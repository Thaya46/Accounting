/**
 * Seed: platform settings, permissions, adapters, the Super Admin, and (unless
 * SEED_DEMO=false) two demo workspaces with users and posted history.
 * Idempotent — safe to run more than once.
 *
 * Demo data goes through the same service layer as the app, so every demo
 * transaction has balanced journals, attribution and audit events.
 */
import "dotenv/config";
import { prisma } from "../src/lib/db";
import { hashPassword } from "../src/lib/auth/password";
import { ensurePermissions, provisionWorkspace } from "../src/lib/workspaces/provision";
import { ADAPTER_CATALOG } from "../src/lib/export/adapter-keys";
import { loadWorkspaceContext } from "../src/lib/auth/workspace";
import { createTransaction, decideApproval, reverseTransaction, type ServiceCtx } from "../src/lib/accounting/transactions";
import { setOpeningBalance } from "../src/lib/accounting/opening";
import { audit } from "../src/lib/audit";
import { addDays, todayInTimeZone } from "../src/lib/dates";

const SUPER_EMAIL = (process.env.SEED_SUPER_ADMIN_EMAIL ?? "superadmin@vledger.local").toLowerCase();
const SUPER_PASSWORD = process.env.SEED_SUPER_ADMIN_PASSWORD ?? "ChangeMe!2026";
const DEMO_PASSWORD = process.env.SEED_DEMO_PASSWORD ?? "Demo!2026pass";

async function ctxFor(userId: string, workspaceId: string): Promise<ServiceCtx> {
  const u = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  const result = await loadWorkspaceContext(
    { id: u.id, seq: u.seq, email: u.email, name: u.name, platformRole: u.platformRole, status: u.status, mfaEnabled: false },
    workspaceId,
  );
  if (!result.ok) throw new Error(`No access for ${u.email}: ${result.error}`);
  return { ...result.ctx, meta: { ip: "seed", userAgent: "prisma/seed.ts" } };
}

async function createUser(email: string, name: string, passwordHash: string) {
  return prisma.user.upsert({
    where: { email },
    create: { email, name, passwordHash, status: "ACTIVE", emailVerifiedAt: new Date() },
    update: {},
  });
}

async function addMember(workspaceId: string, userId: string, roleName: string, extra: { employeeId?: string; department?: string; grants?: string[] } = {}) {
  const role = await prisma.role.findUniqueOrThrow({ where: { workspaceId_name: { workspaceId, name: roleName } } });
  const grants = extra.grants?.length ? await prisma.permission.findMany({ where: { key: { in: extra.grants } } }) : [];
  return prisma.workspaceMembership.create({
    data: {
      workspaceId,
      userId,
      roleId: role.id,
      status: "ACTIVE",
      employeeId: extra.employeeId ?? null,
      department: extra.department ?? null,
      permissions: { create: grants.map((p) => ({ permissionId: p.id })) },
    },
  });
}

