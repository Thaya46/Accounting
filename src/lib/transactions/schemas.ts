/**
 * Request body schemas for the transaction APIs. Attribution fields
 * (createdById, createdByName, workspaceId, …) are never part of these
 * schemas: the outer objects are strict, and the transaction input schema
 * strips unknown keys.
 */
import { z } from "zod";
import { intentSchema, transactionInputSchema } from "@/lib/accounting/transactions";
import { TRANSACTION_TYPES } from "./types";

export const createTransactionBodySchema = z
  .object({
    input: transactionInputSchema,
    intent: intentSchema,
    source: z.enum(["MANUAL", "TEXT", "VOICE"]).default("MANUAL"),
    rawInput: z.string().trim().max(1000).nullish(),
    aiConfidence: z.number().min(0).max(1).nullish(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.source === "MANUAL" && v.rawInput) ctx.addIssue({ code: "custom", path: ["rawInput"], message: "Original input is only recorded for voice or text entries" });
    if (v.source === "MANUAL" && v.aiConfidence != null) ctx.addIssue({ code: "custom", path: ["aiConfidence"], message: "AI confidence is only recorded for voice or text entries" });
  });

export const updateTransactionBodySchema = z
  .object({
    input: transactionInputSchema,
    reason: z.string().trim().max(500).nullish(),
  })
  .strict();

export const approveBodySchema = z
  .object({
    decision: z.enum(["APPROVED", "REJECTED"]),
    comment: z.string().trim().max(1000).nullish(),
    post: z.boolean().optional(),
  })
  .strict()
  .refine((v) => v.decision !== "REJECTED" || Boolean(v.comment?.trim()), { path: ["comment"], message: "Give a reason for rejecting" });

export const reverseBodySchema = z
  .object({
    reason: z.string().trim().min(3, "Give a reason for the reversal").max(500),
    date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")
      .nullish(),
  })
  .strict();

export const parseBodySchema = z
  .object({
    text: z.string().trim().min(1, "Say or type what happened").max(1000, "Keep it under 1,000 characters"),
    source: z.enum(["TEXT", "VOICE"]).default("TEXT"),
  })
  .strict();

export const duplicateCheckSchema = z
  .object({
    type: z.enum(TRANSACTION_TYPES),
    amount: z
      .string()
      .trim()
      .regex(/^\d+(\.\d{1,2})?$/),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    description: z.string().trim().min(1).max(500),
    excludeId: z.string().max(64).nullish(),
  })
  .strict();
