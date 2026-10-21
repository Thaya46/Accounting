/**
 * End-to-end business scenarios from the specification (§15), run against a
 * fresh PostgreSQL database with the real service layer, guards and DB triggers.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDatabase } from "./test-db";

type Mods = {
  prisma: typeof import("@/lib/db").prisma;
  provision: typeof import("@/lib/workspaces/provision");
  invitations: typeof import("@/lib/workspaces/invitations");
  ws: typeof import("@/lib/auth/workspace");
  session: typeof import("@/lib/auth/session");
  txns: typeof import("@/lib/accounting/transactions");
  reports: typeof import("@/lib/accounting/reports");
  ai: typeof import("@/lib/ai/provider");
  password: typeof import("@/lib/auth/password");
  totp: typeof import("@/lib/auth/totp");
  crypto: typeof import("@/lib/auth/crypto");
  aiContext: (workspaceId: string) => Promise<import("@/lib/ai/parser").ParseContext>;
};

let db: Awaited<ReturnType<typeof createTestDatabase>>;
let m: Mods;
const META = { ip: "127.0.0.1", userAgent: "vitest" };

// Shared state across the ordered scenarios.
const S: Record<string, string> = {};

async function ctxFor(userId: string, workspaceId: string) {
  const u = await m.prisma.user.findUniqueOrThrow({ where: { id: userId } });
  const r = await m.ws.loadWorkspaceContext(
    { id: u.id, seq: u.seq, email: u.email, name: u.name, platformRole: u.platformRole, status: u.status, mfaEnabled: false },
    workspaceId,
  );
  if (!r.ok) throw new Error(`access ${r.error}`);
  return { ...r.ctx, meta: META };
}

/** Pulls the single-use link out of the dev-outbox copy of the latest email to `email`. */
async function latestInviteToken(email: string) {
  const log = await m.prisma.notificationLog.findFirstOrThrow({ where: { toEmail: email }, orderBy: { createdAt: "desc" } });
  const match = /\/invite\/([A-Za-z0-9_-]+)/.exec(log.devBody ?? "");
  expect(match, "invitation link in the outbox body").not.toBeNull();
  return { token: match![1], body: log.devBody ?? "" };
}

beforeAll(async () => {
  process.env.EMAIL_DEV_OUTBOX = "true";
  db = await createTestDatabase();
  const [dbm, provision, invitations, ws, session, txns, reports, ai, password, totp, crypto, parser] = await Promise.all([
    import("@/lib/db"),
    import("@/lib/workspaces/provision"),
    import("@/lib/workspaces/invitations"),
    import("@/lib/auth/workspace"),
    import("@/lib/auth/session"),
    import("@/lib/accounting/transactions"),
    import("@/lib/accounting/reports"),
    import("@/lib/ai/provider"),
    import("@/lib/auth/password"),
    import("@/lib/auth/totp"),
    import("@/lib/auth/crypto"),
    import("@/lib/ai/parser"),
  ]);
  void parser;
  m = {
    prisma: dbm.prisma,
    provision,
    invitations,
    ws,
    session,
    txns,
    reports,
    ai,
    password,
    totp,
    crypto,
    aiContext: async (workspaceId: string) => {
      const w = await dbm.prisma.workspace.findUniqueOrThrow({ where: { id: workspaceId } });
      const [accounts, categories] = await Promise.all([
        dbm.prisma.account.findMany({ where: { workspaceId, isActive: true } }),
        dbm.prisma.accountCategory.findMany({ where: { workspaceId, isActive: true } }),
      ]);
      return {
        today: "2026-10-15",
        currency: w.defaultCurrency,
        accounts: accounts.map((a) => ({ id: a.id, code: a.code, name: a.name, type: a.type, subtype: a.subtype, bankName: a.bankName })),
        categories: categories.map((c) => ({ id: c.id, name: c.name, kind: c.kind, accountId: c.accountId, keywords: c.keywords })),
      };
    },
  };
  await m.prisma.platformSettings.create({ data: {} });
  await m.provision.ensurePermissions(m.prisma);
}, 180_000);

