import type { Root, Element, Text, ElementContent, RootContent, Parent } from "hast";

// tags whose descendants should not be linkified (already a link or code-formatted)
const SKIP_TAGS = new Set(["a", "code", "pre"]);

function _escapeForRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function _buildRegex(viewNames: string[]): RegExp | null {
  if (viewNames.length === 0) return null;
  // longest-first so e.g. "foo_bar" wins over "foo" if both ever appear
  const sorted = [...viewNames].sort((a, b) => b.length - a.length);
  const alt = sorted.map(_escapeForRegex).join("|");
  // optional .column suffix; \b on both sides to avoid partial matches inside identifiers
  return new RegExp(`\\b(${alt})(\\.[A-Za-z_][A-Za-z0-9_]*)?\\b`, "g");
}

function _makeLinkElement(viewName: string, matchedText: string): Element {
  return {
    type: "element",
    tagName: "a",
    properties: {
      href: `#schema/${viewName}`,
      className: ["schema-link"],
      "data-schema-view": viewName,
    },
    children: [{ type: "text", value: matchedText }],
  };
}

// replace text node `node` (child at `index` of `parent`) with a mix of text and link nodes
// returns the number of children inserted in place of the original (so the caller can advance)
function _replaceTextNode(
  parent: Parent,
  index: number,
  text: string,
  regex: RegExp,
  viewSet: Set<string>,
): number {
  regex.lastIndex = 0;
  const replacements: Array<Text | Element> = [];
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    const view = match[1];
    if (!viewSet.has(view)) continue;
    if (match.index > cursor) {
      replacements.push({ type: "text", value: text.slice(cursor, match.index) });
    }
    replacements.push(_makeLinkElement(view, match[0]));
    cursor = match.index + match[0].length;
  }

  if (replacements.length === 0) return 1; // no matches; leave original in place

  if (cursor < text.length) {
    replacements.push({ type: "text", value: text.slice(cursor) });
  }

  // splice into parent.children; cast through unknown because hast's content types per parent differ
  (parent.children as unknown as Array<Text | Element>).splice(index, 1, ...replacements);
  return replacements.length;
}

function _walk(node: Root | Element, regex: RegExp, viewSet: Set<string>): void {
  const children = node.children as Array<ElementContent | RootContent>;
  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    if (child.type === "text") {
      const inserted = _replaceTextNode(node, i, child.value, regex, viewSet);
      // skip over newly inserted siblings; they're either text we won't rematch or our own <a> links
      i += inserted - 1;
    } else if (child.type === "element") {
      if (SKIP_TAGS.has(child.tagName)) continue;
      _walk(child, regex, viewSet);
    }
  }
}

/**
 * rehype plugin factory: linkifies bare mentions of known SQL view names in markdown.
 *
 * Matches `view_name` and `view_name.column` tokens. The whole token becomes a link to
 * `#schema/<view_name>`. Text inside <a>, <code>, and <pre> is skipped so we don't double-wrap
 * links or rewrite code samples.
 *
 * Pass the dynamic list of view names from useSchema(); fall back to the hardcoded set in the
 * caller if the schema is still loading.
 *
 * Known limitation: clicking the same link twice in a row does not refire 'hashchange' because
 * the hash doesn't change. useSchemaHashRoute relies on hashchange, so a repeat click is a no-op
 * if the drawer was closed between clicks via a different code path. Acceptable for now.
 */
export function linkifyViewsPlugin(viewNames: string[]) {
  const regex = _buildRegex(viewNames);
  const viewSet = new Set(viewNames);

  return () => (tree: Root) => {
    if (!regex) return;
    _walk(tree, regex, viewSet);
  };
}
