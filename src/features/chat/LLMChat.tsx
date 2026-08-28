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
  Select,
  MenuItem,
  Divider,
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
  WarningAmber as WarningAmberIcon,
} from "@mui/icons-material";
import React, { useRef, useEffect, useState, useCallback, useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { PluggableList } from "unified";
import { fetchEventSource } from "@microsoft/fetch-event-source";
import { TOOL_PROFILES } from "./chat.types";
import type { ChatMessage, LLMChatProps, LiteratureBackend, ToolProfile, ToolProfileValue, Verbosity, PendingAttachment, FileAttachment, ContextUsage } from "./chat.types";
import { MessageRating } from "./MessageRating";
import InstructionsDialog from "./InstructionsDialog";
import { useInstructionSetsStore } from "./useInstructionSets";
import { useChatOptionsStore } from "./useChatOptions";
import { APP_NAME } from "../../config/appName";
import { PendingAttachments, MessageAttachments } from "./FileAttachments";
import { getAttachmentType, isValidAttachmentType } from "./chatHistoryApi";
import { excelFileToTsv } from "./excelToTsv";
import { useSchema } from "./schemaApi";
import { linkifyViewsPlugin } from "./linkifyViews";
import { ToolCallDisclosure } from "./ToolCallDisclosure";
import { decodeToolCallMarker, encodeToolCallMarker, withToolCallOutcome } from "./toolCallMarker";

// hardcoded fallback used until useSchema() resolves; mirrors known views in genetics-results-db
const FALLBACK_VIEW_NAMES = [
  "credible_sets_v",
  "colocalization_v",
  "coloc_credsets_v",
  "exome_variant_results_v",
  "gene_burden_results_v",
];

// the two embedded-object markers a message's text can carry: [IMAGE:format:alt:base64data]
// and [TOOLUSE:base64json]. Matched by one alternation so a message holding both still
// renders its parts in the order they were streamed.
const EMBEDDED_MARKER_REGEX =
  /\[IMAGE:([^:]+):([^:]+):([^\]]+)\]|\[TOOLUSE:([A-Za-z0-9+/=]*)\]/g;

// sentinel option value: opens the management dialog instead of changing the selection
const MANAGE_INSTRUCTIONS_VALUE = "__manage__";

// one option per row, labels in a fixed-width column so every control starts at the same x
const OPTION_LABEL_WIDTH = 116;

const OptionRow = ({
  label,
  tooltip,
  children,
}: {
  label: string;
  tooltip: React.ReactNode;
  children: React.ReactNode;
}) => (
  <Box sx={{ display: "flex", alignItems: "center", gap: 1, minHeight: 30 }}>
    <Box
      sx={{
        display: "flex",
        alignItems: "center",
        gap: 0.5,
        width: OPTION_LABEL_WIDTH,
        flexShrink: 0,
      }}>
      <Tooltip title={tooltip} arrow placement="top">
        <InfoIcon sx={{ fontSize: 16, color: "text.secondary", cursor: "help" }} />
      </Tooltip>
      <Typography variant="body2" color="text.secondary">
        {label}
      </Typography>
    </Box>
    {children}
  </Box>
);

// compact radios: MUI's default FormControlLabel margins are sized for standalone form fields
const optionRadioSx = {
  mr: 1.5,
  "& .MuiRadio-root": { p: 0.375 },
  "& .MuiFormControlLabel-label": { fontSize: "0.75rem" },
};

/** what the Tools control calls each profile. Exhaustive over ToolProfile on purpose: a profile
 * added to the union is a type error here until the UI has decided about it, because a profile the
 * control never offers is one nothing can select while every narrower still resolves it to null —
 * the full tool surface. `null` is a deliberate "not offered": `rag` is the general-only surface
 * and has never been a user-facing choice. "all" is not in here — it is the absence of a profile */
export const TOOL_PROFILE_LABELS: Record<ToolProfile, string | null> = {
  api: "API",
  bigquery: "Database",
  rag: null,
  code: "Code execution",
};

