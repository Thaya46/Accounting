/**
 * Tiny Markdown → HTML renderer for the repository's own documentation files
 * (headings, paragraphs, lists, tables, fenced code, inline code, bold, links).
 * Input is escaped first, so it is safe even for untrusted text.
 */
function esc(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function inline(s: string) {
  return esc(s)
    .replace(/`([^`]+)`/g, '<code class="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]">$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, text: string, href: string) =>
      /^(https?:\/\/|\/|#|[\w./-]+\.md)/.test(href) ? `<a class="text-primary underline-offset-2 hover:underline" href="${href}">${text}</a>` : text,
    );
}

function slug(s: string) {
  return s.toLowerCase().replace(/<[^>]+>/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export function renderMarkdown(md: string): { html: string; headings: { id: string; text: string; level: number }[] } {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  const headings: { id: string; text: string; level: number }[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (/^```/.test(line)) {
      const code: string[] = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) code.push(lines[i++]);
      i++;
      out.push(`<pre class="my-4 overflow-x-auto rounded-lg border bg-muted/60 p-4 text-xs leading-relaxed"><code>${esc(code.join("\n"))}</code></pre>`);
      continue;
    }
    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    if (h) {
      const level = h[1].length;
      const text = inline(h[2]);
      const id = slug(h[2]);
      headings.push({ id, text: h[2].replace(/`/g, ""), level });
      const cls = ["", "text-2xl font-semibold mt-2 mb-4", "text-lg font-semibold mt-10 mb-3 pb-2 border-b", "text-base font-semibold mt-6 mb-2", "text-sm font-semibold mt-4 mb-2"][level];
      out.push(`<h${level} id="${id}" class="${cls} scroll-mt-20">${text}</h${level}>`);
      i++;
      continue;
    }
    if (/^\|/.test(line)) {
      const rows: string[][] = [];
      while (i < lines.length && /^\|/.test(lines[i])) {
        const cells = lines[i]
          .trim()
          .replace(/^\||\|$/g, "")
          .split(/(?<!\\)\|/)
          .map((c) => c.trim().replace(/\\\|/g, "|"));
        if (!cells.every((c) => /^:?-{3,}:?$/.test(c))) rows.push(cells);
        i++;
      }
      const [head, ...body] = rows;
      out.push(
        `<div class="my-4 overflow-x-auto rounded-lg border"><table class="w-full text-sm"><thead class="bg-muted/50"><tr>${head
          .map((c) => `<th class="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground whitespace-nowrap">${inline(c)}</th>`)
          .join("")}</tr></thead><tbody>${body
          .map((r) => `<tr class="border-t align-top">${r.map((c) => `<td class="px-3 py-2">${inline(c)}</td>`).join("")}</tr>`)
          .join("")}</tbody></table></div>`,
      );
      continue;
    }
    if (/^\s*[*-]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[*-]\s+/.test(lines[i])) items.push(lines[i++].replace(/^\s*[*-]\s+/, ""));
      out.push(`<ul class="my-3 list-disc space-y-1 pl-6">${items.map((t) => `<li>${inline(t)}</li>`).join("")}</ul>`);
      continue;
    }
    if (/^\s*\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) items.push(lines[i++].replace(/^\s*\d+\.\s+/, ""));
      out.push(`<ol class="my-3 list-decimal space-y-1 pl-6">${items.map((t) => `<li>${inline(t)}</li>`).join("")}</ol>`);
      continue;
    }
    if (!line.trim()) {
      i++;
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^(#|\||```|\s*[*-]\s|\s*\d+\.\s)/.test(lines[i])) para.push(lines[i++]);
    out.push(`<p class="my-3 leading-relaxed text-foreground/90">${inline(para.join(" "))}</p>`);
  }
  return { html: out.join("\n"), headings };
}