afterAll(async () => {
  await m?.prisma.$disconnect();
  await db?.drop();
}, 60_000);

describe("Scenario 1 — Super Admin creates Workspace A with MFA", () => {
  it("requires MFA for the Super Admin and verifies a TOTP code", async () => {
    const admin = await m.prisma.user.create({
      data: { email: "root@vledger.test", name: "Super Admin", passwordHash: await m.password.hashPassword("Root!Pass2026"), platformRole: "SUPER_ADMIN", status: "ACTIVE", emailVerifiedAt: new Date() },
    });
    S.superAdmin = admin.id;
    expect(await m.session.isMfaRequired(admin.id)).toBe(true);
    const secret = m.totp.generateTotpSecret();
    await m.prisma.mfaCredential.create({ data: { userId: admin.id, secretEncrypted: m.crypto.encrypt(secret), enabledAt: new Date() } });
    const cred = await m.prisma.mfaCredential.findUniqueOrThrow({ where: { userId: admin.id } });
    expect(await m.password.verifyPassword("Root!Pass2026", admin.passwordHash)).toBe(true);
    expect(m.totp.verifyTotp(m.crypto.decrypt(cred.secretEncrypted), m.totp.totp(secret))).not.toBeNull();
  });

  it("creates Workspace A with chart of accounts and a pending admin invitation (no password emailed)", async () => {
    const actor = { id: S.superAdmin, name: "Super Admin", email: "root@vledger.test" };
    const { workspace, invite } = await m.prisma.$transaction(
      async (tx) => {
        const { workspace, roles } = await m.provision.provisionWorkspace(
          tx,
          { name: "Workspace A", code: "WSA", companyName: "A Pvt Ltd", companyEmail: "a@a.test", country: "India", defaultCurrency: "INR", fyStartMonth: 4, timeZone: "Asia/Kolkata", status: "ACTIVE" },
          S.superAdmin,
        );
        const invite = await m.invitations.createInvitation(tx, { workspaceId: workspace.id, email: "admin.a@a.test", name: "Admin A", roleId: roles["Workspace Admin"] }, actor, META);
        return { workspace, invite };
      },
      { timeout: 60_000 },
    );
    S.wsA = workspace.id;
    await m.invitations.sendInvitationEmail({
      workspaceId: workspace.id,
      workspaceName: workspace.name,
      email: "admin.a@a.test",
      name: "Admin A",
      roleName: "Workspace Admin",
      isAdmin: true,
      invitedByName: actor.name,
      token: invite.token,
      ttlHours: invite.ttlHours,
      userId: invite.user.id,
    });

    expect(workspace.seq).toBeGreaterThan(0);
    expect(await m.prisma.account.count({ where: { workspaceId: workspace.id } })).toBeGreaterThan(20);
    expect(await m.prisma.accountCategory.count({ where: { workspaceId: workspace.id } })).toBeGreaterThan(10);
    expect(await m.prisma.workspaceSettings.count({ where: { workspaceId: workspace.id } })).toBe(1);
    const inv = await m.prisma.workspaceInvitation.findFirstOrThrow({ where: { workspaceId: workspace.id } });
    expect(inv.status).toBe("PENDING");
    expect(inv.tokenHash).not.toContain(invite.token); // only the hash is stored
    const { body } = await latestInviteToken("admin.a@a.test");
    expect(body).not.toMatch(/password\s*[:=]/i);
  });

  it("lets Admin A activate their account from the invitation", async () => {
    const { token } = await latestInviteToken("admin.a@a.test");
    const { user } = await m.invitations.acceptInvitation(token, { name: "Admin A", password: "AdminA!Pass2026" }, META);
    S.adminA = user.id;
    const u = await m.prisma.user.findUniqueOrThrow({ where: { id: user.id }, include: { memberships: true } });
    expect(u.status).toBe("ACTIVE");
    expect(u.emailVerifiedAt).not.toBeNull();
    expect(u.memberships[0].status).toBe("ACTIVE");
    expect(await m.session.isMfaRequired(user.id)).toBe(true); // workspace admins must set up MFA
    await expect(m.invitations.acceptInvitation(token, { name: "Admin A", password: "AdminA!Pass2026" }, META)).rejects.toThrow(/already been used/);
  });
});

