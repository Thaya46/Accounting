# VLedger AI — Architecture & Conventions

## Stack
Next.js 15 (App Router, React 19, TypeScript strict) · Tailwind CSS v4 · shadcn-style components on Radix (`radix-ui`) · lucide-react · framer-motion · Recharts 2 · Zod 3 · Prisma 6 + PostgreSQL · Brevo (API or SMTP relay) · optional Claude / OpenAI-compatible AI.

## Directory map
```
prisma/schema.prisma            data model (23+ tables)
prisma/migrations/*             SQL migrations incl. integrity triggers
prisma/seed.ts                  platform seed + demo workspaces
scripts/                        local-postgres (no Docker), dev, setup
src/app/(auth)/…                login, mfa, setup-mfa, invite/[token], forgot/reset password
src/app/admin/…                 Super Admin console (separate layout)
src/app/w/[workspaceId]/…       Workspace app (separate layout, per-workspace URLs)
src/app/api/…                   Route handlers (REST JSON)
src/lib/                        server logic (see below)
src/components/ui/              design system primitives
src/components/shell/           AppShell, nav config, page transitions
tests/unit, tests/scenarios     Vitest
```

## Security model (do not bypass)
* **Every workspace page** calls `requireWorkspace(workspaceId, permission?)` from `@/lib/auth/guards` (redirects on failure).
* **Every workspace API route** is wrapped with `route()` and calls `apiWorkspace(workspaceId, permission?)` from `@/lib/api` (403 on failure). Super Admin APIs use `apiSuperAdmin()`.
* The returned `WorkspaceContext` (`ctx`) is the only source of identity: `ctx.actor` ({id,name,email}) for attribution, `ctx.workspace.id` for scoping, `ctx.permissions` (Set of `PermissionKey`).
* **Every Prisma query on workspace data filters by `workspaceId: ctx.workspace.id`**, including lookups by id (`findFirst({ where: { id, workspaceId } })`, never `findUnique({ where: { id } })` alone).
* Never accept `createdById`, `workspaceId` or actor names from request bodies.
* Super Admins are not workspace members and do not see workspace financial records — only counts/usage.
* Mutations write an audit event via `audit(db, {...})` from `@/lib/audit` (append-only; DB trigger blocks UPDATE/DELETE).
* Permission keys: see `src/lib/permissions.ts`. UI hides controls the user lacks, but the server always re-checks.

## Accounting rules
* Money is `Decimal(18,2)` in the DB; in TS use `@/lib/money` (`dec`, `money2` → "2500.00", `formatMoney(amount, currency)`). Send amounts to the client as strings.
* Dates are calendar dates (`@db.Date`); use `@/lib/dates` (`parseISODate`, `isoDate`, `formatDate`, `todayInTimeZone(ws.timeZone)`, `financialYearFor`, `financialYearRange`).
* Transactions go through `@/lib/accounting/transactions` (`createTransaction`, `updateDraft`, `submitTransaction`, `decideApproval`, `postTransaction`, `reverseTransaction`, `getTransactionDetail`, `findPossibleDuplicates`, `transactionInputSchema`, `intentSchema`). Never write `transactions`/`journal_*` tables directly.
* Posted entries are immutable (DB triggers). Corrections = reversal or adjustment journal.
* Reports: `@/lib/accounting/reports` (`trialBalance`, `profitAndLoss`, `balanceSheet`, `cashFlow`, `generalLedger`, `journalRegister`, `monthlyTrend`, `expenseBreakdown`, `cashAndBankBalances`, `incomeExpenseTotals`, `accountBalances`).
* Opening balances: `@/lib/accounting/opening` → `setOpeningBalance(ctx, accountId, amount, date)`.
* Status flow: DRAFT → (submit) PENDING_APPROVAL → APPROVED/REJECTED → POSTED → REVERSED. Users with `TRANSACTION_POST` may post a DRAFT directly unless approval is required (workspace setting or threshold).

