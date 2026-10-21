import { json, parseBody, route } from "@/lib/api";
import { audit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { emailStatus, sendEmail } from "@/lib/email/send";
import { adminApi } from "@/lib/admin/server";
import { testEmailSchema } from "@/lib/admin/schemas";

function esc(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/** POST /api/admin/outbox/test — sends a simple test email to verify Brevo delivery. */
export const POST = route(async (req) => {
  const { user, actor, meta } = await adminApi();
  const body = await parseBody(req, testEmailSchema);
  const status = emailStatus();
  const when = new Date().toISOString();

  const subject = "VLedger AI test email";
  const text = `This is a test email from VLedger AI.\n\nRequested by ${user.name} (${user.email}) at ${when}.\nTransport: ${status.transport}\nSender: ${status.senderEmail}\n\nIf you received this message, transactional email delivery is working.\n`;
  const html = `<!doctype html><html><body style="margin:0;background:#f8fafc;font-family:Inter,Segoe UI,Arial,sans-serif;color:#0f172a">
  <table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
  <table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fff;border:1px solid #e2e8f0;border-radius:12px">
  <tr><td style="padding:24px 28px;border-bottom:1px solid #e2e8f0"><strong style="font-size:16px;color:#4f46e5">VLedger AI</strong></td></tr>
  <tr><td style="padding:28px">
    <h1 style="font-size:20px;margin:0 0 16px">${esc(subject)}</h1>
    <p style="line-height:1.6;margin:0 0 12px">This is a test email from VLedger AI. If you received it, transactional email delivery is working.</p>
    <p style="line-height:1.6;margin:0 0 12px;color:#64748b;font-size:13px">Requested by ${esc(user.name)} (${esc(user.email)}) at ${esc(when)}.<br>Transport: ${esc(status.transport)} · Sender: ${esc(status.senderEmail)}</p>
  </td></tr></table></td></tr></table></body></html>`;

  const delivery = await sendEmail({ to: body.to, subject, html, text, template: "EMAIL_VERIFICATION", userId: null, workspaceId: null });

  await audit(prisma, {
    workspaceId: null,
    actor,
    entityType: "EMAIL",
    entityId: null,
    action: "TEST_EMAIL_SENT",
    after: { to: body.to, status: delivery.status, transport: status.transport },
    ip: meta.ip,
    userAgent: meta.userAgent,
  });

  return json({ delivery, transport: status.transport });
});
