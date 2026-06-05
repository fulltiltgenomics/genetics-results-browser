import { marked } from "marked";
import type { ChatMessage } from "./chat.types";
import { APP_NAME } from "../../config/appName";

const IMAGE_MARKER_REGEX = /\[IMAGE:([^:]+):([^:]+):([^\]]+)\]/g;

/**
 * Build a markdown string from chat messages, converting image markers
 * and including user attachments.
 */
export function buildChatMarkdown(messages: ChatMessage[]): string {
  const parts = messages.map((msg) => {
    const role = msg.role === "user" ? "## User" : `## ${APP_NAME}`;
    let content = msg.content.replace(
      IMAGE_MARKER_REGEX,
      (_match, format, alt, base64Data) => `![${alt}](data:image/${format};base64,${base64Data})`,
    );
    if (msg.role === "user" && msg.attachments) {
      for (const att of msg.attachments) {
        if (att.type === "image" && att.previewUrl) {
          content += `\n\n![${att.name}](${att.previewUrl})`;
        }
      }
    }
    return `${role}\n\n${content}`;
  });
  return parts.join("\n\n---\n\n");
}

function makeFilename(title: string, ext: string): string {
  return title.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase() + `-export.${ext}`;
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

export function exportChatAsMarkdown(messages: ChatMessage[], title: string) {
  const markdown = buildChatMarkdown(messages);
  triggerDownload(markdown, makeFilename(title, "md"), "text/markdown");
}

export function exportChatAsHtml(messages: ChatMessage[], title: string) {
  const markdown = buildChatMarkdown(messages);
  const bodyHtml = marked.parse(markdown, { gfm: true, breaks: false }) as string;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(title)}</title>
<style>
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    max-width: 900px;
    margin: 0 auto;
    padding: 2rem;
    line-height: 1.6;
    color: #1a1a1a;
    background: #fff;
  }
  h2 { margin-top: 2rem; color: #333; border-bottom: 1px solid #eee; padding-bottom: 0.3rem; }
  hr { border: none; border-top: 1px solid #ddd; margin: 2rem 0; }
  table { border-collapse: collapse; width: 100%; margin: 1rem 0; font-size: 0.9rem; }
  th, td { border: 1px solid #ddd; padding: 0.5rem 0.75rem; text-align: left; }
  th { background: #f5f5f5; font-weight: 600; }
  tr:nth-child(even) { background: #fafafa; }
  img { max-width: 100%; height: auto; border-radius: 4px; border: 1px solid #ddd; margin: 0.5rem 0; }
  code { background: #f4f4f4; padding: 0.15rem 0.4rem; border-radius: 3px; font-size: 0.9em; }
  pre { background: #f4f4f4; padding: 1rem; border-radius: 6px; overflow-x: auto; }
  pre code { background: none; padding: 0; }
  blockquote { border-left: 3px solid #ddd; margin-left: 0; padding-left: 1rem; color: #555; }
  ul, ol { padding-left: 1.5rem; }
</style>
</head>
<body>
${bodyHtml}
</body>
</html>`;

  triggerDownload(html, makeFilename(title, "html"), "text/html");
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
