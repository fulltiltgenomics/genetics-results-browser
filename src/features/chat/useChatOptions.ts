import { create } from "zustand";
import { TOOL_PROFILES } from "./chat.types";
import type { LiteratureBackend, ToolProfileValue, Verbosity } from "./chat.types";
import {
  DEFAULT_OPTIONS,
  LITERATURE_BACKEND_KEY,
  TOOL_PROFILE_ALL,
  TOOL_PROFILE_KEY,
  VERBOSITY_KEY,
  fetchResolvedToolProfile,
  getStoredChatOptions,
  isPlausibleToolProfile,
  saveChatOption,
} from "./chatOptionsApi";
import type { ResolvedToolProfile } from "./chatOptionsApi";

// module-level for the same reason as useInstructionSets: ChatPage remounts LLMChat on every
// conversation switch, so component state would reset these to the built-in defaults each time.
//
// two layers, because opening an old conversation must not rewrite what the user prefers:
//   default* - the user's own last explicit choice, persisted server-side so it follows them
//              across browsers. only a control interaction writes it.
//   current  - what the controls show and what the next message sends. a conversation's stored
//              options overwrite this and nothing else, so going back to an old detailed chat
//              does not make "detailed" the default for the next new chat.

export interface ConversationOptions {
  verbosity?: string | null;
  literatureBackend?: string | null;
  toolProfile?: string | null;
}

interface ChatOptionsState {
  verbosity: Verbosity;
  literatureBackend: LiteratureBackend;
  toolProfile: ToolProfileValue | null;
  /** what the server answered for each profile we have asked about, keyed by profile name.
   * Absent means unasked or unanswerable — see checkProfile */
  profileChecks: Record<string, ResolvedToolProfile>;
  defaultVerbosity: Verbosity;
  defaultLiteratureBackend: LiteratureBackend;
  defaultToolProfile: ToolProfileValue | null;
  loaded: boolean;
  /** the conversation on screen, so load() can re-resolve its NULL fields against the defaults it
   * fetches. null means a new chat, which follows the defaults outright */
  lastConversation: ConversationOptions | null;
  /** an explicit pick outranks a value still being fetched, which is by then the stale one its own
   * PUT is already replacing */
  userChose: boolean;
  load: () => Promise<void>;
  setVerbosity: (value: Verbosity) => void;
  setLiteratureBackend: (value: LiteratureBackend) => void;
  setToolProfile: (value: ToolProfileValue | null) => void;
  /** apply a conversation's stored options without touching the user's default */
  applyFromConversation: (options: ConversationOptions) => void;
  /** starting a new chat returns the controls to the user's default */
  resetToDefaults: () => void;
}

// deep-linking to /chat/<id> races the settings fetch against the session fetch, and the controls
// are usable before either resolves, so a late load() must not clobber what is already on screen.
// lastConversation and userChose record which of those already happened
let inflight: Promise<void> | null = null;

export const useChatOptionsStore = create<ChatOptionsState>((set, get) => ({
  verbosity: DEFAULT_OPTIONS.verbosity,
  literatureBackend: DEFAULT_OPTIONS.literatureBackend,
  toolProfile: DEFAULT_OPTIONS.toolProfile,
  profileChecks: {},
  defaultVerbosity: DEFAULT_OPTIONS.verbosity,
  defaultLiteratureBackend: DEFAULT_OPTIONS.literatureBackend,
  defaultToolProfile: DEFAULT_OPTIONS.toolProfile,
  loaded: false,
  lastConversation: null,
  userChose: false,

  load: () => {
    if (inflight) return inflight;
    if (get().loaded) return Promise.resolve();
    inflight = (async () => {
      try {
        const stored = await getStoredChatOptions();
        if (get().userChose) {
          // an explicit pick already happened and its PUT is replacing what was just fetched
          set({ loaded: true });
          return;
        }
        const defaults = {
          defaultVerbosity: stored.verbosity,
          defaultLiteratureBackend: stored.literatureBackend,
          defaultToolProfile: stored.toolProfile,
        };
        const resolved = resolveCurrent(get().lastConversation, defaults);
        checkProfile(resolved.toolProfile, set, get);
        set({
          loaded: true,
          ...defaults,
          // re-resolve rather than keep what is on screen: a conversation that predates an option
          // leaves it NULL, and that gap has to fall through to the default just fetched, not to
          // the built-in one that was standing in when the conversation was opened
          ...resolved,
        });
        // the stored profile was a name this build does not enumerate. It has just resolved to
        // "All" above, which is WIDER than whatever the user stored; ask the server before letting
        // that stand
        if (stored.unknownToolProfile) {
          adoptServerKnownProfile(stored.unknownToolProfile, set, get);
        }
      } catch (err) {
        // these are preferences, not state a chat needs; fall back to the built-in defaults
        console.error("Failed to load chat options:", err);
      } finally {
        inflight = null;
      }
    })();
    return inflight;
  },

  setVerbosity: (value) => {
    set({ verbosity: value, defaultVerbosity: value, userChose: true });
    persist(VERBOSITY_KEY, value);
  },

  setLiteratureBackend: (value) => {
    set({ literatureBackend: value, defaultLiteratureBackend: value, userChose: true });
    persist(LITERATURE_BACKEND_KEY, value);
  },

  setToolProfile: (value) => {
    set({ toolProfile: value, defaultToolProfile: value, userChose: true });
    checkProfile(value, set, get);
    persist(TOOL_PROFILE_KEY, value ?? TOOL_PROFILE_ALL);
  },

  applyFromConversation: (options) => {
    set({ ...resolveCurrent(options, get()), lastConversation: options });
  },

  resetToDefaults: () => {
    const state = get();
    set({
      lastConversation: null,
      verbosity: state.defaultVerbosity,
      literatureBackend: state.defaultLiteratureBackend,
      toolProfile: state.defaultToolProfile,
    });
  },
}));

