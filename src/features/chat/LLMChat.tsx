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
  RadioGroup,
  Radio,
  FormControlLabel,
  Tooltip,
} from "@mui/material";
import {
  Send as SendIcon,
  Refresh as RefreshIcon,
  ExpandMore as ExpandMoreIcon,
  ExpandLess as ExpandLessIcon,
  KeyboardArrowDown as ArrowDownIcon,
  AttachFile as AttachFileIcon,
  InfoOutlined as InfoIcon,
} from "@mui/icons-material";
import React, { useRef, useEffect, useState, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { fetchEventSource } from "@microsoft/fetch-event-source";
import type { ChatMessage, LLMChatProps, LiteratureBackend, ToolProfile, PendingAttachment, FileAttachment } from "./chat.types";
import { MessageRating } from "./MessageRating";
import { PendingAttachments, MessageAttachments } from "./FileAttachments";
import { getAttachmentType, isValidAttachmentType } from "./chatHistoryApi";

// regex to match image markers: [IMAGE:format:alt:base64data]
const IMAGE_MARKER_REGEX = /\[IMAGE:([^:]+):([^:]+):([^\]]+)\]/g;

/**
 * Renders message content, handling embedded images separately from markdown.
 * Images are stored as [IMAGE:format:alt:base64data] markers.
 */