describe("Scenario 2 — Admin A creates User A and User B", () => {
  it("invites both users who then sign in with their assigned permissions", async () => {
    const ctx = await ctxFor(S.adminA, S.wsA);
    expect(ctx.permissions.has("USERS_MANAGE")).toBe(true);
    const roles = await m.prisma.role.findMany({ where: { workspaceId: S.wsA } });
    const roleId = (n: string) => roles.find((r) => r.name === n)!.id;
    await m.invitations.inviteAndEmail({ workspaceId: S.wsA, email: "user.a@a.test", name: "User A", roleId: roleId("Accountant"), employeeId: "E-1", department: "Finance" }, ctx.actor, META);
    await m.invitations.inviteAndEmail({ workspaceId: S.wsA, email: "user.b@a.test", name: "User B", roleId: roleId("Staff"), permissionKeys: ["TRANSACTION_POST"] }, ctx.actor, META);

    const a = await m.invitations.acceptInvitation((await latestInviteToken("user.a@a.test")).token, { name: "User A", password: "UserA!Pass2026" }, META);
    const b = await m.invitations.acceptInvitation((await latestInviteToken("user.b@a.test")).token, { name: "User B", password: "UserB!Pass2026" }, META);
    S.userA = a.user.id;
    S.userB = b.user.id;

    const ca = await ctxFor(S.userA, S.wsA);
    const cb = await ctxFor(S.userB, S.wsA);
    expect(ca.permissions.has("TRANSACTION_POST")).toBe(true);
    expect(ca.permissions.has("USERS_MANAGE")).toBe(false);
    expect(cb.permissions.has("TRANSACTION_CREATE")).toBe(true);
    expect(cb.permissions.has("TRANSACTION_POST")).toBe(true); // granted individually
    expect(cb.permissions.has("TRANSACTION_VIEW")).toBe(false);
  });
});

describe("Scenario 3 — User A records an expense by voice", () => {
  it("creates, attributes, posts a balanced journal and writes audit history", async () => {
    const ctxAdmin = await ctxFor(S.adminA, S.wsA);
    const hdfc = await m.prisma.account.create({ data: { workspaceId: S.wsA, code: "BANK-HDFC", name: "HDFC Bank", type: "ASSET", subtype: "BANK", bankName: "HDFC Bank" } });
    S.hdfc = hdfc.id;
    void ctxAdmin;

    const ctx = await ctxFor(S.userA, S.wsA);
    const parsed = await m.ai.extractTransaction("Today I spent ₹2,500 for office electricity through HDFC Bank.", await m.aiContext(S.wsA));
    expect(parsed).toMatchObject({ type: "EXPENSE", amount: "2500.00", categoryName: "Electricity Expense", paymentAccountName: "HDFC Bank", missing: [] });

    const before = Date.now();
    const txn = await m.txns.createTransaction(
      ctx,
      { type: "EXPENSE", date: parsed.date, amount: parsed.amount!, description: parsed.description, categoryId: parsed.categoryId, creditAccountId: parsed.paymentAccountId, paymentMethod: parsed.paymentMethod },
      { source: "VOICE", intent: "post", rawInput: "Today I spent ₹2,500 for office electricity through HDFC Bank.", aiConfidence: parsed.confidence },
    );
    S.txnA = txn.id;
    expect(txn.workspaceId).toBe(S.wsA);
    expect(txn.createdById).toBe(S.userA);
    expect(txn.createdByName).toBe("User A");
    expect(txn.createdAt.getTime()).toBeGreaterThanOrEqual(before - 5000);
    expect(txn.source).toBe("VOICE");
    expect(txn.status).toBe("POSTED");

    const je = await m.prisma.journalEntry.findUniqueOrThrow({ where: { id: txn.journalEntryId! }, include: { lines: { include: { account: true }, orderBy: { lineNo: "asc" } } } });
    expect(je.lines.map((l) => [l.account.code, l.debit.toFixed(2), l.credit.toFixed(2)])).toEqual([
      ["EXP-ELEC", "2500.00", "0.00"],
      ["BANK-HDFC", "0.00", "2500.00"],
    ]);
    const events = await m.prisma.auditEvent.findMany({ where: { transactionId: txn.id }, orderBy: { createdAt: "asc" } });
    expect(events.map((e) => e.action)).toEqual(["CREATED", "POSTED"]);
    expect(events.every((e) => e.actorUserId === S.userA && e.workspaceId === S.wsA)).toBe(true);
  });
});