// profiles whose check is in flight, so a user clicking back and forth does not queue a request
// per click. A settled answer is cached in profileChecks and never re-asked
const profileChecksInflight = new Set<string>();

/** Ask the server whether it knows this profile, without making the chat wait for the answer
 * (genetics-results-suite-4h6.74).
 *
 * Deliberately fire-and-forget: this is a correctness signal about a control, not data a message
 * needs, so it never gates sending and never produces a loading state. A `null` answer — offline,
 * 5xx, a backend predating the endpoint — is left OUT of profileChecks entirely rather than
 * recorded as "unknown", because the UI must only ever react to an explicit `known_profile: false`.
 * "all" (null) is not a profile the server can fail to recognise, so it is not asked about. */
function checkProfile(
  profile: ToolProfileValue | null,
  set: (partial: Partial<ChatOptionsState>) => void,
  get: () => ChatOptionsState,
) {
  if (!profile || profileChecksInflight.has(profile) || get().profileChecks[profile]) return;
  profileChecksInflight.add(profile);
  void fetchResolvedToolProfile(profile)
    .then((result) => {
      if (result) {
        set({ profileChecks: { ...get().profileChecks, [profile]: result } });
      }
    })
    // fetchResolvedToolProfile swallows its own failures, so this only catches a future one that
    // stops doing that. A rejected probe must still be a no-op, never an unhandled rejection
    .catch(() => {})
    .finally(() => profileChecksInflight.delete(profile));
}

/** Keep a stored profile this build does not enumerate, if the server says it knows it
 * (genetics-results-suite-4h6.74).
 *
 * This is the drift direction `coerceToolProfile` cannot see. A profile added or renamed
 * server-side is absent from TOOL_PROFILES, so a user whose stored `chat_tool_profile` is that
 * name gets it narrowed to `null` — and `null` server-side means NO filtering, the full ~65-tool
 * surface. The user asked for less and silently got more, the Tools row says "All", and the
 * message never carries the profile at all, so neither the resolved-tools probe nor the server's
 * warn-once can observe it: the value stops existing before either one runs.
 *
 * Only `known_profile: true` changes anything. `false`, an unanswerable probe, or an implausible
 * name all leave the pre-existing behaviour exactly as it was — nothing is selected, "All" stands.
 * Nothing is persisted either: the settings row already holds this value, and a PUT here would
 * write back a name from a server the user may not be on next time.
 *
 * One probe, from `load`, which itself runs once. There is no retry and no re-ask. */
function adoptServerKnownProfile(
  name: string,
  set: (partial: Partial<ChatOptionsState>) => void,
  get: () => ChatOptionsState,
) {
  if (!isPlausibleToolProfile(name) || profileChecksInflight.has(name)) return;
  profileChecksInflight.add(name);
  void fetchResolvedToolProfile(name)
    .then((result) => {
      if (!result?.known) return;
      const state = get();
      // an explicit pick made while this was in flight is the newer intent, and its own PUT has
      // already replaced the stored value this probe was about
      if (state.userChose) return;
      set({
        profileChecks: { ...state.profileChecks, [name]: result },
        defaultToolProfile: name,
        // a conversation on screen carries its OWN profile; the user's stored default must not
        // overwrite what that conversation was run with. It still becomes the default for the
        // next new chat
        ...(state.lastConversation === null && state.toolProfile === null
          ? { toolProfile: name }
          : {}),
      });
    })
    .catch(() => {})
    .finally(() => profileChecksInflight.delete(name));
}

/** test-only. The in-flight set is module state that a `setState` reset cannot reach, and an entry
 * left behind by a check that had not settled when a test ended would silently make the next
 * test's check a no-op */
export function __resetToolProfileChecks() {
  profileChecksInflight.clear();
  useChatOptionsStore.setState({ profileChecks: {} });
}

interface Defaults {
  defaultVerbosity: Verbosity;
  defaultLiteratureBackend: LiteratureBackend;
  defaultToolProfile: ToolProfileValue | null;
}

/** what the controls should show for a conversation: its own value where it has one, the user's
 * default where it does not. a null toolProfile is "all", which is a real choice rather than a gap,
 * so only undefined falls through */
function resolveCurrent(options: ConversationOptions | null, defaults: Defaults) {
  if (!options) {
    return {
      verbosity: defaults.defaultVerbosity,
      literatureBackend: defaults.defaultLiteratureBackend,
      toolProfile: defaults.defaultToolProfile,
    };
  }
  return {
    verbosity: coerceOr(options.verbosity, ["brief", "detailed"] as const, defaults.defaultVerbosity),
    literatureBackend: coerceOr(
      options.literatureBackend,
      ["europepmc", "perplexity"] as const,
      defaults.defaultLiteratureBackend,
    ),
    toolProfile: coerceOr(options.toolProfile, TOOL_PROFILES, null),
  };
}

function coerceOr<T extends string, F>(value: unknown, allowed: readonly T[], fallback: F): T | F {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

function persist(key: string, value: string) {
  saveChatOption(key, value).catch((err) =>
    console.error(`Failed to save the ${key} preference:`, err),
  );
}
