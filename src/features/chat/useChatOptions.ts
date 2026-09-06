import { create } from "zustand";
import type { LiteratureBackend, ToolProfile, Verbosity } from "./chat.types";
import {
  DEFAULT_OPTIONS,
  LITERATURE_BACKEND_KEY,
  TOOL_PROFILE_KEY,
  VERBOSITY_KEY,
  coerceToolProfile,
  fetchResolvedToolProfile,
  getStoredChatOptions,
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
  toolProfile: ToolProfile;
  /** what the server answered for each profile we have asked about, keyed by profile name.
   * Absent means unasked or unanswerable — see checkProfile */
  profileChecks: Record<string, ResolvedToolProfile>;
  defaultVerbosity: Verbosity;
  defaultLiteratureBackend: LiteratureBackend;
  defaultToolProfile: ToolProfile;
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
  setToolProfile: (value: ToolProfile) => void;
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
    persist(TOOL_PROFILE_KEY, value);
  },

  applyFromConversation: (options) => {
    const resolved = resolveCurrent(options, get());
    set({ ...resolved, lastConversation: options });
    checkProfile(resolved.toolProfile, set, get);
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

/** Ask the server how big the surface this profile resolves to is, without making the chat wait
 * for the answer.
 *
 * Deliberately fire-and-forget: the answer is a caption under a control, not data a message needs,
 * so it never gates sending and never produces a loading state. A `null` answer — offline, 5xx, a
 * backend predating the endpoint — is left OUT of profileChecks entirely, so the caption is simply
 * absent rather than guessed at. */
function checkProfile(
  profile: ToolProfile,
  set: (partial: Partial<ChatOptionsState>) => void,
  get: () => ChatOptionsState,
) {
  if (profileChecksInflight.has(profile) || get().profileChecks[profile]) return;
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
  defaultToolProfile: ToolProfile;
}

/** what the controls should show for a conversation: its own value where it has one, the user's
 * default where it does not. the tool profile is the exception — a row with no value is not a gap
 * to fill from the default but a message the server ran without code execution, which is what
 * coerceToolProfile answers for it */
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
    toolProfile: coerceToolProfile(options.toolProfile),
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
