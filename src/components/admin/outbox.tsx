"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, Copy, Eye, Send } from "lucide-react";
import { apiFetch } from "@/lib/client/api";
import { formatDateTime } from "@/lib/dates";
import { testEmailSchema } from "@/lib/admin/schemas";
import { Button } from "@/components/ui/button";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Input, NativeSelect } from "@/components/ui/input";
import { Alert, FormField } from "@/components/ui/feedback";
import { Dialog, DialogContent, DialogFooter, DialogTrigger, Tabs, TabsList, TabsTrigger } from "@/components/ui/overlay";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { errorMessage } from "./form-errors";

export type OutboxRow = {
  id: string;
  createdAt: string;
  toEmail: string;
  template: string;
  subject: string;
  status: "SENT" | "FAILED" | "DEV_LOGGED";
  error: string | null;
  providerMessageId: string | null;
  devBody: string | null;
  workspace: { id: string; name: string; code: string } | null;
};

const URL_RE = /(https?:\/\/[^\s<>"')]+)/g;

/** Renders plain text with URLs turned into links. */
function Linkified({ text }: { text: string }) {
  const parts = text.split(URL_RE);
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <a key={i} href={part} target="_blank" rel="noopener noreferrer" className="break-all font-medium text-primary underline underline-offset-2">
            {part}
          </a>
        ) : (
          <React.Fragment key={i}>{part}</React.Fragment>
        ),
      )}
    </>
  );
}

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = React.useState(false);
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          toast.success("Link copied");
          setTimeout(() => setCopied(false), 2000);
        } catch {
          toast.error("Could not copy — select the link and copy it manually");
        }
      }}
    >
      {copied ? <Check /> : <Copy />} {copied ? "Copied" : "Copy link"}
    </Button>
  );
}

// ───────── Filters ─────────

const STATUS_TABS = [
  { value: "ALL", label: "All" },
  { value: "SENT", label: "Sent" },
  { value: "FAILED", label: "Failed" },
  { value: "DEV_LOGGED", label: "Not sent (outbox)" },
] as const;

