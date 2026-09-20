import { useMemo } from "react";
import { Box } from "@mui/material";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import type { PluggableList } from "unified";
import { ArtifactLink } from "./ArtifactLink";
import { FileDownload } from "./FileDownload";
import { MarkdownTable } from "./MarkdownTable";
import { ToolCallDisclosure } from "./ToolCallDisclosure";
import { decodeFileName } from "./fileMarker";
import { artifactNameFromHref, linkifyArtifactsPlugin } from "./linkifyArtifacts";
import { decodeToolCallMarker } from "./toolCallMarker";

// the three embedded-object markers a message's text can carry: [IMAGE:format:alt:base64data],
// [FILE:mime:name:base64data] and [TOOLUSE:base64json]. Matched by one alternation so a message
// holding several still renders its parts in the order they were streamed.
const EMBEDDED_MARKER_REGEX =
  /\[IMAGE:([^:]+):([^:]+):([^\]]+)\]|\[FILE:([^:\]]+):([^:\]]+):([^\]]+)\]|\[TOOLUSE:([A-Za-z0-9+/=]*)\]/g;

type Artifact = { mime: string; data: string };

/**
 * Every file this message carries, by the name the analysis saved it under.
 *
 * Built from the whole message before any of it renders, because the narration that names a
 * file usually comes AFTER the marker that carries it, and a mention before the marker has to
 * link too.
 */
const collectArtifacts = (content: string): Map<string, Artifact> => {
  const artifacts = new Map<string, Artifact>();
  EMBEDDED_MARKER_REGEX.lastIndex = 0;
  let match;
  while ((match = EMBEDDED_MARKER_REGEX.exec(content)) !== null) {
    const [, format, alt, base64Data, fileMime, fileName, fileData] = match;
    if (fileData !== undefined) {
      artifacts.set(decodeFileName(fileName), { mime: fileMime, data: fileData });
    } else if (base64Data !== undefined) {
      // an image's alt text IS the file name the sandbox wrote, so a mention of the .png
      // saves the same bytes the transcript is already showing
      artifacts.set(decodeFileName(alt), { mime: `image/${format}`, data: base64Data });
    }
  }
  return artifacts;
};

/**
 * Renders message content, handling embedded objects separately from markdown.
 *
 * Three marker shapes are carried inline in the text: [IMAGE:format:alt:base64data],
 * [FILE:mime:name:base64data] and [TOOLUSE:base64json]. All live in the message's `content`
 * rather than in component state so that a reopened session renders identically to the live
 * stream — `content` is the only thing this component ever sees.
 *
 * Its own module rather than a local in LLMChat because the admin conversation viewer reads
 * the same stored `content` and rendered it straight through ReactMarkdown, which spilled
 * the markers as base64 prose. Anything that displays a stored message renders it here.
 */
export const MessageContent = ({
  content,
  rehypePlugins,
}: {
  content: string;
  rehypePlugins?: PluggableList;
}) => {
  const artifacts = useMemo(() => collectArtifacts(content), [content]);

  const plugins = useMemo<PluggableList | undefined>(() => {
    if (artifacts.size === 0) return rehypePlugins;
    return [...(rehypePlugins ?? []), linkifyArtifactsPlugin([...artifacts.keys()])];
  }, [artifacts, rehypePlugins]);

  const components = useMemo<Components>(
    () => ({
      table: MarkdownTable,
      a: ({ href, children, ...props }) => {
        const name = artifactNameFromHref(href);
        const artifact = name === null ? undefined : artifacts.get(name);
        if (!artifact) {
          return (
            <a href={href} {...props}>
              {children}
            </a>
          );
        }
        return <ArtifactLink mime={artifact.mime} name={name!} data={artifact.data} />;
      },
    }),
    [artifacts],
  );

  if (
    !content.includes("[IMAGE:") &&
    !content.includes("[FILE:") &&
    !content.includes("[TOOLUSE:")
  ) {
    return (
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={plugins} components={components}>
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
            rehypePlugins={plugins}
            components={components}>
            {textPart}
          </ReactMarkdown>
        );
      }
    }

    const [, format, alt, base64Data, fileMime, fileName, fileData, toolCallData] = match;
    if (toolCallData !== undefined) {
      const record = decodeToolCallMarker(toolCallData);
      // a marker left half-written by an interrupted stream decodes to null; dropping it
      // is better than rendering the base64 as prose
      if (record) {
        parts.push(<ToolCallDisclosure key={`tool-${keyIndex++}`} record={record} />);
      }
    } else if (fileData !== undefined) {
      parts.push(
        <FileDownload
          key={`file-${keyIndex++}`}
          mime={fileMime}
          name={decodeFileName(fileName)}
          data={fileData}
        />
      );
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
          rehypePlugins={plugins}
          components={components}>
          {remainingText}
        </ReactMarkdown>
      );
    }
  }

  return <>{parts}</>;
};
