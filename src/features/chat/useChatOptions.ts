import { create } from "zustand";
import type { LiteratureBackend, ToolProfile, Verbosity } from "./chat.types";
import {
  DEFAULT_OPTIONS,
  LITERATURE_BACKEND_KEY,
  TOOL_PROFILE_ALL,
  TOOL_PROFILE_KEY,
  VERBOSITY_KEY,
  getStoredChatOptions,
  saveChatOption,
} from "./chatOptionsApi";

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
  toolProfile: ToolProfile | null;
  defaultVerbosity: Verbosity;
  defaultLiteratureBackend: LiteratureBackend;
  defaultToolProfile: ToolProfile | null;
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
  setToolProfile: (value: ToolProfile | null) => void;
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
        set({
          loaded: true,
          ...defaults,
          // re-resolve rather than keep what is on screen: a conversation that predates an option
          // leaves it NULL, and that gap has to fall through to the default just fetched, not to
          // the built-in one that was standing in when the conversation was opened
          ...resolveCurrent(get().lastConversation, defaults),
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

interface Defaults {
  defaultVerbosity: Verbosity;
  defaultLiteratureBackend: LiteratureBackend;
  defaultToolProfile: ToolProfile | null;
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
    toolProfile: coerceOr(options.toolProfile, ["api", "bigquery", "rag"] as const, null),
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
