import { useState, useEffect, useCallback } from "react";
import {
  Box,
  Typography,
  TextField,
  Button,
  ToggleButtonGroup,
  ToggleButton,
  Paper,
  Dialog,
  DialogTitle,
  DialogContent,
  IconButton,
  CircularProgress,
  Alert,
  Pagination,
  Tooltip,
  Menu,
  MenuItem,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import DownloadIcon from "@mui/icons-material/Download";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Tooltip as ChartTooltip,
  Legend,
} from "chart.js";
import { Line } from "react-chartjs-2";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { marked } from "marked";
import { useNavigate } from "react-router-dom";
import {
  fetchAdminSessions,
  fetchAdminSessionDetail,
  fetchUsageAnalytics,
  type AdminSession,
  type AdminSessionDetail,
  type UsageDataPoint,
} from "./adminApi";

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, ChartTooltip, Legend);

const PAGE_SIZE = 25;

function buildExportMarkdown(session: AdminSessionDetail): string {
  const parts = session.messages.map((m) => {
    const role = m.role === "user" ? "## User" : "## Assistant";
    return `${role}\n\n${m.content}`;
  });
  return parts.join("\n\n---\n\n");
}

function triggerDownload(content: string, filename: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function makeFilename(title: string, ext: string): string {
  return title.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase() + `-export.${ext}`;
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export default function AdminPage() {
  const navigate = useNavigate();
  const [sessions, setSessions] = useState<AdminSession[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // filters
  const [userFilter, setUserFilter] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [sessionIdFilter, setSessionIdFilter] = useState("");

  // detail dialog
  const [selectedSession, setSelectedSession] = useState<AdminSessionDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [exportAnchor, setExportAnchor] = useState<null | HTMLElement>(null);
  const [copyTooltip, setCopyTooltip] = useState("Copy ID");

  // analytics
  const [analyticsPeriod, setAnalyticsPeriod] = useState<"week" | "month" | "year">("week");
  const [analyticsData, setAnalyticsData] = useState<UsageDataPoint[]>([]);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);

  const loadSessions = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchAdminSessions({
        user: userFilter || undefined,
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined,
        sessionId: sessionIdFilter || undefined,
        limit: PAGE_SIZE,
        offset: (page - 1) * PAGE_SIZE,
      });
      setSessions(result.sessions);
      setTotal(result.total);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [userFilter, dateFrom, dateTo, sessionIdFilter, page]);

  const loadAnalytics = useCallback(async () => {
    setAnalyticsLoading(true);
    try {
      const result = await fetchUsageAnalytics(analyticsPeriod);
      setAnalyticsData(result.data);
    } catch {
      // analytics errors are non-critical
    } finally {
      setAnalyticsLoading(false);
    }
  }, [analyticsPeriod]);

  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  useEffect(() => {
    loadAnalytics();
  }, [loadAnalytics]);

  const handleSearch = () => {
    setPage(1);
    loadSessions();
  };

  const handleClearFilters = () => {
    setUserFilter("");
    setDateFrom("");
    setDateTo("");
    setSessionIdFilter("");
    setPage(1);
  };

  const openSessionDetail = async (sessionId: string) => {
    setDetailLoading(true);
    try {
      const detail = await fetchAdminSessionDetail(sessionId);
      setSelectedSession(detail);
    } catch {
      setError("Failed to load session detail");
    } finally {
      setDetailLoading(false);
    }
  };

  const handleCopyId = () => {
    if (selectedSession) {
      navigator.clipboard.writeText(selectedSession.id);
      setCopyTooltip("Copied!");
      setTimeout(() => setCopyTooltip("Copy ID"), 1500);
    }
  };

  const handleExport = (format: "markdown" | "html") => {
    if (!selectedSession) return;
    setExportAnchor(null);
    const title = selectedSession.title || "conversation";
    const md = buildExportMarkdown(selectedSession);
    if (format === "markdown") {
      triggerDownload(md, makeFilename(title, "md"), "text/markdown");
    } else {
      const bodyHtml = marked.parse(md, { gfm: true, breaks: false }) as string;
      const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><title>${escapeHtml(title)}</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; max-width: 900px; margin: 0 auto; padding: 2rem; line-height: 1.6; }
  h2 { margin-top: 2rem; border-bottom: 1px solid #eee; padding-bottom: 0.3rem; }
  hr { border: none; border-top: 1px solid #ddd; margin: 2rem 0; }
  table { border-collapse: collapse; width: 100%; margin: 1rem 0; }
  th, td { border: 1px solid #ddd; padding: 0.5rem; text-align: left; }
  th { background: #f5f5f5; }
  code { background: #f4f4f4; padding: 0.15rem 0.4rem; border-radius: 3px; }
  pre { background: #f4f4f4; padding: 1rem; border-radius: 6px; overflow-x: auto; }
  pre code { background: none; padding: 0; }
</style></head><body>${bodyHtml}</body></html>`;
      triggerDownload(html, makeFilename(title, "html"), "text/html");
    }
  };

  const chartData = {
    labels: analyticsData.map((d) => d.date),
    datasets: [
      {
        label: "Conversations",
        data: analyticsData.map((d) => d.conversations),
        borderColor: "rgb(63, 81, 181)",
        backgroundColor: "rgba(63, 81, 181, 0.1)",
        tension: 0.3,
      },
      {
        label: "Unique Users",
        data: analyticsData.map((d) => d.unique_users),
        borderColor: "rgb(233, 30, 99)",
        backgroundColor: "rgba(233, 30, 99, 0.1)",
        tension: 0.3,
      },
    ],
  };

  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    animation: false as const,
    plugins: {
      legend: { position: "top" as const },
    },
    scales: {
      y: { beginAtZero: true, ticks: { stepSize: 1 } },
    },
  };

  return (
    <Box sx={{ maxWidth: 1200, mx: "auto", mt: 2 }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 2 }}>
        <Button
          startIcon={<ArrowBackIcon />}
          onClick={() => navigate("/")}
          size="small"
        >
          Back to Chat
        </Button>
        <Typography variant="h5">Admin - Conversations</Typography>
      </Box>

      {/* Analytics */}
      <Paper sx={{ p: 2, mb: 3 }}>
        <Box sx={{ display: "flex", justifyContent: "flex-end", mb: 1 }}>
          <ToggleButtonGroup
            size="small"
            value={analyticsPeriod}
            exclusive
            onChange={(_, v) => v && setAnalyticsPeriod(v)}
          >
            <ToggleButton value="week">Week</ToggleButton>
            <ToggleButton value="month">Month</ToggleButton>
            <ToggleButton value="year">Year</ToggleButton>
          </ToggleButtonGroup>
        </Box>
        <Box sx={{ height: 250 }}>
          {analyticsLoading ? (
            <Box sx={{ display: "flex", justifyContent: "center", alignItems: "center", height: "100%" }}>
              <CircularProgress size={24} />
            </Box>
          ) : (
            <Line data={chartData} options={chartOptions} />
          )}
        </Box>
      </Paper>

      {/* Filters */}
      <Paper sx={{ p: 2, mb: 2 }}>
        <Box sx={{ display: "flex", gap: 1.5, flexWrap: "wrap", alignItems: "center" }}>
          <TextField
            size="small"
            label="User"
            value={userFilter}
            onChange={(e) => setUserFilter(e.target.value)}
            sx={{ width: 200 }}
          />
          <TextField
            size="small"
            label="From"
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            slotProps={{ inputLabel: { shrink: true } }}
            sx={{ width: 160 }}
          />
          <TextField
            size="small"
            label="To"
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            slotProps={{ inputLabel: { shrink: true } }}
            sx={{ width: 160 }}
          />
          <TextField
            size="small"
            label="Session ID"
            value={sessionIdFilter}
            onChange={(e) => setSessionIdFilter(e.target.value)}
            sx={{ width: 200 }}
          />
          <Button variant="contained" size="small" onClick={handleSearch}>
            Search
          </Button>
          <Button variant="outlined" size="small" onClick={handleClearFilters}>
            Clear
          </Button>
        </Box>
      </Paper>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      {/* Sessions table */}
      <Paper sx={{ overflow: "auto" }}>
        {loading ? (
          <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}>
            <CircularProgress />
          </Box>
        ) : (
          <>
            <Box component="table" sx={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr>
                  {["User", "Title / Preview", "Messages", "Created", "Updated", "Rating"].map(
                    (h) => (
                      <Box
                        component="th"
                        key={h}
                        sx={{
                          textAlign: "left",
                          p: 1,
                          borderBottom: 1,
                          borderColor: "divider",
                          fontWeight: 600,
                          whiteSpace: "nowrap",
                        }}
                      >
                        {h}
                      </Box>
                    )
                  )}
                </tr>
              </thead>
              <tbody>
                {sessions.map((s) => (
                  <Box
                    component="tr"
                    key={s.id}
                    onClick={() => openSessionDetail(s.id)}
                    sx={{
                      cursor: "pointer",
                      "&:hover": { bgcolor: "action.hover" },
                    }}
                  >
                    <Box component="td" sx={{ p: 1, borderBottom: 1, borderColor: "divider" }}>
                      {s.userId}
                    </Box>
                    <Box
                      component="td"
                      sx={{
                        p: 1,
                        borderBottom: 1,
                        borderColor: "divider",
                        maxWidth: 400,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {s.title || s.preview || <em>No content</em>}
                    </Box>
                    <Box
                      component="td"
                      sx={{ p: 1, borderBottom: 1, borderColor: "divider", textAlign: "center" }}
                    >
                      {s.messageCount}
                    </Box>
                    <Box component="td" sx={{ p: 1, borderBottom: 1, borderColor: "divider", whiteSpace: "nowrap" }}>
                      {new Date(s.createdAt).toLocaleDateString()}
                    </Box>
                    <Box component="td" sx={{ p: 1, borderBottom: 1, borderColor: "divider", whiteSpace: "nowrap" }}>
                      {new Date(s.updatedAt).toLocaleDateString()}
                    </Box>
                    <Box
                      component="td"
                      sx={{ p: 1, borderBottom: 1, borderColor: "divider", textAlign: "center" }}
                    >
                      {s.rating ?? "-"}
                    </Box>
                  </Box>
                ))}
                {sessions.length === 0 && (
                  <tr>
                    <Box component="td" colSpan={6} sx={{ p: 3, textAlign: "center" }}>
                      No sessions found
                    </Box>
                  </tr>
                )}
              </tbody>
            </Box>
            {total > PAGE_SIZE && (
              <Box sx={{ display: "flex", justifyContent: "center", py: 1.5 }}>
                <Pagination
                  count={Math.ceil(total / PAGE_SIZE)}
                  page={page}
                  onChange={(_, p) => setPage(p)}
                  size="small"
                />
              </Box>
            )}
            <Typography variant="caption" sx={{ display: "block", textAlign: "right", p: 1, color: "text.secondary" }}>
              {total} conversation{total !== 1 ? "s" : ""} total
            </Typography>
          </>
        )}
      </Paper>

      {/* Session detail dialog */}
      <Dialog
        open={!!selectedSession}
        onClose={() => setSelectedSession(null)}
        maxWidth="md"
        fullWidth
      >
        {selectedSession && (
          <>
            <DialogTitle sx={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <Box>
                <Typography variant="h6">
                  {selectedSession.title || "Untitled Conversation"}
                </Typography>
                <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, mt: 0.5 }}>
                  <Typography variant="caption" color="text.secondary">
                    {selectedSession.userId} &middot;{" "}
                    {new Date(selectedSession.createdAt).toLocaleString()} &middot;{" "}
                    ID: {selectedSession.id}
                  </Typography>
                  <Tooltip title={copyTooltip}>
                    <IconButton size="small" onClick={handleCopyId}>
                      <ContentCopyIcon sx={{ fontSize: 14 }} />
                    </IconButton>
                  </Tooltip>
                </Box>
              </Box>
              <Box sx={{ display: "flex", gap: 0.5, ml: 1, flexShrink: 0 }}>
                <IconButton
                  size="small"
                  onClick={(e) => setExportAnchor(e.currentTarget)}
                >
                  <DownloadIcon />
                </IconButton>
                <Menu
                  anchorEl={exportAnchor}
                  open={Boolean(exportAnchor)}
                  onClose={() => setExportAnchor(null)}
                >
                  <MenuItem onClick={() => handleExport("markdown")}>As Markdown</MenuItem>
                  <MenuItem onClick={() => handleExport("html")}>As HTML</MenuItem>
                </Menu>
                <IconButton size="small" onClick={() => setSelectedSession(null)}>
                  <CloseIcon />
                </IconButton>
              </Box>
            </DialogTitle>
            <DialogContent dividers>
              {selectedSession.messages.map((m) => (
                <Box
                  key={m.id}
                  sx={{
                    mb: 1.5,
                    p: 1.5,
                    borderRadius: 1,
                    bgcolor: m.role === "user" ? "action.hover" : "background.default",
                    borderLeft: 3,
                    borderColor: m.role === "user" ? "primary.main" : "secondary.main",
                  }}
                >
                  <Typography variant="caption" fontWeight={600} color="text.secondary">
                    {m.role}
                    {m.thumbsUp !== null && (m.thumbsUp ? " 👍" : " 👎")}
                  </Typography>
                  <Box sx={{ mt: 0.5, fontSize: 13, "& p": { my: 0.5 }, "& table": { borderCollapse: "collapse", fontSize: 12, my: 1 }, "& th, & td": { border: 1, borderColor: "divider", px: 1, py: 0.5 }, "& pre": { bgcolor: "action.hover", p: 1, borderRadius: 1, overflow: "auto", fontSize: 12 }, "& code": { fontSize: 12 }, "& img": { maxWidth: "100%" } }}>
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.content}</ReactMarkdown>
                  </Box>
                </Box>
              ))}
            </DialogContent>
          </>
        )}
      </Dialog>

      {detailLoading && (
        <Box
          sx={{
            position: "fixed",
            top: "50%",
            left: "50%",
            transform: "translate(-50%, -50%)",
          }}
        >
          <CircularProgress />
        </Box>
      )}
    </Box>
  );
}
