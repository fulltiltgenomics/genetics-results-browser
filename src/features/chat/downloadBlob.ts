/**
 * Save data the browser already holds under a file name.
 *
 * An object URL rather than a `data:` URI: an artifact is routinely megabytes, and a
 * `data:` href that large is both a second copy of the payload in the DOM and a top-level
 * navigation a browser refuses outright.
 */
export function downloadBlob(data: BlobPart, filename: string, mimeType: string): void {
  const url = URL.createObjectURL(new Blob([data], { type: mimeType }));
  const a = document.createElement("a");
  a.href = url;
  // an artifact name is written by the sandbox, so it is not trusted to be a bare file name
  a.download = filename.replace(/[/\\]/g, "_").replace(/[\u0000-\u001f]/g, "") || "download";
  a.click();
  URL.revokeObjectURL(url);
}
