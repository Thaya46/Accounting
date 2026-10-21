import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";

/** URL for a page of a filtered list (page 1 omits the parameter). */
export function pageHref(basePath: string, params: Record<string, string | undefined>, page: number) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v && k !== "page") sp.set(k, v);
  if (page > 1) sp.set("page", String(page));
  const qs = sp.toString();
  return qs ? `${basePath}?${qs}` : basePath;
}

/** Server-rendered pager that preserves the current filters in the query string. */
export function Pagination({
  basePath,
  params,
  page,
  pageSize,
  total,
}: {
  basePath: string;
  params: Record<string, string | undefined>;
  page: number;
  pageSize: number;
  total: number;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total === 0) return null;
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  const href = (p: number) => pageHref(basePath, params, p);

  return (
    <div className="flex flex-col items-center justify-between gap-3 border-t px-4 py-3 text-sm sm:flex-row">
      <p className="text-muted-foreground tabular">
        Showing {from.toLocaleString("en-US")}–{to.toLocaleString("en-US")} of {total.toLocaleString("en-US")}
      </p>
      <div className="flex items-center gap-2">
        {page > 1 ? (
          <Button asChild variant="outline" size="sm">
            <Link href={href(page - 1)} scroll={false}>
              <ChevronLeft /> Previous
            </Link>
          </Button>
        ) : (
          <Button variant="outline" size="sm" disabled>
            <ChevronLeft /> Previous
          </Button>
        )}
        <span className="px-1 text-xs text-muted-foreground tabular">
          Page {page} of {pages}
        </span>
        {page < pages ? (
          <Button asChild variant="outline" size="sm">
            <Link href={href(page + 1)} scroll={false}>
              Next <ChevronRight />
            </Link>
          </Button>
        ) : (
          <Button variant="outline" size="sm" disabled>
            Next <ChevronRight />
          </Button>
        )}
      </div>
    </div>
  );
}
