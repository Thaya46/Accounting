/** HTTP helpers for file downloads. */

/** RFC 6266 Content-Disposition with an ASCII fallback and a UTF-8 filename*. */
export function contentDisposition(fileName: string): string {
  const ascii = fileName.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

export function fileResponse(file: { fileName: string; contentType: string; content: string }): Response {
  return new Response(file.content, {
    status: 200,
    headers: {
      "Content-Type": file.contentType.includes("charset") ? file.contentType : `${file.contentType}; charset=utf-8`,
      "Content-Disposition": contentDisposition(file.fileName),
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
