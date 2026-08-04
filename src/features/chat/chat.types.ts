export interface ContextUsage {
  iteration: number;
  input_tokens: number;
  output_tokens: number;
  total_input_tokens: number;
  total_output_tokens: number;
  context_window: number;
  context_percent: number;
}

export type LiteratureBackend = "europepmc" | "perplexity";

export type ToolProfile = "api" | "bigquery" | "rag";

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

  /** callback when messages change (for external tracking) */
  onMessagesChange?: (messages: ChatMessage[]) => void;

  /** callback when the first message exchange completes (for title generation) */
  onFirstExchange?: (
    literatureBackend?: string | null,
    toolProfile?: string | null,
    instructionSetId?: string | null,
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
