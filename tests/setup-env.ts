import "dotenv/config";

// Unit tests never need the network; keep any accidental email/AI calls offline.
process.env.BREVO_API_KEY = "";
process.env.AI_PROVIDER = "none";
process.env.APP_ENCRYPTION_KEY ||= Buffer.alloc(32, 7).toString("base64");