async function seedDemo(superAdminId: string) {
  if (await prisma.workspace.findUnique({ where: { code: "ABC" } })) {
    console.log("• Demo workspaces already exist — skipping demo data");
    return;
  }
  const superActor = { id: superAdminId, name: "Super Admin", email: SUPER_EMAIL };
  const today = todayInTimeZone("Asia/Kolkata");
  const pw = await hashPassword(DEMO_PASSWORD);

  // ── Workspace A ──
  const { workspace: abc } = await prisma.$transaction(
    (tx) =>
      provisionWorkspace(
        tx,
        { name: "ABC Technologies", code: "ABC", companyName: "ABC Technologies Pvt Ltd", companyEmail: "accounts@abc.test", country: "India", defaultCurrency: "INR", fyStartMonth: 4, timeZone: "Asia/Kolkata", status: "ACTIVE" },
        superAdminId,
      ),
    { timeout: 60_000, maxWait: 10_000 },
  );
  await audit(prisma, { workspaceId: abc.id, actor: superActor, entityType: "WORKSPACE", entityId: abc.id, action: "WORKSPACE_CREATED", after: { name: abc.name, code: abc.code }, ip: "seed" });
  await prisma.workspaceSettings.update({ where: { workspaceId: abc.id }, data: { autoPostEnabled: true, autoPostMinConfidence: 0.9, approvalThreshold: "200000.00" } });

  const adminA = await createUser("admin.a@abc.test", "Admin A", pw);
  const userA = await createUser("user.a@abc.test", "User A", pw);
  const userB = await createUser("user.b@abc.test", "User B", pw);
  const userC = await createUser("user.c@abc.test", "User C", pw);
  await addMember(abc.id, adminA.id, "Workspace Admin", { employeeId: "E-001", department: "Finance" });
  await addMember(abc.id, userA.id, "Accountant", { employeeId: "E-014", department: "Finance" });
  await addMember(abc.id, userB.id, "Staff", { employeeId: "E-022", department: "Sales", grants: ["TRANSACTION_POST"] });
  await addMember(abc.id, userC.id, "Staff", { employeeId: "E-031", department: "Operations" });

  const hdfc = await prisma.account.create({
    data: { workspaceId: abc.id, code: "BANK-HDFC", name: "HDFC Bank", type: "ASSET", subtype: "BANK", bankName: "HDFC Bank", accountNumberLast4: "4821" },
  });
  const icici = await prisma.account.create({
    data: { workspaceId: abc.id, code: "BANK-ICICI", name: "ICICI Bank", type: "ASSET", subtype: "BANK", bankName: "ICICI Bank", accountNumberLast4: "1907" },
  });
  await prisma.customer.createMany({ data: ["ABC Technologies Client Services", "Acme Corp", "Bright Solutions", "Nimbus Labs"].map((name) => ({ workspaceId: abc.id, name })) });
  await prisma.vendor.createMany({ data: ["Tata Power", "Shell Fuel Station", "WeWork", "Airtel"].map((name) => ({ workspaceId: abc.id, name })) });

  const ctxAdmin = await ctxFor(adminA.id, abc.id);
  const ctxA = await ctxFor(userA.id, abc.id);
  const ctxB = await ctxFor(userB.id, abc.id);
  const ctxC = await ctxFor(userC.id, abc.id);

  const fyStart = "2026-04-01";
  const cash = await prisma.account.findUniqueOrThrow({ where: { workspaceId_code: { workspaceId: abc.id, code: "CASH" } } });
  await setOpeningBalance(ctxAdmin, hdfc.id, "500000.00", fyStart);
  await setOpeningBalance(ctxAdmin, icici.id, "150000.00", fyStart);
  await setOpeningBalance(ctxAdmin, cash.id, "25000.00", fyStart);

  const cat = async (name: string) => (await prisma.accountCategory.findUniqueOrThrow({ where: { workspaceId_name: { workspaceId: abc.id, name } } })).id;
  const C = {
    rent: await cat("Rent Expense"),
    elec: await cat("Electricity Expense"),
    salary: await cat("Salaries"),
    fuel: await cat("Fuel"),
    software: await cat("Software"),
    internet: await cat("Internet & Phone"),
    meals: await cat("Meals & Entertainment"),
    service: await cat("Service Revenue"),
    sales: await cat("Sales Revenue"),
  };

  type Plan = { ctx: ServiceCtx; source: "VOICE" | "TEXT" | "MANUAL"; type: "INCOME" | "EXPENSE"; amount: string; date: string; description: string; categoryId: string; account: string; pm: string; party?: string; raw?: string };
  const plans: Plan[] = [];
  const months = ["2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"];
  months.forEach((m, i) => {
    const d = (day: number) => `${m}-${String(day).padStart(2, "0")}`;
    plans.push({ ctx: ctxAdmin, source: "MANUAL", type: "EXPENSE", amount: "15000.00", date: d(1), description: "Office Rent", categoryId: C.rent, account: hdfc.id, pm: "Bank Transfer", party: "WeWork" });
    if (d(1) < today || m !== "2026-10") plans.push({ ctx: ctxA, source: "MANUAL", type: "EXPENSE", amount: "120000.00", date: d(1), description: "Monthly Salaries", categoryId: C.salary, account: hdfc.id, pm: "Bank Transfer" });
    plans.push({ ctx: ctxA, source: "VOICE", type: "EXPENSE", amount: (2300 + i * 75).toFixed(2), date: d(5), description: "Office Electricity", categoryId: C.elec, account: hdfc.id, pm: "Bank Transfer", party: "Tata Power", raw: `Spent ${2300 + i * 75} rupees for office electricity through HDFC Bank` });
    plans.push({ ctx: ctxB, source: "TEXT", type: "EXPENSE", amount: "1500.00", date: d(8), description: "Petrol", categoryId: C.fuel, account: cash.id, pm: "Cash", party: "Shell Fuel Station", raw: "Paid 1500 for petrol by cash" });
    plans.push({ ctx: ctxB, source: "TEXT", type: "INCOME", amount: (50000 + i * 5000).toFixed(2), date: d(10), description: "Service Payment", categoryId: C.service, account: hdfc.id, pm: "Bank Transfer", party: "Acme Corp", raw: `Received ${50000 + i * 5000} from Acme Corp for service payment into HDFC Bank` });
    plans.push({ ctx: ctxA, source: "TEXT", type: "INCOME", amount: (75000 + (i % 3) * 25000).toFixed(2), date: d(12), description: "Website Development", categoryId: C.service, account: icici.id, pm: "Bank Transfer", party: "Bright Solutions" });
    plans.push({ ctx: ctxA, source: "MANUAL", type: "INCOME", amount: (95000 + i * 7000).toFixed(2), date: d(13), description: "Annual Support Contract", categoryId: C.service, account: hdfc.id, pm: "Bank Transfer", party: "Nimbus Labs" });
    plans.push({ ctx: ctxAdmin, source: "MANUAL", type: "EXPENSE", amount: "3499.00", date: d(14), description: "Cloud Hosting", categoryId: C.software, account: icici.id, pm: "Card" });
    if (i % 2 === 0) plans.push({ ctx: ctxB, source: "VOICE", type: "EXPENSE", amount: "1199.00", date: d(15), description: "Office Internet", categoryId: C.internet, account: hdfc.id, pm: "Bank Transfer", party: "Airtel", raw: "Paid internet bill 1199 via HDFC" });
    if (i % 3 === 1) plans.push({ ctx: ctxB, source: "TEXT", type: "INCOME", amount: "42000.00", date: d(18), description: "Product Sales", categoryId: C.sales, account: hdfc.id, pm: "UPI" });
  });

  let n = 0;
  for (const p of plans.filter((p) => p.date <= today)) {
    await createTransaction(
      p.ctx,
      {
        type: p.type,
        date: p.date,
        amount: p.amount,
        description: p.description,
        categoryId: p.categoryId,
        ...(p.type === "EXPENSE" ? { creditAccountId: p.account } : { debitAccountId: p.account }),
        paymentMethod: p.pm,
        ...(p.party ? (p.type === "INCOME" ? { customerName: p.party } : { vendorName: p.party }) : {}),
      },
      { source: p.source, intent: "post", rawInput: p.raw ?? null, aiConfidence: p.source === "MANUAL" ? null : 0.94 },
    );
    n++;
  }

  // Workflow examples: a draft, a pending approval, a reversal.
  await createTransaction(ctxC, { type: "EXPENSE", date: addDays(today, -1), amount: "860.00", description: "Team Lunch", categoryId: C.meals, creditAccountId: cash.id, paymentMethod: "Cash" }, { source: "TEXT", intent: "submit", rawInput: "Spent 860 on team lunch yesterday in cash", aiConfidence: 0.88 });
  await createTransaction(ctxC, { type: "EXPENSE", date: today, amount: "2400.00", description: "Courier Charges", creditAccountId: cash.id, paymentMethod: "Cash" }, { source: "MANUAL", intent: "draft" });
  const big = await createTransaction(ctxA, { type: "EXPENSE", date: addDays(today, -2), amount: "250000.00", description: "Laptops for new hires", debitAccountId: (await prisma.account.findUniqueOrThrow({ where: { workspaceId_code: { workspaceId: abc.id, code: "FA-EQUIP" } } })).id, creditAccountId: hdfc.id, paymentMethod: "Bank Transfer" }, { source: "MANUAL", intent: "submit" });
  void big;
  const wrong = await createTransaction(ctxB, { type: "EXPENSE", date: addDays(today, -6), amount: "1500.00", description: "Petrol", categoryId: C.fuel, creditAccountId: cash.id, paymentMethod: "Cash" }, { source: "VOICE", intent: "post", rawInput: "paid 1500 for petrol in cash", aiConfidence: 0.91 });
  await reverseTransaction(ctxA, wrong.id, "Duplicate of an entry already recorded the same day");
  const toReject = await createTransaction(ctxC, { type: "EXPENSE", date: addDays(today, -3), amount: "5400.00", description: "Client dinner", categoryId: C.meals, creditAccountId: cash.id, paymentMethod: "Cash" }, { source: "TEXT", intent: "submit" });
  await decideApproval(ctxAdmin, toReject.id, "REJECTED", "Please attach the bill and split personal expenses");
  console.log(`• Workspace ABC Technologies: ${n} posted transactions + workflow examples`);

  // ── Workspace B (for isolation testing) ──
  const { workspace: glx } = await prisma.$transaction(
    (tx) =>
      provisionWorkspace(
        tx,
        { name: "Globex Retail", code: "GLX", companyName: "Globex Retail LLP", companyEmail: "ops@globex.test", country: "India", defaultCurrency: "INR", fyStartMonth: 4, timeZone: "Asia/Kolkata", status: "ACTIVE" },
        superAdminId,
      ),
    { timeout: 60_000, maxWait: 10_000 },
  );
  await audit(prisma, { workspaceId: glx.id, actor: superActor, entityType: "WORKSPACE", entityId: glx.id, action: "WORKSPACE_CREATED", after: { name: glx.name, code: glx.code }, ip: "seed" });
  const adminB = await createUser("admin.b@globex.test", "Admin B", pw);
  await addMember(glx.id, adminB.id, "Workspace Admin", { employeeId: "G-001", department: "Accounts" });
  const ctxGB = await ctxFor(adminB.id, glx.id);
  const glxBank = await prisma.account.findUniqueOrThrow({ where: { workspaceId_code: { workspaceId: glx.id, code: "BANK-PRIMARY" } } });
  await setOpeningBalance(ctxGB, glxBank.id, "300000.00", fyStart);
  const glxSales = await prisma.accountCategory.findUniqueOrThrow({ where: { workspaceId_name: { workspaceId: glx.id, name: "Sales Revenue" } } });
  const glxRent = await prisma.accountCategory.findUniqueOrThrow({ where: { workspaceId_name: { workspaceId: glx.id, name: "Rent Expense" } } });
  for (const m of ["2026-08", "2026-09", "2026-10"]) {
    await createTransaction(ctxGB, { type: "INCOME", date: `${m}-05`, amount: "180000.00", description: "Store Sales", categoryId: glxSales.id, debitAccountId: glxBank.id, paymentMethod: "UPI" }, { source: "MANUAL", intent: "post" });
    await createTransaction(ctxGB, { type: "EXPENSE", date: `${m}-02`, amount: "40000.00", description: "Shop Rent", categoryId: glxRent.id, creditAccountId: glxBank.id, paymentMethod: "Bank Transfer" }, { source: "MANUAL", intent: "post" });
  }
  console.log("• Workspace Globex Retail created (isolation test workspace)");

  // Archived & suspended examples for the Super Admin dashboard.
  await prisma.$transaction(
    (tx) =>
      provisionWorkspace(
        tx,
        { name: "Initech Services", code: "INI", companyName: "Initech Services Pvt Ltd", companyEmail: "finance@initech.test", country: "India", defaultCurrency: "INR", fyStartMonth: 4, timeZone: "Asia/Kolkata", status: "SUSPENDED" },
        superAdminId,
      ),
    { timeout: 60_000, maxWait: 10_000 },
  );
}

async function main() {
  console.log("Seeding VLedger AI…");
  await prisma.platformSettings.upsert({ where: { id: "platform" }, create: {}, update: {} });
  await ensurePermissions(prisma);
  for (const a of ADAPTER_CATALOG) {
    await prisma.integrationAdapter.upsert({ where: { key: a.key }, create: { key: a.key, name: a.name }, update: { name: a.name } });
  }

  let superAdmin = await prisma.user.findUnique({ where: { email: SUPER_EMAIL } });
  if (!superAdmin) {
    superAdmin = await prisma.user.create({
      data: { email: SUPER_EMAIL, name: "Super Admin", passwordHash: await hashPassword(SUPER_PASSWORD), platformRole: "SUPER_ADMIN", status: "ACTIVE", emailVerifiedAt: new Date() },
    });
    console.log(`• Super Admin created: ${SUPER_EMAIL} (MFA setup is required at first sign-in)`);
  } else {
    console.log(`• Super Admin exists: ${SUPER_EMAIL}`);
  }

  if (process.env.SEED_DEMO !== "false") await seedDemo(superAdmin.id);
  console.log("✔ Seed complete");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