describe("Scenario 4 — User B records income", () => {
  it("keeps records distinct and filterable by who entered them", async () => {
    const ctx = await ctxFor(S.userB, S.wsA);
    const parsed = await m.ai.extractTransaction("Received ₹75,000 from ABC Technologies for website development into HDFC Bank", await m.aiContext(S.wsA));
    expect(parsed).toMatchObject({ type: "INCOME", amount: "75000.00", categoryName: "Service Revenue", counterparty: "ABC Technologies", paymentAccountName: "HDFC Bank" });
    const txn = await m.txns.createTransaction(
      ctx,
      { type: "INCOME", date: parsed.date, amount: parsed.amount!, description: parsed.description, categoryId: parsed.categoryId, debitAccountId: parsed.paymentAccountId, customerName: parsed.counterparty },
      { source: "TEXT", intent: "post", aiConfidence: parsed.confidence },
    );
    S.txnB = txn.id;
    expect(txn.createdById).toBe(S.userB);
    expect(txn.createdByName).toBe("User B");

    const byA = await m.prisma.transaction.findMany({ where: { workspaceId: S.wsA, createdById: S.userA } });
    const byB = await m.prisma.transaction.findMany({ where: { workspaceId: S.wsA, createdById: S.userB } });
    expect(byA.map((t) => t.id)).toEqual([S.txnA]);
    expect(byB.map((t) => t.id)).toEqual([S.txnB]);

    // User B (no View Transactions) cannot see User A's entry; the admin can.
    const ctxB = await ctxFor(S.userB, S.wsA);
    const ctxAdmin = await ctxFor(S.adminA, S.wsA);
    expect(await m.txns.getTransactionDetail(ctxB, S.txnA)).toBeNull();
    expect((await m.txns.getTransactionDetail(ctxAdmin, S.txnA))?.txn.createdByName).toBe("User A");
  });
});

