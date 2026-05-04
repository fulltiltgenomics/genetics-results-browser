import { useState, useEffect, useCallback, useRef } from "react";
import { Box, Typography, CircularProgress, Button, Chip, Menu, MenuItem } from "@mui/material";
import { VisibilityOff } from "@mui/icons-material";
import finnGenieLogo from "../../assets/finngenie-leonardo-gemini-2.5-flash-recraft-vectorized-claude-cropped.svg";
import { LLMChat } from "./LLMChat";
import { ChatHistorySidebar } from "./ChatHistorySidebar";
import { SessionRating } from "./SessionRating";
import { FeedbackDialog } from "./FeedbackDialog";
import { AboutDialog } from "./AboutDialog";
import McpTokenDialog from "../page/McpTokenDialog";
import { DatasetsDialog } from "./DatasetsDialog";
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
  uploadAttachment,
  type ChatSession,
  type SessionDetail,
  type ChatMessageRecord,
} from "./chatHistoryApi";
import type { ChatMessage, FileAttachment } from "./chat.types";
import { exportChatAsHtml, exportChatAsMarkdown } from "./exportChat";

/**
 * Standalone chat page with history sidebar and config editor.
 * Three-column layout: [Sidebar 280px] [Chat flex:1] [Config 600px]
 */
