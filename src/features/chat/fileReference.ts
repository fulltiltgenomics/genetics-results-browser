import type { AttachmentType, FileAttachment } from "./chat.types";
import { excelFileToTsv } from "./excelToTsv";

// a data file reaches the model as a reference it pulls through run_analysis inputs, plus a
// preview short enough to replay on every turn without costing real context
export const FILE_PREVIEW_MAX_LINES = 20;
export const FILE_PREVIEW_MAX_BYTES = 2048;

// mirrors chat-backend's MAX_FILE_BLOCK_BYTES, which answers 413 for any "[File: ..." block
// over it in any turn, history included, so one oversize block makes the whole conversation
// unsendable. Wrong if that setting is changed on the server without changing this
export const MAX_FILE_BLOCK_BYTES = 8192;

const encoder = new TextEncoder();
const utf8Bytes = (s: string) => encoder.encode(s).length;

// the backend measures UTF-8 bytes, so a cut by characters could leave a block of
// multi-byte text over the cap
function truncateUtf8(text: string, maxBytes: number): string {
  // every character is at least one byte, so this prefix holds the answer
  const head = text.slice(0, maxBytes);
  if (utf8Bytes(head) <= maxBytes) return head;
  let bytes = 0;
  let out = "";
  for (const ch of head) {
    const n = utf8Bytes(ch);
    if (bytes + n > maxBytes) break;
    bytes += n;
    out += ch;
  }
  return out;
}

/** first FILE_PREVIEW_MAX_LINES lines or FILE_PREVIEW_MAX_BYTES bytes, whichever is smaller */
export function boundPreview(text: string): string {
  let end = -1;
  for (let i = 0; i < FILE_PREVIEW_MAX_LINES; i++) {
    end = text.indexOf("\n", end + 1);
    if (end === -1) break;
  }
  const lines = end === -1 ? text : text.slice(0, end);
  return truncateUtf8(lines, FILE_PREVIEW_MAX_BYTES);
}

/**
 * The preview of a picked data file. Plain text is read as a bounded slice, never whole;
 * Excel has to be parsed whole, so a caller that already converted it passes the TSV.
 */
export async function readFilePreview(
  file: File,
  type: AttachmentType,
  excelTsv?: string,
): Promise<string> {
  if (type === "excel") return boundPreview(excelTsv ?? (await excelFileToTsv(file)));
  // a slice cut inside a multi-byte character decodes to a trailing replacement character
  const text = await file.slice(0, FILE_PREVIEW_MAX_BYTES).text();
  return boundPreview(file.size > FILE_PREVIEW_MAX_BYTES ? text.replace(/�$/, "") : text);
}

// browsers often give .tsv and .csv an empty MIME type; labelling those octet-stream would tell
// the model a text file is binary. A CSV is typed "tsv" too, so only its name tells it apart;
// Excel is labelled as TSV because that is what the sandbox gets
function typeLabel(att: Pick<FileAttachment, "name" | "type" | "mimeType">): string {
  if (att.mimeType) return att.mimeType;
  if (att.type === "tsv") return /\.csv$/i.test(att.name) ? "text/csv" : "text/tab-separated-values";
  if (att.type === "excel") return "text/tab-separated-values";
  return "application/octet-stream";
}

/**
 * The "[File: ...]" text block for a data attachment, the same on the turn that sends it and
 * on every replay. `preview` is re-bounded here because a message can carry a longer one than
 * this code writes (one restored from an older client); resending that would 413.
 * `uploads` is false where nothing is ever uploaded (secret chats, views that keep no
 * session): there a missing id is not a failure, and asking for a re-upload would loop.
 */
export function fileReferenceBlock(
  att: Pick<FileAttachment, "name" | "size" | "type" | "mimeType" | "serverId" | "preview">,
  uploads: boolean,
): string {
  const header = att.serverId
    ? `[File: ${att.name}] attachment_id=${att.serverId} size=${att.size} type=${typeLabel(att)}`
    : uploads
      ? `[File: ${att.name}] upload failed - ask the user to re-upload`
      : `[File: ${att.name}] not uploaded (this chat does not keep files) - only the preview below is available`;
  const preview = att.preview ? boundPreview(att.preview) : "";
  // with the preview bounded, only a file name of kilobytes reaches the cap; cutting the
  // block then loses the end of the header, which beats a 413 for the whole conversation
  return truncateUtf8(preview ? `${header}\n${preview}` : header, MAX_FILE_BLOCK_BYTES);
}
