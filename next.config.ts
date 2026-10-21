import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Microphone is allowed for same-origin voice entry only.
  { key: "Permissions-Policy", value: "camera=(), geolocation=(), microphone=(self)" },
];

const nextConfig: NextConfig = {
  // Lets a second local server build into its own folder (default .next).
  distDir: process.env.NEXT_DIST_DIR || ".next",
  poweredByHeader: false,
  serverExternalPackages: ["@prisma/client", "embedded-postgres"],
  // The Super Admin API reference reads docs/API.md at runtime; bundle it with
  // that page on serverless hosts such as Vercel.
  outputFileTracingIncludes: { "/admin/docs": ["./docs/API.md"] },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
