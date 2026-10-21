import Link from "next/link";
import { Bot, Mail } from "lucide-react";
import { requireSuperAdmin } from "@/lib/auth/guards";
import { getPlatformSettings, platformTimeZone } from "@/lib/admin/queries";
import { emailStatus } from "@/lib/email/send";
import { aiProviderStatus } from "@/lib/ai/provider";
import { formatDateTime } from "@/lib/dates";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, PageHeader } from "@/components/ui/feedback";
import { PlatformSettingsForm } from "@/components/admin/platform-settings-form";

export const metadata = { title: "Platform Settings" };

const TRANSPORT_LABEL = { "brevo-api": "Brevo Transactional API", "brevo-smtp": "Brevo SMTP relay", none: "Not configured" } as const;
const AI_LABEL = { anthropic: "Anthropic Claude", openai: "OpenAI-compatible", none: "Built-in rules" } as const;

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-right font-medium break-words">{children}</dd>
    </div>
  );
}

export default async function SettingsPage() {
  await requireSuperAdmin();
  const [settings, timeZone] = await Promise.all([getPlatformSettings(), platformTimeZone()]);
  const email = emailStatus();
  const ai = aiProviderStatus();
  const { updatedAt, ...values } = settings;

  return (
    <>
      <PageHeader
        title="Platform Settings"
        description={updatedAt ? `Platform-wide configuration. Last updated ${formatDateTime(updatedAt, timeZone)}.` : "Platform-wide configuration."}
      />
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1fr_360px]">
        <PlatformSettingsForm initial={values} />

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Mail className="h-4 w-4 text-primary" /> Email delivery
              </CardTitle>
              <CardDescription>Configured on the server through environment variables.</CardDescription>
            </CardHeader>
            <CardContent>
              <dl className="divide-y">
                <Row label="Transport">
                  <Badge variant={email.transport === "none" ? "warning" : "success"}>{TRANSPORT_LABEL[email.transport]}</Badge>
                </Row>
                <Row label="Sender">{email.senderEmail}</Row>
                <Row label="Development outbox">{email.devOutbox ? "Enabled" : "Disabled"}</Row>
              </dl>
              {email.note && (
                <Alert variant="warning" className="mt-3">
                  {email.note}{" "}
                  {email.devOutbox ? "Undelivered messages are kept in the Email Outbox for development." : "Emails cannot be delivered until this is fixed."}
                </Alert>
              )}
              <Button asChild variant="outline" size="sm" className="mt-4">
                <Link href="/admin/outbox">Open Email Outbox</Link>
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Bot className="h-4 w-4 text-primary" /> AI provider
              </CardTitle>
              <CardDescription>Used to interpret voice and text entries. Falls back to built-in rules.</CardDescription>
            </CardHeader>
            <CardContent>
              <dl className="divide-y">
                <Row label="Provider">{AI_LABEL[ai.provider]}</Row>
                <Row label="Model">{ai.model || "—"}</Row>
                <Row label="Status">
                  <Badge variant={ai.configured ? "success" : "warning"}>{ai.configured ? "Ready" : "Missing configuration"}</Badge>
                </Row>
              </dl>
              {!ai.configured && (
                <Alert variant="warning" className="mt-3">
                  The selected provider is missing its API key or model. Entries are parsed with the built-in rules until it is configured.
                </Alert>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
