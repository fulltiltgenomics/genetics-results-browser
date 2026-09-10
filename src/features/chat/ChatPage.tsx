import { useState, useEffect, useCallback, useRef, useMemo, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { useParams, useNavigate } from "react-router";
import { Box, Typography, CircularProgress, Button, Chip, Drawer, IconButton, ListItemIcon, ListItemText, Menu, MenuItem, Popover, Alert, Tooltip, useMediaQuery, useTheme } from "@mui/material";
import { VisibilityOff, Share as ShareIcon, LinkOff as LinkOffIcon, ForkRight as ForkRightIcon, FileDownload as FileDownloadIcon, Star as StarIcon, StarBorder as StarBorderIcon } from "@mui/icons-material";
import MenuIcon from "@mui/icons-material/Menu";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import finnGenieLogo from "../../assets/finngenie-leonardo-gemini-2.5-flash-recraft-vectorized-claude-cropped.svg";
import { APP_NAME } from "../../config/appName";
import { LLMChat } from "./LLMChat";
import { ChatHistorySidebar } from "./ChatHistorySidebar";
import { SessionRating } from "./SessionRating";
import { FeedbackDialog } from "./FeedbackDialog";
import { AboutDialog } from "./AboutDialog";
import McpTokenDialog from "../page/McpTokenDialog";
import { DatasetsDialog } from "./DatasetsDialog";
import { ToolsDialog } from "./ToolsDialog";
import { SchemaDrawer } from "./SchemaDrawer";
import { useSchema } from "./schemaApi";
import { useSchemaHashRoute } from "./useSchemaHashRoute";
import {
  listSessions,
  createSession,
  getSession,
  deleteSession,
  updateSession,
  saveMessage,
  rateMessage,
  generateTitle,
  getAttachment,
  getAttachmentText,
  uploadAttachment,
  shareSession,
  forkSession,
  pinSession,
  moveSession,
  type ChatSession,
  type SessionDetail,
  type ChatMessageRecord,
} from "./chatHistoryApi";
import type { ChatMessage, FileAttachment, PendingAttachment } from "./chat.types";
import { useProjects } from "./useProjects";
import { MemoryDialog } from "./MemoryDialog";
import { exportChatAsHtml, exportChatAsMarkdown } from "./exportChat";
import { useChatSeedStore } from "../../store/store.chatSeed";
import { useChatOptionsStore } from "./useChatOptions";
import { useInstructionSetsStore } from "./useInstructionSets";

/**
 * Standalone chat page with history sidebar and config editor.
 * Three-column layout: [Sidebar 280px] [Chat flex:1] [Config 600px]
 */
const ChatPage = () => {
  const { sessionId: urlSessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("md"));
  // landscape phones: viewport is too short to fit two header rows, the rating bar and the
  // disclaimer alongside a usable chat, so trim the non-essential chrome to give the chat room
  const isShort = useMediaQuery("(max-height: 500px)");
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [activeSession, setActiveSession] = useState<SessionDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [sessionLoading, setSessionLoading] = useState(false);
  const [currentMessageCount, setCurrentMessageCount] = useState(0);
  // messages with attachment previews loaded
  const [loadedMessages, setLoadedMessages] = useState<ChatMessage[] | undefined>(undefined);

  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [tokensOpen, setTokensOpen] = useState(false);
  const [isSecretChat, setIsSecretChat] = useState(false);
  // client-only conversation id for secret chats: never persisted, sent purely so
  // distinct secret conversations can be counted from logs (like normal sessionId)
  const [secretSessionId, setSecretSessionId] = useState<string | null>(null);
  const [exportMenuAnchor, setExportMenuAnchor] = useState<HTMLElement | null>(null);
  const [actionMenuAnchorEl, setActionMenuAnchorEl] = useState<HTMLElement | null>(null);
  const [datasetsOpen, setDatasetsOpen] = useState(false);
  const { projects, create: createProject, rename: renameProject, remove: removeProject, reload: reloadProjects } = useProjects();
  // the project a new chat is filed into: set by opening a filed conversation or by a section
  // "+", cleared at home. Both creation paths (eager below, lazy in ensureSession) read it.
  const [currentProjectId, setCurrentProjectId] = useState<string | null>(null);
  // the sidebar's "Project memory" item; null keeps the dialog closed
  const [memoryProjectId, setMemoryProjectId] = useState<string | null>(null);
  const [topMoveAnchorEl, setTopMoveAnchorEl] = useState<HTMLElement | null>(null);
  const [toolsOpen, setToolsOpen] = useState(false);
  // hash-based deep linking for SchemaDrawer; known view names come from the cached schema
  const { data: schemaData } = useSchema();
  const knownSchemaViews = useMemo(
    () => schemaData?.tables.map((t) => t.name),
    [schemaData],
  );
  const schemaRoute = useSchemaHashRoute(knownSchemaViews);
  const [sharePopoverOpen, setSharePopoverOpen] = useState(false);
  const shareButtonRef = useRef<HTMLSpanElement>(null);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState<boolean>(false);

  // track current messages for saving
  const currentMessagesRef = useRef<ChatMessage[]>([]);
  const savedMessageIds = useRef<Set<string>>(new Set());
  // track if we just created a new session (to skip loading)
  const isNewSession = useRef(false);
  // track session created inline (during first exchange) to avoid remounting LLMChat
  const inlineSessionIdRef = useRef<string | null>(null);
  // a chat the sidebar created eagerly (New Chat, or "+" in a project) so it could show it
  // at once; if the user leaves it before a message exists it is deleted again, or every
  // mis-click would leave an empty "New Chat" behind in the project
  const eagerSessionIdRef = useRef<string | null>(null);
  // stable key for LLMChat - only changes when user explicitly switches sessions
  const [chatKey, setChatKey] = useState<string>("new");
  const applyChatOptions = useChatOptionsStore((s) => s.applyFromConversation);
  const resetChatOptions = useChatOptionsStore((s) => s.resetToDefaults);
  const applyInstructionSet = useInstructionSetsStore((s) => s.applyFromConversation);
  const resetInstructionSet = useInstructionSetsStore((s) => s.resetToDefault);

  // consume a pending chat seed once on committed mount (annotation -> chat hand-off). consuming in
  // a useEffect rather than a useState initializer is deliberate: React may speculatively render/
  // discard a tree (lazy routes, concurrent rendering), and a render-phase consume would clear the
  // store on a discarded mount, losing the seed. the effect runs only on the committed mount; the
  // store clear inside consumeChatSeed keeps it one-shot so it can't reappear on later navigation.
  // the seed is meant for the very first chat after the hand-off only; ChatPage (and this state)
  // survives intra-page navigation since /chat and /chat/:id share one instance, so every handler
  // that bumps chatKey (remounting LLMChat) clears seedInput to avoid re-prefilling unrelated chats.
  const [seedInput, setSeedInput] = useState<string | undefined>(undefined);
  useEffect(() => {
    setSeedInput(useChatSeedStore.getState().consumeChatSeed());
  }, []);

  // per-conversation unsent drafts (text + attachments), so switching conversations doesn't lose
  // what the user typed. keyed by session id, with all not-yet-persisted new chats sharing the
  // logical key "new". kept in a ref because it changes on every keystroke and only needs to be
  // read when a chatKey change remounts LLMChat. attachment File objects live in memory only, so
  // drafts survive conversation switches but not page reloads. secret chats are excluded so their
  // drafts leave no trace after switching away.
  const draftsRef = useRef<Map<string, { text: string; attachments: PendingAttachment[] }>>(
    new Map(),
  );
  const draftKey = chatKey.startsWith("secret")
    ? null
    : chatKey.startsWith("new")
      ? "new"
      : chatKey;
  const handleDraftChange = useCallback(
    (text: string, attachments: PendingAttachment[]) => {
      if (!draftKey) return;
      if (!text && attachments.length === 0) {
        draftsRef.current.delete(draftKey);
      } else {
        draftsRef.current.set(draftKey, { text, attachments });
      }
    },
    [draftKey],
  );
  // reading the ref during render is safe here: the map only matters at LLMChat mount time, and
  // every mount is triggered by a chatKey state change, which re-renders with the current map
  const storedDraft = draftKey ? draftsRef.current.get(draftKey) : undefined;

  // load sessions on mount
  useEffect(() => {
    loadSessions();
  }, []);

  // load session from URL param on mount
  const urlSessionLoadedRef = useRef(false);
  useEffect(() => {
    if (urlSessionId && !urlSessionLoadedRef.current) {
      urlSessionLoadedRef.current = true;
      handleSelectSession(urlSessionId);
    }
  }, [urlSessionId]);

  const loadSessions = async () => {
    try {
      const data = await listSessions();
      setSessions(data);
    } catch (err) {
      console.error("Failed to load sessions:", err);
    } finally {
      setLoading(false);
    }
  };

  // load session detail when active session changes
  useEffect(() => {
    if (activeSessionId) {
      // skip loading if we just created this session (it's empty)
      if (isNewSession.current) {
        isNewSession.current = false;
        setActiveSession({
          id: activeSessionId,
          title: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          rating: undefined,
          comment: undefined,
          phenotypeCode: undefined,
          isOwner: true,
          shared: false,
          messages: [],
        });
      } else if (inlineSessionIdRef.current === activeSessionId) {
        // inline creation during first exchange - session already set, don't reload
        // ref is cleared in handleNewChat/handleSelectSession when user explicitly switches
      } else if (activeSession?.id === activeSessionId) {
        // session already loaded, skip
      } else {
        loadSessionDetail(activeSessionId);
      }
    } else {
      setActiveSession(null);
      currentMessagesRef.current = [];
      savedMessageIds.current = new Set();
    }
  }, [activeSessionId, activeSession?.id]);

  // reapply the options a conversation was last held under. the last message wins rather than the
  // first: a conversation the user switched to detailed halfway through reopens as detailed, which
  // is what its most recent answers reflect. assistant rows carry the same values as the user turn
  // that produced them, so no role filter is needed
  const applyConversationOptions = (messages: ChatMessageRecord[]) => {
    const last = messages[messages.length - 1];
    // a session created but never sent to has nothing to reapply. treating it as a conversation
    // would pin the controls to whatever is on screen and block the user's stored default from
    // landing when the settings fetch resolves after this
    if (!last) {
      resetToUserDefaults();
      return;
    }
    applyChatOptions({
      verbosity: last.verbosity,
      literatureBackend: last.literatureBackend,
      toolProfile: last.toolProfile,
    });
    applyInstructionSet(last.instructionSetId);
  };

  // a new chat starts from what the user last chose, not from whatever the conversation they were
  // just reading happened to use
  const resetToUserDefaults = () => {
    resetChatOptions();
    resetInstructionSet();
  };

  const loadSessionDetail = async (sessionId: string) => {
    setSessionLoading(true);
    setSessionError(null);
    try {
      const data = await getSession(sessionId);
      savedMessageIds.current = new Set(data.messages.map((m) => m.id));

      // prepare loaded messages before showing LLMChat so it mounts with correct data
      const converted = convertMessages(data.messages);
      const hasAttachments = converted.some((m) => m.attachments && m.attachments.length > 0);
      const ready = hasAttachments ? await loadAttachmentPreviews(sessionId, converted) : converted;

      setActiveSession(data);
      // on a deep link or a refresh the session list has not resolved yet, so the detail is the
      // only place the conversation's project can come from
      setCurrentProjectId(data.projectId ?? null);
      setLoadedMessages(ready);
      applyConversationOptions(data.messages);
    } catch (err) {
      console.error("Failed to load session:", err);
      setSessionError("Chat not found or not shared with you");
      setActiveSessionId(null);
    } finally {
      setSessionLoading(false);
    }
  };

  // `projectId` omitted keeps the current project; passing null explicitly starts an unfiled chat
  /** delete the eagerly created chat the user is leaving if nothing was ever said in it.
   * `keep` is the chat being navigated to, so re-selecting the same row is not a leave. */
  const discardEmptyEagerSession = (keep?: string) => {
    const id = eagerSessionIdRef.current;
    if (!id || id === keep) return;
    eagerSessionIdRef.current = null;
    if (savedMessageIds.current.size > 0 || currentMessagesRef.current.length > 0) return;
    setSessions((prev) => prev.filter((s) => s.id !== id));
    deleteSession(id)
      .then(() => reloadProjects())
      .catch((err) => console.error("Failed to discard empty chat:", err));
  };

  const handleNewChat = async (projectId?: string | null) => {
    discardEmptyEagerSession();
    const targetProjectId = projectId === undefined ? currentProjectId : projectId;
    setCurrentProjectId(targetProjectId);
    setIsSecretChat(false);
    setSeedInput(undefined);
    resetToUserDefaults();
    try {
      const session = await createSession(undefined, targetProjectId ?? undefined);
      setSessions((prev) => [{ ...session, preview: undefined, rating: undefined }, ...prev]);
      eagerSessionIdRef.current = session.id;
      isNewSession.current = true;
      inlineSessionIdRef.current = null;
      // clear stale messages before chatKey change triggers LLMChat remount
      setLoadedMessages(undefined);
      setActiveSession({
        id: session.id,
        title: null,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
        rating: undefined,
        comment: undefined,
        phenotypeCode: undefined,
        isOwner: true,
        shared: false,
        messages: [],
      });
      setActiveSessionId(session.id);
      setChatKey(session.id);
      savedMessageIds.current = new Set();
      navigate(`/chat/${session.id}`, { replace: true });
      void reloadProjects();
    } catch (err) {
      console.error("Failed to create session:", err);
    }
  };

  // reset to a blank, not-yet-persisted new chat at root; the session is created
  // lazily on the first message (see handleFirstExchange), so the URL stays "/"
  const handleGoHome = () => {
    discardEmptyEagerSession();
    setIsSecretChat(false);
    setCurrentProjectId(null);
    setSessionError(null);
    resetToUserDefaults();
    inlineSessionIdRef.current = null;
    isNewSession.current = false;
    setLoadedMessages(undefined);
    setActiveSession(null);
    setActiveSessionId(null);
    setChatKey(`new-${Date.now()}`);
    savedMessageIds.current = new Set();
    currentMessagesRef.current = [];
    navigate("/");
  };

  const handleNewSecretChat = () => {
    discardEmptyEagerSession();
    setIsSecretChat(true);
    setSeedInput(undefined);
    resetToUserDefaults();
    setActiveSessionId(null);
    setActiveSession(null);
    setSecretSessionId(crypto.randomUUID());
    setChatKey(`secret-${Date.now()}`);
    savedMessageIds.current = new Set();
    currentMessagesRef.current = [];
    navigate("/chat", { replace: true });
  };

  const handleSelectSession = (sessionId: string) => {
    discardEmptyEagerSession(sessionId);
    setIsSecretChat(false);
    setCurrentProjectId(sessions.find((s) => s.id === sessionId)?.projectId ?? null);
    setSeedInput(undefined);
    setSessionError(null);
    inlineSessionIdRef.current = null;
    setLoadedMessages(undefined);
    setActiveSessionId(sessionId);
    setChatKey(sessionId);
    navigate(`/chat/${sessionId}`, { replace: true });
  };

  const handleDeleteSession = async (sessionId: string) => {
    try {
      await deleteSession(sessionId);
      if (eagerSessionIdRef.current === sessionId) eagerSessionIdRef.current = null;
      setSessions((prev) => prev.filter((s) => s.id !== sessionId));
      if (activeSessionId === sessionId) {
        setActiveSessionId(null);
      }
      void reloadProjects();
    } catch (err) {
      console.error("Failed to delete session:", err);
    }
  };

  // convert data URL to File for upload
  const dataUrlToFile = (dataUrl: string, fileName: string, mimeType: string): File => {
    const arr = dataUrl.split(",");
    const bstr = atob(arr[1]);
    let n = bstr.length;
    const u8arr = new Uint8Array(n);
    while (n--) {
      u8arr[n] = bstr.charCodeAt(n);
    }
    return new File([u8arr], fileName, { type: mimeType });
  };

  // save a single message to backend
  const saveMessageToBackend = useCallback(
    async (
      sessionId: string,
      msg: ChatMessage,
      literatureBackend?: string | null,
      toolProfile?: string | null,
      instructionSetId?: string | null,
      verbosity?: string | null,
    ) => {
      const hasContent = msg.content.trim();
      const hasAttachments = msg.attachments && msg.attachments.length > 0;
      if (!hasContent && !hasAttachments) return;

      // for user messages with attachments, upload files and store metadata in contentJson
      let contentJson = msg.contentJson;
      if (msg.role === "user" && hasAttachments) {
        // upload every attachment type, not just images: an un-uploaded data file
        // survives only as long as the page's in-memory File, so reopening the session
        // would leave the model with a filename and no contents
        const uploadedAttachments = await Promise.all(
          msg.attachments!.map(async (a) => {
            if (a.serverId) return a;
            // images are re-derived from the preview data URL; data files carry the
            // original File so Excel is uploaded as Excel, not as its parsed TSV
            const file =
              a.type === "image" && a.previewUrl
                ? dataUrlToFile(a.previewUrl, a.name, a.mimeType)
                : a.file;
            if (!file) return a;
            try {
              const uploaded = await uploadAttachment(sessionId, file);
              return { ...a, serverId: uploaded.id, status: "uploaded" as const };
            } catch (err) {
              console.error("Failed to upload attachment:", err);
              return a;
            }
          }),
        );

        const attachmentMeta = uploadedAttachments.map((a) => ({
          id: a.id,
          name: a.name,
          size: a.size,
          type: a.type,
          mimeType: a.mimeType,
          serverId: a.serverId,
          status: a.status,
        }));
        contentJson = JSON.stringify({ attachments: attachmentMeta });
      }

      try {
        await saveMessage(sessionId, msg.id, msg.role, msg.content, contentJson, literatureBackend, toolProfile, msg.toolResultsJson, instructionSetId, verbosity);
      } catch (err) {
        console.error("Failed to save message:", err);
      }
    },
    [],
  );

  const handleMessagesChange = useCallback((messages: ChatMessage[]) => {
    currentMessagesRef.current = messages;
    setCurrentMessageCount(messages.length);
    // messages are saved via onStreamingComplete callback, not here
  }, []);

  // called when streaming completes for a message exchange
  const handleStreamingComplete = useCallback(
    async (
      userMessage: ChatMessage,
      assistantMessage: ChatMessage,
      messageContent?: any[] | null,
      literatureBackend?: string | null,
      toolProfile?: string | null,
      toolResults?: any[] | null,
      instructionSetId?: string | null,
      verbosity?: string | null,
    ) => {
      if (isSecretChat) return;
      console.log("[handleStreamingComplete] literatureBackend:", literatureBackend, "toolProfile:", toolProfile, "instructionSetId:", instructionSetId);
      if (!activeSessionId) return;

      // save user message with literature backend and tool profile
      const hasUserContent = userMessage.content.trim();
      const hasUserAttachments = userMessage.attachments && userMessage.attachments.length > 0;
      if (!savedMessageIds.current.has(userMessage.id) && (hasUserContent || hasUserAttachments)) {
        await saveMessageToBackend(activeSessionId, userMessage, literatureBackend, toolProfile, instructionSetId, verbosity);
        savedMessageIds.current.add(userMessage.id);
      }

      // save assistant message with full content_json (includes tool calls), literature backend, and tool profile
      if (!savedMessageIds.current.has(assistantMessage.id) && assistantMessage.content.trim()) {
        const contentJson = messageContent ? JSON.stringify(messageContent) : null;
        const toolResultsJson = toolResults ? JSON.stringify(toolResults) : null;
        await saveMessageToBackend(
          activeSessionId,
          {
            ...assistantMessage,
            contentJson,
            toolResultsJson,
          },
          literatureBackend,
          toolProfile,
          instructionSetId,
          verbosity,
        );
        savedMessageIds.current.add(assistantMessage.id);
      }
    },
    [activeSessionId, saveMessageToBackend, isSecretChat],
  );

  /**
   * The session id for a turn, created on demand.
   *
   * Called by LLMChat BEFORE the request goes out. It used to run after the exchange
   * instead, which meant the first turn of an inline-started chat was sent with
   * `session_id: null` — and `run_analysis` refuses a turn with no session, because that id
   * becomes the `sid` claim of the per-execution sandbox credential and is what scopes the
   * execution's artifacts and audit records to a conversation
   * (genetics-results-suite-vda). Every other tool worked, so the only symptom was the
   * agent saying it had no authenticated session when asked to plot.
   *
   * Idempotent through `inlineSessionIdRef`: a second call before React has re-rendered
   * with the new `activeSessionId` returns the same id rather than creating another row.
   */
  const ensureSession = useCallback(async (): Promise<string | null> => {
    if (isSecretChat) return secretSessionId;
    const existing = activeSessionId ?? inlineSessionIdRef.current;
    if (existing) return existing;

    const session = await createSession(undefined, currentProjectId ?? undefined);

    // adopt the id WITHOUT a chatKey change, which would remount LLMChat mid-send
    inlineSessionIdRef.current = session.id;
    setActiveSession({
      id: session.id,
      title: null,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      rating: undefined,
      comment: undefined,
      phenotypeCode: undefined,
      isOwner: true,
      shared: false,
      messages: [],
    });
    setSessions((prev) => [{ ...session, preview: undefined, rating: undefined }, ...prev]);
    setActiveSessionId(session.id);
    // prevent the URL useEffect from treating this as a fresh navigation
    urlSessionLoadedRef.current = true;
    navigate(`/chat/${session.id}`, { replace: true });
    return session.id;
  }, [activeSessionId, isSecretChat, secretSessionId, currentProjectId, navigate]);

  // called after first exchange completes - saves the initial messages
  const handleFirstExchange = useCallback(
    async (
      literatureBackend?: string | null,
      toolProfile?: string | null,
      instructionSetId?: string | null,
      verbosity?: string | null,
    ) => {
      if (isSecretChat) return;
      console.log("[handleFirstExchange] literatureBackend:", literatureBackend, "toolProfile:", toolProfile, "instructionSetId:", instructionSetId);
      // `ensureSession` ran before the turn was sent, so one exists. The ref is read as well
      // as the state because the state may not have re-rendered this callback yet.
      let sessionIdToUse = activeSessionId ?? inlineSessionIdRef.current;

      // a turn whose session creation failed still streamed and answered; it simply has
      // nowhere to be saved
      if (!sessionIdToUse) {
        try {
          sessionIdToUse = await ensureSession();
        } catch (err) {
          console.error("Failed to create session:", err);
          return;
        }
        if (!sessionIdToUse) return;
      }

      // save all current messages to the newly created session
      const messages = currentMessagesRef.current;
      for (const msg of messages) {
        const hasContent = msg.content.trim();
        const hasAttachments = msg.attachments && msg.attachments.length > 0;
        if ((hasContent || hasAttachments) && !savedMessageIds.current.has(msg.id)) {
          await saveMessageToBackend(sessionIdToUse, msg, literatureBackend, toolProfile, instructionSetId, verbosity);
          savedMessageIds.current.add(msg.id);
        }
      }

      // update session preview
      const firstUserMsg = messages.find((m) => m.role === "user");
      if (firstUserMsg) {
        setSessions((prev) =>
          prev.map((s) =>
            s.id === sessionIdToUse
              ? {
                  ...s,
                  updatedAt: new Date().toISOString(),
                  preview: s.title ? undefined : firstUserMsg.content.slice(0, 80),
                }
              : s,
          ),
        );
      }

      // generate title
      try {
        const title = await generateTitle(sessionIdToUse);
        setActiveSession((prev) => (prev ? { ...prev, title } : null));
        setSessions((prev) =>
          prev.map((s) => (s.id === sessionIdToUse ? { ...s, title, preview: undefined } : s)),
        );
      } catch (err) {
        console.error("Failed to generate title:", err);
      }
    },
    [activeSessionId, saveMessageToBackend, isSecretChat, ensureSession],
  );

  const handleRateMessage = useCallback(async (messageId: string, thumbsUp: boolean | null) => {
    try {
      await rateMessage(messageId, thumbsUp);
    } catch (err) {
      console.error("Failed to rate message:", err);
    }
  }, []);

  const handleExportChat = (format: "html" | "markdown") => {
    setExportMenuAnchor(null);
    const messages = currentMessagesRef.current;
    if (messages.length === 0) return;
    const title = activeSession?.title || "chat";
    if (format === "html") {
      exportChatAsHtml(messages, title);
    } else {
      exportChatAsMarkdown(messages, title);
    }
  };

  const handleShare = async () => {
    if (!activeSessionId) return;
    try {
      await shareSession(activeSessionId, true);
      setActiveSession((prev) => (prev ? { ...prev, shared: true } : null));
      await navigator.clipboard.writeText(window.location.href);
      setSharePopoverOpen(true);
      setTimeout(() => setSharePopoverOpen(false), 3000);
    } catch (err) {
      console.error("Failed to share session:", err);
    }
  };

  const handleUnshare = async () => {
    if (!activeSessionId) return;
    try {
      await shareSession(activeSessionId, false);
      setActiveSession((prev) => (prev ? { ...prev, shared: false } : null));
    } catch (err) {
      console.error("Failed to unshare session:", err);
    }
  };

  const handleFork = async () => {
    if (!activeSessionId) return;
    setSeedInput(undefined);
    try {
      const newSession = await forkSession(activeSessionId);
      setSessions((prev) => [{ ...newSession, preview: undefined, rating: undefined }, ...prev]);
      navigate(`/chat/${newSession.id}`);
      setActiveSessionId(newSession.id);
      setChatKey(newSession.id);
    } catch (err) {
      console.error("Failed to fork session:", err);
    }
  };

  // pin state lives on the session-list entry, not on SessionDetail (the backend only adds
  // `pinned` to the list response), so read and update it there rather than on activeSession
  const activeSessionPinned = sessions.find((s) => s.id === activeSessionId)?.pinned ?? false;

  const handleTogglePinSession = async (sessionId: string, wasPinned: boolean) => {
    const next = !wasPinned;
    setSessions((prev) => prev.map((s) => (s.id === sessionId ? { ...s, pinned: next } : s)));
    try {
      await pinSession(sessionId, next);
    } catch (err) {
      console.error("Failed to update pin:", err);
      setSessions((prev) => prev.map((s) => (s.id === sessionId ? { ...s, pinned: wasPinned } : s)));
      // rethrown so the sidebar can undo the same flip in its per-project cache, which the
      // session list above does not cover
      throw err;
    }
  };

  // the loaded detail wins over the session list, which is capped at 50 and may not have
  // resolved at all on a deep link; it is only trusted while it describes the open conversation
  const activeSessionProjectId =
    (activeSession?.id === activeSessionId ? activeSession?.projectId : undefined) ??
    sessions.find((s) => s.id === activeSessionId)?.projectId ??
    null;

  // `previousProjectId` is the caller's: the sidebar shows rows past the session list's 50-item
  // cap out of its own per-project cache, and rolling those back off the list alone unfiles them
  const handleMoveSession = async (
    sessionId: string,
    projectId: string | null,
    previousProjectId?: string | null,
  ) => {
    const listed = sessions.find((s) => s.id === sessionId);
    const previous =
      previousProjectId !== undefined
        ? previousProjectId
        : (listed?.projectId ??
          (activeSession?.id === sessionId ? (activeSession.projectId ?? null) : null));
    const applyProject = (value: string | null) => {
      setSessions((prev) =>
        prev.map((s) => (s.id === sessionId ? { ...s, projectId: value } : s)),
      );
      setActiveSession((prev) => (prev?.id === sessionId ? { ...prev, projectId: value } : prev));
      if (sessionId === activeSessionId) setCurrentProjectId(value);
    };
    applyProject(projectId);
    try {
      await moveSession(sessionId, projectId);
      void reloadProjects();
    } catch (err) {
      console.error("Failed to move conversation:", err);
      applyProject(previous);
    }
  };

  // rejects on failure: the sidebar's dialog is where the user finds out
  const handleDeleteProject = async (projectId: string, withSessions: boolean) => {
    const openChatWasFiledHere = activeSessionProjectId === projectId;
    await removeProject(projectId, withSessions);
    if (withSessions && openChatWasFiledHere) {
      // the conversation on screen was deleted with the project; there is nothing to go back to
      handleGoHome();
    } else if (openChatWasFiledHere) {
      // the chat stays, unfiled: leaving the id on the detail hands the memory chip and the
      // next digest a project that no longer exists
      setActiveSession((prev) =>
        prev && prev.projectId === projectId ? { ...prev, projectId: null } : prev,
      );
    }
    if (currentProjectId === projectId) setCurrentProjectId(null);
    // the kept chats come back unfiled, and the deleted ones are gone: either way the
    // session list on screen is now wrong
    await loadSessions();
  };

  const handleTogglePin = () => {
    if (!activeSessionId) return;
    // already logged and rolled back inside; this caller has nothing left to do with the failure
    void handleTogglePinSession(activeSessionId, activeSessionPinned).catch(() => {});
  };

  const handleSessionRatingSave = async (rating: number, comment?: string) => {
    if (!activeSessionId) return;
    try {
      await updateSession(activeSessionId, { rating, comment });
      setActiveSession((prev) => (prev ? { ...prev, rating, comment: comment ?? undefined } : null));
      setSessions((prev) => prev.map((s) => (s.id === activeSessionId ? { ...s, rating } : s)));
    } catch (err) {
      console.error("Failed to save session rating:", err);
    }
  };

  // convert backend messages to frontend format, restoring attachments from contentJson
  const convertMessages = (messages: ChatMessageRecord[]): ChatMessage[] => {
    return messages.map((m) => {
      let attachments: FileAttachment[] | undefined;

      // for user messages, check if contentJson contains attachment metadata
      if (m.role === "user" && m.contentJson) {
        try {
          const parsed = JSON.parse(m.contentJson);
          if (parsed.attachments && Array.isArray(parsed.attachments)) {
            attachments = parsed.attachments;
          }
        } catch {
          // contentJson is not our attachment format, ignore
        }
      }

      return {
        id: m.id,
        role: m.role as "user" | "assistant",
        content: m.content,
        createdAt: m.createdAt,
        thumbsUp: m.thumbsUp,
        contentJson: m.contentJson,
        toolResultsJson: m.toolResultsJson,
        verbosity: m.verbosity,
        instructionSetId: m.instructionSetId,
        attachments,
      };
    });
  };

  // restore attachment payloads from the server: image previews, and the text of data
  // files so replayed turns still carry their contents
  const loadAttachmentPreviews = useCallback(
    async (sessionId: string, messages: ChatMessage[]): Promise<ChatMessage[]> => {
      const updatedMessages = await Promise.all(
        messages.map(async (msg) => {
          if (!msg.attachments || msg.attachments.length === 0) return msg;

          const updatedAttachments = await Promise.all(
            msg.attachments.map(async (att) => {
              // only fetch if it's an image with serverId but no previewUrl
              if (att.type === "image" && att.serverId && !att.previewUrl) {
                try {
                  const blob = await getAttachment(sessionId, att.serverId);
                  const previewUrl = await new Promise<string>((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onloadend = () => resolve(reader.result as string);
                    reader.onerror = reject;
                    reader.readAsDataURL(blob);
                  });
                  return { ...att, previewUrl };
                } catch (err) {
                  console.error("Failed to load attachment preview:", err);
                  return att;
                }
              }
              if (att.type !== "image" && att.serverId && !att.textContent) {
                try {
                  return { ...att, textContent: await getAttachmentText(sessionId, att.serverId) };
                } catch (err) {
                  // pre-fix messages have no serverId at all and are unrecoverable; this
                  // path only fires when the upload succeeded but the sidecar is missing
                  console.error("Failed to load attachment text:", err);
                  return att;
                }
              }
              return att;
            }),
          );

          return { ...msg, attachments: updatedAttachments };
        }),
      );
      return updatedMessages;
    },
    [],
  );

  // load attachment previews when session changes
  useEffect(() => {
    if (!activeSession) {
      setLoadedMessages(undefined);
      return;
    }

    const messages = convertMessages(activeSession.messages);
    const hasAttachments = messages.some((m) => m.attachments && m.attachments.length > 0);

    if (!hasAttachments) {
      setLoadedMessages(messages);
      return;
    }

    // load attachment previews asynchronously
    loadAttachmentPreviews(activeSession.id, messages).then(setLoadedMessages);
  }, [activeSession, loadAttachmentPreviews]);

  return (
    <Box sx={{ display: "flex", flexDirection: "column", height: "calc(100dvh - 64px)" }}>
      {/* header row */}
      <Box sx={{ display: "flex" }}>
        <Box sx={{ width: 280, flexShrink: 0, borderColor: "divider", display: { xs: "none", md: "block" } }} />
        <Box sx={{ flex: 1, p: { xs: 1, md: 2 }, pb: 0 }}>
          <Box
            sx={{
              mb: { xs: 0.5, md: 2 },
              display: "flex",
              flexDirection: "row",
              alignItems: { xs: "center", md: "flex-start" },
              gap: { xs: 1, md: 2 },
            }}
          >
            <IconButton
              aria-label="Open chat history"
              onClick={() => setMobileDrawerOpen(true)}
              edge="start"
              size="small"
              sx={{ display: { xs: "inline-flex", md: "none" } }}
            >
              <MenuIcon />
            </IconButton>
            <Box
              component="img"
              src={finnGenieLogo}
              alt={APP_NAME}
              onClick={handleGoHome}
              sx={{ height: { xs: 28, md: 60 }, flexShrink: 0, cursor: "pointer" }}
            />
            <Box
              sx={{
                minWidth: 0,
                flex: 1,
                display: { xs: "flex", md: "block" },
                alignItems: { xs: "center", md: "stretch" },
                gap: { xs: 1, md: 0 },
              }}
            >
              <Box
                sx={{
                  display: "flex",
                  alignItems: "center",
                  flexWrap: "wrap",
                  gap: { xs: 1, md: 2 },
                  minWidth: 0,
                  flex: { xs: 1, md: "0 1 auto" },
                }}
              >
                <Typography
                  variant={isMobile ? "h6" : "h5"}
                  noWrap={isMobile}
                  sx={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}
                >
                  {isSecretChat ? "Secret Chat" : activeSession?.title || APP_NAME}
                </Typography>
                {isSecretChat && (
                  <Chip
                    icon={<VisibilityOff sx={{ fontSize: 16 }} />}
                    label="Not Saved"
                    color="warning"
                    size="small"
                  />
                )}
                {/* a pin only holds a conversation in its project's memory window, so an
                    unfiled conversation offers none */}
                {activeSession?.isOwner && activeSessionId && !isSecretChat && activeSession.projectId && (
                  <Tooltip title={activeSessionPinned ? "Kept in project memory" : "Keep in project memory"}>
                    <IconButton size="small" onClick={handleTogglePin} aria-label={activeSessionPinned ? "unpin" : "pin"}>
                      {activeSessionPinned ? <StarIcon fontSize="small" /> : <StarBorderIcon fontSize="small" />}
                    </IconButton>
                  </Tooltip>
                )}
                {activeSession?.isOwner && activeSessionId && !isSecretChat && (
                  <span ref={shareButtonRef}>
                    {activeSession.shared ? (
                      <Button
                        size="small"
                        variant="outlined"
                        startIcon={<LinkOffIcon />}
                        onClick={handleUnshare}
                      >
                        Unshare
                      </Button>
                    ) : (
                      <Button
                        size="small"
                        variant="outlined"
                        startIcon={<ShareIcon />}
                        onClick={handleShare}
                      >
                        Share
                      </Button>
                    )}
                  </span>
                )}
                {activeSession && !activeSession.isOwner && (
                  <Button
                    size="small"
                    variant="outlined"
                    startIcon={<ForkRightIcon />}
                    onClick={handleFork}
                  >
                    Fork to continue
                  </Button>
                )}
                {currentMessageCount > 0 && (
                  <Button
                    size="small"
                    variant="outlined"
                    startIcon={<FileDownloadIcon />}
                    onClick={(e) => setExportMenuAnchor(e.currentTarget)}
                  >
                    Export
                  </Button>
                )}
              </Box>

              {(() => {
                const actions: Array<{
                  key: string;
                  label: string;
                  icon?: ReactNode;
                  tooltip?: string;
                  onClick: (e: ReactMouseEvent<HTMLElement>) => void;
                }> = [
                  { key: "about", label: "About", onClick: () => setAboutOpen(true) },
                  { key: "feedback", label: "Feedback", onClick: () => setFeedbackOpen(true) },
                  { key: "tokens", label: "MCP/API Keys", onClick: () => setTokensOpen(true) },
                  { key: "datasets", label: "Datasets", onClick: () => setDatasetsOpen(true) },
                  {
                    key: "tools",
                    label: "Tools",
                    tooltip: "What the assistant can call",
                    onClick: () => setToolsOpen(true),
                  },
                  ...(activeSessionId && !isSecretChat && activeSession?.isOwner && projects.length > 0
                    ? [
                        {
                          key: "move",
                          label: "Move to\u2026",
                          tooltip: "File this conversation in a project",
                          onClick: (e: ReactMouseEvent<HTMLElement>) =>
                            setTopMoveAnchorEl(e.currentTarget),
                        },
                      ]
                    : []),
                  {
                    key: "tables",
                    label: "Tables",
                    tooltip: "Database tables",
                    onClick: () => schemaRoute.openEmpty(),
                  },
                ];

                return (
                  <Box sx={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: { xs: 0.5, md: 1 }, mt: { xs: 0, md: 1 }, flexShrink: 0 }}>
                    {isMobile ? (
                      <>
                        <IconButton
                          aria-label="More actions"
                          size="small"
                          onClick={(e) => setActionMenuAnchorEl(e.currentTarget)}
                        >
                          <MoreVertIcon />
                        </IconButton>
                        <Menu
                          anchorEl={actionMenuAnchorEl}
                          open={Boolean(actionMenuAnchorEl)}
                          onClose={() => setActionMenuAnchorEl(null)}
                        >
                          {actions.map((a) => (
                            <MenuItem
                              key={a.key}
                              onClick={(e) => {
                                a.onClick(e);
                                setActionMenuAnchorEl(null);
                              }}
                            >
                              {a.icon && <ListItemIcon>{a.icon}</ListItemIcon>}
                              <ListItemText>{a.label}</ListItemText>
                            </MenuItem>
                          ))}
                        </Menu>
                      </>
                    ) : (
                      actions.map((a) => {
                        const btn = (
                          <Button
                            key={a.key}
                            size="small"
                            startIcon={a.icon}
                            onClick={a.onClick}
                          >
                            {a.label}
                          </Button>
                        );
                        return a.tooltip ? (
                          <Tooltip key={a.key} title={a.tooltip}>
                            {btn}
                          </Tooltip>
                        ) : (
                          btn
                        );
                      })
                    )}
                  </Box>
                );
              })()}
            </Box>
          </Box>
        </Box>
      </Box>

      {/* content row */}
      <Box sx={{ display: "flex", flex: 1, minHeight: 0 }}>
        {/* sidebar: permanent on >= md */}
        <Box
          sx={{
            width: 280,
            flexShrink: 0,
            borderRight: 1,
            borderColor: "divider",
            overflow: "hidden",
            display: { xs: "none", md: "block" },
          }}>
          <ChatHistorySidebar
            sessions={sessions}
            activeSessionId={activeSessionId}
            onSelectSession={handleSelectSession}
            onNewChat={handleNewChat}
            onNewSecretChat={handleNewSecretChat}
            onDeleteSession={handleDeleteSession}
            onTogglePinSession={handleTogglePinSession}
            loading={loading}
            projects={projects}
            currentProjectId={currentProjectId}
            onSelectCurrentProject={setCurrentProjectId}
            onNewChatInProject={(projectId) => handleNewChat(projectId)}
            onCreateProject={createProject}
            onRenameProject={renameProject}
            onDeleteProject={handleDeleteProject}
            onMoveSession={handleMoveSession}
            onOpenProjectMemory={setMemoryProjectId}
            isSecretChat={isSecretChat}
          />
        </Box>
        {/* sidebar: temporary drawer on < md */}
        {isMobile && (
          <Drawer
            anchor="left"
            variant="temporary"
            open={mobileDrawerOpen}
            onClose={() => setMobileDrawerOpen(false)}
            ModalProps={{ keepMounted: true }}
            PaperProps={{ sx: { width: 280 } }}
          >
            <ChatHistorySidebar
              sessions={sessions}
              activeSessionId={activeSessionId}
              onSelectSession={handleSelectSession}
              onNewChat={handleNewChat}
              onNewSecretChat={handleNewSecretChat}
              onDeleteSession={handleDeleteSession}
              onTogglePinSession={handleTogglePinSession}
              loading={loading}
              onAfterSelect={() => setMobileDrawerOpen(false)}
              projects={projects}
              currentProjectId={currentProjectId}
              onSelectCurrentProject={setCurrentProjectId}
              onNewChatInProject={(projectId) => handleNewChat(projectId)}
              onCreateProject={createProject}
              onRenameProject={renameProject}
              onDeleteProject={handleDeleteProject}
              onMoveSession={handleMoveSession}
              onOpenProjectMemory={setMemoryProjectId}
              isSecretChat={isSecretChat}
            />
          </Drawer>
        )}

        {/* main chat area */}
        <Box
          sx={{
            flex: 1,
            minWidth: 0,
            display: "flex",
            flexDirection: "column",
            p: 2,
            pt: 0,
          }}>
          {sessionError ? (
            <Box sx={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Alert severity="warning">{sessionError}</Alert>
            </Box>
          ) : sessionLoading ? (
            <Box sx={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <CircularProgress />
            </Box>
          ) : (
            <Box sx={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
              {activeSession && !activeSession.isOwner && (
                <Alert severity="info" sx={{ mb: 1 }}>
                  This is a shared chat. You are viewing it in read-only mode.
                </Alert>
              )}
              <LLMChat
                key={chatKey}
                sessionId={isSecretChat ? secretSessionId : activeSessionId}
                initialMessages={isSecretChat ? undefined : loadedMessages}
                onMessagesChange={handleMessagesChange}
                onEnsureSession={ensureSession}
                onFirstExchange={handleFirstExchange}
                onStreamingComplete={handleStreamingComplete}
                onRateMessage={isSecretChat ? undefined : handleRateMessage}
                placeholder="Ask about phenotypes, genes, variants..."
                emptyStateTitle={`Welcome to ${APP_NAME}`}
                emptyStateDescription=""
                height="100%"
                exampleQuestions={[
                  "What do we know about the effects of rs200317762?",
                  "What schizophrenia data do we have?",
                  "Summarize findings on antimycotics use in FinnGen.",
                  "How many unique fine-mapped protective loss-of-function variants do we have in FinnGen with PIP > 0.05, MAF < 0.05, p-value < 1e-10 and what phenotypes are they associated to?",
                  "We've found that the variant chr2:9521321:A:G (ADAM17) confers risk to IBD. Does this variant colocalize with any molecular QTLs (eQTL, pQTL) that might indicate the function of this variant and what process might be implicated?",
                ]}
                isSecretChat={isSecretChat}
                projectId={isSecretChat ? null : activeSessionProjectId}
                readOnly={activeSession ? !activeSession.isOwner : false}
                initialInput={seedInput ?? storedDraft?.text}
                initialAttachments={storedDraft?.attachments}
                onDraftChange={handleDraftChange}
              />
            </Box>
          )}

          {/* session rating at bottom */}
          {!isSecretChat && activeSessionId && currentMessageCount > 0 && (
            <SessionRating
              sessionId={activeSessionId}
              rating={activeSession?.rating ?? null}
              comment={activeSession?.comment ?? null}
              onSave={handleSessionRatingSave}
            />
          )}
        </Box>

      </Box>

      <Typography
        variant="caption"
        color="text.secondary"
        sx={{ textAlign: "center", px: 2, py: { xs: 0.5, md: 1 }, display: isShort ? "none" : "block" }}
      >
        {APP_NAME} is an AI tool intended to assist exploration, not replace expert judgment. It may
        generate incorrect or misleading information. Always validate findings against authoritative
        sources before use in research.
      </Typography>

      <Menu
        anchorEl={exportMenuAnchor}
        open={Boolean(exportMenuAnchor)}
        onClose={() => setExportMenuAnchor(null)}
      >
        <MenuItem onClick={() => handleExportChat("html")}>As HTML</MenuItem>
        <MenuItem onClick={() => handleExportChat("markdown")}>As Markdown</MenuItem>
      </Menu>
      <Menu
        anchorEl={topMoveAnchorEl}
        open={Boolean(topMoveAnchorEl)}
        onClose={() => setTopMoveAnchorEl(null)}
      >
        {projects
          .filter((p) => p.id !== activeSessionProjectId)
          .map((p) => (
            <MenuItem
              key={p.id}
              onClick={() => {
                setTopMoveAnchorEl(null);
                if (activeSessionId) void handleMoveSession(activeSessionId, p.id);
              }}
            >
              {p.name}
            </MenuItem>
          ))}
        {activeSessionProjectId && (
          <MenuItem
            onClick={() => {
              setTopMoveAnchorEl(null);
              if (activeSessionId) void handleMoveSession(activeSessionId, null);
            }}
          >
            No project
          </MenuItem>
        )}
      </Menu>
      <MemoryDialog
        open={Boolean(memoryProjectId)}
        onClose={() => setMemoryProjectId(null)}
        projectId={memoryProjectId}
      />
      <FeedbackDialog open={feedbackOpen} onClose={() => setFeedbackOpen(false)} />
      <AboutDialog open={aboutOpen} onClose={() => setAboutOpen(false)} />
      <McpTokenDialog open={tokensOpen} onClose={() => setTokensOpen(false)} />
      <DatasetsDialog open={datasetsOpen} onClose={() => setDatasetsOpen(false)} />
      <ToolsDialog open={toolsOpen} onClose={() => setToolsOpen(false)} />
      <SchemaDrawer
        open={schemaRoute.open}
        onClose={schemaRoute.close}
        selectedView={schemaRoute.selectedView}
        onSelectView={schemaRoute.openTo}
        onShowOverview={schemaRoute.clearSelection}
      />
      <Popover
        open={sharePopoverOpen}
        anchorEl={shareButtonRef.current}
        onClose={() => setSharePopoverOpen(false)}
        anchorOrigin={{ vertical: "bottom", horizontal: "left" }}
        transformOrigin={{ vertical: "top", horizontal: "left" }}
        disableAutoFocus
        disableEnforceFocus
      >
        <Alert severity="success" sx={{ py: 0.5 }}>
          Chat URL copied to clipboard — share it with others!
        </Alert>
      </Popover>
    </Box>
  );
};

export default ChatPage;
