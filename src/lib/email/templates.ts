import { env } from "@/lib/env";

type Rendered = { subject: string; html: string; text: string };

function esc(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function layout(title: string, bodyHtml: string, cta?: { label: string; url: string }) {
  const button = cta
    ? `<p style="margin:28px 0"><a href="${esc(cta.url)}" style="background:#4f46e5;color:#fff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:600;display:inline-block">${esc(cta.label)}</a></p>
       <p style="color:#64748b;font-size:12px">If the button does not work, copy this link into your browser:<br><span style="word-break:break-all">${esc(cta.url)}</span></p>`
    : "";
  return `<!doctype html><html><body style="margin:0;background:#f8fafc;font-family:Inter,Segoe UI,Arial,sans-serif;color:#0f172a">
  <table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
  <table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fff;border:1px solid #e2e8f0;border-radius:12px">
  <tr><td style="padding:24px 28px;border-bottom:1px solid #e2e8f0"><strong style="font-size:16px;color:#4f46e5">VLedger AI</strong></td></tr>
  <tr><td style="padding:28px">
    <h1 style="font-size:20px;margin:0 0 16px">${esc(title)}</h1>
    ${bodyHtml}
    ${button}
  </td></tr>
  <tr><td style="padding:16px 28px;border-top:1px solid #e2e8f0;color:#94a3b8;font-size:12px">
    This is an automated security email from VLedger AI. We never send passwords by email.
  </td></tr></table></td></tr></table></body></html>`;
}

const p = (s: string) => `<p style="line-height:1.6;margin:0 0 12px">${s}</p>`;

export function invitationEmail(opts: {
  name: string;
  workspaceName: string;
  roleName: string;
  invitedBy: string;
  token: string;
  expiresHours: number;
  isAdmin: boolean;
}): Rendered {
  const url = `${env.appUrl}/invite/${opts.token}`;
  const subject = opts.isAdmin
    ? `You're invited to administer ${opts.workspaceName} on VLedger AI`
    : `You're invited to join ${opts.workspaceName} on VLedger AI`;
  const html = layout(
    subject,
    p(`Hi ${esc(opts.name)},`) +
      p(`${esc(opts.invitedBy)} invited you to <strong>${esc(opts.workspaceName)}</strong> as <strong>${esc(opts.roleName)}</strong>.`) +
      p(`Use the secure link below to verify your email and choose your password. ${opts.isAdmin ? "As an administrator you will also set up an authenticator app (MFA)." : ""}`) +
      p(`This link expires in ${opts.expiresHours} hours and can be used once.`),
    { label: "Accept invitation", url },
  );
  const text = `Hi ${opts.name},\n\n${opts.invitedBy} invited you to ${opts.workspaceName} as ${opts.roleName}.\nAccept the invitation and set your password (link valid for ${opts.expiresHours} hours, single use):\n${url}\n`;
  return { subject, html, text };
}

export function passwordResetEmail(opts: { name: string; token: string; expiresMinutes: number }): Rendered {
  const url = `${env.appUrl}/reset-password/${opts.token}`;
  const subject = "Reset your VLedger AI password";
  const html = layout(
    subject,
    p(`Hi ${esc(opts.name)},`) +
      p("We received a request to reset your password. If this was you, use the link below.") +
      p(`The link expires in ${opts.expiresMinutes} minutes. If you did not ask for this, you can ignore this email — your password will not change.`),
    { label: "Reset password", url },
  );
  return { subject, html, text: `Reset your password (valid ${opts.expiresMinutes} minutes):\n${url}\n\nIf you did not request this, ignore this email.` };
}

export function accountActivatedEmail(opts: { name: string; workspaceName?: string }): Rendered {
  const subject = "Your VLedger AI account is active";
  const where = opts.workspaceName ? ` for ${esc(opts.workspaceName)}` : "";
  const html = layout(subject, p(`Hi ${esc(opts.name)},`) + p(`Your email is verified and your account${where} is now active.`), {
    label: "Sign in",
    url: `${env.appUrl}/login`,
  });
  return { subject, html, text: `Hi ${opts.name}, your email is verified and your account${opts.workspaceName ? ` for ${opts.workspaceName}` : ""} is active. Sign in: ${env.appUrl}/login` };
}

export function mfaNotificationEmail(opts: { name: string; event: "enabled" | "disabled" | "recovery_used" | "recovery_regenerated" }): Rendered {
  const messages = {
    enabled: "Multi-factor authentication was turned on for your account.",
    disabled: "Multi-factor authentication was turned off for your account.",
    recovery_used: "A backup recovery code was just used to sign in to your account.",
    recovery_regenerated: "New backup recovery codes were generated. Previous codes no longer work.",
  } as const;
  const subject = "Security update for your VLedger AI account";
  const html = layout(subject, p(`Hi ${esc(opts.name)},`) + p(messages[opts.event]) + p("If this wasn't you, reset your password immediately and contact your administrator."));
  return { subject, html, text: `${messages[opts.event]} If this wasn't you, reset your password immediately.` };
}

export function suspiciousLoginEmail(opts: { name: string; ip: string; userAgent: string; when: string }): Rendered {
  const subject = "New sign-in to your VLedger AI account";
  const html = layout(
    subject,
    p(`Hi ${esc(opts.name)},`) +
      p("We noticed a sign-in from a new location or device:") +
      `<ul style="color:#334155;line-height:1.7"><li>Time: ${esc(opts.when)}</li><li>IP address: ${esc(opts.ip)}</li><li>Device: ${esc(opts.userAgent.slice(0, 120))}</li></ul>` +
      p("If this was you, no action is needed. Otherwise reset your password and review your active sessions."),
  );
  return { subject, html, text: `New sign-in at ${opts.when} from ${opts.ip} (${opts.userAgent.slice(0, 120)}). If this wasn't you, reset your password.` };
}

export function transactionSummaryEmail(opts: {
  name: string;
  workspaceName: string;
  period: string;
  /** Concrete period, e.g. "15 Oct 2026" or "October 2026". */
  rangeLabel?: string;
  income: string;
  expenses: string;
  net: string;
  count: number;
}): Rendered {
  const when = opts.rangeLabel ? ` — ${opts.rangeLabel}` : "";
  const subject = `${opts.workspaceName}: ${opts.period} transaction summary${when}`;
  const html = layout(
    subject,
    p(`Hi ${esc(opts.name)}, here is the ${esc(opts.period.toLowerCase())} summary for ${esc(opts.workspaceName)}${opts.rangeLabel ? ` covering <strong>${esc(opts.rangeLabel)}</strong>` : ""}.`) +
      `<table style="width:100%;border-collapse:collapse;margin:8px 0 16px">
        <tr><td style="padding:6px 0;color:#64748b">Transactions posted</td><td align="right">${opts.count}</td></tr>
        <tr><td style="padding:6px 0;color:#64748b">Income</td><td align="right" style="color:#16a34a">${esc(opts.income)}</td></tr>
        <tr><td style="padding:6px 0;color:#64748b">Expenses</td><td align="right" style="color:#dc2626">${esc(opts.expenses)}</td></tr>
        <tr><td style="padding:6px 0;font-weight:600">Net</td><td align="right" style="font-weight:600">${esc(opts.net)}</td></tr></table>`,
    { label: "Open dashboard", url: `${env.appUrl}/login` },
  );
  return { subject, html, text: `${opts.period} summary for ${opts.workspaceName}${when}: ${opts.count} posted, income ${opts.income}, expenses ${opts.expenses}, net ${opts.net}.` };
}
