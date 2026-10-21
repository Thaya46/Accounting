# VLedger AI

Multi-workspace, AI-assisted **double-entry accounting** web application. Every transaction is traceable to the person who created it, every posting is balanced, and accounting data exports to a canonical JSON model with adapters for third-party accounting software.

Built with Next.js 15 (App Router) · TypeScript · React 19 · Tailwind CSS v4 · shadcn-style UI on Radix · Recharts · Framer Motion · Prisma 6 · PostgreSQL · Zod · Brevo email · optional Claude / OpenAI-compatible AI.

---

## Features

| Area | What you get |
|---|---|
| **Super Admin** | Separate console: create/edit workspaces (auto-provisions chart of accounts, roles, settings), activate/suspend/archive, assign Workspace Admins via Brevo invitations, platform settings and accounting defaults, export-integration availability, system activity log, usage monitoring, email outbox. |
| **Workspace Admin** | Users & invitations, roles and granular permissions, chart of accounts with opening balances, bank/cash accounts, categories (with AI keywords), customers & vendors, workspace settings (approvals, auto-posting, MFA policy, summaries), audit log, integrations. |
| **Users** | Dashboard, AI expense/income entry, voice entry, manual entry, My Transactions, transaction details, profile, security (MFA, password, sessions), workspace switcher. |
| **Attribution & audit** | Created-by always taken from the server session (ID + name snapshot), last-modified/approved/posted/reversed by, entry source (voice/text/manual/import). Append-only audit history enforced by a PostgreSQL trigger; posted entries are immutable and corrected by reversal/adjustment. |
| **AI accounting** | Browser speech-to-text, natural-language extraction, category prediction, account selection, duplicate detection, review before posting, clarification questions instead of guessing, configurable auto-posting for high-confidence complete entries. Works fully **without a paid API key** (built-in rule engine); Claude or any OpenAI-compatible endpoint (e.g. local Ollama) can be enabled. |
| **Double-entry engine** | Chart of accounts, general ledger, journal entries/lines, trial balance, balance sheet, P&L, cash flow, reconciliation, opening balances, transfers, adjustments, reversals. Fixed-precision decimals, atomic multi-line postings, balance validated in code **and** by a deferred database constraint. |
| **Export / import** | Canonical JSON (retains creator info), CSV, TallyPrime XML, Zoho Books / QuickBooks Online journal payloads, Xero manual-journal CSV, a configurable custom CSV, plus documented-but-not-implemented adapters (BUSY, SAP, Dynamics) clearly labelled. Separate audit-metadata file with every export, duplicate-export prevention, export history. JSON import with schema/workspace validation, mapping, duplicate detection and provenance. |
| **Security** | Email/password (scrypt), TOTP MFA (required for Super Admin and Workspace Admins) with recovery codes, server-side sessions (httpOnly cookie, hashed tokens), DB-backed rate limiting, account lockout, suspicious-login alerts, invitation-only onboarding (no passwords by email), same-origin checks on mutations, strict security headers. |

---

## Quick start (Windows or macOS, no Docker)

Requirements: **Node.js 20+** (tested on Node 24) and npm.

```bash
npm install
```

