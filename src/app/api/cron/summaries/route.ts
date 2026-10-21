import { NextResponse, type NextRequest } from "next/server";
import { safeEqual } from "@/lib/auth/crypto";
import { runScheduledSummaries } from "@/lib/summaries";

/**
 * Scheduler entry point for daily/monthly summary emails.
 *   POST /api/cron/summaries?period=daily   with header  Authorization: Bearer <CRON_SECRET>
 * GET is accepted too because Vercel Cron calls with GET (sending that same
 * header when CRON_SECRET is set). Disabled unless CRON_SECRET is set.
 */
export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return NextResponse.json({ error: { code: "DISABLED", message: "CRON_SECRET is not configured" } }, { status: 404 });
  const auth = req.headers.get("authorization") ?? "";
  if (!safeEqual(auth, `Bearer ${secret}`)) return NextResponse.json({ error: { code: "UNAUTHENTICATED", message: "Invalid scheduler credentials" } }, { status: 401 });
  const period = req.nextUrl.searchParams.get("period");
  if (period !== "daily" && period !== "monthly") return NextResponse.json({ error: { code: "BAD_REQUEST", message: "period must be daily or monthly" } }, { status: 400 });
  return NextResponse.json({ period, results: await runScheduledSummaries(period) });
}

export const GET = POST;