describe("Scenario 5 — Workspace separation", () => {
  it("denies Workspace B's admin any access to Workspace A", async () => {
    const actor = { id: S.superAdmin, name: "Super Admin" };
    const { workspace, invite } = await m.prisma.$transaction(
      async (tx) => {
        const { workspace, roles } = await m.provision.provisionWorkspace(
          tx,
          { name: "Workspace B", code: "WSB", companyName: "B LLP", companyEmail: "b@b.test", country: "India", defaultCurrency: "INR", fyStartMonth: 4, timeZone: "Asia/Kolkata", status: "ACTIVE" },
          S.superAdmin,
        );
        return { workspace, invite: await m.invitations.createInvitation(tx, { workspaceId: workspace.id, email: "admin.b@b.test", name: "Admin B", roleId: roles["Workspace Admin"] }, actor) };
      },
      { timeout: 60_000 },
    );
    S.wsB = workspace.id;
    const { user } = await m.invitations.acceptInvitation(invite.token, { name: "Admin B", password: "AdminB!Pass2026" });
    S.adminB = user.id;

    const adminB = await m.prisma.user.findUniqueOrThrow({ where: { id: S.adminB } });
    const access = await m.ws.loadWorkspaceContext({ ...adminB, mfaEnabled: false }, S.wsA);
    expect(access).toEqual({ ok: false, error: "FORBIDDEN" });

    const ctxB = await ctxFor(S.adminB, S.wsB);
    expect(await m.txns.getTransactionDetail(ctxB, S.txnA)).toBeNull();
    await expect(m.txns.postTransaction(ctxB, S.txnA)).rejects.toThrow(/not found/i);
    await expect(m.txns.reverseTransaction(ctxB, S.txnA, "attempt")).rejects.toThrow(/not found/i);
    // Referencing another workspace's account is rejected by the service…
    await expect(
      m.txns.createTransaction(ctxB, { type: "EXPENSE", date: "2026-10-15", amount: "10.00", description: "x", creditAccountId: S.hdfc }, { source: "MANUAL" }),
    ).rejects.toThrow(/not found in this workspace/i);
    // …and by the database even if application code were bypassed.
    await expect(
      m.prisma.transaction.create({
        data: { workspaceId: S.wsB, number: 999, date: new Date("2026-10-15"), type: "EXPENSE", amount: "10.00", currency: "INR", description: "bypass", creditAccountId: S.hdfc, source: "MANUAL", createdById: S.adminB, createdByName: "Admin B" },
      }),
    ).rejects.toThrow(/different workspace/);
    expect(await m.prisma.transaction.count({ where: { workspaceId: S.wsB } })).toBe(0);

    // Tally ledger groups, bill-wise allocations and party ledgers follow the same rule.
    const groupA = await m.prisma.accountGroup.create({ data: { workspaceId: S.wsA, name: "Isolation Check", nature: "ASSET", isPrimary: true } });
    const accountB = await m.prisma.account.findFirstOrThrow({ where: { workspaceId: S.wsB } });
    await expect(
      m.prisma.accountGroup.create({ data: { workspaceId: S.wsB, name: "Child of A", nature: "ASSET", parentGroupId: groupA.id } }),
    ).rejects.toThrow(/different workspace/);
    await expect(m.prisma.account.update({ where: { id: accountB.id }, data: { groupId: groupA.id } })).rejects.toThrow(/different workspace/);
    await expect(
      m.prisma.billAllocation.create({ data: { workspaceId: S.wsB, transactionId: S.txnA, accountId: accountB.id, refNo: "INV-1", amount: "10.00", pendingAmount: "10.00" } }),
    ).rejects.toThrow(/different workspace/);
    await expect(m.prisma.transaction.update({ where: { id: S.txnA }, data: { partyLedgerId: accountB.id } })).rejects.toThrow(/different workspace/);
    await m.prisma.accountGroup.delete({ where: { id: groupA.id } });
  });
});

