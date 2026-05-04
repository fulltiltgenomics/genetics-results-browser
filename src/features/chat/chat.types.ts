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

  /** container height (default: "calc(100vh - 300px)") */
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
  onFirstExchange?: (literatureBackend?: string | null, toolProfile?: string | null) => void;

  /** callback when streaming completes for a message (for persistence) */
  onStreamingComplete?: (
    userMessage: ChatMessage,
    assistantMessage: ChatMessage,
    messageContent?: any[] | null,
    literatureBackend?: string | null,
    toolProfile?: string | null,
  ) => void;

  /** callback to rate a message */
  onRateMessage?: (messageId: string, thumbsUp: boolean | null) => void;

  /** example questions shown in empty state that users can click to send */
  exampleQuestions?: string[];

  /** secret chat mode - messages not logged or persisted */
  isSecretChat?: boolean;
}
