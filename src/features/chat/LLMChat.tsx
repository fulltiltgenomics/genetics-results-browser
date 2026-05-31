import {
  Box,
  Paper,
  TextField,
  useMediaQuery,
  Button,
  Typography,
  CircularProgress,
  LinearProgress,
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
  Stop as StopIcon,
  PlayArrow as ContinueIcon,
  Refresh as RefreshIcon,
  ExpandMore as ExpandMoreIcon,
  ExpandLess as ExpandLessIcon,
  KeyboardArrowDown as ArrowDownIcon,
  AttachFile as AttachFileIcon,
  InfoOutlined as InfoIcon,
} from "@mui/icons-material";
import React, { useRef, useEffect, useState, useCallback, useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { PluggableList } from "unified";
import { fetchEventSource } from "@microsoft/fetch-event-source";
import type { ChatMessage, LLMChatProps, LiteratureBackend, ToolProfile, PendingAttachment, FileAttachment, ContextUsage } from "./chat.types";
import { MessageRating } from "./MessageRating";
import { PendingAttachments, MessageAttachments } from "./FileAttachments";
import { getAttachmentType, isValidAttachmentType } from "./chatHistoryApi";
import { useSchema } from "./schemaApi";
import { linkifyViewsPlugin } from "./linkifyViews";

// hardcoded fallback used until useSchema() resolves; mirrors known views in genetics-results-db
const FALLBACK_VIEW_NAMES = [
  "credible_sets_v",
  "colocalization_v",
  "coloc_credsets_v",
  "exome_variant_results_v",
  "gene_burden_results_v",
];

// regex to match image markers: [IMAGE:format:alt:base64data]
const IMAGE_MARKER_REGEX = /\[IMAGE:([^:]+):([^:]+):([^\]]+)\]/g;

/**
 * Renders message content, handling embedded images separately from markdown.
 * Images are stored as [IMAGE:format:alt:base64data] markers.
 */
