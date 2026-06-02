import { useEffect, useState } from "react";
import { Typography } from "@mui/material";
import { SideSheet } from "../../components/SideSheet";

interface AboutDialogProps {
  open: boolean;
  onClose: () => void;
}

const formatModelName = (modelId: string): string => {
  // "claude-sonnet-4-6" -> "Claude Sonnet 4.6", "claude-opus-4-7" -> "Claude Opus 4.7"
  const match = modelId.match(/^claude-(\w+)-(\d+)-(\d+)/);
  if (!match) return modelId;
  const [, variant, major, minor] = match;
  return `Claude ${variant.charAt(0).toUpperCase() + variant.slice(1)} ${major}.${minor}`;
};

export const AboutDialog = ({ open, onClose }: AboutDialogProps) => {
  const [modelName, setModelName] = useState<string>("");

  useEffect(() => {
    if (!open) return;
    const chatUrl = import.meta.env.VITE_CHAT_URL;
    if (!chatUrl) return;
    fetch(`${chatUrl.replace(/\/chat\/?$/, "")}/status`, { credentials: "include" })
      .then((r) => r.json())
      .then((data) => setModelName(formatModelName(data.default_model)))
      .catch(() => {});
  }, [open]);

  return (
    <SideSheet open={open} onClose={onClose} title="About FinnGenie">
      <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
        I can help you explore and interpret human genetics results. Ask me about phenotypes, genes,
        variants, biological interpretations, and more.
      </Typography>

      <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
        I am {modelName || "an AI assistant"} but I also have direct access to a lot of great genetics results
        data (ask me about it!). Typically, when you ask me a question, I will first check our data
        resources for relevant information. Then I'll do a literature search, and finally synthesize
        the information from the two sources. Do ask follow-up questions!
      </Typography>

      <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
        By default, your chats are stored so we can improve me. Chats are not stored by us when you use the Secret Chat feature. We use Anthropic and Perplexity APIs that have their own privacy and data retention policies: <a target="_blank" href="https://privacy.claude.com">Anthropic</a>  <a target="_blank" href="https://docs.perplexity.ai/docs/resources/privacy-security">Perplexity</a>
      </Typography>
    </SideSheet>
  );
};
