import { describe, expect, it } from "vitest";
import { base32Decode, base32Encode, generateTotpSecret, hotp, otpauthUri, totp, verifyTotp } from "@/lib/auth/totp";
import { hashPassword, passwordSchema, verifyPassword } from "@/lib/auth/password";
import { decrypt, encrypt, sha256 } from "@/lib/auth/crypto";
import { ALL_PERMISSIONS, PERMISSIONS, SYSTEM_ROLES } from "@/lib/permissions";
import { secureCookieFor } from "@/lib/auth/secure-cookie";

describe("session cookie Secure flag", () => {
  it("follows the protocol the request arrived on", () => {
    expect(secureCookieFor("https", "auto", true)).toBe(true);
    expect(secureCookieFor("https,http", "auto", true)).toBe(true); // first proxy hop wins
    expect(secureCookieFor("http", "auto", true)).toBe(false); // e.g. http://192.168.1.20:3000
    expect(secureCookieFor("http", "auto", false)).toBe(false);
  });

  it("falls back to the environment when the protocol is unknown", () => {
    expect(secureCookieFor(null, "auto", true)).toBe(true);
    expect(secureCookieFor(undefined, "auto", false)).toBe(false);
  });

  it("honours COOKIE_SECURE overrides", () => {
    expect(secureCookieFor("http", "true", false)).toBe(true);
    expect(secureCookieFor("https", "FALSE", true)).toBe(false);
  });
});

describe("TOTP (RFC 6238)", () => {
  // RFC 6238 Appendix B test secret "12345678901234567890" (SHA-1).
  const rfcSecret = base32Encode(Buffer.from("12345678901234567890"));

  it("matches the RFC 6238 reference values", () => {
    expect(totp(rfcSecret, 59 * 1000)).toBe("287082");
    expect(totp(rfcSecret, 1111111109 * 1000)).toBe("081804");
    expect(totp(rfcSecret, 1234567890 * 1000)).toBe("005924");
    expect(totp(rfcSecret, 2000000000 * 1000)).toBe("279037");
  });

  it("matches the RFC 4226 HOTP reference values", () => {
    expect(hotp(rfcSecret, 0)).toBe("755224");
    expect(hotp(rfcSecret, 9)).toBe("520489");
  });

  it("round-trips base32", () => {
    const buf = Buffer.from("vledger-secret-bytes");
    expect(base32Decode(base32Encode(buf)).equals(buf)).toBe(true);
  });

  it("verifies within the time window and rejects replays", () => {
    const secret = generateTotpSecret();
    const now = Date.now();
    const code = totp(secret, now);
    const step = verifyTotp(secret, code, { now });
    expect(step).not.toBeNull();
    expect(verifyTotp(secret, code, { now, lastUsedStep: step })).toBeNull();
    expect(verifyTotp(secret, "000000", { now })).toBeNull();
    expect(verifyTotp(secret, "abc", { now })).toBeNull();
  });

  it("builds an otpauth URI for authenticator apps", () => {
    expect(otpauthUri("ABC", "user@x.test")).toMatch(/^otpauth:\/\/totp\/VLedger%20AI%3Auser%40x\.test\?secret=ABC/);
  });
});

describe("passwords", () => {
  it("hashes with scrypt and verifies", async () => {
    const hash = await hashPassword("Correct!Horse9");
    expect(hash.startsWith("scrypt$")).toBe(true);
    expect(await verifyPassword("Correct!Horse9", hash)).toBe(true);
    expect(await verifyPassword("wrong", hash)).toBe(false);
    expect(await verifyPassword("anything", null)).toBe(false);
  });

  it("enforces the password policy", () => {
    expect(passwordSchema.safeParse("short").success).toBe(false);
    expect(passwordSchema.safeParse("alllowercase123!").success).toBe(false);
    expect(passwordSchema.safeParse("NoSymbols12345").success).toBe(false);
    expect(passwordSchema.safeParse("Good!Password42").success).toBe(true);
  });
});

describe("encryption at rest", () => {
  it("round-trips AES-256-GCM and detects tampering", () => {
    const payload = encrypt("JBSWY3DPEHPK3PXP");
    expect(decrypt(payload)).toBe("JBSWY3DPEHPK3PXP");
    const [iv, tag, ct] = payload.split(".");
    const tampered = [iv, tag, ct.slice(0, -2) + (ct.endsWith("A") ? "BB" : "AA")].join(".");
    expect(() => decrypt(tampered)).toThrow();
    expect(sha256("x")).toHaveLength(64);
  });
});

describe("permissions", () => {
  it("defines every granular permission required by the specification", () => {
    for (const key of [
      "TRANSACTION_CREATE",
      "TRANSACTION_VIEW",
      "TRANSACTION_EDIT_DRAFT",
      "TRANSACTION_POST",
      "TRANSACTION_REVERSE",
      "TRANSACTION_APPROVE",
      "REPORTS_VIEW",
      "DATA_EXPORT",
      "ACCOUNTS_MANAGE",
      "USERS_MANAGE",
      "AUDIT_VIEW",
    ]) {
      expect(PERMISSIONS).toHaveProperty(key);
    }
  });

  it("gives the Workspace Admin role every permission and only it is an admin role", () => {
    const admin = SYSTEM_ROLES.find((r) => r.isAdmin)!;
    expect(admin.permissions.sort()).toEqual([...ALL_PERMISSIONS].sort());
    expect(SYSTEM_ROLES.filter((r) => r.isAdmin)).toHaveLength(1);
  });
});
