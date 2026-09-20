import type { Root, Element, Text, ElementContent, RootContent, Parent } from "hast";

/**
 * rehype plugin: turns a prose mention of a file the turn produced into a link to it.
 *
 * A message carries its artifacts as `[FILE:...]` / `[IMAGE:...]` markers, which
 * MessageContent renders as a download control at the point the marker sits — usually right
 * after the tool call that wrote the file, far above the narration that names it. The
 * narration then says "per-locus table: `foo.csv`" and that text is inert, so a reader who
 * scrolled past the control has no way back to the bytes. Every mention of a name the
 * message actually carries becomes a control of its own.
 *
 * Deliberately NOT the same skip list as linkifyViews: an inline `code` span is the form the
 * model writes a file name in most often, so `code` is walked. `pre` is not, because a code
 * block is the analysis source, which contains the same name as a string literal.
 */

const SKIP_TAGS = new Set(["a", "pre"]);

export const ARTIFACT_HREF_PREFIX = "#artifact/";

/** the artifact name back out of a href this plugin wrote, or null for any other link */
export const artifactNameFromHref = (href: string | undefined): string | null => {
  if (!href || !href.startsWith(ARTIFACT_HREF_PREFIX)) return null;
  const encoded = href.slice(ARTIFACT_HREF_PREFIX.length);
  try {
    return decodeURIComponent(encoded);
  } catch {
    return encoded;
  }
};

function _escapeForRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function _buildRegex(names: string[]): RegExp | null {
  if (names.length === 0) return null;
  // longest-first so `plot.png` still wins where another artifact is named `plot`
  const sorted = [...names].sort((a, b) => b.length - a.length);
  const alt = sorted.map(_escapeForRegex).join("|");
  // a file name is mostly word characters plus `.`/`-`/`_`, so \b would fire inside
  // `other_foo.csv` and inside a path segment; the guards are the characters a name is
  // built from, which makes a match the WHOLE token or nothing
  return new RegExp(`(?<![\\w./-])(${alt})(?![\\w./-])`, "g");
}

function _makeLinkElement(name: string): Element {
  return {
    type: "element",
    tagName: "a",
    properties: {
      href: `${ARTIFACT_HREF_PREFIX}${encodeURIComponent(name)}`,
      className: ["artifact-link"],
      "data-artifact-name": name,
    },
    children: [{ type: "text", value: name }],
  };
}

// replace text node `node` (child at `index` of `parent`) with a mix of text and link nodes;
// returns how many children now stand in its place so the caller can step over them
function _replaceTextNode(
  parent: Parent,
  index: number,
  text: string,
  regex: RegExp,
  names: Set<string>,
): number {
  regex.lastIndex = 0;
  const replacements: Array<Text | Element> = [];
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    const name = match[1];
    if (!names.has(name)) continue;
    if (match.index > cursor) {
      replacements.push({ type: "text", value: text.slice(cursor, match.index) });
    }
    replacements.push(_makeLinkElement(name));
    cursor = match.index + match[0].length;
  }

  if (replacements.length === 0) return 1;

  if (cursor < text.length) {
    replacements.push({ type: "text", value: text.slice(cursor) });
  }

  // cast through unknown because hast's permitted content type differs per parent
  (parent.children as unknown as Array<Text | Element>).splice(index, 1, ...replacements);
  return replacements.length;
}

function _walk(node: Root | Element, regex: RegExp, names: Set<string>): void {
  const children = node.children as Array<ElementContent | RootContent>;
  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    if (child.type === "text") {
      i += _replaceTextNode(node, i, child.value, regex, names) - 1;
    } else if (child.type === "element") {
      if (SKIP_TAGS.has(child.tagName)) continue;
      _walk(child, regex, names);
    }
  }
}

/** plugin factory; `names` are the artifacts this message carries, decoded */
export function linkifyArtifactsPlugin(names: string[]) {
  const regex = _buildRegex(names);
  const nameSet = new Set(names);

  return () => (tree: Root) => {
    if (!regex) return;
    _walk(tree, regex, nameSet);
  };
}
