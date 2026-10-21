function str(name: string, fallback = ""): string {
  return (process.env[name] ?? fallback).trim();
}

export const env = {
  /** Base URL for email links: APP_URL, else the Vercel production domain, else localhost. */
  get appUrl() {
    const vercel = str("VERCEL_PROJECT_PRODUCTION_URL");
    return (str("APP_URL") || (vercel ? `https://${vercel}` : "http://localhost:3000")).replace(/\/$/, "");
  },
  get isProduction() {
    return process.env.NODE_ENV === "production";
  },
  /** "auto" (follow the request protocol), "true" or "false". */
  get cookieSecure() {
    return str("COOKIE_SECURE", "auto");
  },
  get encryptionKey() {
    return str("APP_ENCRYPTION_KEY");
  },
  get brevo() {
    return {
      apiKey: str("BREVO_API_KEY"),
      smtpLogin: str("BREVO_SMTP_LOGIN"),
      senderEmail: str("BREVO_SENDER_EMAIL", "no-reply@example.com"),
      senderName: str("BREVO_SENDER_NAME", "VLedger AI"),
    };
  },
  get devOutbox() {
    return str("EMAIL_DEV_OUTBOX", "true") === "true";
  },
  get ai() {
    return {
      provider: str("AI_PROVIDER", "none") as "none" | "anthropic" | "openai",
      anthropicKey: str("ANTHROPIC_API_KEY"),
      anthropicModel: str("ANTHROPIC_MODEL", "claude-opus-5-5"),
      openaiBaseUrl: str("OPENAI_COMPATIBLE_BASE_URL").replace(/\/$/, ""),
      openaiKey: str("OPENAI_COMPATIBLE_API_KEY"),
      openaiModel: str("OPENAI_COMPATIBLE_MODEL"),
    };
  },
};
