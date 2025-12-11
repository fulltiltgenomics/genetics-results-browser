export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt?: string;
  thumbsUp?: boolean | null;
  contentJson?: string | null; // JSON string of full message content blocks (for tool calls)
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
  onFirstExchange?: () => void;

  /** callback when streaming completes for a message (for persistence) */
  onStreamingComplete?: (
    userMessage: ChatMessage,
    assistantMessage: ChatMessage,
    messageContent?: any[] | null
  ) => void;

  /** callback to rate a message */
  onRateMessage?: (messageId: string, thumbsUp: boolean | null) => void;
}