## Route handler pattern
```ts
// src/app/api/w/[workspaceId]/things/route.ts
import { z } from "zod";
import { prisma } from "@/lib/db";
import { apiWorkspace, json, parseBody, route, notFound } from "@/lib/api";
import { audit } from "@/lib/audit";

export const GET = route(async (_req, { workspaceId }) => {
  const ctx = await apiWorkspace(workspaceId, "ACCOUNTS_MANAGE");
  return json({ items: await prisma.thing.findMany({ where: { workspaceId: ctx.workspace.id } }) });
});

const schema = z.object({ name: z.string().trim().min(1).max(120) });
export const POST = route(async (req, { workspaceId }) => {
  const ctx = await apiWorkspace(workspaceId, "ACCOUNTS_MANAGE");
  const body = await parseBody(req, schema);
  const created = await prisma.$transaction(async (tx) => {
    const t = await tx.thing.create({ data: { workspaceId: ctx.workspace.id, ...body } });
    await audit(tx, { workspaceId: ctx.workspace.id, actor: ctx.actor, entityType: "THING", entityId: t.id, action: "THING_CREATED", after: body, ip: ctx.meta.ip, userAgent: ctx.meta.userAgent });
    return t;
  });
  return json({ item: created }, 201);
});
```
`route()` passes resolved params as the second argument, rejects cross-origin mutations, and converts `ApiError`/Zod/Prisma errors to JSON `{ error: { code, message, details } }`. Throw `badRequest()`, `forbidden()`, `notFound()`, `conflict()` from `@/lib/api`.

## Page pattern (Next 15: `params`/`searchParams` are Promises)
```tsx
export const metadata = { title: "Things" };
export default async function Page({ params, searchParams }: { params: Promise<{ workspaceId: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { workspaceId } = await params;
  const ctx = await requireWorkspace(workspaceId, "ACCOUNTS_MANAGE");
  const data = await prisma.thing.findMany({ where: { workspaceId: ctx.workspace.id } });
  return (<><PageHeader title="Things" description="…" actions={…} /><ThingsClient workspaceId={workspaceId} initial={serialize(data)} /></>);
}
```
Pass only plain JSON to client components (convert `Decimal` → string, `Date` → ISO string). Client components mutate via `apiFetch(url, { method, body })` from `@/lib/client/api`, show `toast.success/error` (sonner), then `router.refresh()`.

## UI kit (`src/components/ui`)
* `button.tsx` — `Button` (variants: default, destructive, outline, secondary, ghost, link, success; sizes: default, sm, lg, icon, icon-sm; `loading`, `asChild`).
* `card.tsx` — `Card`, `CardHeader`, `CardTitle`, `CardDescription`, `CardContent`, `CardFooter`.
* `input.tsx` — `Input`, `Textarea`, `NativeSelect` (styled `<select>`).
* `misc.tsx` — `Label`, `Separator`, `Switch`, `Checkbox`, `Tooltip`, `Avatar`.
* `badge.tsx` — `Badge` (default, secondary, outline, success, danger, warning, info, muted), `StatusBadge`, `TypeBadge`, `SourceBadge`.
* `table.tsx` — `Table`, `THead`, `TBody`, `TFoot`, `TR`, `TH`, `TD`.
* `overlay.tsx` — `Dialog`, `DialogTrigger`, `DialogContent` (requires `title`), `DialogFooter`, `DialogClose`, `DropdownMenu*`, `Tabs`, `TabsList`, `TabsTrigger`, `TabsContent`, `Popover*`, `SheetContent`.
* `feedback.tsx` — `Skeleton`, `TableSkeleton`, `Alert` (info/success/warning/danger), `EmptyState`, `PageHeader`, `FormField`.
* Colors: semantic tokens only (`bg-card`, `text-muted-foreground`, `text-income`, `text-expense`, `bg-income-soft`, `bg-expense-soft`, `text-primary`, `border`, `bg-muted`, chart colors `var(--chart-1..5)`). Income = green, expense = red. Both light and dark themes must look right — never hard-code light-only colors.
* Use `tabular` class for numeric columns; right-align amounts.
* Mobile: layouts must work at 375 px (stack grids, tables scroll horizontally).

## Identifiers
`@/lib/ids`: `workspaceRef(seq)` → WS-001, `userRef(seq)` → USR-001, `txnRef(number)` → TXN-0001, `journalRef(number)` → JE-0001.
