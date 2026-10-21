import fs from "node:fs/promises";
import path from "node:path";
import { requireSuperAdmin } from "@/lib/auth/guards";
import { renderMarkdown } from "@/lib/markdown";
import { Card, CardContent } from "@/components/ui/card";
import { Alert } from "@/components/ui/feedback";

export const metadata = { title: "API Reference" };

export default async function ApiDocsPage() {
  await requireSuperAdmin();
  let source = "";
  try {
    source = await fs.readFile(path.join(process.cwd(), "docs", "API.md"), "utf8");
  } catch {
    return <Alert variant="warning" title="API reference not found">docs/API.md is missing from this deployment.</Alert>;
  }
  const { html, headings } = renderMarkdown(source);
  const toc = headings.filter((h) => h.level === 2);
  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_220px]">
      <Card>
        <CardContent className="max-w-none p-6 text-sm sm:p-8" dangerouslySetInnerHTML={{ __html: html }} />
      </Card>
      <aside className="hidden lg:block">
        <nav className="sticky top-20 space-y-1 text-sm" aria-label="On this page">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">On this page</p>
          {toc.map((h) => (
            <a key={h.id} href={`#${h.id}`} className="block truncate rounded px-2 py-1 text-muted-foreground hover:bg-muted hover:text-foreground">
              {h.text}
            </a>
          ))}
        </nav>
      </aside>
    </div>
  );
}