const ChatPage = () => {
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
  const [exportMenuAnchor, setExportMenuAnchor] = useState<HTMLElement | null>(null);
  const [datasetsOpen, setDatasetsOpen] = useState(false);

  // track current messages for saving
  const currentMessagesRef = useRef<ChatMessage[]>([]);
  const savedMessageIds = useRef<Set<string>>(new Set());
  // track if we just created a new session (to skip loading)
  const isNewSession = useRef(false);
  // track session created inline (during first exchange) to avoid remounting LLMChat
  const inlineSessionIdRef = useRef<string | null>(null);
  // stable key for LLMChat - only changes when user explicitly switches sessions
  const [chatKey, setChatKey] = useState<string>("new");

  // load sessions on mount
  useEffect(() => {
    loadSessions();
  }, []);

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

  const loadSessionDetail = async (sessionId: string) => {
    setSessionLoading(true);
    try {
      const data = await getSession(sessionId);
      savedMessageIds.current = new Set(data.messages.map((m) => m.id));

      // prepare loaded messages before showing LLMChat so it mounts with correct data
      const converted = convertMessages(data.messages);
      const hasAttachments = converted.some((m) => m.attachments && m.attachments.length > 0);
      const ready = hasAttachments ? await loadAttachmentPreviews(sessionId, converted) : converted;

      setActiveSession(data);
      setLoadedMessages(ready);
    } catch (err) {
      console.error("Failed to load session:", err);
      // session may have been deleted
      setActiveSessionId(null);
    } finally {
      setSessionLoading(false);
    }
  };

  const handleNewChat = async () => {
    setIsSecretChat(false);
    try {
      const session = await createSession();
      setSessions((prev) => [{ ...session, preview: undefined, rating: undefined }, ...prev]);
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
        messages: [],
      });
      setActiveSessionId(session.id);
      setChatKey(session.id);
      savedMessageIds.current = new Set();
    } catch (err) {
      console.error("Failed to create session:", err);
    }
  };

  const handleNewSecretChat = () => {
    setIsSecretChat(true);
    setActiveSessionId(null);
    setActiveSession(null);
    setChatKey(`secret-${Date.now()}`);
    savedMessageIds.current = new Set();
    currentMessagesRef.current = [];
  };

  const handleSelectSession = (sessionId: string) => {
    setIsSecretChat(false);
    inlineSessionIdRef.current = null;
    setLoadedMessages(undefined);
    setActiveSessionId(sessionId);
    setChatKey(sessionId);
  };

  const handleDeleteSession = async (sessionId: string) => {
    try {
      await deleteSession(sessionId);
      setSessions((prev) => prev.filter((s) => s.id !== sessionId));
      if (activeSessionId === sessionId) {
        setActiveSessionId(null);
      }
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
    async (sessionId: string, msg: ChatMessage, literatureBackend?: string | null, toolProfile?: string | null) => {
      const hasContent = msg.content.trim();
      const hasAttachments = msg.attachments && msg.attachments.length > 0;
      if (!hasContent && !hasAttachments) return;

      // for user messages with attachments, upload files and store metadata in contentJson
      let contentJson = msg.contentJson;
      if (msg.role === "user" && hasAttachments) {
        // upload attachments that have previewUrl but no serverId
        const uploadedAttachments = await Promise.all(
          msg.attachments!.map(async (a) => {
            if (a.type === "image" && a.previewUrl && !a.serverId) {
              try {
                const file = dataUrlToFile(a.previewUrl, a.name, a.mimeType);
                const uploaded = await uploadAttachment(sessionId, file);
                return { ...a, serverId: uploaded.id, status: "uploaded" as const };
              } catch (err) {
                console.error("Failed to upload attachment:", err);
                return a;
              }
            }
            return a;
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
        await saveMessage(sessionId, msg.id, msg.role, msg.content, contentJson, literatureBackend, toolProfile);
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
    ) => {
      if (isSecretChat) return;
      console.log("[handleStreamingComplete] literatureBackend:", literatureBackend, "toolProfile:", toolProfile);
      if (!activeSessionId) return;

      // save user message with literature backend and tool profile
      const hasUserContent = userMessage.content.trim();
      const hasUserAttachments = userMessage.attachments && userMessage.attachments.length > 0;
      if (!savedMessageIds.current.has(userMessage.id) && (hasUserContent || hasUserAttachments)) {
        await saveMessageToBackend(activeSessionId, userMessage, literatureBackend, toolProfile);
        savedMessageIds.current.add(userMessage.id);
      }

      // save assistant message with full content_json (includes tool calls), literature backend, and tool profile
      if (!savedMessageIds.current.has(assistantMessage.id) && assistantMessage.content.trim()) {
        const contentJson = messageContent ? JSON.stringify(messageContent) : null;
        await saveMessageToBackend(
          activeSessionId,
          {
            ...assistantMessage,
            contentJson,
          },
          literatureBackend,
          toolProfile,
        );
        savedMessageIds.current.add(assistantMessage.id);
      }
    },
    [activeSessionId, saveMessageToBackend, isSecretChat],
  );

  // called after first exchange completes - creates session and saves initial messages
  const handleFirstExchange = useCallback(
    async (literatureBackend?: string | null, toolProfile?: string | null) => {
      if (isSecretChat) return;
      console.log("[handleFirstExchange] literatureBackend:", literatureBackend, "toolProfile:", toolProfile);
      let sessionIdToUse = activeSessionId;

      // if no session exists, create one first
      if (!sessionIdToUse) {
        try {
          const session = await createSession();
          sessionIdToUse = session.id;

          // set active session WITHOUT triggering a key change on LLMChat
          inlineSessionIdRef.current = session.id;

          setActiveSession({
            id: session.id,
            title: null,
            createdAt: session.createdAt,
            updatedAt: session.updatedAt,
            rating: undefined,
            comment: undefined,
            phenotypeCode: undefined,
            messages: [],
          });

          setSessions((prev) => [{ ...session, preview: undefined, rating: undefined }, ...prev]);
          setActiveSessionId(session.id);
        } catch (err) {
          console.error("Failed to create session:", err);
          return;
        }
      }

      // save all current messages to the newly created session
      const messages = currentMessagesRef.current;
      for (const msg of messages) {
        const hasContent = msg.content.trim();
        const hasAttachments = msg.attachments && msg.attachments.length > 0;
        if ((hasContent || hasAttachments) && !savedMessageIds.current.has(msg.id)) {
          await saveMessageToBackend(sessionIdToUse, msg, literatureBackend, toolProfile);
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
    [activeSessionId, saveMessageToBackend, isSecretChat],
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

  const handleSessionRatingSave = async (rating: number, comment?: string) => {
    if (!activeSessionId) return;
    try {
      await updateSession(activeSessionId, { rating, comment });
      setActiveSession((prev) => (prev ? { ...prev, rating, comment: comment ?? null } : null));
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
        attachments,
      };
    });
  };

  // fetch image preview data for attachments that have serverId but no previewUrl
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
    <Box sx={{ display: "flex", flexDirection: "column", height: "calc(100vh - 64px)" }}>
      {/* header row */}
      <Box sx={{ display: "flex" }}>
        <Box sx={{ width: 280, flexShrink: 0, borderColor: "divider" }} />
        <Box sx={{ flex: 1, p: 2, pb: 0 }}>
          <Box sx={{ mb: 2, display: "flex", alignItems: "flex-start", gap: 2 }}>
            <Box
              component="img"
              src={finnGenieLogo}
              alt="FinnGenie"
              sx={{ height: 60, flexShrink: 0 }}
            />
            <Box>
              <Box sx={{ display: "flex", alignItems: "center", gap: 2 }}>
                <Typography variant="h5">
                  {isSecretChat ? "Secret Chat" : activeSession?.title || "FinnGenie"}
                </Typography>
                {isSecretChat && (
                  <Chip
                    icon={<VisibilityOff sx={{ fontSize: 16 }} />}
                    label="Not Saved"
                    color="warning"
                    size="small"
                  />
                )}
              </Box>

              <Box sx={{ display: "flex", alignItems: "center", gap: 1, mt: 1 }}>
                <Button size="small" onClick={() => setAboutOpen(true)}>
                  About
                </Button>
                <Button size="small" onClick={() => setFeedbackOpen(true)}>
                  Feedback
                </Button>
                <Button size="small" onClick={() => setTokensOpen(true)}>
                  MCP/API Keys
                </Button>
                <Button size="small" onClick={() => setDatasetsOpen(true)}>
                  Datasets
                </Button>
                {currentMessageCount > 0 && (
                  <>
                    <Button size="small" onClick={(e) => setExportMenuAnchor(e.currentTarget)}>
                      Export this chat
                    </Button>
                    <Menu
                      anchorEl={exportMenuAnchor}
                      open={Boolean(exportMenuAnchor)}
                      onClose={() => setExportMenuAnchor(null)}
                    >
                      <MenuItem onClick={() => handleExportChat("html")}>As HTML</MenuItem>
                      <MenuItem onClick={() => handleExportChat("markdown")}>As Markdown</MenuItem>
                    </Menu>
                  </>
                )}
              </Box>
            </Box>
          </Box>
        </Box>
      </Box>

      {/* content row */}
      <Box sx={{ display: "flex", flex: 1, minHeight: 0 }}>
        {/* sidebar */}
        <Box
          sx={{
            width: 280,
            flexShrink: 0,
            borderRight: 1,
            borderColor: "divider",
            overflow: "hidden",
          }}>
          <ChatHistorySidebar
            sessions={sessions}
            activeSessionId={activeSessionId}
            onSelectSession={handleSelectSession}
            onNewChat={handleNewChat}
            onNewSecretChat={handleNewSecretChat}
            onDeleteSession={handleDeleteSession}
            loading={loading}
          />
        </Box>

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
          {sessionLoading ? (
            <Box sx={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <CircularProgress />
            </Box>
          ) : (
            <Box sx={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
              <LLMChat
                key={chatKey}
                sessionId={activeSessionId}
                initialMessages={isSecretChat ? undefined : loadedMessages}
                onMessagesChange={handleMessagesChange}
                onFirstExchange={handleFirstExchange}
                onStreamingComplete={handleStreamingComplete}
                onRateMessage={isSecretChat ? undefined : handleRateMessage}
                placeholder="Ask about phenotypes, genes, variants..."
                emptyStateTitle="Welcome to FinnGenie"
                emptyStateDescription=""
                height="100%"
                exampleQuestions={[
                  "What do we know about the effects of rs200317762?",
                  "Summarize findings on antimycotics use in FinnGen.",
                  "How many unique fine-mapped protective loss-of-function variants do we have in FinnGen with PIP > 0.05, MAF < 0.05, p-value < 1e-10 and what phenotypes are they associated to?",
                  "We've found that the variant chr2:9521321:A:G (ADAM17) confers risk to IBD. Does this variant colocalize with any molecular QTLs (eQTL, pQTL) that might indicate the function of this variant and what process might be implicated?",
                ]}
                isSecretChat={isSecretChat}
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
        sx={{ textAlign: "center", px: 2, py: 1, display: "block" }}
      >
        FinnGenie is an AI tool intended to assist exploration, not replace expert judgment. It may
        generate incorrect or misleading information. Always validate findings against authoritative
        sources before use in research.
      </Typography>

      <FeedbackDialog open={feedbackOpen} onClose={() => setFeedbackOpen(false)} />
      <AboutDialog open={aboutOpen} onClose={() => setAboutOpen(false)} />
      <McpTokenDialog open={tokensOpen} onClose={() => setTokensOpen(false)} />
      <DatasetsDialog open={datasetsOpen} onClose={() => setDatasetsOpen(false)} />
    </Box>
  );
};

export default ChatPage;
