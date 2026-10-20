import { useState, useEffect, useCallback } from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  IconButton,
  List,
  ListItem,
  ListItemSecondaryAction,
  ListItemText,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import DeleteIcon from "@mui/icons-material/Delete";
import { SideSheet } from "../../components/SideSheet";
import {
  grantAccess,
  listAccessGrants,
  resendAccessEmail,
  revokeAccess,
  type AccessGrant,
  type AccessGrantResult,
} from "./accessGrantApi";

interface AccessGrantDialogProps {
  open: boolean;
  onClose: () => void;
  label: string;
  expiresAt: string;
}

// the deadline is set in US Eastern time on the server side, so show it in that zone whatever
// the admin's browser is set to
const deadlineFormat = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  weekday: "short",
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZoneName: "short",
});

export const formatDeadline = (iso: string) => deadlineFormat.format(new Date(iso));

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Outcome =
  | { kind: "granted"; result: AccessGrantResult }
  | { kind: "confirm"; email: string }
  | { kind: "resent"; email: string; emailSent: boolean; emailError: string | null };

const grantStatus = (g: AccessGrant) => {
  if (g.revokedAt) return { label: "Revoked", color: "default" as const };
  if (g.active) return { label: "Active", color: "success" as const };
  return { label: "Expired", color: "default" as const };
};

export const AccessGrantDialog = ({ open, onClose, label, expiresAt }: AccessGrantDialogProps) => {
  const [email, setEmail] = useState("");
  const [grants, setGrants] = useState<AccessGrant[]>([]);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const loadGrants = useCallback(async () => {
    try {
      setGrants(await listAccessGrants());
    } catch {
      setError("Failed to load grants");
    }
  }, []);

  useEffect(() => {
    if (open) {
      loadGrants();
      setEmail("");
      setOutcome(null);
      setError(null);
    }
  }, [open, loadGrants]);

  const submit = async (confirmUnknownProvider: boolean) => {
    const address = email.trim().toLowerCase();
    if (!EMAIL_RE.test(address)) {
      setError("That does not look like an e-mail address");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await grantAccess(address, confirmUnknownProvider);
      if (!result.granted && result.provider === "unknown") {
        setOutcome({ kind: "confirm", email: address });
      } else {
        setOutcome({ kind: "granted", result });
        setEmail("");
        await loadGrants();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to grant access");
    } finally {
      setBusy(false);
    }
  };

  const handleResend = async (address: string) => {
    setBusy(true);
    setError(null);
    try {
      const r = await resendAccessEmail(address);
      setOutcome({ kind: "resent", email: address, ...r });
      await loadGrants();
    } catch {
      setError("Failed to send the e-mail");
    } finally {
      setBusy(false);
    }
  };

  const handleRevoke = async (address: string) => {
    setError(null);
    try {
      await revokeAccess(address);
      await loadGrants();
    } catch {
      setError("Failed to revoke access");
    }
  };

  const renderOutcome = () => {
    if (!outcome) return null;
    if (outcome.kind === "confirm") {
      return (
        <Alert
          severity="warning"
          sx={{ mb: 2 }}
          action={
            <Button color="inherit" size="small" onClick={() => submit(true)} disabled={busy}>
              Grant anyway
            </Button>
          }
        >
          {outcome.email} does not look like a Google, Apple or Microsoft address. The recipient
          must sign in with Google, Apple or Microsoft using exactly this address.
        </Alert>
      );
    }
    if (outcome.kind === "resent") {
      return outcome.emailSent ? (
        <Alert severity="success" sx={{ mb: 2 }}>E-mail sent to {outcome.email}</Alert>
      ) : (
        <Alert severity="error" sx={{ mb: 2 }}>
          E-mail to {outcome.email} FAILED: {outcome.emailError ?? "unknown error"}
        </Alert>
      );
    }
    const { result } = outcome;
    const address = result.grant?.email ?? "";
    const until = result.grant ? formatDeadline(result.grant.expiresAt) : formatDeadline(expiresAt);
    if (result.alreadyActive) {
      return (
        <Alert severity="info" sx={{ mb: 2 }}>
          {address} already has access until {until}; no e-mail sent.
        </Alert>
      );
    }
    if (result.emailSent) {
      return (
        <Alert severity="success" sx={{ mb: 2 }}>
          Access granted to {address} until {until}; e-mail sent.
        </Alert>
      );
    }
    return (
      <Alert
        severity="warning"
        sx={{ mb: 2 }}
        action={
          <Button color="inherit" size="small" onClick={() => handleResend(address)} disabled={busy}>
            Resend
          </Button>
        }
      >
        Access granted to {address} until {until}; e-mail FAILED: {result.emailError ?? "unknown error"}
      </Alert>
    );
  };

  return (
    <SideSheet
      open={open}
      onClose={onClose}
      title={label}
      footer={
        <Button variant="contained" onClick={() => submit(false)} disabled={busy || !email.trim()}>
          Grant access
        </Button>
      }
    >
      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      {renderOutcome()}

      <Typography variant="body1" gutterBottom>
        Enter a Google/Apple/Microsoft e-mail
      </Typography>
      <TextField
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") submit(false);
        }}
        placeholder="name@example.com"
        size="small"
        fullWidth
        autoFocus
        slotProps={{ htmlInput: { "aria-label": "e-mail address" } }}
      />
      <Typography variant="body2" color="text.secondary" sx={{ mt: 1, mb: 3 }}>
        Access until {formatDeadline(expiresAt)}. The recipient signs in with Google, Apple or
        Microsoft using this address; any MCP/API keys they create stop working at the same time.
      </Typography>

      {grants.length > 0 ? (
        <List dense disablePadding>
          {grants.map((g) => {
            const status = grantStatus(g);
            return (
              <ListItem key={g.email} divider>
                <ListItemText
                  primary={
                    <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}>
                      <Typography variant="body2">{g.email}</Typography>
                      <Chip label={status.label} size="small" color={status.color} variant="outlined" />
                      {g.emailError && !g.emailSentAt && (
                        <Chip label="e-mail failed" size="small" color="error" variant="outlined" />
                      )}
                    </Box>
                  }
                  secondary={
                    <>
                      Granted {new Date(g.grantedAt).toLocaleDateString()} by {g.grantedBy} · until{" "}
                      {formatDeadline(g.expiresAt)}
                      {g.emailSentAt
                        ? ` · e-mail sent ${new Date(g.emailSentAt).toLocaleDateString()}`
                        : " · e-mail not sent"}
                    </>
                  }
                />
                <ListItemSecondaryAction>
                  {g.active && !g.emailSentAt && (
                    <Button size="small" onClick={() => handleResend(g.email)} disabled={busy}>
                      Resend
                    </Button>
                  )}
                  {g.active && (
                    <Tooltip title="Revoke access">
                      <IconButton
                        edge="end"
                        size="small"
                        aria-label={`revoke ${g.email}`}
                        onClick={() => handleRevoke(g.email)}
                      >
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  )}
                </ListItemSecondaryAction>
              </ListItem>
            );
          })}
        </List>
      ) : (
        <Typography variant="body2" color="text.secondary">
          No access granted yet.
        </Typography>
      )}
    </SideSheet>
  );
};