1. **Configure** — copy `.env.example` to `.env` and set at least `APP_ENCRYPTION_KEY`:
   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
   ```
   * **Database** — either point `DATABASE_URL`/`DIRECT_DATABASE_URL` at any PostgreSQL 14+ server, **or** keep the defaults to use the bundled local PostgreSQL (real PostgreSQL 17 binaries installed through npm via `embedded-postgres`; data in `./.pgdata`).
   * **Email** — set `BREVO_API_KEY` (an `xkeysib-…` API key) **or** an SMTP key (`xsmtpsib-…`) plus `BREVO_SMTP_LOGIN`, and a verified `BREVO_SENDER_EMAIL`. Without email configured, messages are kept in the Super Admin **Email outbox** (dev only) so invitation links still work.
2. **Set up the database** (migrations + seed):
   ```bash
   npm run setup
   ```
3. **Run**:
   ```bash
   npm run dev
   ```
   Open http://localhost:3000. `npm run dev` also starts the bundled PostgreSQL when `DATABASE_URL` points at it.

### Demo accounts (seeded)

| Role | Email | Password |
|---|---|---|
| Super Admin | `superadmin@vledger.local` | `SEED_SUPER_ADMIN_PASSWORD` (default `ChangeMe!2026`) |
| Workspace Admin — ABC Technologies | `admin.a@abc.test` | `SEED_DEMO_PASSWORD` (default `Demo!2026pass`) |
| Accountant — ABC Technologies | `user.a@abc.test` | same |
| Staff (+Post permission) — ABC Technologies | `user.b@abc.test` | same |
| Staff — ABC Technologies | `user.c@abc.test` | same |
| Workspace Admin — Globex Retail | `admin.b@globex.test` | same |

Admins must enrol an authenticator app on first sign-in (any TOTP app: Google/Microsoft Authenticator, Authy, 1Password). Skip demo data with `SEED_DEMO=false npm run db:seed`. **Change or remove demo accounts before production.**

---

## Scripts

| Command | Purpose |
|---|---|
| `npm run dev` | Dev server with Turbopack (+ bundled PostgreSQL if configured) |
| `npm run dev:webpack` | Dev server with the classic webpack compiler (fallback) |
| `npm run setup` | Apply migrations and seed |
| `npm run db:start` | Run the bundled PostgreSQL in the foreground |
| `npm run db:migrate` | `prisma migrate deploy` |
| `npm run db:seed` | Seed (idempotent) |
| `npm run superadmin:reset` | Set the Super Admin email/password from `.env`, reset their MFA and sign them out (lock-out recovery) |
| `npm run summaries -- daily\|monthly` | Send scheduled summary emails (run from cron / Task Scheduler) |
| `npm run build` / `npm start` | Production build / server (`npm start` needs a build; running `npm run dev` replaces it) |
| `npm run prod` | Build and start the production server in one step |
| `npm run typecheck` | TypeScript check |
| `npm test` | All tests (unit + scenarios) |
| `npm run test:unit` | Pure unit tests |
| `npm run test:scenarios` | End-to-end business scenarios on a fresh, throwaway database |

The scenario suite creates a new database on the `TEST_DATABASE_URL` server for every run (starting the bundled PostgreSQL if needed), migrates it, runs the specification's workflows (Super Admin + MFA, invitations, voice expense, income by a second user, workspace isolation, audit trail on edit/reversal, approvals, DB-level integrity) and drops it afterwards. It never touches `DATABASE_URL`.

---

## Performance note

Included relations are loaded with SQL joins (Prisma `relationJoins`), so each request makes only a few round trips. In development the first visit to each page also compiles it (a few seconds); later visits are fast, and `npm run build && npm start` avoids compilation entirely. Each page performs several database queries. Keep the application server in the same region as PostgreSQL: with a database on another continent (≈230 ms per round trip) pages take a few seconds, while a co-located deployment responds in a few hundred milliseconds.

## Documentation

* [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — structure, security model, conventions.
* [`docs/API.md`](docs/API.md) — REST API reference.
* [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) — production deployment.
* [`docs/REQUIREMENTS.md`](docs/REQUIREMENTS.md) — the original specification.

## Project layout

```
prisma/            schema, migrations (incl. integrity triggers), seed
scripts/           local PostgreSQL launcher, dev runner, setup
src/app/(auth)/    sign-in, MFA, invitations, password reset
src/app/admin/     Super Admin console
src/app/w/[id]/    workspace application
src/app/api/       route handlers
src/lib/           auth, accounting engine, AI, email, export/import, permissions
src/components/    UI kit, app shell, feature components
tests/             unit + scenario tests
```