describe("Scenario 6 — JSON export of Workspace A", () => {
  it("exports only Workspace A, as valid canonical JSON with journals and creator information", async () => {
    const svc = await import("@/lib/export/service");
    const { exportRequestSchema } = await import("@/lib/export/filters");
    const { canonicalExportSchema } = await import("@/lib/export/canonical-schema");
    const ctx = await ctxFor(S.adminA, S.wsA);
    const job = await svc.generateExport(ctx, exportRequestSchema.parse({ adapterKey: "canonical-json", period: { kind: "fy", startYear: 2026 } }));
    S.exportJob = job.id;
    const file = await svc.downloadExportFile(ctx, job.id, "data");
    const data = canonicalExportSchema.parse(JSON.parse(file.content));

    expect(data.schemaVersion).toBe("1.0");
    expect(data.exportType).toBe("accounting_transactions");
    expect(data.workspace).toMatchObject({ workspaceName: "Workspace A", currency: "INR" });
    const posted = await m.prisma.transaction.count({ where: { workspaceId: S.wsA, status: { in: ["POSTED", "REVERSED"] } } });
    expect(data.transactions).toHaveLength(posted);

    const expense = data.transactions.find((t) => t.description === "Office Electricity")!;
    const income = data.transactions.find((t) => t.type === "income")!;
    expect(expense).toMatchObject({ type: "expense", amount: "2500.00", currency: "INR", category: "Electricity Expense" });
    expect(expense.audit.createdBy.name).toBe("User A");
    expect(expense.audit.source).toBe("voice");
    expect(income).toMatchObject({ amount: "75000.00" });
    expect(income.audit.createdBy.name).toBe("User B");
    expect(expense.journalLines.map((l) => [l.accountCode, l.debit, l.credit])).toEqual([
      ["EXP-ELEC", "2500.00", "0.00"],
      ["BANK-HDFC", "0.00", "2500.00"],
    ]);
    for (const t of data.transactions) {
      const d = t.journalLines.reduce((s, l) => s + Number(l.debit), 0);
      const c = t.journalLines.reduce((s, l) => s + Number(l.credit), 0);
      expect(d.toFixed(2)).toBe(c.toFixed(2));
      expect(t.audit.createdBy.userId).toMatch(/^USR-\d+/);
    }
    // Every exported transaction gets an EXPORTED audit event.
    expect(await m.prisma.auditEvent.count({ where: { workspaceId: S.wsA, action: "EXPORTED" } })).toBe(posted);
  });

  it("does not let Workspace B read Workspace A's export", async () => {
    const svc = await import("@/lib/export/service");
    const ctxB = await ctxFor(S.adminB, S.wsB);
    await expect(svc.downloadExportFile(ctxB, S.exportJob, "data")).rejects.toThrow(/not found/i);
    expect(await svc.listExportJobs(ctxB)).toHaveLength(0);
  });
});

describe("Scenario 7 — Accounting software export", () => {
  it("requires configuration, applies account mappings, and keeps full audit metadata in a separate file", async () => {
    const svc = await import("@/lib/export/service");
    const integrations = await import("@/lib/export/integrations");
    const { exportRequestSchema } = await import("@/lib/export/filters");
    const ctx = await ctxFor(S.adminA, S.wsA);
    const req = exportRequestSchema.parse({ adapterKey: "tallyprime", period: { kind: "fy", startYear: 2026 } });

    const before = await svc.previewExport(ctx, req);
    expect(before.status.status).toBe("configuration_required");
    await expect(svc.generateExport(ctx, req)).rejects.toThrow();

    const used = before.accountsUsed;
    await integrations.updateIntegration(ctx, "tallyprime", {
      config: { companyName: "A Pvt Ltd" },
      mappings: used.map((a) => ({ accountId: a.accountId, externalCode: `${a.name} A/c` })),
    });
    const ready = await svc.previewExport(ctx, req);
    expect(ready.status.status).toBe("available");

    const job = await svc.generateExport(ctx, req);
    const xml = (await svc.downloadExportFile(ctx, job.id, "data")).content;
    expect(xml).toContain("<SVCURRENTCOMPANY>A Pvt Ltd</SVCURRENTCOMPANY>");
    expect(xml).toContain("<LEDGERNAME>HDFC Bank A/c</LEDGERNAME>");
    expect(xml).toMatch(/<NARRATION>[^<]*User A/); // creator mapped into a supported field
    expect(xml).not.toMatch(/<(CREATEDBY|CREATED_BY|createdBy)/); // no unsupported elements

    const auditFile = JSON.parse((await svc.downloadExportFile(ctx, job.id, "audit")).content);
    expect(JSON.stringify(auditFile)).toContain("User B");

    // Duplicate-export prevention: the same transactions are not exported to Tally twice.
    const again = await svc.previewExport(ctx, { ...req, excludeAlreadyExported: true });
    expect(again.counts.transactions).toBe(0);
  });

  it("clearly identifies unsupported integrations", async () => {
    const svc = await import("@/lib/export/service");
    const { exportRequestSchema } = await import("@/lib/export/filters");
    const ctx = await ctxFor(S.adminA, S.wsA);
    const req = exportRequestSchema.parse({ adapterKey: "sap", period: { kind: "fy", startYear: 2026 } });
    expect((await svc.previewExport(ctx, req)).status.status).toBe("not_implemented");
    await expect(svc.generateExport(ctx, req)).rejects.toThrow();
  });
});

