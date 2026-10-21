import { prisma } from "@/lib/db";
import { json, parseBody, route } from "@/lib/api";
import { audit, diff } from "@/lib/audit";
import { emailStatus } from "@/lib/email/send";
import { aiProviderStatus } from "@/lib/ai/provider";
import { adminApi } from "@/lib/admin/server";
import { platformSettingsSchema } from "@/lib/admin/schemas";
import { PLATFORM_DEFAULTS, getPlatformSettings } from "@/lib/admin/queries";

/** GET /api/admin/settings — platform settings plus read-only email and AI provider status. */
export const GET = route(async () => {
  await adminApi();
  return json({ settings: await getPlatformSettings(), email: emailStatus(), ai: aiProviderStatus() });
});

/** PATCH /api/admin/settings — updates platform-wide settings (audited as PLATFORM_SETTINGS_UPDATED). */
export const PATCH = route(async (req) => {
  const { actor, meta } = await adminApi();
  const body = await parseBody(req, platformSettingsSchema);

  const result = await prisma.$transaction(async (tx) => {
    const current = await tx.platformSettings.findUnique({ where: { id: "platform" } });
    const before = current
      ? {
          platformName: current.platformName,
          defaultCountry: current.defaultCountry,
          defaultCurrency: current.defaultCurrency,
          defaultTimeZone: current.defaultTimeZone,
          defaultFyStartMonth: current.defaultFyStartMonth,
          requireMfaForUsers: current.requireMfaForUsers,
          sessionTtlHours: current.sessionTtlHours,
          invitationTtlHours: current.invitationTtlHours,
          allowSelfPasswordReset: current.allowSelfPasswordReset,
        }
      : { ...PLATFORM_DEFAULTS };
    const changes = diff(before, body);
    if (!changes.changed && current) return { changed: false };

    await tx.platformSettings.upsert({
      where: { id: "platform" },
      create: { id: "platform", ...before, ...body },
      update: changes.after,
    });
    await audit(tx, {
      workspaceId: null,
      actor,
      entityType: "PLATFORM_SETTINGS",
      entityId: "platform",
      action: "PLATFORM_SETTINGS_UPDATED",
      before: changes.before,
      after: changes.after,
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
    return { changed: true };
  });

  return json({ ...result, settings: await getPlatformSettings() });
});
