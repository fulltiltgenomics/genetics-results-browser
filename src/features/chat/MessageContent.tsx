import { Box } from "@mui/material";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { PluggableList } from "unified";
import { ToolCallDisclosure } from "./ToolCallDisclosure";
import { decodeToolCallMarker } from "./toolCallMarker";

// the two embedded-object markers a message's text can carry: [IMAGE:format:alt:base64data]
// and [TOOLUSE:base64json]. Matched by one alternation so a message holding both still
// renders its parts in the order they were streamed.
const EMBEDDED_MARKER_REGEX =
  /\[IMAGE:([^:]+):([^:]+):([^\]]+)\]|\[TOOLUSE:([A-Za-z0-9+/=]*)\]/g;

/**
 * Renders message content, handling embedded objects separately from markdown.
 *
 * Two marker shapes are carried inline in the text: [IMAGE:format:alt:base64data] and
 * [TOOLUSE:base64json]. Both live in the message's `content` rather than in component
 * state so that a reopened session renders identically to the live stream — `content` is
 * the only thing this component ever sees.
 *
 * Its own module rather than a local in LLMChat because the admin conversation viewer reads
 * the same stored `content` and rendered it straight through ReactMarkdown, which spilled
 * both markers as base64 prose. Anything that displays a stored message renders it here.
 */
export const MessageContent = ({
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
          {/* not a link, and deliberately not clickable: the src is a data: URL, and a
              browser refuses one as a top-level navigation, so opening it in a tab gave a
              blank tab every time. Saving the image is the context menu's job. */}
          <img
            src={src}
            alt={alt}
            style={{
              maxWidth: "100%",
              borderRadius: 4,
              border: "1px solid #ddd",
            }}
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
