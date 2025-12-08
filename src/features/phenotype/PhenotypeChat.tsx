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

interface PhenotypeChatProps {
  phenocode: string;
  markdownContent: string | null;
}

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
}

/**
 * Chat interface component with custom SSE streaming.
 * Handles streaming responses from the backend LLM endpoint.
 */
export const PhenotypeChat = ({ phenocode, markdownContent }: PhenotypeChatProps) => {
  const theme = useTheme();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const [markdownExpanded, setMarkdownExpanded] = useState(true);
  const [shouldAutoScroll, setShouldAutoScroll] = useState(true);

  const apiUrl = import.meta.env.VITE_API_URL;

  // detect if user has scrolled away from bottom
  const handleScroll = useCallback(() => {
    const container = messagesContainerRef.current;
    if (!container) return;
    const { scrollTop, scrollHeight, clientHeight } = container;
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 50;
    setShouldAutoScroll(isAtBottom);
  }, []);

  // auto-scroll to bottom only when user is at/near bottom
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

      // add user message to chat
      const userMsg: ChatMessage = {
        id: `user-${Date.now()}`,
        role: "user",
        content: userMessage,
      };
      setMessages((prev) => [...prev, userMsg]);
      setIsLoading(true);
      setError(null);

      // prepare assistant message placeholder
      const assistantMsgId = `assistant-${Date.now()}`;
      setMessages((prev) => [...prev, { id: assistantMsgId, role: "assistant", content: "" }]);

      // abort any previous request
      abortControllerRef.current?.abort();
      abortControllerRef.current = new AbortController();

      // prepare message history for API - filter out empty messages
      const messageHistory = [
        ...messages
          .filter((m) => m.content.trim() !== "")
          .map((m) => ({ role: m.role, content: m.content })),
        { role: "user" as const, content: userMessage },
      ];

      // track content accumulation for this request
      let accumulatedContent = "";

      try {
        await fetchEventSource(`${apiUrl}/v1/chat`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          credentials: "include",
          body: JSON.stringify({
            messages: messageHistory,
            phenotype_code: phenocode,
            provider: "anthropic",
            enable_mcp: true,
          }),
          signal: abortControllerRef.current.signal,
          onmessage(event) {
            try {
              const data = JSON.parse(event.data);
              if (data.type === "content" && data.content) {
                accumulatedContent += data.content;
                const newContent = accumulatedContent;
                setMessages((prev) =>
                  prev.map((m) => (m.id === assistantMsgId ? { ...m, content: newContent } : m))
                );
              } else if (data.type === "error") {
                throw new Error(data.error);
              }
            } catch (parseError) {
              console.error("Error parsing JSON in SSE:", parseError);
            }
          },
          onerror(err) {
            console.error("SSE error:", err);
            throw err;
          },
          openWhenHidden: true, // keep connection open when tab is hidden
        });
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
    [messages, phenocode, apiUrl, isLoading]
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;
    sendMessage(input);
    setInput("");
  };

  const handleRetry = () => {
    // find last user message and retry
    const lastUserMsg = [...messages].reverse().find((m) => m.role === "user");
    if (lastUserMsg) {
      // remove last assistant message if empty
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

  return (
    <Box sx={{ display: "flex", flexDirection: "column", height: "calc(100vh - 300px)" }}>
      {markdownContent && (
        <Paper sx={{ mb: 2 }}>
          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              p: 1.5,
              cursor: "pointer",
              bgcolor: theme.palette.mode === "dark" ? "grey.800" : "grey.100",
              borderRadius: markdownExpanded ? "4px 4px 0 0" : 1,
            }}
            onClick={() => setMarkdownExpanded(!markdownExpanded)}>
            <Typography variant="subtitle1" fontWeight="medium">
              Phenotype Report: {phenocode}
            </Typography>
            <IconButton size="small">
              {markdownExpanded ? <ExpandLessIcon /> : <ExpandMoreIcon />}
            </IconButton>
          </Box>
          <Collapse in={markdownExpanded}>
            <Box
              sx={{
                p: 2,
                maxHeight: 300,
                overflow: "auto",
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
              }}>
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{markdownContent}</ReactMarkdown>
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
        {messages.length === 0 && (
          <Box sx={{ textAlign: "center", py: 4 }}>
            <Typography variant="h6" color="text.secondary" gutterBottom>
              Start a conversation about {phenocode}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Ask questions about the phenotype, request genetic insights, or query specific data.
            </Typography>
          </Box>
        )}

        {messages.map((message, index) => (
          <Box
            key={message.id || index}
            sx={{
              mb: 2,
              display: "flex",
              justifyContent: message.role === "user" ? "flex-end" : "flex-start",
            }}>
            <Paper
              sx={{
                p: 2,
                maxWidth: "80%",
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
                {message.role === "user" ? "You" : "Assistant"}
              </Typography>
              <Box
                sx={{
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
                  "& ul, & ol": {
                    pl: 2,
                  },
                }}>
                {message.content ? (
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>
                ) : (
                  <Typography variant="body2" color="text.secondary" fontStyle="italic">
                    ...
                  </Typography>
                )}
              </Box>
            </Paper>
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

        {/* scroll to bottom button */}
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

      <Paper
        component="form"
        onSubmit={handleSubmit}
        sx={{
          p: 2,
          display: "flex",
          gap: 1,
        }}>
        <TextField
          fullWidth
          multiline
          maxRows={4}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask a question about this phenotype..."
          disabled={isLoading}
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
    </Box>
  );
};