/** what to call a profile the SERVER knows and this build does not (genetics-results-suite-4h6.74).
 * TOOL_PROFILE_LABELS is exhaustive over ToolProfile by design and so can never have an entry for a
 * name added after this build shipped, but the value is kept and sent, so the control has to say
 * something. The raw key made readable beats both alternatives: hiding it leaves a radio group with
 * nothing selected, and showing the bare key looks like a bug. Bounded upstream by
 * `isPlausibleToolProfile`, which is what makes it safe to render at all. */
export function toolProfileLabel(profile: ToolProfileValue): string {
  const known = TOOL_PROFILE_LABELS[profile as ToolProfile];
  if (known) return known;
  return profile
    .split(/[-_]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

// per-message limits (mirror the backend MAX_MESSAGE_CHARS / MAX_ATTACHMENTS_PER_MESSAGE)
const MAX_MESSAGE_CHARS = 50000;
const MAX_ATTACHMENTS_PER_MESSAGE = 10;

/**
 * Renders message content, handling embedded objects separately from markdown.
 *
 * Two marker shapes are carried inline in the text: [IMAGE:format:alt:base64data] and
 * [TOOLUSE:base64json]. Both live in the message's `content` rather than in component
 * state so that a reopened session renders identically to the live stream — `content` is
 * the only thing this component ever sees.
 */
const MessageContent = ({
  content,
  rehypePlugins,
}: {
  content: string;
  rehypePlugins?: PluggableList;
}) => {
  if (!content.includes("[IMAGE:") && !content.includes("[TOOLUSE:")) {
    return (
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={rehypePlugins}>
        {content}
      </ReactMarkdown>
    );
  }

  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match;
  let keyIndex = 0;

  // reset regex state
  EMBEDDED_MARKER_REGEX.lastIndex = 0;

  while ((match = EMBEDDED_MARKER_REGEX.exec(content)) !== null) {
    // add text before the embedded object
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

    const [, format, alt, base64Data, toolCallData] = match;
    if (toolCallData !== undefined) {
      const record = decodeToolCallMarker(toolCallData);
      // a marker left half-written by an interrupted stream decodes to null; dropping it
      // is better than rendering the base64 as prose
      if (record) {
        parts.push(<ToolCallDisclosure key={`tool-${keyIndex++}`} record={record} />);
      }
    } else {
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
    }

    lastIndex = match.index + match[0].length;
  }

  // add any remaining text after the last embedded object
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
  onEnsureSession,
  onMessagesChange,
  onFirstExchange,
  onStreamingComplete,
  onRateMessage,
  exampleQuestions,
  isSecretChat,
  readOnly,
  initialInput,
  initialAttachments,
  onDraftChange,
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
  // driven by the backend's thinking keepalive, so a reasoning pause between tool
  // calls is visible rather than looking like a stall
  const [isThinking, setIsThinking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const isTimeoutAbortRef = useRef(false);
  const [contextExpanded, setContextExpanded] = useState(true);
  const [shouldAutoScroll, setShouldAutoScroll] = useState(true);
  const [hoveredMessageId, setHoveredMessageId] = useState<string | null>(null);
  // shared stores, not component state: these survive the remount ChatPage does on every
  // conversation switch, so the stored default still applies to a message sent right after one
  const literatureBackend = useChatOptionsStore((s) => s.literatureBackend);
  const setLiteratureBackend = useChatOptionsStore((s) => s.setLiteratureBackend);
  const toolProfile = useChatOptionsStore((s) => s.toolProfile);
  const setToolProfile = useChatOptionsStore((s) => s.setToolProfile);
  // what the server said about the selected profile, once it has said anything. undefined while
  // unasked or unanswerable, so an unreachable backend renders exactly as before
  const toolProfileCheck = useChatOptionsStore((s) =>
    s.toolProfile ? s.profileChecks[s.toolProfile] : undefined,
  );
  // a profile the server confirmed that this build does not enumerate, so the radio group has an
  // option to be selected on. Only the store's adoption path can put one here, and only after the
  // server answered known_profile:true for it
  const extraToolProfile =
    toolProfile && !TOOL_PROFILES.includes(toolProfile as ToolProfile) ? toolProfile : null;
  const verbosity = useChatOptionsStore((s) => s.verbosity);
  const setVerbosity = useChatOptionsStore((s) => s.setVerbosity);
  const loadChatOptions = useChatOptionsStore((s) => s.load);
  const instructionSets = useInstructionSetsStore((s) => s.sets);
  const instructionSetId = useInstructionSetsStore((s) => s.selectedId);
  const loadInstructionSets = useInstructionSetsStore((s) => s.load);
  const selectInstructionSet = useInstructionSetsStore((s) => s.select);
  const [instructionsDialogOpen, setInstructionsDialogOpen] = useState(false);
  const [optionsOpen, setOptionsOpen] = useState(false);
  // keyed off the id, not the looked-up set: the list and the stored selection load together but the
  // name can be momentarily unresolved, and claiming "no instructions" while one is selected would
  // misreport what the next message actually sends
  const instructionsSummary = instructionSetId
    ? (instructionSets.find((s) => s.id === instructionSetId)?.name ?? "instructions")
    : "no instructions";
  const hasTriggeredFirstExchange = useRef(false);
  // unlike initialInput, initialAttachments needs no async-seed effect: the parent restores drafts
  // synchronously from a ref when remounting on conversation switch
  const [pendingAttachments, setPendingAttachments] = useState<PendingAttachment[]>(
    initialAttachments ?? [],
  );
  const [wasStopped, setWasStopped] = useState(false);

  // report the unsent draft so the parent can restore it after a conversation-switch remount.
  // also fires when the draft empties on send, correctly clearing the stored draft
  useEffect(() => {
    onDraftChange?.(input, pendingAttachments);
  }, [input, pendingAttachments, onDraftChange]);
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

  useEffect(() => {
    void loadInstructionSets();
  }, [loadInstructionSets]);

  useEffect(() => {
    void loadChatOptions();
  }, [loadChatOptions]);

  const handleInstructionSetChange = useCallback(
    (value: string) => {
      if (value === MANAGE_INSTRUCTIONS_VALUE) {
        setInstructionsDialogOpen(true);
        return;
      }
      selectInstructionSet(value === "" ? null : value);
    },
    [selectInstructionSet],
  );

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

      // enforce per-message limits before sending (typed text only; attachments exempt)
      if (userMessage.length > MAX_MESSAGE_CHARS) {
        setError(
          `Message too long (${userMessage.length.toLocaleString()} characters, limit ${MAX_MESSAGE_CHARS.toLocaleString()}). For large data, attach a TSV/CSV file instead.`
        );
        return;
      }
      if (attachments && attachments.length > MAX_ATTACHMENTS_PER_MESSAGE) {
        setError(
          `Too many attachments (${attachments.length}, limit ${MAX_ATTACHMENTS_PER_MESSAGE} per message).`
        );
        return;
      }

      setWasStopped(false);

      // read data-file text up front: it is inlined into this turn's content and kept
      // on the message so later turns can resend it. Reading it lazily per turn would
      // fail once the local File is gone (after a reload the attachment is metadata only).
      const fileTexts = new Map<string, string>();
      for (const att of attachments ?? []) {
        if (att.type === "image") continue;
        try {
          fileTexts.set(
            att.id,
            att.type === "excel" ? await excelFileToTsv(att.file) : await att.file.text(),
          );
        } catch {
          fileTexts.set(att.id, "(failed to read)");
        }
      }

      // convert pending attachments to file attachments for the message; `file` is kept
      // so the upload can send the original bytes, and is stripped before serialization
      const messageAttachments: FileAttachment[] | undefined =
        attachments && attachments.length > 0
          ? attachments.map((a) => ({ ...a, textContent: fileTexts.get(a.id) }))
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
      // stamped from the send-time values, so the note under the label keeps saying what this turn
      // was actually produced under even if the user moves a control while it streams
      setMessages((prev) => [
        ...prev,
        { id: assistantMsgId, role: "assistant", content: "", verbosity, instructionSetId },
      ]);

      abortControllerRef.current?.abort();
      abortControllerRef.current = new AbortController();

      // build message history, using contentJson when available for full tool context
      const messageHistory = [
        ...messages
          .filter((m) => m.content.trim() !== "" || (m.attachments && m.attachments.length > 0))
          .flatMap((m) => {
            // for assistant messages, use contentJson for full message structure (tool calls etc)
            if (m.role === "assistant" && m.contentJson) {
              try {
                const parsed = JSON.parse(m.contentJson);
                const entries: any[] = [{ role: m.role, content: parsed }];
                // replay persisted tool results so resumed conversations carry the
                // actual tool data, not just the assistant's prose summary. The
                // synthetic user turn answers the assistant's tool_use blocks; the
                // backend pairs them by tool_use_id. Messages without toolResultsJson
                // (older conversations) emit only the assistant entry, and the server
                // strips the orphan tool_use blocks as before (backward compatible).
                if (m.toolResultsJson) {
                  try {
                    const toolResults = JSON.parse(m.toolResultsJson);
                    if (Array.isArray(toolResults) && toolResults.length > 0) {
                      entries.push({ role: "user", content: toolResults });
                    }
                  } catch {
                    // ignore malformed tool results; fall back to old behavior
                  }
                }
                return entries;
              } catch {
                // fall back to text content if parsing fails
              }
            }
            // for user messages with attachments, rebuild content with images and the
            // inlined text of data files — replaying only the images would silently drop
            // an attached TSV/Excel from every turn after the one that first sent it
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
                } else if (att.type !== "image" && att.textContent) {
                  content.push({
                    type: "text",
                    text: `[File: ${att.name}]\n${att.textContent}`,
                  });
                }
              }
              if (m.content.trim()) {
                content.push({ type: "text", text: m.content });
              }
              return [{ role: m.role, content }];
            }
            return [{ role: m.role, content: m.content }];
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
            // data files are inlined as text, read once above (Excel is binary and was
            // parsed to TSV there — reading it as text would yield garbage)
            userContent.push({
              type: "text",
              text: `[File: ${attachment.name}]\n${fileTexts.get(attachment.id) ?? "(failed to read)"}`,
            });
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

      // resolved BEFORE the request, not after the exchange: `session_id` becomes the `sid`
      // claim of the per-execution sandbox credential, and run_analysis fails closed without
      // one — so a chat whose session was created afterwards could not run code on its first
      // turn at all (genetics-results-suite-vda). A failure here is not fatal to the turn:
      // every other tool works without a session, so the turn proceeds unpersisted rather
      // than being refused.
      let turnSessionId = sessionId ?? null;
      if (!turnSessionId && onEnsureSession) {
        try {
          turnSessionId = await onEnsureSession();
        } catch (err) {
          console.error("Failed to establish a session for this turn:", err);
        }
      }

      let accumulatedContent = "";
      let messageContent: any[] | null = null;
      let toolResults: any[] | null = null;
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
            verbosity,
            instruction_set_id: instructionSetId,
            secret: isSecretChat || false,
            session_id: turnSessionId,
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
            if (data.type === "thinking") {
              // reasoning keepalive: carries no content, so it only drives the indicator
              setIsThinking(true);
            } else if (data.type === "content" && data.content) {
              setIsThinking(false);
              accumulatedContent += data.content;
              const newContent = accumulatedContent;
              setMessages((prev) =>
                prev.map((m) => (m.id === assistantMsgId ? { ...m, content: newContent } : m))
              );
            } else if (data.type === "image") {
              // store image as a special marker that we'll render separately
              const imageFormat = (data.image_format || "png").replace(/[^\w+.-]/g, "");
              // the marker is colon-delimited and `alt` is now an artifact FILE NAME, which
              // the sandbox permits colons and brackets in — an unescaped one would split the
              // marker and spill base64 into the transcript as prose
              const imageAlt = (data.image_alt || "Generated image").replace(/[:[\]]/g, " ");
              const imageData = data.image_data || "";
              const imageMarker = `\n\n[IMAGE:${imageFormat}:${imageAlt}:${imageData}]\n\n`;
              accumulatedContent += imageMarker;
              const newContent = accumulatedContent;
              setMessages((prev) =>
                prev.map((m) => (m.id === assistantMsgId ? { ...m, content: newContent } : m))
              );
            } else if (data.type === "tool_use" && data.name) {
              // a tool call, embedded in the text the same way an image is so that it
              // survives persistence and reload. Rendered collapsed by MessageContent
              setIsThinking(false);
              accumulatedContent += `\n\n${encodeToolCallMarker({
                id: data.id ?? "",
                name: data.name,
                input: data.input ?? {},
              })}\n\n`;
              const newContent = accumulatedContent;
              setMessages((prev) =>
                prev.map((m) => (m.id === assistantMsgId ? { ...m, content: newContent } : m))
              );
            } else if (data.type === "script_result" && data.tool_use_id) {
              // the outcome of a run_analysis that was already written into the content
              // above; rewrite that one marker so its summary line can show it
              accumulatedContent = withToolCallOutcome(accumulatedContent, data.tool_use_id, {
                ran: Boolean(data.ran),
                ok: Boolean(data.ok),
                status: typeof data.status === "string" ? data.status : "unknown",
                durationMs: typeof data.duration_ms === "number" ? data.duration_ms : null,
                exception: typeof data.exception === "string" ? data.exception : null,
              });
              const newContent = accumulatedContent;
              setMessages((prev) =>
                prev.map((m) => (m.id === assistantMsgId ? { ...m, content: newContent } : m))
              );
            } else if (data.type === "done") {
              receivedDone = true;
              messageContent = data.message_content || null;
              toolResults = data.tool_results || null;
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
          onStreamingComplete?.(userMsg, completedAssistantMsg, messageContent, literatureBackend, toolProfile, toolResults, instructionSetId, verbosity);

          // check if this is the first exchange
          if (!hasTriggeredFirstExchange.current) {
            hasTriggeredFirstExchange.current = true;
            onFirstExchange?.(literatureBackend, toolProfile, instructionSetId, verbosity);
          }
        }
      } catch (err: any) {
        if (err.name === "AbortError") {
          if (isTimeoutAbortRef.current) {
            setError("Server stopped responding. Please try again.");
          }
          if (accumulatedContent) {
            // partial content is worth saving however the stream ended — a timeout
            // abort used to leave it on screen but unsaved, so it vanished on reload.
            const partialMsg: ChatMessage = {
              id: assistantMsgId,
              role: "assistant",
              content: accumulatedContent,
            };
            onStreamingComplete?.(userMsg, partialMsg, messageContent, literatureBackend, toolProfile, toolResults, instructionSetId, verbosity);
            if (!hasTriggeredFirstExchange.current) {
              hasTriggeredFirstExchange.current = true;
              onFirstExchange?.(literatureBackend, toolProfile, instructionSetId, verbosity);
            }
            // a timed-out turn is resumable for the same reason a stopped one is
            setWasStopped(true);
          } else {
            // nothing to keep — drop the empty assistant placeholder
            setMessages((prev) => prev.filter((m) => m.id !== assistantMsgId || m.content));
          }
          return;
        }
        console.error("Chat error:", err);
        setError(err.message || "Failed to send message");
        setMessages((prev) => prev.filter((m) => m.id !== assistantMsgId || m.content));
      } finally {
        if (inactivityTimer) clearTimeout(inactivityTimer);
        setIsLoading(false);
        setIsThinking(false);
      }
    },
    [
      messages,
      phenotypeCode,
      chatUrl,
      isLoading,
      // both are read when the turn resolves its session id. `sessionId` was previously
      // absent, so this callback held whatever it was when `messages` last changed — which
      // happened to be every turn, making the staleness invisible rather than absent
      sessionId,
      onEnsureSession,
      onFirstExchange,
      onStreamingComplete,
      literatureBackend,
      toolProfile,
      verbosity,
      instructionSetId,
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

  // reads the message's own stamp rather than the selector: returning to an old chat should show
  // what each answer was actually produced under, including turns from before the user switched
  const messageNote = (message: ChatMessage) => {
    const parts: string[] = [];
    if (message.verbosity === "brief" || message.verbosity === "detailed") {
      parts.push(message.verbosity);
    }
    // an archived set is gone from the list but still named by the messages it shaped; naming it
    // would need a lookup the client cannot do, and saying nothing beats saying the wrong thing
    const set = instructionSets.find((s) => s.id === message.instructionSetId);
    if (set) parts.push(set.name);
    return parts.join(" · ");
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
          Options{" "}
          <Box component="span" sx={{ opacity: 0.8 }}>
            ({verbosity}, {instructionsSummary})
          </Box>
        </Typography>
        {optionsOpen ? (
          <ExpandLessIcon sx={{ fontSize: 18, color: "text.secondary" }} />
        ) : (
          <ExpandMoreIcon sx={{ fontSize: 18, color: "text.secondary" }} />
        )}
      </Box>
      <Collapse in={optionsOpen}>
        <Box sx={{ display: "flex", flexDirection: "column" }}>
          <OptionRow
            label="Answer"
            tooltip={
              <span style={{ whiteSpace: "pre-line" }}>
                How much detail should the answer contain?{"\n"}
                Brief - leads with the finding and the data behind it; ask a follow-up for anything left out (default){"\n"}
                Detailed - the full write-up: complete data extraction, then literature, then analysis
              </span>
            }>
            <RadioGroup
              row
              value={verbosity}
              onChange={(e) => setVerbosity(e.target.value as Verbosity)}>
              <FormControlLabel
                value="brief"
                control={<Radio size="small" />}
                label="Brief"
                sx={optionRadioSx}
              />
              <FormControlLabel
                value="detailed"
                control={<Radio size="small" />}
                label="Detailed"
                sx={optionRadioSx}
              />
            </RadioGroup>
          </OptionRow>
          <OptionRow
            label="Instructions"
            tooltip={
              <span style={{ whiteSpace: "pre-line" }}>
                Your own standing instructions, added to every message in this chat.{"\n"}
                Use them to say who you are and how you want answers written — e.g. "I am a statistical geneticist, always give effect sizes with standard errors".{"\n"}
                None - no extra instructions (default){"\n"}
                Manage instructions - create or edit your instruction sets
              </span>
            }>
            <Select
              size="small"
              value={instructionSetId ?? ""}
              onChange={(e) => handleInstructionSetChange(e.target.value)}
              inputProps={{ "aria-label": "Instructions" }}
              sx={{
                fontSize: "0.75rem",
                minWidth: 160,
                "& .MuiSelect-select": { py: 0.375 },
              }}>
              <MenuItem value="" sx={{ fontSize: "0.75rem" }}>
                None
              </MenuItem>
              {instructionSets.map((set) => (
                <MenuItem key={set.id} value={set.id} sx={{ fontSize: "0.75rem" }}>
                  {set.name}
                </MenuItem>
              ))}
              <Divider />
              <MenuItem value={MANAGE_INSTRUCTIONS_VALUE} sx={{ fontSize: "0.75rem" }}>
                Manage instructions…
              </MenuItem>
            </Select>
          </OptionRow>
          <OptionRow
            label="Literature search"
            tooltip={
              <span style={{ whiteSpace: "pre-line" }}>
                Choose where to search for scientific literature.{"\n"}
                Perplexity - AI-powered search across the web, good for broad questions and recent findings{"\n"}
                Europe PMC - searches the Europe PubMed Central database directly, best for precise biomedical literature queries
              </span>
            }>
            <RadioGroup
              row
              value={literatureBackend}
              onChange={(e) => setLiteratureBackend(e.target.value as LiteratureBackend)}>
              <FormControlLabel
                value="perplexity"
                control={<Radio size="small" />}
                label="Perplexity"
                sx={optionRadioSx}
              />
              <FormControlLabel
                value="europepmc"
                control={<Radio size="small" />}
                label="Europe PMC"
                sx={optionRadioSx}
              />
            </RadioGroup>
          </OptionRow>
          <OptionRow
            label="Tools"
            tooltip={
              <span style={{ whiteSpace: "pre-line" }}>
                Which MCP tools to use?{"\n"}
                All - includes all tools and automatically determines the ones to use (most times this is the best choice){"\n"}
                API - includes tools tied to the genetics results API (can be used when strictly getting data for variants/genes/phenotypes){"\n"}
                Database - includes access to a database that contains credible set and colocalization data (good when computations across all data is needed instead of a specific variant, gene or phenotype){"\n"}
                Code execution - a deliberately minimal set of seven tools built around running analysis code in the sandbox, with search for genes, phenotypes, rsids and literature; no external (gnomAD/Open Targets) or RAG tools. Needs a reachable sandbox
              </span>
            }>
            <RadioGroup
              row
              value={toolProfile ?? "all"}
              onChange={(e) => {
                const val = e.target.value;
                setToolProfile(val === "all" ? null : val);
              }}>
              <FormControlLabel
                value="all"
                control={<Radio size="small" />}
                label="All"
                sx={optionRadioSx}
              />
              {TOOL_PROFILES.map((profile) => {
                const label = TOOL_PROFILE_LABELS[profile];
                return label === null ? null : (
                  <FormControlLabel
                    key={profile}
                    value={profile}
                    control={<Radio size="small" />}
                    label={label}
                    sx={optionRadioSx}
                  />
                );
              })}
              {extraToolProfile && (
                <FormControlLabel
                  value={extraToolProfile}
                  control={<Radio size="small" />}
                  label={toolProfileLabel(extraToolProfile)}
                  sx={optionRadioSx}
                />
              )}
            </RadioGroup>
            {/* the server's verdict on the selected profile (genetics-results-suite-4h6.74). The
                browser and the server each keep their own profile list and neither can import the
                other's, so a name this build offers may be one the server no longer knows — in
                which case it quietly resolves to general-only and the user gets an arm they did
                not pick. Only an explicit known_profile:false speaks up here. */}
            {toolProfileCheck && toolProfile && !toolProfileCheck.known && (
              <Tooltip
                arrow
                placement="top"
                title={`The server does not recognise "${toolProfile}", so it falls back to a general-only tool set instead of the one this option names. Your messages still work; they are not using the tools you selected. This browser build is out of step with the chat backend — pick All, or report it.`}>
                <Typography
                  variant="caption"
                  color="warning.main"
                  sx={{ display: "flex", alignItems: "center", gap: 0.25, cursor: "help" }}>
                  <WarningAmberIcon sx={{ fontSize: 14 }} />
                  not recognised by the server ({toolProfileCheck.count} tools)
                </Typography>
              </Tooltip>
            )}
            {toolProfileCheck?.known && (
              // confirmation that the server resolved the same profile this control names. The
              // count is LOCAL tools only — gnomAD/Open Targets and RAG are proxied surfaces the
              // endpoint deliberately leaves out, so the tooltip says so rather than implying
              // this is everything the model gets
              <Tooltip
                arrow
                placement="top"
                title="Local tools the server resolves this profile to. Proxied gnomAD / Open Targets and RAG tools are counted separately.">
                <Typography
                  variant="caption"
                  color="text.secondary"
                  sx={{ whiteSpace: "nowrap", cursor: "help" }}>
                  {toolProfileCheck.count} tools
                </Typography>
              </Tooltip>
            )}
          </OptionRow>
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
      <InstructionsDialog
        open={instructionsDialogOpen}
        onClose={() => {
          setInstructionsDialogOpen(false);
          // a set may have been renamed, created or archived while the dialog was open, and an
          // archive can invalidate the current selection
          void loadInstructionSets(true);
        }}
      />
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
        sx={{ display: "flex", flexDirection: "column", height, alignItems: "center", position: "relative", overflow: "auto" }}
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
                  {message.role === "user" ? "You" : APP_NAME}
                  {message.role === "assistant" && messageNote(message) && (
                    <Box
                      component="span"
                      sx={{ fontWeight: "normal", ml: 1, opacity: 0.75 }}>
                      {messageNote(message)}
                    </Box>
                  )}
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

        {/* before the first token, and again whenever the model goes back to reasoning
            mid-response — the latter is otherwise a silent gap */}
        {isLoading && (isThinking || messages[messages.length - 1]?.content === "") && (
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