export function OutboxFilters({
  status,
  template,
  templates,
  counts,
}: {
  status: string;
  template: string;
  templates: string[];
  counts: Record<"SENT" | "FAILED" | "DEV_LOGGED", number>;
}) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const current = STATUS_TABS.some((t) => t.value === status) ? status : "ALL";
  const total = counts.SENT + counts.FAILED + counts.DEV_LOGGED;

  const go = (next: { status?: string; template?: string }) => {
    const merged = { status: current === "ALL" ? "" : current, template, ...next };
    const sp = new URLSearchParams();
    if (merged.status && merged.status !== "ALL") sp.set("status", merged.status);
    if (merged.template) sp.set("template", merged.template);
    const qs = sp.toString();
    startTransition(() => router.push(qs ? `/admin/outbox?${qs}` : "/admin/outbox", { scroll: false }));
  };

  return (
    <div className="flex flex-col gap-3 border-b p-4 lg:flex-row lg:items-center lg:justify-between" aria-busy={pending}>
      <div className="-mx-1 overflow-x-auto px-1 scrollbar-thin">
        <Tabs value={current} onValueChange={(v) => go({ status: v })}>
          <TabsList aria-label="Filter by delivery status">
            {STATUS_TABS.map((t) => (
              <TabsTrigger key={t.value} value={t.value}>
                {t.label}
                <span className="rounded-full bg-muted px-1.5 text-[11px] tabular text-muted-foreground">{t.value === "ALL" ? total : counts[t.value]}</span>
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>
      <div className="flex items-center gap-2">
        <label htmlFor="outbox-template" className="shrink-0 text-sm text-muted-foreground">
          Template
        </label>
        <NativeSelect id="outbox-template" value={template} onChange={(e) => go({ template: e.target.value })} className="w-full lg:w-60">
          <option value="">All templates</option>
          {templates.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </NativeSelect>
      </div>
    </div>
  );
}

// ───────── Table + message viewer ─────────

export function OutboxTable({ items, timeZone }: { items: OutboxRow[]; timeZone: string }) {
  const [viewing, setViewing] = React.useState<OutboxRow | null>(null);
  const links = viewing?.devBody ? [...new Set(viewing.devBody.match(URL_RE) ?? [])] : [];

  return (
    <>
      <Table className="min-w-[960px]">
        <THead>
          <TR className="hover:bg-transparent">
            <TH>Time</TH>
            <TH>To</TH>
            <TH>Template</TH>
            <TH>Subject</TH>
            <TH>Status</TH>
            <TH>Error</TH>
            <TH className="w-px">
              <span className="sr-only">Actions</span>
            </TH>
          </TR>
        </THead>
        <TBody>
          {items.map((r) => (
            <TR key={r.id}>
              <TD className="whitespace-nowrap text-xs tabular">
                <time dateTime={r.createdAt}>{formatDateTime(r.createdAt, timeZone)}</time>
              </TD>
              <TD className="max-w-[220px]">
                <p className="truncate text-sm">{r.toEmail}</p>
                {r.workspace && <p className="truncate text-xs text-muted-foreground">{r.workspace.name}</p>}
              </TD>
              <TD>
                <Badge variant="outline" className="rounded-md font-mono text-[11px]">
                  {r.template}
                </Badge>
              </TD>
              <TD className="max-w-[280px]">
                <p className="truncate text-sm" title={r.subject}>
                  {r.subject}
                </p>
              </TD>
              <TD>
                <StatusBadge status={r.status} />
              </TD>
              <TD className="max-w-[240px]">
                {r.error ? (
                  <p className="line-clamp-2 text-xs text-muted-foreground" title={r.error}>
                    {r.error}
                  </p>
                ) : (
                  <span className="text-xs text-muted-foreground">—</span>
                )}
              </TD>
              <TD>
                {r.devBody ? (
                  <Button variant="ghost" size="sm" onClick={() => setViewing(r)}>
                    <Eye /> View message
                  </Button>
                ) : null}
              </TD>
            </TR>
          ))}
        </TBody>
      </Table>

      <Dialog open={viewing !== null} onOpenChange={(o) => !o && setViewing(null)}>
        {viewing && (
          <DialogContent title={viewing.subject} description={`To ${viewing.toEmail} · ${formatDateTime(viewing.createdAt, timeZone)}`} className="max-w-2xl">
            <Alert variant="warning" title="Development outbox — not delivered">
              This message was never sent to the recipient. It is kept here only because email delivery is not configured (or failed) and the development outbox is enabled.
              Share one-time links only with the intended person.
            </Alert>
            {links.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Links in this message</p>
                {links.map((l) => (
                  <div key={l} className="flex flex-col gap-2 rounded-md border bg-muted/40 p-2 sm:flex-row sm:items-center">
                    <code className="min-w-0 flex-1 break-all font-mono text-xs">{l}</code>
                    <CopyButton value={l} />
                  </div>
                ))}
              </div>
            )}
            <div className="max-h-[50vh] overflow-auto whitespace-pre-wrap break-words rounded-md border bg-card p-4 text-sm leading-relaxed scrollbar-thin">
              <Linkified text={viewing.devBody ?? ""} />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setViewing(null)}>
                Close
              </Button>
            </DialogFooter>
          </DialogContent>
        )}
      </Dialog>
    </>
  );
}

// ───────── Test email ─────────

export function SendTestEmailButton({ defaultTo }: { defaultTo: string }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [to, setTo] = React.useState(defaultTo);
  const [error, setError] = React.useState<string | null>(null);
  const [sending, setSending] = React.useState(false);
  const [result, setResult] = React.useState<{ status: "SENT" | "FAILED" | "DEV_LOGGED"; error?: string } | null>(null);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    setResult(null);
    const parsed = testEmailSchema.safeParse({ to });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Enter a valid email address");
      return;
    }
    setSending(true);
    try {
      const res = await apiFetch<{ delivery: { status: "SENT" | "FAILED" | "DEV_LOGGED"; error?: string } }>("/api/admin/outbox/test", {
        method: "POST",
        body: parsed.data,
      });
      setResult(res.delivery);
      if (res.delivery.status === "SENT") toast.success(`Test email sent to ${parsed.data.to}`);
      else if (res.delivery.status === "FAILED") toast.error("The test email could not be delivered", { description: res.delivery.error });
      else toast.warning("Email delivery is not configured", { description: "The test message was recorded in the development outbox." });
      router.refresh();
    } catch (err) {
      setError(errorMessage(err));
      toast.error(errorMessage(err, "Could not send the test email"));
    } finally {
      setSending(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (sending) return;
        setOpen(o);
        if (o) {
          setTo(defaultTo);
          setError(null);
          setResult(null);
        }
      }}
    >
      <DialogTrigger asChild>
        <Button>
          <Send /> Send test email
        </Button>
      </DialogTrigger>
      <DialogContent title="Send test email" description="Sends a short message through the configured Brevo transport and logs the result here.">
        <form onSubmit={send} noValidate className="space-y-4">
          <FormField label="Recipient" htmlFor="test-to" required error={error}>
            <Input
              id="test-to"
              type="email"
              value={to}
              maxLength={254}
              autoFocus
              aria-invalid={Boolean(error)}
              onChange={(e) => {
                setTo(e.target.value);
                setError(null);
              }}
            />
          </FormField>
          {result &&
            (result.status === "SENT" ? (
              <Alert variant="success" title="Delivered to Brevo">
                The message was accepted for delivery. Check the recipient&apos;s inbox.
              </Alert>
            ) : result.status === "FAILED" ? (
              <Alert variant="danger" title="Delivery failed">
                {result.error ?? "The email provider rejected the message."}
              </Alert>
            ) : (
              <Alert variant="warning" title="Not delivered — development outbox">
                {result.error ?? "Email delivery is not configured."} The message is listed below in the outbox.
              </Alert>
            ))}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={sending}>
              Close
            </Button>
            <Button type="submit" loading={sending}>
              {!sending && <Send />} Send
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