describe("Scenario 8 — Audit trail on edit and reversal", () => {
  it("retains the original creator when an admin edits a draft", async () => {
    const ctxA = await ctxFor(S.userA, S.wsA);
    const cat = await m.prisma.accountCategory.findFirstOrThrow({ where: { workspaceId: S.wsA, name: "Fuel" } });
    const draft = await m.txns.createTransaction(ctxA, { type: "EXPENSE", date: "2026-10-14", amount: "1500.00", description: "Petrol", categoryId: cat.id, creditAccountId: S.hdfc }, { source: "TEXT", intent: "draft" });
    const ctxAdmin = await ctxFor(S.adminA, S.wsA);
    const edited = await m.txns.updateDraft(ctxAdmin, draft.id, { type: "EXPENSE", date: "2026-10-14", amount: "1650.00", description: "Petrol (corrected)", categoryId: cat.id, creditAccountId: S.hdfc }, "Receipt showed ₹1,650");
    expect(edited.createdById).toBe(S.userA);
    expect(edited.createdByName).toBe("User A");
    expect(edited.updatedById).toBe(S.adminA);
    const update = await m.prisma.auditEvent.findFirstOrThrow({ where: { transactionId: draft.id, action: "UPDATED" } });
    expect(update.actorUserId).toBe(S.adminA);
    expect(update.reason).toBe("Receipt showed ₹1,650");
    expect(update.before).toMatchObject({ amount: "1500.00", description: "Petrol" });
    expect(update.after).toMatchObject({ amount: "1650.00", description: "Petrol (corrected)" });
  });

  it("reverses a posted entry with a mirror journal, keeping the creator and logging the action", async () => {
    const ctxAdmin = await ctxFor(S.adminA, S.wsA);
    const reversed = await m.txns.reverseTransaction(ctxAdmin, S.txnA, "Recorded against the wrong bank");
    expect(reversed.status).toBe("REVERSED");
    expect(reversed.createdById).toBe(S.userA);
    const rev = await m.prisma.journalEntry.findUniqueOrThrow({ where: { id: reversed.reversalEntryId! }, include: { lines: { include: { account: true }, orderBy: { lineNo: "asc" } } } });
    expect(rev.type).toBe("REVERSAL");
    expect(rev.lines.map((l) => [l.account.code, l.debit.toFixed(2), l.credit.toFixed(2)])).toEqual([
      ["EXP-ELEC", "0.00", "2500.00"],
      ["BANK-HDFC", "2500.00", "0.00"],
    ]);
    const ev = await m.prisma.auditEvent.findFirstOrThrow({ where: { transactionId: S.txnA, action: "REVERSED" } });
    expect(ev).toMatchObject({ actorUserId: S.adminA, reason: "Recorded against the wrong bank", reversalId: rev.id });
    await expect(m.txns.reverseTransaction(ctxAdmin, S.txnA, "again")).rejects.toThrow(/only posted/i);
  });

  it("keeps attribution visible after the creator is deactivated, and audit rows are immutable", async () => {
    await m.prisma.workspaceMembership.update({ where: { workspaceId_userId: { workspaceId: S.wsA, userId: S.userA } }, data: { status: "DISABLED" } });
    const ctxAdmin = await ctxFor(S.adminA, S.wsA);
    const detail = await m.txns.getTransactionDetail(ctxAdmin, S.txnA);
    expect(detail?.txn.createdByName).toBe("User A");
    expect(detail?.txn.createdBy.email).toBe("user.a@a.test");
    expect(detail?.auditEvents.map((e) => e.action)).toEqual(["CREATED", "POSTED", "EXPORTED", "EXPORTED", "REVERSED"]);
    const any = await m.prisma.auditEvent.findFirstOrThrow({ where: { transactionId: S.txnA } });
    await expect(m.prisma.auditEvent.update({ where: { id: any.id }, data: { reason: "tamper" } })).rejects.toThrow(/append-only/);
    await expect(m.prisma.auditEvent.delete({ where: { id: any.id } })).rejects.toThrow(/append-only/);
    await expect(m.prisma.transaction.update({ where: { id: S.txnA }, data: { createdById: S.adminA } })).rejects.toThrow(/immutable/);
  });
});

