import { useState, useEffect, useCallback } from "react";
import {
  Button,
  TextField,
  Typography,
  Box,
  IconButton,
  Alert,
  Chip,
  Tooltip,
  List,
  ListItem,
  ListItemText,
  ListItemSecondaryAction,
} from "@mui/material";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import DeleteIcon from "@mui/icons-material/Delete";
import { SideSheet } from "../../components/SideSheet";
import { APP_NAME } from "../../config/appName";
import { createToken, listTokens, revokeToken, type TokenInfo } from "../chat/tokenApi";

interface McpTokenDialogProps {
  open: boolean;
  onClose: () => void;
}

const McpTokenDialog = ({ open, onClose }: McpTokenDialogProps) => {
  const [tokens, setTokens] = useState<TokenInfo[]>([]);
  const [newTokenValue, setNewTokenValue] = useState<string | null>(null);
  const [tokenName, setTokenName] = useState("");
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadTokens = useCallback(async () => {
    try {
      setTokens(await listTokens());
    } catch (e) {
      setError("Failed to load keys");
    }
  }, []);

  useEffect(() => {
    if (open) {
      loadTokens();
      setNewTokenValue(null);
      setTokenName("");
      setCopied(false);
      setError(null);
    }
  }, [open, loadTokens]);

  const handleCreate = async () => {
    try {
      setError(null);
      const result = await createToken(tokenName || undefined);
      setNewTokenValue(result.token);
      setTokenName("");
      setCopied(false);
      await loadTokens();
    } catch (e) {
      setError("Failed to create key");
    }
  };

  const handleCopy = async (text: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleRevoke = async (tokenId: number) => {
    try {
      setError(null);
      await revokeToken(tokenId);
      await loadTokens();
    } catch (e) {
      setError("Failed to revoke key");
    }
  };

  const formatDate = (iso: string) => new Date(iso).toLocaleDateString();

  const activeTokens = tokens.filter((t) => t.isActive);
  const origin = window.location.origin;

  return (
    <SideSheet open={open} onClose={onClose} title="MCP and API Keys">
        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}

        {newTokenValue && (
          <Alert severity="success" sx={{ mb: 2, "& .MuiAlert-message": { overflow: "hidden", width: "100%" } }} icon={false}>
            <Typography variant="subtitle2" gutterBottom>
              Key created — copy it now, it won't be shown again
            </Typography>
            <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
              <TextField
                value={newTokenValue}
                size="small"
                fullWidth
                slotProps={{ input: { readOnly: true, sx: { fontFamily: "monospace", fontSize: "0.85rem" } } }}
              />
              <Tooltip title={copied ? "Copied!" : "Copy"}>
                <IconButton onClick={() => handleCopy(newTokenValue)} size="small">
                  <ContentCopyIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            </Box>
          </Alert>
        )}

        <Box sx={{ display: "flex", gap: 1, mb: 2 }}>
          <TextField
            value={tokenName}
            onChange={(e) => setTokenName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleCreate(); }}
            placeholder="Key name (optional)"
            size="small"
            fullWidth
          />
          <Button variant="contained" onClick={handleCreate} sx={{ whiteSpace: "nowrap" }}>
            Create key
          </Button>
        </Box>

        {activeTokens.length > 0 && (
          <List dense disablePadding>
            {activeTokens.map((t) => (
              <ListItem key={t.id} divider>
                <ListItemText
                  primary={
                    <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                      <Typography variant="body2" fontFamily="monospace">
                        {t.prefix}...
                      </Typography>
                      {t.name && <Chip label={t.name} size="small" variant="outlined" />}
                    </Box>
                  }
                  secondary={
                    <>
                      Created {formatDate(t.createdAt)}
                      {t.lastUsedAt && ` · Last used ${formatDate(t.lastUsedAt)}`}
                      {t.expiresAt && ` · Expires ${formatDate(t.expiresAt)} if unused`}
                    </>
                  }
                />
                <ListItemSecondaryAction>
                  <Tooltip title="Revoke">
                    <IconButton edge="end" onClick={() => handleRevoke(t.id)} size="small">
                      <DeleteIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                </ListItemSecondaryAction>
              </ListItem>
            ))}
          </List>
        )}

        {activeTokens.length === 0 && !newTokenValue && (
          <Typography variant="body2" color="text.secondary" sx={{ py: 1 }}>
            No active keys. Create one to connect MCP clients.
          </Typography>
        )}

        {activeTokens.length > 0 && (
          <Typography variant="body2" color="text.secondary" sx={{ py: 1 }}>
            Keys are personal and provide access to embargoed FinnGen data. Do not share your keys.
            A key expires after 90 days without use; each use extends it by another 90 days.
          </Typography>
        )}

        <Box sx={{ mt: 3, p: 2, bgcolor: "action.hover", borderRadius: 1 }}>
          <Typography variant="subtitle2" gutterBottom>
            MCP access
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Use this configuration to add {APP_NAME} MCP to Claude, Cursor, etc. Replace &lt;TOKEN&gt; with a created key:
          </Typography>
          <Box
            component="pre"
            sx={{
              mt: 1,
              p: 1.5,
              bgcolor: "background.paper",
              borderRadius: 1,
              fontSize: "0.8rem",
              fontFamily: "monospace",
              overflow: "auto",
              whiteSpace: "pre-wrap",
            }}
          >
        {`{
  "mcpServers": {
    "genetics": {
      "type": "streamable-http",
      "url": "${origin}/mcp",
      "headers": {
        "Authorization": "Bearer <TOKEN>"
      }
    }
  }
}`}
          </Box>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1.5 }}>
            The key must be sent in the <code>Authorization</code> header. Passing it in the URL
            (<code>?token=…</code>) is no longer accepted: a key in a URL is recorded by load
            balancer request logs and browser history, and leaks to other sites via the{" "}
            <code>Referer</code> header. If your client cannot set headers, contact us rather
            than putting the key in the URL.
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1.5 }}>
            <strong>Deprecated:</strong> a Google ID token (in terminal:{" "}
            <code>gcloud auth print-identity-token</code>) is still accepted, but it expires every
            hour, we cannot revoke it for you, and it grants access on your Google account's domain
            alone. Create a key above and use that instead.
          </Typography>
        </Box>
        <Box sx={{ mt: 3, p: 2, bgcolor: "action.hover", borderRadius: 1 }}>
          <Typography variant="subtitle2" gutterBottom>
            API access
          </Typography>
          <Typography variant="body2" color="text.secondary">
            For direct API access, replace &lt;TOKEN&gt; with a created key:
          </Typography>
          <Box
            component="pre"
            sx={{
              mt: 1,
              p: 1.5,
              bgcolor: "background.paper",
              borderRadius: 1,
              fontSize: "0.8rem",
              fontFamily: "monospace",
              overflow: "auto",
              whiteSpace: "pre-wrap",
            }}
          >
{`curl -H "Authorization: Bearer <TOKEN>" \\
  ${origin}/api/v1/credible_sets_by_gene/PCSK9 | head`}
          </Box>
          <Typography variant="body2" color="text.secondary" paragraph>
            <strong>Deprecated:</strong> a Google ID token (in terminal:{" "}
            <code>gcloud auth print-identity-token</code>) is still accepted, but it expires every
            hour, we cannot revoke it for you, and it grants access on your Google account's domain
            alone. Create a key above and use that instead.
          </Typography>
          <Typography variant="body2" color="text.secondary" paragraph>
            See <a href={`${origin}/api/v1/docs`} target="_blank" rel="noreferrer">API docs</a> for available API endpoints.
          </Typography>
          </Box>
    </SideSheet>
  );
};

export default McpTokenDialog;