const MessageContent = ({ content }: { content: string }) => {
  // check if content has any image markers
  if (!content.includes("[IMAGE:")) {
    return <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>;
  }

  // split content by image markers and render each part
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match;
  let keyIndex = 0;

  // reset regex state
  IMAGE_MARKER_REGEX.lastIndex = 0;

  while ((match = IMAGE_MARKER_REGEX.exec(content)) !== null) {
    // add text before the image
    if (match.index > lastIndex) {
      const textPart = content.slice(lastIndex, match.index);
      if (textPart.trim()) {
        parts.push(
          <ReactMarkdown key={`text-${keyIndex++}`} remarkPlugins={[remarkGfm]}>
            {textPart}
          </ReactMarkdown>
        );
      }
    }

    // add the image
    const [, format, alt, base64Data] = match;
    const src = `data:image/${format};base64,${base64Data}`;
    parts.push(
      <Box key={`img-${keyIndex++}`} sx={{ my: 2 }}>
        <img
          src={src}
          alt={alt}
          style={{
            maxWidth: "100%",
            cursor: "pointer",
            borderRadius: 4,
            border: "1px solid #ddd",
          }}
          onClick={() => window.open(src, "_blank")}
          title="Click to open in new tab"
        />
      </Box>
    );

    lastIndex = match.index + match[0].length;
  }

  // add any remaining text after the last image
  if (lastIndex < content.length) {
    const remainingText = content.slice(lastIndex);
    if (remainingText.trim()) {
      parts.push(
        <ReactMarkdown key={`text-${keyIndex++}`} remarkPlugins={[remarkGfm]}>
          {remainingText}
        </ReactMarkdown>
      );
    }
  }

  return <>{parts}</>;
};

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
  const [literatureBackend, setLiteratureBackend] = useState<LiteratureBackend>("perplexity");
  const [toolProfile, setToolProfile] = useState<ToolProfile | null>(null);
  const hasTriggeredFirstExchange = useRef(false);
  const [pendingAttachments, setPendingAttachments] = useState<PendingAttachment[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragCounterRef = useRef(0);

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

  const createImagePreview = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  };

  const processFiles = useCallback(async (files: FileList | File[]) => {
    const validFiles: PendingAttachment[] = [];

    for (const file of Array.from(files)) {
      if (!isValidAttachmentType(file.type, file.name)) {
        setError(`Unsupported file type: ${file.name}. Supported: images, TSV, CSV, Excel`);
        continue;
      }

      const attachmentType = getAttachmentType(file.type, file.name);
      let previewUrl: string | undefined;

      if (attachmentType === "image") {
        try {
          previewUrl = await createImagePreview(file);
        } catch {
          // preview failed, continue without it
        }
      }

      validFiles.push({
        id: crypto.randomUUID(),
        name: file.name,
        size: file.size,
        type: attachmentType,
        mimeType: file.type,
        previewUrl,
        status: "pending",
        file,
      });
    }

    if (validFiles.length > 0) {
      setPendingAttachments((prev) => [...prev, ...validFiles]);
    }
  }, []);

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current++;
    if (e.dataTransfer.types.includes("Files")) {
      setIsDragging(true);
    }
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current--;
    if (dragCounterRef.current === 0) {
      setIsDragging(false);
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      dragCounterRef.current = 0;
      setIsDragging(false);

      const files = e.dataTransfer.files;
      if (files.length > 0) {
        processFiles(files);
      }
    },
    [processFiles]
  );

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (files && files.length > 0) {
        processFiles(files);
      }
      // reset input so same file can be selected again
      e.target.value = "";
    },
    [processFiles]
  );

  const removeAttachment = useCallback((id: string) => {
    setPendingAttachments((prev) => prev.filter((a) => a.id !== id));
  }, []);

  const sendMessage = useCallback(
    async (userMessage: string, attachments?: PendingAttachment[]) => {
      if ((!userMessage.trim() && (!attachments || attachments.length === 0)) || isLoading) return;

      // convert pending attachments to file attachments for the message
      const messageAttachments: FileAttachment[] | undefined =
        attachments && attachments.length > 0
          ? attachments.map(({ file, ...rest }) => rest)
          : undefined;

      const userMsgId = crypto.randomUUID();
      const userMsg: ChatMessage = {
        id: userMsgId,
        role: "user",
        content: userMessage,
        attachments: messageAttachments,
      };
      setMessages((prev) => [...prev, userMsg]);
      setIsLoading(true);
      setError(null);
      setPendingAttachments([]);

      const assistantMsgId = crypto.randomUUID();
      setMessages((prev) => [...prev, { id: assistantMsgId, role: "assistant", content: "" }]);

      abortControllerRef.current?.abort();
      abortControllerRef.current = new AbortController();

      // build message history, using contentJson when available for full tool context
      const messageHistory = [
        ...messages
          .filter((m) => m.content.trim() !== "" || (m.attachments && m.attachments.length > 0))
          .map((m) => {
            // for assistant messages, use contentJson for full message structure (tool calls etc)
            if (m.role === "assistant" && m.contentJson) {
              try {
                const parsed = JSON.parse(m.contentJson);
                return { role: m.role, content: parsed };
              } catch {
                // fall back to text content if parsing fails
              }
            }
            // for user messages with attachments, rebuild content with images
            if (m.role === "user" && m.attachments && m.attachments.length > 0) {
              const content: any[] = [];
              for (const att of m.attachments) {
                if (att.type === "image" && att.previewUrl) {
                  const base64Data = att.previewUrl.split(",")[1];
                  content.push({
                    type: "image",
                    source: {
                      type: "base64",
                      media_type: att.mimeType || "image/png",
                      data: base64Data,
                    },
                  });
                }
              }
              if (m.content.trim()) {
                content.push({ type: "text", text: m.content });
              }
              return { role: m.role, content };
            }
            return { role: m.role, content: m.content };
          }),
      ];

      // build current user message content with attachments
      const userContent: any[] = [];

      // add attachments first (images as base64, data files as references)
      if (attachments && attachments.length > 0) {
        for (const attachment of attachments) {
          if (attachment.type === "image" && attachment.previewUrl) {
            // for images, send as base64 image content
            const base64Data = attachment.previewUrl.split(",")[1];
            const mediaType = attachment.mimeType || "image/png";
            userContent.push({
              type: "image",
              source: {
                type: "base64",
                media_type: mediaType,
                data: base64Data,
              },
            });
          } else {
            // for TSV/Excel, read file content and include as text
            try {
              const text = await attachment.file.text();
              userContent.push({
                type: "text",
                text: `[File: ${attachment.name}]\n${text}`,
              });
            } catch {
              userContent.push({
                type: "text",
                text: `[File: ${attachment.name}] (failed to read)`,
              });
            }
          }
        }
      }

      // add text content
      if (userMessage.trim()) {
        userContent.push({ type: "text", text: userMessage });
      }

      // add current message to history
      messageHistory.push({
        role: "user" as const,
        content: userContent.length === 1 && userContent[0].type === "text"
          ? userContent[0].text
          : userContent,
      });

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
            literature_backend: literatureBackend,
            tool_profile: toolProfile,
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
              } else if (data.type === "image") {
                // store image as a special marker that we'll render separately
                const imageFormat = data.image_format || "png";
                const imageAlt = data.image_alt || "Generated image";
                const imageData = data.image_data || "";
                // use a unique marker that won't appear in normal text
                const imageMarker = `\n\n[IMAGE:${imageFormat}:${imageAlt}:${imageData}]\n\n`;
                accumulatedContent += imageMarker;
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
          onStreamingComplete?.(userMsg, completedAssistantMsg, messageContent, literatureBackend, toolProfile);

          // check if this is the first exchange
          if (!hasTriggeredFirstExchange.current) {
            hasTriggeredFirstExchange.current = true;
            onFirstExchange?.(literatureBackend, toolProfile);
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
    [
      messages,
      phenotypeCode,
      apiUrl,
      isLoading,
      onFirstExchange,
      onStreamingComplete,
      literatureBackend,
      toolProfile,
    ]
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() && pendingAttachments.length === 0) return;
    sendMessage(input, pendingAttachments.length > 0 ? pendingAttachments : undefined);
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
    "& img": {
      maxWidth: "100%",
      height: "auto",
      borderRadius: 1,
      my: 2,
      display: "block",
      cursor: "pointer",
      border: `1px solid ${theme.palette.divider}`,
      "&:hover": {
        boxShadow: theme.shadows[4],
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
        flexDirection: "column",
        gap: 1,
        maxWidth: "100%",
        width: "100%",
      }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 2, flexWrap: "wrap" }}>
        <Typography variant="body2" color="text.secondary">
          Literature search
        </Typography>
        <RadioGroup
          row
          value={literatureBackend}
          onChange={(e) => setLiteratureBackend(e.target.value as LiteratureBackend)}>
          <FormControlLabel
            value="perplexity"
            control={<Radio size="small" />}
            label="Perplexity"
            sx={{ "& .MuiFormControlLabel-label": { fontSize: "0.75rem" } }}
          />
          <FormControlLabel
            value="europepmc"
            control={<Radio size="small" />}
            label="Europe PMC"
            sx={{ "& .MuiFormControlLabel-label": { fontSize: "0.75rem" } }}
          />
        </RadioGroup>
        <Box sx={{ borderLeft: 1, borderColor: "divider", pl: 2, display: "flex", alignItems: "center", gap: 2 }}>
          <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
            <Typography variant="body2" color="text.secondary">
              Tools
            </Typography>
            <Tooltip
              title={
                <span style={{ whiteSpace: "pre-line" }}>
                  Which MCP tools to use?{"\n"}
                  All - includes all tools and automatically determines the ones to use (most times this is the best choice){"\n"}
                  RAG - includes Retrieval Augmented Generation search (can currently be used when asking about interpretation on phenotypes){"\n"}
                  API - includes tools tied to the genetics results API (can be used when strictly getting data for variants/genes/phenotypes){"\n"}
                  BigQuery - includes access to a BigQuery database that contains credible set and colocalization data (good when computations across all data is needed instead of a specific variant, gene or phenotype)
                </span>
              }
              arrow
              placement="top">
              <InfoIcon sx={{ fontSize: 16, color: "text.secondary", cursor: "help" }} />
            </Tooltip>
          </Box>
          <RadioGroup
            row
            value={toolProfile ?? "all"}
            onChange={(e) => {
              const val = e.target.value;
              setToolProfile(val === "all" ? null : (val as ToolProfile));
            }}>
            <FormControlLabel
              value="all"
              control={<Radio size="small" />}
              label="All"
              sx={{ "& .MuiFormControlLabel-label": { fontSize: "0.75rem" } }}
            />
            <FormControlLabel
              value="rag"
              control={<Radio size="small" />}
              label="RAG"
              sx={{ "& .MuiFormControlLabel-label": { fontSize: "0.75rem" } }}
            />
            <FormControlLabel
              value="api"
              control={<Radio size="small" />}
              label="API"
              sx={{ "& .MuiFormControlLabel-label": { fontSize: "0.75rem" } }}
            />
            <FormControlLabel
              value="bigquery"
              control={<Radio size="small" />}
              label="BigQuery"
              sx={{ "& .MuiFormControlLabel-label": { fontSize: "0.75rem" } }}
            />
          </RadioGroup>
        </Box>
      </Box>
      <PendingAttachments
        attachments={pendingAttachments}
        onRemove={removeAttachment}
        disabled={isLoading}
      />
      <Box sx={{ display: "flex", gap: 1, alignItems: "flex-end" }}>
        <input
          type="file"
          ref={fileInputRef}
          onChange={handleFileSelect}
          accept="image/*,.tsv,.csv,.xlsx,.xls"
          multiple
          style={{ display: "none" }}
        />
        <IconButton
          onClick={() => fileInputRef.current?.click()}
          disabled={isLoading}
          sx={{ mb: 0.5 }}
          title="Attach files (images, TSV, Excel)">
          <AttachFileIcon />
        </IconButton>
        <TextField
          fullWidth
          multiline
          maxRows={4}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={pendingAttachments.length > 0 ? "Add a message (optional)..." : placeholder}
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
          disabled={isLoading || (!input.trim() && pendingAttachments.length === 0)}
          sx={{ minWidth: 100 }}>
          {isLoading ? <CircularProgress size={24} /> : <SendIcon />}
        </Button>
      </Box>
    </Paper>
  );

  const dropZoneOverlay = isDragging && (
    <Box
      sx={{
        position: "absolute",
        inset: 0,
        bgcolor: "rgba(25, 118, 210, 0.1)",
        border: "2px dashed",
        borderColor: "primary.main",
        borderRadius: 2,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
        pointerEvents: "none",
      }}>
      <Typography variant="h6" color="primary">
        Drop files here
      </Typography>
    </Box>
  );

  // empty state: input at top center
  if (!hasMessages) {
    return (
      <Box
        sx={{ display: "flex", flexDirection: "column", height, alignItems: "center", position: "relative" }}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}>
        {dropZoneOverlay}
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
    <Box
      sx={{ display: "flex", flexDirection: "column", height, position: "relative" }}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}>
      {dropZoneOverlay}
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
                {message.attachments && message.attachments.length > 0 && (
                  <MessageAttachments
                    attachments={message.attachments}
                    isUserMessage={message.role === "user"}
                  />
                )}
                <Box sx={markdownStyles}>
                  {message.content ? (
                    <MessageContent content={message.content} />
                  ) : message.attachments && message.attachments.length > 0 ? null : (
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