describe("Accounting integrity", () => {
  it("routes large amounts through approval and blocks self-approval", async () => {
    await m.prisma.workspaceSettings.update({ where: { workspaceId: S.wsA }, data: { approvalThreshold: "100000.00" } });
    const ctxB = await ctxFor(S.userB, S.wsA);
    const cat = await m.prisma.accountCategory.findFirstOrThrow({ where: { workspaceId: S.wsA, name: "Service Revenue" } });
    const big = await m.txns.createTransaction(ctxB, { type: "INCOME", date: "2026-10-15", amount: "150000.00", description: "Big project", categoryId: cat.id, debitAccountId: S.hdfc }, { source: "MANUAL" });
    await expect(m.txns.postTransaction(ctxB, big.id)).rejects.toThrow(/needs approval/);
    await m.txns.submitTransaction(ctxB, big.id);
    const ctxAdmin = await ctxFor(S.adminA, S.wsA);
    const posted = await m.txns.decideApproval(ctxAdmin, big.id, "APPROVED", "OK", true);
    expect(posted.status).toBe("POSTED");
    expect(posted.approvedById).toBe(S.adminA);
    expect(posted.createdById).toBe(S.userB);
    await expect(m.txns.postTransaction(ctxAdmin, big.id)).rejects.toThrow(/already posted/);
  });

  it("produces a balanced trial balance and balance sheet", async () => {
    const tb = await m.reports.trialBalance(S.wsA, "2026-12-31");
    expect(tb.balanced).toBe(true);
    const bs = await m.reports.balanceSheet(S.wsA, "2026-12-31");
    expect(bs.balanced).toBe(true);
    const pl = await m.reports.profitAndLoss(S.wsA, "2026-04-01", "2027-03-31");
    expect(pl.totalIncome).toBe("225000.00");
    expect(pl.totalExpenses).toBe("0.00"); // the electricity expense was reversed
  });

  it("rejects an unbalanced journal at the database level", async () => {
    const acc = await m.prisma.account.findFirstOrThrow({ where: { workspaceId: S.wsA, code: "CASH" } });
    await expect(
      m.prisma.journalEntry.create({
        data: {
          workspaceId: S.wsA,
          number: 9999,
          date: new Date("2026-10-15"),
          description: "bad",
          totalDebit: "10.00",
          totalCredit: "10.00",
          postedById: S.adminA,
          postedByName: "Admin A",
          lines: { create: [{ workspaceId: S.wsA, accountId: acc.id, lineNo: 1, debit: "10.00", credit: "0" }, { workspaceId: S.wsA, accountId: S.hdfc, lineNo: 2, debit: "0", credit: "9.99" }] },
        },
      }),
    ).rejects.toThrow(/not balanced/);
  });
});
