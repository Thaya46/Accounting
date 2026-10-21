/** Zod schemas for Super Admin API bodies (shared by route handlers; client-safe). */
import { z } from "zod";
import { CURRENCIES } from "@/lib/money";
import { WORKSPACE_CODE_RE, isValidTimeZone } from "./constants";

const name = (label: string, max = 120) =>
  z
    .string({ required_error: `${label} is required` })
    .trim()
    .min(2, `${label} must be at least 2 characters`)
    .max(max, `${label} must be at most ${max} characters`);

const email = (label: string) =>
  z
    .string({ required_error: `${label} is required` })
    .trim()
    .toLowerCase()
    .max(254, `${label} is too long`)
    .email(`${label} must be a valid email address`);

export const currencySchema = z
  .string()
  .trim()
  .toUpperCase()
  .refine((c) => (CURRENCIES as readonly string[]).includes(c), "Choose a supported currency");

export const timeZoneSchema = z.string().trim().refine(isValidTimeZone, "Choose a valid IANA time zone");

export const fyStartMonthSchema = z.coerce.number().int().min(1, "Choose a financial year").max(12, "Choose a financial year");

export const workspaceCodeSchema = z
  .string({ required_error: "Workspace code is required" })
  .trim()
  .toUpperCase()
  .regex(WORKSPACE_CODE_RE, "Workspace code must be 2–10 uppercase letters or digits");

export const workspaceCreateSchema = z.object({
  name: name("Workspace name"),
  code: workspaceCodeSchema,
  companyName: name("Company name", 160),
  companyEmail: email("Company email"),
  country: name("Country", 80),
  defaultCurrency: currencySchema,
  fyStartMonth: fyStartMonthSchema,
  timeZone: timeZoneSchema,
  adminName: name("Workspace Admin name"),
  adminEmail: email("Workspace Admin email"),
  status: z.enum(["ACTIVE", "SUSPENDED"], { errorMap: () => ({ message: "Status must be Active or Suspended" }) }),
});
export type WorkspaceCreateInput = z.infer<typeof workspaceCreateSchema>;

export const workspaceUpdateSchema = z
  .object({
    name: name("Workspace name"),
    companyName: name("Company name", 160),
    companyEmail: email("Company email"),
    country: name("Country", 80),
    defaultCurrency: currencySchema,
    fyStartMonth: fyStartMonthSchema,
    timeZone: timeZoneSchema,
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, "Nothing to update");
export type WorkspaceUpdateInput = z.infer<typeof workspaceUpdateSchema>;

export const workspaceStatusSchema = z.object({
  status: z.enum(["ACTIVE", "SUSPENDED", "ARCHIVED"]),
  reason: z.string().trim().min(3, "Give a reason (at least 3 characters)").max(500, "Reason must be at most 500 characters"),
});

export const adminInviteSchema = z.object({
  name: name("Name"),
  email: email("Email"),
});

export const revokeInvitationSchema = z.object({
  reason: z.string().trim().max(500).optional(),
});

export const platformSettingsSchema = z
  .object({
    platformName: name("Platform name", 80),
    defaultCountry: name("Default country", 80),
    defaultCurrency: currencySchema,
    defaultTimeZone: timeZoneSchema,
    defaultFyStartMonth: fyStartMonthSchema,
    requireMfaForUsers: z.boolean(),
    sessionTtlHours: z.coerce.number().int().min(1, "Session lifetime must be 1–168 hours").max(168, "Session lifetime must be 1–168 hours"),
    invitationTtlHours: z.coerce
      .number()
      .int()
      .min(1, "Invitation lifetime must be 1–336 hours")
      .max(336, "Invitation lifetime must be 1–336 hours"),
    allowSelfPasswordReset: z.boolean(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, "Nothing to update");

export const testEmailSchema = z.object({ to: email("Recipient") });
