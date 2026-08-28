/** payload of one `usage` SSE event, emitted per agentic-loop iteration */
export interface ContextUsage {
  iteration: number;
  /** the whole context of this call, cached parts included — NOT the billed input */
  input_tokens: number;
  /**
   * part of input_tokens served from the prompt cache. Optional because the browser
   * deploys independently of the MCP backend: during a rollout window a pre-change
   * backend still emits `usage` events without the cache fields.
   */
  cache_read?: number;
  /** part of input_tokens written into the prompt cache; ~12x the price of a read */
  cache_create?: number;
  output_tokens: number;
  /** cumulative billed uncached input, i.e. input_tokens minus both cache fields */
  total_input_tokens: number;
  total_output_tokens: number;
  context_window: number;
  context_percent: number;
}

export type LiteratureBackend = "europepmc" | "perplexity";

/** every selectable tool profile, and the single source of truth for the union below. anything
 * that narrows or enumerates a profile must read this rather than repeat the literals: a list
 * that falls behind does not fail, it silently resolves to `null` — see `coerceToolProfile` for
 * why that is the dangerous direction */
export const TOOL_PROFILES = ["api", "bigquery", "rag", "code"] as const;

export type ToolProfile = (typeof TOOL_PROFILES)[number];

/** a profile value as it travels: one of this build's own names, or a name only the SERVER knows.
 * The second case is the other half of the drift the list above warns about — a profile added
 * server-side is absent here, and narrowing it away resolves it to `null`, which is the FULL tool
 * surface rather than the smaller one the user stored. The browser therefore asks the server about
 * an unrecognised stored value instead of discarding it (genetics-results-suite-4h6.74); see
 * `adoptServerKnownProfile` in useChatOptions.ts. Nothing may be *selectable* outside TOOL_PROFILES
 * — this type only carries a value the server has confirmed. */
export type ToolProfileValue = ToolProfile | (string & {});

export type Verbosity = "brief" | "detailed";

/** a named set of user-authored instructions appended to the chat system prompt */
export interface InstructionSet {
  id: string;
  name: string;
  body: string;
  createdAt: string;
  updatedAt: string;
  /** the stored body predates the character cap, so saving it back unchanged is rejected */
  bodyOverCap: boolean;
}

export interface InstructionSetVersion {
  id: number;
  setId: string;
  name: string;
  body: string;
  changedAt: string;
  comment?: string | null;
}

export type AttachmentType = "image" | "tsv" | "excel";

export interface FileAttachment {
  id: string;
  name: string;
  size: number;
  type: AttachmentType;
  mimeType: string;
  // for images: base64 data URL for preview; for data files: parsed preview text
  previewUrl?: string;
  // upload status
  status: "pending" | "uploading" | "uploaded" | "error";
  // server-side ID after upload
  serverId?: string;
  // error message if upload failed
  error?: string;
  // original file, kept on sent messages so the upload can preserve the real bytes
  // (an Excel file's textContent is parsed TSV, not something we can re-upload)
  file?: File;
  // model-ready text for data files, inlined as a "[File: name]" block on every turn.
  // Cached at send time and refetched from the server sidecar when a session is
  // restored, so replayed turns don't depend on the local File still being around.
  textContent?: string;
}

export interface PendingAttachment extends FileAttachment {
  file: File;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt?: string;
  thumbsUp?: boolean | null;
  contentJson?: string | null; // JSON string of full message content blocks (for tool calls)
  toolResultsJson?: string | null; // JSON string of tool_result blocks for this assistant turn
  literatureBackend?: string | null; // literature search backend used
  verbosity?: string | null; // answer detail this turn was produced under
  instructionSetId?: string | null; // instruction set this turn was produced under
  attachments?: FileAttachment[]; // file attachments (images, TSV, Excel)
}

export interface LLMChatProps {
  /** optional phenotype code for context */
  phenotypeCode?: string;

  /** optional pre-loaded content to display above chat */
  contextContent?: {
    title: string;
    markdown: string;
  };

  /** placeholder text for input field */
  placeholder?: string;

  /** title shown in empty state */
  emptyStateTitle?: string;

  /** description shown in empty state */
  emptyStateDescription?: string;

  /** container height (default: "calc(100dvh - 300px)") */
  height?: string;

  /** current session ID (for persistence) */
  sessionId?: string | null;

  /** initial messages to load (when resuming a session) */
  initialMessages?: ChatMessage[];

  /** callback when a new session is created */
  onSessionCreated?: (sessionId: string) => void;

  /**
   * Resolve the session id for a turn, creating the session if there is not one yet.
   * Awaited BEFORE the request goes out, because `session_id` is not only for persistence:
   * it becomes the `sid` claim of the per-execution sandbox credential, and `run_analysis`
   * refuses a turn without one (genetics-results-suite-vda). Creating the session after the
   * exchange left the first turn of every inline-started chat unable to run code.
   */
  onEnsureSession?: () => Promise<string | null>;

  /** callback when messages change (for external tracking) */
  onMessagesChange?: (messages: ChatMessage[]) => void;

  /** callback when the first message exchange completes (for title generation) */
  onFirstExchange?: (
    literatureBackend?: string | null,
    toolProfile?: string | null,
    instructionSetId?: string | null,
    verbosity?: string | null,
  ) => void;

  /** callback when streaming completes for a message (for persistence) */
  onStreamingComplete?: (
    userMessage: ChatMessage,
    assistantMessage: ChatMessage,
    messageContent?: any[] | null,
    literatureBackend?: string | null,
    toolProfile?: string | null,
    toolResults?: any[] | null,
    instructionSetId?: string | null,
    verbosity?: string | null,
  ) => void;

  /** callback to rate a message */
  onRateMessage?: (messageId: string, thumbsUp: boolean | null) => void;

  /** example questions shown in empty state that users can click to send */
  exampleQuestions?: string[];

  /** secret chat mode - messages not logged or persisted */
  isSecretChat?: boolean;

  /** read-only mode - hides input area (for shared sessions viewed by non-owners) */
  readOnly?: boolean;

  /** prefilled draft for the input textarea on mount (e.g. an annotation-side "ask the assistant"
   *  seed). does NOT auto-send — the user reviews and submits. */
  initialInput?: string;

  /** pending attachments restored on mount (draft preservation across conversation switches).
   *  the File objects live in memory only, so this works within a page session but not across
   *  reloads. */
  initialAttachments?: PendingAttachment[];

  /** notifies the parent whenever the unsent draft (input text or pending attachments) changes,
   *  so it can be restored via initialInput/initialAttachments after a remount */
  onDraftChange?: (input: string, attachments: PendingAttachment[]) => void;
}
