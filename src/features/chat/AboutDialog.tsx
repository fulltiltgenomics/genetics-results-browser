import { Dialog, DialogTitle, DialogContent, DialogActions, Button, Typography } from "@mui/material";

interface AboutDialogProps {
  open: boolean;
  onClose: () => void;
}

export const AboutDialog = ({ open, onClose }: AboutDialogProps) => {
  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>About FinnGenie</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
          I can help you explore and interpret human genetics results. Ask me about phenotypes, genes,
          variants, biological interpretations, and more.
        </Typography>

        <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
          I am Claude Sonnet 4.6 but I also have direct access to a lot of great genetics results
          data (ask me about it!). Typically, when you ask me a question, I will first check our data
          resources for relevant information. Then I'll do a literature search, and finally synthesize
          the information from the two sources. Do ask follow-up questions!
        </Typography>

        <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
          By default, your chats are stored so we can improve me. Chats are not stored by us when you use the Secret Chat feature. We use Anthropic and Perplexity APIs that have their own privacy and data retention policies: <a target="_blank" href="https://privacy.claude.com">Anthropic</a>  <a target="_blank" href="https://docs.perplexity.ai/docs/resources/privacy-security">Perplexity</a>
        </Typography>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
};
