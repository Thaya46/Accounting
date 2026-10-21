import nodemailer from "nodemailer";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";

export type EmailTemplate =
  | "WORKSPACE_ADMIN_INVITATION"
  | "USER_INVITATION"
  | "EMAIL_VERIFICATION"
  | "PASSWORD_RESET"
  | "MFA_NOTIFICATION"
  | "SUSPICIOUS_LOGIN"
  | "ACCOUNT_ACTIVATED"
  | "TRANSACTION_SUMMARY";

export type OutgoingEmail = {
  to: string;
  toName?: string;
  subject: string;
  html: string;
  text: string;
  template: EmailTemplate;
  workspaceId?: string | null;
  userId?: string | null;
};

export type EmailTransport = "brevo-api" | "brevo-smtp" | "none";

/**
 * Brevo issues two kinds of credentials: API keys (xkeysib-…) for the
 * Transactional Email API and SMTP keys (xsmtpsib-…) for the SMTP relay.
 */
export function emailTransport(): EmailTransport {
  const { apiKey, smtpLogin } = env.brevo;
  if (apiKey.startsWith("xsmtpsib-")) return smtpLogin ? "brevo-smtp" : "none";
  return apiKey ? "brevo-api" : "none";
}

export function emailStatus() {
  const transport = emailTransport();
  const { apiKey, smtpLogin, senderEmail } = env.brevo;
  let note = "";
  if (transport === "none") {
    note = apiKey.startsWith("xsmtpsib-") && !smtpLogin
      ? "An SMTP key is configured but BREVO_SMTP_LOGIN is missing."
      : "BREVO_API_KEY is not configured.";
  }
  return { transport, senderEmail, devOutbox: env.devOutbox, note };
}

async function sendViaApi(msg: OutgoingEmail) {
  const res = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: { "api-key": env.brevo.apiKey, "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({
      sender: { email: env.brevo.senderEmail, name: env.brevo.senderName },
      to: [{ email: msg.to, ...(msg.toName ? { name: msg.toName } : {}) }],
      subject: msg.subject,
      htmlContent: msg.html,
      textContent: msg.text,
      tags: [msg.template],
    }),
    signal: AbortSignal.timeout(15_000),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`Brevo API ${res.status}: ${body.slice(0, 300)}`);
  return (JSON.parse(body) as { messageId?: string }).messageId ?? null;
}

let smtp: nodemailer.Transporter | null = null;
async function sendViaSmtp(msg: OutgoingEmail) {
  smtp ??= nodemailer.createTransport({
    host: "smtp-relay.brevo.com",
    port: 587,
    secure: false,
    requireTLS: true,
    auth: { user: env.brevo.smtpLogin, pass: env.brevo.apiKey },
  });
  const info = await smtp.sendMail({
    from: { name: env.brevo.senderName, address: env.brevo.senderEmail },
    to: msg.toName ? { name: msg.toName, address: msg.to } : msg.to,
    subject: msg.subject,
    html: msg.html,
    text: msg.text,
    headers: { "X-Mailin-Tag": msg.template },
  });
  return info.messageId ?? null;
}

/**
 * Sends a transactional email through Brevo and records it in notification_logs.
 * Never throws — callers continue (e.g. an invitation is still created) and the
 * delivery result is returned for display.
 */
export async function sendEmail(msg: OutgoingEmail): Promise<{ status: "SENT" | "FAILED" | "DEV_LOGGED"; error?: string }> {
  const transport = emailTransport();
  let status: "SENT" | "FAILED" | "DEV_LOGGED";
  let providerMessageId: string | null = null;
  let error: string | undefined;

  if (transport === "none") {
    status = "DEV_LOGGED";
    error = emailStatus().note;
  } else {
    try {
      providerMessageId = transport === "brevo-api" ? await sendViaApi(msg) : await sendViaSmtp(msg);
      status = "SENT";
    } catch (e) {
      status = "FAILED";
      error = e instanceof Error ? e.message : String(e);
      console.error(`[email] ${msg.template} to ${msg.to} failed: ${error}`);
    }
  }

  // The body (which may contain one-time links) is only retained in dev-outbox mode
  // and only when the email did not go out.
  const keepBody = env.devOutbox && status !== "SENT";
  await prisma.notificationLog.create({
    data: {
      workspaceId: msg.workspaceId ?? null,
      userId: msg.userId ?? null,
      toEmail: msg.to,
      template: msg.template,
      subject: msg.subject,
      status,
      providerMessageId,
      error: error?.slice(0, 500) ?? null,
      devBody: keepBody ? msg.text : null,
    },
  });
  if (status !== "SENT" && keepBody && !env.isProduction) {
    console.log(`\n[email:outbox] ${msg.subject} → ${msg.to}\n${msg.text}\n`);
  }
  return { status, error };
}