const MessageContent = ({
  content,
  rehypePlugins,
}: {
  content: string;
  rehypePlugins?: PluggableList;
}) => {
  // check if content has any image markers
  if (!content.includes("[IMAGE:")) {
    return (
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={rehypePlugins}>
        {content}
      </ReactMarkdown>
    );
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
          <ReactMarkdown
            key={`text-${keyIndex++}`}
            remarkPlugins={[remarkGfm]}
            rehypePlugins={rehypePlugins}>
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
        <ReactMarkdown
          key={`text-${keyIndex++}`}
          remarkPlugins={[remarkGfm]}
          rehypePlugins={rehypePlugins}>
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
  height = "calc(100dvh - 300px)",
  sessionId,
  initialMessages,
  onSessionCreated,
  onMessagesChange,
  onFirstExchange,
  onStreamingComplete,
  onRateMessage,
  exampleQuestions,
  isSecretChat,
  readOnly,
  initialInput,
}: LLMChatProps) => {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("md"));
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  // seed the draft from initialInput (annotation-side hand-off) without auto-sending. the parent
  // (ChatPage) resolves the seed asynchronously after mount, so cover both cases: the useState
  // initializer handles a seed already present at mount, and the effect below handles a seed that
  // arrives a tick later. seededInputRef makes seeding strictly one-shot so a re-render with the same
  // initialInput won't overwrite the draft again (it does not protect against typing that races the
  // initial async seed within the first tick).
  const [input, setInput] = useState(initialInput ?? "");
  const seededInputRef = useRef(false);
  useEffect(() => {
    if (!seededInputRef.current && initialInput) {
      seededInputRef.current = true;
      setInput(initialInput);
    }
  }, [initialInput]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const isTimeoutAbortRef = useRef(false);
  const [contextExpanded, setContextExpanded] = useState(true);
  const [shouldAutoScroll, setShouldAutoScroll] = useState(true);
  const [hoveredMessageId, setHoveredMessageId] = useState<string | null>(null);
  const [literatureBackend, setLiteratureBackend] = useState<LiteratureBackend>("perplexity");
  const [toolProfile, setToolProfile] = useState<ToolProfile | null>(null);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const hasTriggeredFirstExchange = useRef(false);
  const [pendingAttachments, setPendingAttachments] = useState<PendingAttachment[]>([]);
  const [wasStopped, setWasStopped] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [contextUsage, setContextUsage] = useState<ContextUsage | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragCounterRef = useRef(0);

  const chatUrl = import.meta.env.VITE_CHAT_URL;

  // build the rehype plugin list for assistant markdown so view names become clickable links
  // that open the SchemaDrawer via the existing #schema/<view> hash route
  const { data: schemaData } = useSchema();
  const messageRehypePlugins = useMemo<PluggableList>(() => {
    const names = schemaData?.tables.map((t) => t.name) ?? FALLBACK_VIEW_NAMES;
    return [linkifyViewsPlugin(names)];
  }, [schemaData]);

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
      setContextUsage(null);
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

  const handlePaste = useCallback(
    (e: React.ClipboardEvent) => {
      if (isLoading) return;

      const items = e.clipboardData?.items;
      if (!items) return;

      const imageFiles: File[] = [];
      let hasText = false;

      for (const item of Array.from(items)) {
        if (item.kind === "file" && item.type.startsWith("image/")) {
          const file = item.getAsFile();
          if (file) {
            const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
            const renamed = new File([file], `pasted-image-${timestamp}.png`, {
              type: file.type,
            });
            imageFiles.push(renamed);
          }
        } else if (item.type === "text/plain") {
          hasText = true;
        }
      }

      if (imageFiles.length > 0) {
        // only prevent default when paste is exclusively images
        if (!hasText) {
          e.preventDefault();
        }
        processFiles(imageFiles);
      }
    },
    [isLoading, processFiles]
  );

  const removeAttachment = useCallback((id: string) => {
    setPendingAttachments((prev) => prev.filter((a) => a.id !== id));
  }, []);

  const sendMessage = useCallback(
    async (userMessage: string, attachments?: PendingAttachment[]) => {
      if ((!userMessage.trim() && (!attachments || attachments.length === 0)) || isLoading) return;
      setWasStopped(false);

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
      let receivedDone = false;
      let streamError: string | null = null;
      let inactivityTimer: ReturnType<typeof setTimeout> | null = null;
      isTimeoutAbortRef.current = false;

      const resetInactivityTimer = () => {
        if (inactivityTimer) clearTimeout(inactivityTimer);
        inactivityTimer = setTimeout(() => {
          isTimeoutAbortRef.current = true;
          abortControllerRef.current?.abort();
        }, 90_000);
      };

      try {
        await fetchEventSource(`${chatUrl}/v1/chat`, {
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
            secret: isSecretChat || false,
          }),
          signal: abortControllerRef.current.signal,
          async onopen(response) {
            if (
              response.ok &&
              response.headers.get("content-type")?.includes("text/event-stream")
            ) {
              resetInactivityTimer();
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
            resetInactivityTimer();
            if (!event.data || event.data.trim() === "") return;
            let data: any;
            try {
              data = JSON.parse(event.data);
            } catch {
              return; // ignore unparseable SSE chunks
            }
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
              const imageMarker = `\n\n[IMAGE:${imageFormat}:${imageAlt}:${imageData}]\n\n`;
              accumulatedContent += imageMarker;
              const newContent = accumulatedContent;
              setMessages((prev) =>
                prev.map((m) => (m.id === assistantMsgId ? { ...m, content: newContent } : m))
              );
            } else if (data.type === "done") {
              receivedDone = true;
              messageContent = data.message_content || null;
            } else if (data.type === "usage") {
              // only update if context grew (it should never shrink within a conversation)
              setContextUsage((prev) =>
                !prev || data.input_tokens >= prev.input_tokens ? (data as ContextUsage) : prev
              );
            } else if (data.type === "error") {
              streamError = data.error || "A server error occurred";
            }
          },
          onerror(err) {
            console.error("SSE error:", err);
            throw err;
          },
          openWhenHidden: true,
        });

        // check for errors reported by the backend during streaming
        if (streamError) {
          throw new Error(streamError);
        }

        // detect premature stream end (connection dropped without "done" event)
        if (accumulatedContent && !receivedDone) {
          accumulatedContent += "\n\n---\n*Response may be incomplete — the connection was interrupted.*";
          setMessages((prev) =>
            prev.map((m) => (m.id === assistantMsgId ? { ...m, content: accumulatedContent } : m))
          );
        }

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
          if (isTimeoutAbortRef.current) {
            setError("Server stopped responding. Please try again.");
            setMessages((prev) => prev.filter((m) => m.id !== assistantMsgId || m.content));
          } else if (accumulatedContent) {
            // user-initiated stop with partial content — keep it and save
            const stoppedMsg: ChatMessage = {
              id: assistantMsgId,
              role: "assistant",
              content: accumulatedContent,
            };
            onStreamingComplete?.(userMsg, stoppedMsg, messageContent, literatureBackend, toolProfile);
            if (!hasTriggeredFirstExchange.current) {
              hasTriggeredFirstExchange.current = true;
              onFirstExchange?.(literatureBackend, toolProfile);
            }
          }
          return;
        }
        console.error("Chat error:", err);
        setError(err.message || "Failed to send message");
        setMessages((prev) => prev.filter((m) => m.id !== assistantMsgId || m.content));
      } finally {
        if (inactivityTimer) clearTimeout(inactivityTimer);
        setIsLoading(false);
      }
    },
    [
      messages,
      phenotypeCode,
      chatUrl,
      isLoading,
      onFirstExchange,
      onStreamingComplete,
      literatureBackend,
      toolProfile,
    ]
  );

  const handleStop = () => {
    setWasStopped(true);
    abortControllerRef.current?.abort();
  };

  const handleContinue = () => {
    setWasStopped(false);
    sendMessage("continue");
  };

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
    "& a.schema-link": {
      color: theme.palette.primary.main,
      textDecoration: "underline",
      textDecorationStyle: "dotted",
      cursor: "pointer",
      "&:hover": {
        textDecorationStyle: "solid",
      },
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
        p: { xs: 1, md: 2 },
        display: "flex",
        flexDirection: "column",
        gap: 1,
        maxWidth: "100%",
        width: "100%",
      }}>
      <Box
        sx={{ display: "flex", alignItems: "center", cursor: "pointer", userSelect: "none" }}
        onClick={() => setOptionsOpen((v) => !v)}>
        <Typography variant="body2" color="text.secondary">
          Options
        </Typography>
        {optionsOpen ? (
          <ExpandLessIcon sx={{ fontSize: 18, color: "text.secondary" }} />
        ) : (
          <ExpandMoreIcon sx={{ fontSize: 18, color: "text.secondary" }} />
        )}
      </Box>
      <Collapse in={optionsOpen}>
        <Box
          sx={{
            display: "flex",
            flexDirection: { xs: "column", sm: "row" },
            alignItems: { xs: "flex-start", sm: "center" },
            gap: { xs: 1, sm: 2 },
            flexWrap: "wrap",
          }}>
          <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
            <Typography variant="body2" color="text.secondary">
              Literature search
            </Typography>
            <Tooltip
              title={
                <span style={{ whiteSpace: "pre-line" }}>
                  Choose where to search for scientific literature.{"\n"}
                  Perplexity - AI-powered search across the web, good for broad questions and recent findings{"\n"}
                  Europe PMC - searches the Europe PubMed Central database directly, best for precise biomedical literature queries
                </span>
              }
              arrow
              placement="top">
              <InfoIcon sx={{ fontSize: 16, color: "text.secondary", cursor: "help" }} />
            </Tooltip>
          </Box>
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
          <Box
            sx={{
              borderLeft: { xs: 0, sm: 1 },
              borderTop: { xs: 1, sm: 0 },
              borderColor: "divider",
              pl: { xs: 0, sm: 2 },
              pt: { xs: 1, sm: 0 },
              display: "flex",
              alignItems: "center",
              gap: 2,
            }}>
            <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
              <Typography variant="body2" color="text.secondary">
                Tools
              </Typography>
              <Tooltip
                title={
                  <span style={{ whiteSpace: "pre-line" }}>
                    Which MCP tools to use?{"\n"}
                    All - includes all tools and automatically determines the ones to use (most times this is the best choice){"\n"}
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
              {/* <FormControlLabel
                value="rag"
                control={<Radio size="small" />}
                label="RAG"
                sx={{ "& .MuiFormControlLabel-label": { fontSize: "0.75rem" } }}
              /> */}
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
        {contextUsage && (
          <Tooltip title="Context window usage for this conversation — when full, older messages may be summarized" arrow placement="top">
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 1 }}>
              <Typography variant="caption" color="text.secondary" sx={{ whiteSpace: 'nowrap' }}>
                Conversation context
              </Typography>
              <LinearProgress
                variant="determinate"
                value={Math.min(contextUsage.context_percent, 100)}
                sx={{ flexGrow: 1, height: 4, borderRadius: 2 }}
              />
              <Typography variant="caption" color="text.secondary" sx={{ whiteSpace: 'nowrap' }}>
                {contextUsage.input_tokens >= 1000
                  ? `${(contextUsage.input_tokens / 1000).toFixed(1)}K`
                  : contextUsage.input_tokens} / {Math.round(contextUsage.context_window / 1000)}K tokens
              </Typography>
            </Box>
          </Tooltip>
        )}
      </Collapse>
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
          minRows={isMobile && !hasMessages ? 6 : 1}
          maxRows={isMobile && !hasMessages ? 10 : 4}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onPaste={handlePaste}
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
        {!isMobile && (isLoading ? (
          <Button
            variant="contained"
            onClick={handleStop}
            sx={{ minWidth: 100 }}>
            <StopIcon />
          </Button>
        ) : wasStopped ? (
          <Button
            variant="contained"
            color="success"
            onClick={handleContinue}
            sx={{ minWidth: 100 }}>
            <ContinueIcon />
          </Button>
        ) : (
          <Button
            type="submit"
            variant="contained"
            disabled={!input.trim() && pendingAttachments.length === 0}
            sx={{ minWidth: 100 }}>
            <SendIcon />
          </Button>
        ))}
      </Box>
      {isMobile && (
        <Box sx={{ mt: 1 }}>
          {isLoading ? (
            <Button
              variant="contained"
              onClick={handleStop}
              fullWidth>
              <StopIcon />
            </Button>
          ) : wasStopped ? (
            <Button
              variant="contained"
              color="success"
              onClick={handleContinue}
              fullWidth>
              <ContinueIcon />
            </Button>
          ) : (
            <Button
              type="submit"
              variant="contained"
              disabled={!input.trim() && pendingAttachments.length === 0}
              fullWidth>
              <SendIcon />
            </Button>
          )}
        </Box>
      )}
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
        {!readOnly && inputForm}

        {/* example questions */}
        {!readOnly && exampleQuestions && exampleQuestions.length > 0 && (
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
                    borderRadius: 1,
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
                    <MessageContent
                      content={message.content}
                      rehypePlugins={message.role === "assistant" ? messageRehypePlugins : undefined}
                    />
                  ) : message.attachments && message.attachments.length > 0 ? null : (
                    <Typography variant="body2" color="text.secondary" fontStyle="italic">
                      ...
                    </Typography>
                  )}
                  {isLoading && message.role === "assistant" && index === messages.length - 1 && message.content && (
                    <Box
                      component="span"
                      sx={{
                        display: "inline-block",
                        width: 8,
                        height: 8,
                        borderRadius: "50%",
                        backgroundColor: "primary.main",
                        ml: 0.5,
                        verticalAlign: "middle",
                        animation: "pulse 1.2s ease-in-out infinite",
                        "@keyframes pulse": {
                          "0%, 100%": { opacity: 0.3 },
                          "50%": { opacity: 1 },
                        },
                      }}
                    />
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


      {!readOnly && inputForm}
    </Box>
  );
};
