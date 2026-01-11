import {
  Box,
  Paper,
  TextField,
  Button,
  Typography,
  CircularProgress,
  Alert,
  IconButton,
  useTheme,
  Collapse,
  Fab,
  Chip,
} from "@mui/material";
import {
  Send as SendIcon,
  Refresh as RefreshIcon,
  ExpandMore as ExpandMoreIcon,
  ExpandLess as ExpandLessIcon,
  KeyboardArrowDown as ArrowDownIcon,
} from "@mui/icons-material";
import { useRef, useEffect, useState, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { fetchEventSource } from "@microsoft/fetch-event-source";
import type { ChatMessage, LLMChatProps } from "./chat.types";
import { MessageRating } from "./MessageRating";

/**
 * Reusable LLM chat component with SSE streaming.
 * Can be used standalone or embedded with phenotype context.
 * Supports session persistence via callbacks.
 */
export const LLMChat = ({
  phenotypeCode,
  contextContent,
  placeholder = "Ask a question...",
  emptyStateTitle = "Start a conversation",
  emptyStateDescription = "Ask questions about human genetics results, phenotypes, genes, or variants.",
  height = "calc(100vh - 300px)",
  sessionId,
  initialMessages,
  onSessionCreated,
  onMessagesChange,
  onFirstExchange,
  onStreamingComplete,
  onRateMessage,
  exampleQuestions,
}: LLMChatProps) => {
  const theme = useTheme();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const [contextExpanded, setContextExpanded] = useState(true);
  const [shouldAutoScroll, setShouldAutoScroll] = useState(true);
  const [hoveredMessageId, setHoveredMessageId] = useState<string | null>(null);
  const hasTriggeredFirstExchange = useRef(false);

  const apiUrl = import.meta.env.VITE_API_URL;

  // track the last session ID to detect actual session switches
  const lastSessionIdRef = useRef<string | null | undefined>(undefined);

  // load initial messages only on mount or when explicitly switching sessions
  // (not when sessionId changes from null to a new ID during inline session creation)
  useEffect(() => {
    const prevSessionId = lastSessionIdRef.current;
    const isFirstMount = prevSessionId === undefined;
    const isInlineCreation = prevSessionId === null && sessionId !== null;
    const isSessionSwitch =
      prevSessionId !== undefined && prevSessionId !== null && sessionId !== prevSessionId;

    lastSessionIdRef.current = sessionId;

    // only load initial messages on first mount or when switching between existing sessions
    if (isFirstMount) {
      if (initialMessages && initialMessages.length > 0) {
        setMessages(initialMessages);
        hasTriggeredFirstExchange.current = true;
      }
      // don't clear on first mount - let the component start empty naturally
    } else if (isSessionSwitch) {
      // switching to a different session - load its messages
      if (initialMessages && initialMessages.length > 0) {
        setMessages(initialMessages);
        hasTriggeredFirstExchange.current = true;
      } else {
        setMessages([]);
        hasTriggeredFirstExchange.current = false;
      }
    }
    // if isInlineCreation, do nothing - keep existing messages
  }, [initialMessages, sessionId]);

  // notify parent when messages change
  useEffect(() => {
    onMessagesChange?.(messages);
  }, [messages, onMessagesChange]);

  const handleScroll = useCallback(() => {
    const container = messagesContainerRef.current;
    if (!container) return;
    const { scrollTop, scrollHeight, clientHeight } = container;
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 50;
    setShouldAutoScroll(isAtBottom);
  }, []);

  useEffect(() => {
    if (shouldAutoScroll) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, shouldAutoScroll]);

  const scrollToBottom = () => {
    setShouldAutoScroll(true);
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  const sendMessage = useCallback(
    async (userMessage: string) => {
      if (!userMessage.trim() || isLoading) return;

      const userMsgId = crypto.randomUUID();
      const userMsg: ChatMessage = {
        id: userMsgId,
        role: "user",
        content: userMessage,
      };
      setMessages((prev) => [...prev, userMsg]);
      setIsLoading(true);
      setError(null);

      const assistantMsgId = crypto.randomUUID();
      setMessages((prev) => [...prev, { id: assistantMsgId, role: "assistant", content: "" }]);

      abortControllerRef.current?.abort();
      abortControllerRef.current = new AbortController();

      // build message history, using contentJson when available for full tool context
      const messageHistory = [
        ...messages
          .filter((m) => m.content.trim() !== "")
          .map((m) => {
            // if contentJson is available, use it for the full message structure
            if (m.contentJson) {
              try {
                const parsed = JSON.parse(m.contentJson);
                return { role: m.role, content: parsed };
              } catch {
                // fall back to text content if parsing fails
              }
            }
            return { role: m.role, content: m.content };
          }),
        { role: "user" as const, content: userMessage },
      ];

      let accumulatedContent = "";
      let messageContent: any[] | null = null;

      try {
        await fetchEventSource(`${apiUrl}/v1/chat`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          credentials: "include",
          body: JSON.stringify({
            messages: messageHistory,
            phenotype_code: phenotypeCode || null,
            provider: "anthropic",
            enable_mcp: true,
          }),
          signal: abortControllerRef.current.signal,
          async onopen(response) {
            if (
              response.ok &&
              response.headers.get("content-type")?.includes("text/event-stream")
            ) {
              return;
            }
            const contentType = response.headers.get("content-type");
            if (contentType?.includes("application/json")) {
              const errorData = await response.json();
              throw new Error(errorData.detail || errorData.error || `HTTP ${response.status}`);
            }
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
          },
          onmessage(event) {
            if (!event.data || event.data.trim() === "") return;
            try {
              const data = JSON.parse(event.data);
              if (data.type === "content" && data.content) {
                accumulatedContent += data.content;
                const newContent = accumulatedContent;
                setMessages((prev) =>
                  prev.map((m) => (m.id === assistantMsgId ? { ...m, content: newContent } : m))
                );
              } else if (data.type === "done") {
                // capture message_content for persistence (includes tool calls)
                messageContent = data.message_content || null;
              } else if (data.type === "error") {
                throw new Error(data.error);
              }
            } catch {
              // ignore malformed SSE chunks
            }
          },
          onerror(err) {
            console.error("SSE error:", err);
            throw err;
          },
          openWhenHidden: true,
        });

        // streaming completed - notify parent with the completed messages
        if (accumulatedContent) {
          const completedAssistantMsg: ChatMessage = {
            id: assistantMsgId,
            role: "assistant",
            content: accumulatedContent,
          };
          onStreamingComplete?.(userMsg, completedAssistantMsg, messageContent);

          // check if this is the first exchange
          if (!hasTriggeredFirstExchange.current) {
            hasTriggeredFirstExchange.current = true;
            onFirstExchange?.();
          }
        }
      } catch (err: any) {
        if (err.name === "AbortError") {
          return;
        }
        console.error("Chat error:", err);
        setError(err.message || "Failed to send message");
        setMessages((prev) => prev.filter((m) => m.id !== assistantMsgId || m.content));
      } finally {
        setIsLoading(false);
      }
    },
    [messages, phenotypeCode, apiUrl, isLoading, onFirstExchange, onStreamingComplete]
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;
    sendMessage(input);
    setInput("");
  };

  const handleRetry = () => {
    const lastUserMsg = [...messages].reverse().find((m) => m.role === "user");
    if (lastUserMsg) {
      setMessages((prev) => {
        const newMessages = [...prev];
        if (newMessages.length > 0 && newMessages[newMessages.length - 1].role === "assistant") {
          newMessages.pop();
        }
        if (newMessages.length > 0 && newMessages[newMessages.length - 1].role === "user") {
          newMessages.pop();
        }
        return newMessages;
      });
      sendMessage(lastUserMsg.content);
    }
  };

  const handleRateMessage = (messageId: string, thumbsUp: boolean | null) => {
    // update local state
    setMessages((prev) => prev.map((m) => (m.id === messageId ? { ...m, thumbsUp } : m)));
    // notify parent to save to backend
    onRateMessage?.(messageId, thumbsUp);
  };

  const markdownStyles = {
    "& p": { margin: "0.5em 0" },
    "& pre": {
      bgcolor: theme.palette.mode === "dark" ? "grey.800" : "grey.100",
      p: 1,
      borderRadius: 1,
      overflow: "auto",
    },
    "& code": {
      bgcolor: theme.palette.mode === "dark" ? "grey.800" : "grey.100",
      px: 0.5,
      borderRadius: 0.5,
    },
    "& ul, & ol": { pl: 2 },
    "& table": {
      borderCollapse: "collapse",
      width: "100%",
      "& th, & td": {
        border: `1px solid ${theme.palette.divider}`,
        p: 1,
        textAlign: "left",
      },
      "& th": {
        bgcolor: theme.palette.mode === "dark" ? "grey.800" : "grey.100",
      },
    },
  };

  const hasMessages = messages.length > 0;

  const inputForm = (
    <Paper
      component="form"
      onSubmit={handleSubmit}
      sx={{
        p: 2,
        display: "flex",
        gap: 1,
        // maxWidth: hasMessages ? "100%" : 600,
        maxWidth: "100%",
        width: "100%",
      }}>
      <TextField
        fullWidth
        multiline
        maxRows={4}
        value={input}
        onChange={(e) => setInput(e.target.value)}
        placeholder={placeholder}
        disabled={isLoading}
        autoFocus
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            handleSubmit(e);
          }
        }}
      />
      <Button
        type="submit"
        variant="contained"
        disabled={isLoading || !input.trim()}
        sx={{ minWidth: 100 }}>
        {isLoading ? <CircularProgress size={24} /> : <SendIcon />}
      </Button>
    </Paper>
  );

  // empty state: input at top center
  if (!hasMessages) {
    return (
      <Box sx={{ display: "flex", flexDirection: "column", height, alignItems: "center" }}>
        {/* optional context content (e.g., phenotype markdown) */}
        {contextContent && (
          <Paper sx={{ mb: 2, width: "100%" }}>
            <Box
              sx={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                p: 1.5,
                cursor: "pointer",
                bgcolor: theme.palette.mode === "dark" ? "grey.800" : "grey.100",
                borderRadius: contextExpanded ? "4px 4px 0 0" : 1,
              }}
              onClick={() => setContextExpanded(!contextExpanded)}>
              <Typography variant="subtitle1" fontWeight="medium">
                {contextContent.title}
              </Typography>
              <IconButton size="small">
                {contextExpanded ? <ExpandLessIcon /> : <ExpandMoreIcon />}
              </IconButton>
            </Box>
            <Collapse in={contextExpanded}>
              <Box sx={{ p: 2, maxHeight: 300, overflow: "auto", ...markdownStyles }}>
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{contextContent.markdown}</ReactMarkdown>
              </Box>
            </Collapse>
          </Paper>
        )}
        {inputForm}

        {/* example questions */}
        {exampleQuestions && exampleQuestions.length > 0 && (
          <Box sx={{ mt: 3, maxWidth: 800, width: "100%" }}>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
              Try asking:
            </Typography>
            <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
              {exampleQuestions.map((question, index) => (
                <Chip
                  key={index}
                  label={question}
                  onClick={() => sendMessage(question)}
                  disabled={isLoading}
                  sx={{
                    height: "auto",
                    py: 1,
                    px: 0.5,
                    "& .MuiChip-label": {
                      whiteSpace: "normal",
                      textAlign: "left",
                    },
                    cursor: "pointer",
                    "&:hover": {
                      bgcolor: theme.palette.action.hover,
                    },
                  }}
                  variant="outlined"
                />
              ))}
            </Box>
          </Box>
        )}
      </Box>
    );
  }

  // with messages: messages area with fixed input at bottom
  return (
    <Box sx={{ display: "flex", flexDirection: "column", height, position: "relative" }}>
      {/* optional context content (e.g., phenotype markdown) */}
      {contextContent && (
        <Paper sx={{ mb: 2 }}>
          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              p: 1.5,
              cursor: "pointer",
              bgcolor: theme.palette.mode === "dark" ? "grey.800" : "grey.100",
              borderRadius: contextExpanded ? "4px 4px 0 0" : 1,
            }}
            onClick={() => setContextExpanded(!contextExpanded)}>
            <Typography variant="subtitle1" fontWeight="medium">
              {contextContent.title}
            </Typography>
            <IconButton size="small">
              {contextExpanded ? <ExpandLessIcon /> : <ExpandMoreIcon />}
            </IconButton>
          </Box>
          <Collapse in={contextExpanded}>
            <Box sx={{ p: 2, maxHeight: 300, overflow: "auto", ...markdownStyles }}>
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{contextContent.markdown}</ReactMarkdown>
            </Box>
          </Collapse>
        </Paper>
      )}

      {/* messages area */}
      <Paper
        ref={messagesContainerRef}
        onScroll={handleScroll}
        sx={{
          flex: 1,
          p: 2,
          mb: 2,
          overflow: "auto",
          bgcolor: theme.palette.mode === "dark" ? "grey.900" : "grey.50",
          position: "relative",
        }}>
        {messages.map((message, index) => (
          <Box
            key={message.id || index}
            sx={{
              mb: 2,
              display: "flex",
              justifyContent: message.role === "user" ? "flex-end" : "flex-start",
            }}
            onMouseEnter={() => setHoveredMessageId(message.id)}
            onMouseLeave={() => setHoveredMessageId(null)}>
            <Box sx={{ maxWidth: "80%" }}>
              <Paper
                sx={{
                  p: 2,
                  bgcolor:
                    message.role === "user"
                      ? theme.palette.primary.main
                      : theme.palette.background.paper,
                  color:
                    message.role === "user"
                      ? theme.palette.primary.contrastText
                      : theme.palette.text.primary,
                }}>
                <Typography
                  variant="caption"
                  sx={{
                    fontWeight: "bold",
                    mb: 1,
                    display: "block",
                    opacity: 0.8,
                  }}>
                  {message.role === "user" ? "You" : "FinnGenie"}
                </Typography>
                <Box sx={markdownStyles}>
                  {message.content ? (
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>
                  ) : (
                    <Typography variant="body2" color="text.secondary" fontStyle="italic">
                      ...
                    </Typography>
                  )}
                </Box>
              </Paper>
              {/* rating buttons for assistant messages */}
              {message.role === "assistant" && message.content && onRateMessage && (
                <Box sx={{ display: "flex", justifyContent: "flex-start", mt: 0.5 }}>
                  <MessageRating
                    messageId={message.id}
                    thumbsUp={message.thumbsUp ?? null}
                    onRate={handleRateMessage}
                    visible={hoveredMessageId === message.id}
                  />
                </Box>
              )}
            </Box>
          </Box>
        ))}

        {isLoading && messages[messages.length - 1]?.content === "" && (
          <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 2 }}>
            <CircularProgress size={20} />
            <Typography variant="body2" color="text.secondary">
              Thinking...
            </Typography>
          </Box>
        )}

        <div ref={messagesEndRef} />

        {!shouldAutoScroll && messages.length > 0 && (
          <Fab
            size="small"
            color="primary"
            onClick={scrollToBottom}
            sx={{
              position: "sticky",
              bottom: 8,
              left: "50%",
              transform: "translateX(-50%)",
            }}>
            <ArrowDownIcon />
          </Fab>
        )}
      </Paper>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
          <IconButton size="small" onClick={handleRetry} sx={{ ml: 1 }}>
            <RefreshIcon fontSize="small" />
          </IconButton>
        </Alert>
      )}

      {inputForm}
    </Box>
  );
};
