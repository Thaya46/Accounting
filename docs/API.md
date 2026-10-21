# VLedger AI — REST API

All endpoints are JSON over HTTPS under `/api`. Authentication uses the `vl_session` httpOnly cookie set by sign-in; there are no bearer tokens. Mutating requests (`POST`, `PATCH`, `PUT`, `DELETE`) must be same-origin — a mismatching `Origin` header is rejected with `403`.

## Conventions

* **Errors** — `{ "error": { "code": "VALIDATION_ERROR" | "BAD_REQUEST" | "UNAUTHENTICATED" | "MFA_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "CONFLICT" | "APPROVAL_REQUIRED" | "RATE_LIMITED" | "INTEGRITY_ERROR" | "INTERNAL", "message": "…", "details": … } }` with the matching HTTP status (400, 401, 403, 404, 409, 422, 429, 500).
* **Amounts** are decimal strings with two places (`"2500.00"`). **Dates** are `YYYY-MM-DD`; timestamps are ISO 8601 UTC.
* **Workspace isolation** — every `/api/w/{workspaceId}/…` route checks that the signed-in user is an ACTIVE member of an ACTIVE workspace and holds the listed permission. Otherwise `403 Access denied`. Records from other workspaces are never returned (`404`).
* **Attribution** — `createdBy`, actor names and workspace IDs are always taken from the session; such fields in request bodies are ignored or rejected.
* **Permissions** — `TRANSACTION_CREATE`, `TRANSACTION_VIEW`, `TRANSACTION_EDIT_DRAFT`, `TRANSACTION_POST`, `TRANSACTION_REVERSE`, `TRANSACTION_APPROVE`, `REPORTS_VIEW`, `DATA_EXPORT`, `DATA_IMPORT`, `ACCOUNTS_MANAGE`, `USERS_MANAGE`, `AUDIT_VIEW`, `SETTINGS_MANAGE`.

## Authentication

| Method | Path | Body | Notes |
|---|---|---|---|
| POST | `/api/auth/login` | `{ email, password }` | Rate-limited (per IP and per email), lockout after 5 failures for 15 min. Returns `{ next }` — `/mfa`, `/setup-mfa`, or the home path. Sends a new-sign-in alert when the IP changes. |
| POST | `/api/auth/logout` | — | Revokes the current session. |
| POST | `/api/auth/mfa/verify` | `{ code, recovery? }` | Completes sign-in with a TOTP code or a single-use recovery code. TOTP codes cannot be replayed. |
| GET | `/api/auth/mfa/setup` | — | Starts enrolment: `{ secret, otpauthUri, qrDataUrl }` (the pending secret is reused until enabled). |
| POST | `/api/auth/mfa/setup` | `{ code }` | Enables MFA; returns `{ recoveryCodes[10], next }` (shown once). |
| POST | `/api/auth/forgot-password` | `{ email }` | Always `200` with a generic message. Emails a 30-minute single-use link via Brevo. |
| POST | `/api/auth/reset-password` | `{ token, password }` | Sets a new password and signs out all sessions. |
| POST | `/api/auth/invite/accept` | `{ token, name, password }` | Accepts an invitation (verifies the email, activates the account, creates a session). Existing users confirm their current password. |

## Account (signed-in user)

| Method | Path | Body | Notes |
|---|---|---|---|
| GET | `/api/account` | — | Profile and memberships. |
| PATCH | `/api/account` | `{ name }` | Updates the display name (past transactions keep their name snapshot). |
| GET | `/api/account/security` | — | `{ mfaEnabled, mfaRequired, recoveryCodesRemaining, sessions[] }` |
| POST | `/api/account/security` | `{ action: "change_password", currentPassword, newPassword }` | Signs out other sessions. |
|  |  | `{ action: "regenerate_recovery_codes", code }` | Requires a current TOTP code. |
|  |  | `{ action: "disable_mfa", password, code }` | Refused when policy requires MFA. |
|  |  | `{ action: "revoke_session", sessionId }` / `{ action: "revoke_other_sessions" }` | |

## Super Admin (`/api/admin`, Super Admin session required)

| Method | Path | Body / query | Notes |
|---|---|---|---|
| GET | `/workspaces?q=&status=&page=` | — | Workspaces with member counts and admins (no financial records). |
| POST | `/workspaces` | `{ name, code, companyName, companyEmail, country, defaultCurrency, fyStartMonth, timeZone, adminName, adminEmail, status: "ACTIVE"\|"SUSPENDED" }` | `201 { workspace, invitation, delivery }`. One DB transaction: workspace + unique ID + settings + roles + chart of accounts + categories + pending Workspace Admin invitation; audit `WORKSPACE_CREATED`; Brevo email after commit. `409` duplicate code. |
| GET | `/workspaces/{workspaceId}` | — | Details, admins, invitations (with delivery), usage metrics, status history. |
| PATCH | `/workspaces/{workspaceId}` | partial `{ name, companyName, companyEmail, country, defaultCurrency, fyStartMonth, timeZone }` | Currency is locked once the workspace has postings; archived workspaces are read-only. |
| POST | `/workspaces/{workspaceId}/status` | `{ status: "ACTIVE"\|"SUSPENDED"\|"ARCHIVED", reason }` | Audit `WORKSPACE_STATUS_CHANGED`. Members of suspended/archived workspaces lose access immediately. |
| POST | `/workspaces/{workspaceId}/admins` | `{ name, email }` | Invites an additional Workspace Admin. |
| POST | `/invitations/{invitationId}/resend` | `{}` | Fresh single-use link; the old one is revoked. |
| POST | `/invitations/{invitationId}/revoke` | `{ reason? }` | |
| GET / PATCH | `/settings` | partial platform settings | Defaults for new workspaces, MFA-for-all, session and invitation lifetimes, self-service reset. GET also returns email transport and AI provider status. |
| GET | `/activity?q=&actor=&workspace=<id\|platform>&from=&to=&entity=&page=` | — | System activity log (50/page). Transaction payloads are redacted for the Super Admin. |
| POST | `/outbox/test` | `{ to }` | Sends a test email and returns the delivery result. |

## Workspace administration (`/api/w/{workspaceId}`)

| Method | Path | Permission | Body / query |
|---|---|---|---|
| GET | `/members` | USERS_MANAGE | Members with role, extra permissions, status, MFA, last login. |
| POST | `/members` | USERS_MANAGE | `{ name, email, employeeId?, department?, roleId, permissionKeys?[] }` → invitation + `delivery { status, error? }`. Creates a pending invitation emailed via Brevo (never a password). 60/hour per workspace. |
| PATCH | `/members/{membershipId}` | USERS_MANAGE | `{ action: "update", roleId, permissionKeys[], employeeId?, department? }` · `{ action: "disable", reason }` · `{ action: "reactivate", reason? }`. Cannot disable yourself or the last Workspace Admin; non-admin managers cannot grant permissions they lack or assign the admin role. |
| GET | `/invitations` | USERS_MANAGE | All invitations with computed `EXPIRED` status and delivery status. |
| POST | `/invitations/{invitationId}/resend` | USERS_MANAGE | Issues a fresh single-use link (previous one revoked). |
| POST | `/invitations/{invitationId}/revoke` | USERS_MANAGE | `{ reason? }` |
| GET / POST | `/roles` | USERS_MANAGE | POST `{ name, description?, permissionKeys[] }` |
| PATCH / DELETE | `/roles/{roleId}` | USERS_MANAGE | PATCH `{ name?, description?, permissionKeys?[] }`. The Workspace Admin role is locked; system roles cannot be deleted; roles in use cannot be deleted. |
| GET | `/accounts` | ACCOUNTS_MANAGE or REPORTS_VIEW | Chart of accounts with natural balances. |
| POST | `/accounts` | ACCOUNTS_MANAGE | `{ code, name, type, subtype?, description?, bankName?, accountNumberLast4?, isActive? }` |
| PATCH | `/accounts/{accountId}` | ACCOUNTS_MANAGE | Same fields. Type is fixed once the account has postings; system accounts cannot be deactivated. |
| POST | `/accounts/{accountId}/opening-balance` | ACCOUNTS_MANAGE | `{ amount, date }` — posts an OPENING journal against Opening Balance Equity (a change reverses the previous one). |
| GET / POST | `/categories` | ACCOUNTS_MANAGE | POST `{ name, kind: "INCOME"\|"EXPENSE", accountId, keywords?[], isActive? }` — account must match the kind. |
| PATCH / DELETE | `/categories/{categoryId}` | ACCOUNTS_MANAGE | DELETE only when never used (deactivate otherwise). |
| GET / POST | `/contacts?kind=customer\|vendor` | ACCOUNTS_MANAGE | `{ name, email?, phone?, taxId? }` |
| PATCH | `/contacts/{contactId}?kind=` | ACCOUNTS_MANAGE | Same fields. |
| GET / PATCH | `/settings` | SETTINGS_MANAGE | `{ autoPostEnabled, autoPostMinConfidence, requireApproval, approvalThreshold, duplicateWindowDays, mfaRequiredForUsers, dailySummaryEmail, monthlySummaryEmail }` (any subset). |
| POST | `/settings/summary` | SETTINGS_MANAGE | `{ period: "daily"\|"monthly" }` — emails today's / month-to-date totals to active admins now. |
| GET | `/audit` | AUDIT_VIEW | `actor, action, entity, q (TXN-0001 or an ID), from, to, page` — 50 per page, workspace time zone day boundaries. |

## Scheduler

| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | `/api/cron/summaries?period=daily\|monthly` | `Authorization: Bearer <CRON_SECRET>` | Sends the previous day's / month's summary to every opted-in workspace. Disabled (404) when `CRON_SECRET` is unset. |

## Transactions, AI entry and approvals (`/api/w/{workspaceId}`)

| Method | Path | Permission | Body / query |
|---|---|---|---|
| GET | `/transactions` | member | Filters: `createdById` (needs TRANSACTION_VIEW), `from`, `to`, `categoryId`, `minAmount`, `maxAmount`, `type`, `source`, `status`, `q` (text or `TXN-0001`), `sort`, `page`, `mine=1`. Without TRANSACTION_VIEW only the caller's own entries are returned. Response: rows (Date, Description, Amount, Type, Entered By, Status, …), totals, paging, member list. |
| POST | `/transactions` | TRANSACTION_CREATE | `{ input, intent: "draft"\|"submit"\|"post"\|"auto", source: "MANUAL"\|"TEXT"\|"VOICE", rawInput?, aiConfidence? }` → `201 { transaction, duplicates, autoPosted }`. `input` = `{ type: INCOME\|EXPENSE\|TRANSFER\|JOURNAL, date, amount?, currency?, exchangeRate?, description, categoryId?, debitAccountId?, creditAccountId?, lines?[{accountId, debit, credit, description?}], isAdjustment?, paymentMethod?, reference?, notes?, customerName?, vendorName? }`. Created-by fields are never accepted. |
| GET | `/transactions/{id}` | own entry or TRANSACTION_VIEW | Full metadata, journal (posted or proposed lines), reversal, approvals, append-only audit history. Others' entries → 404. |
| PATCH | `/transactions/{id}` | TRANSACTION_EDIT_DRAFT | `{ input, reason? }` — drafts/rejected only; creator is preserved; audit `UPDATED` with before/after + reason. |
| POST | `/transactions/{id}/submit` | TRANSACTION_CREATE or TRANSACTION_EDIT_DRAFT | Draft → pending approval (`SUBMITTED`). |
| POST | `/transactions/{id}/approve` | TRANSACTION_APPROVE | `{ decision: "APPROVED"\|"REJECTED", comment?, post? }` — comment required to reject; self-approval blocked for non-admins; `post: true` also posts (needs TRANSACTION_POST). |
| POST | `/transactions/{id}/post` | TRANSACTION_POST | Creates the balanced journal atomically. `409 APPROVAL_REQUIRED` when the workspace policy/threshold (compared in base currency) requires approval first. |
| POST | `/transactions/{id}/reverse` | TRANSACTION_REVERSE | `{ reason, date? }` — mirror-image REVERSAL journal; original entry untouched. |
| POST | `/transactions/check-duplicates` | TRANSACTION_CREATE or TRANSACTION_EDIT_DRAFT | `{ type, amount, date, description, excludeId? }` — other users' matches are redacted for callers without TRANSACTION_VIEW. |
| POST | `/ai/parse` | TRANSACTION_CREATE | `{ text (1–1000 chars), source: "TEXT"\|"VOICE" }` → `{ parsed, duplicates, provider }`. `parsed` includes fields, per-field confidence, `missing[]` and `clarifications[]` (questions instead of guesses). 60/min per user. |
| GET | `/approvals` | TRANSACTION_APPROVE | `{ pending, approved, canPost, isAdmin }` |

## Dashboards, reports and reconciliation (`/api/w/{workspaceId}`)

| Method | Path | Permission | Body / query |
|---|---|---|---|
| GET | `/dashboard` | member | `view: "workspace"` (with REPORTS_VIEW: KPIs, bank & cash balances, monthly trend, expense breakdown, recent transactions, transactions by user, pending approvals, export history) or `view: "personal"` (my transactions, my recorded income/expenses, recent activity). |
| GET | `/reports/{report}` | REPORTS_VIEW | `report` ∈ `profit-and-loss`, `balance-sheet`, `trial-balance`, `cash-flow`, `general-ledger`, `journal`. Query: `period=fy\|prev-fy\|this-month\|last-month\|custom`, `from`, `to`, `asOf`, `accountId`. Computed from posted journal entries only. |
| GET | `/reconciliations?accountId=` | REPORTS_VIEW or ACCOUNTS_MANAGE | Reconciliation history for a bank/cash/wallet/card account. |
| POST | `/reconciliations` | ACCOUNTS_MANAGE | `{ accountId, statementDate, statementBalance, lineIds[], acceptDifference? }` → `201`. Lines must belong to the account, be unreconciled and dated on/before the statement date; a non-zero difference returns `409` unless `acceptDifference` is set (the difference is recorded). |

## Export, integrations and import (`/api/w/{workspaceId}`)

Export request body (preview and generate):
`{ adapterKey, exportType: "accounting_transactions"|"journal_entries"|"account_ledger", period: { kind: "fy", startYear } | { kind: "custom", from, to }, types[], statuses[] (default POSTED, REVERSED), createdById?, categoryIds[], accountIds[], excludeAlreadyExported, includeAuditTrail }`

| Method | Path | Permission | Notes |
|---|---|---|---|
| POST | `/export/preview` | DATA_EXPORT | Builds the canonical export, re-validates every journal's balance, computes the adapter status (Available / Configuration Required / Validation Failed / Not Implemented / Disabled), accounts used + mappings, counts and a file excerpt. Nothing is stored. |
| POST | `/export` | DATA_EXPORT | Generates and stores the export job, the data file, the separate `*.audit.json` metadata file and a SHA-256 checksum; records `EXPORTED` per transaction and `EXPORT_CREATED`. `422 EXPORT_BLOCKED` with issues when the adapter is not Available or validation fails. |
| GET | `/export?take=` | DATA_EXPORT | Export history. |
| GET | `/export/{jobId}/download?file=data\|audit` | DATA_EXPORT | Downloads a stored file (audited as `EXPORT_DOWNLOADED`). |
| GET | `/integrations` | DATA_EXPORT or SETTINGS_MANAGE | All adapters with spec metadata and workspace status. |
| GET / PUT | `/integrations/{adapterKey}` | DATA_EXPORT or SETTINGS_MANAGE | PUT `{ config?, mappings?: [{ accountId, externalCode, externalName? }] }` — `config` needs SETTINGS_MANAGE; an empty `externalCode` removes a mapping. |
| GET | `/import` | DATA_IMPORT | Import history. |
| POST | `/import/preview` | DATA_IMPORT | `{ fileName, content }` (canonical JSON ≤ 5 MB). Schema + workspace validation, account mapping by code, category mapping by name, duplicate detection (external reference, duplicate hash, within file), balance checks. Creates an ImportJob in PREVIEW. |
| GET | `/import/{jobId}` | DATA_IMPORT | Job, preview and results. |
| POST | `/import/{jobId}/confirm` | DATA_IMPORT | `{ accountMap, categoryMap, skipDuplicates, postBalanced, acknowledgeWorkspaceMismatch }` — `postBalanced` needs TRANSACTION_POST; only the uploader can confirm. Imported records are created as the authenticated importer; the file's creator is kept only as unverified external provenance. Audits `IMPORTED` per record and `IMPORT_COMPLETED`. |
| GET | `/import/{jobId}/errors` | DATA_IMPORT | CSV error report. |

Super Admin: `GET /api/admin/integrations` (adapters, implementation status, 30-day usage) and `PATCH /api/admin/integrations` `{ key, enabled }` to make an adapter available platform-wide.

### Adapter status

| Adapter | Format | Status logic | Created-by transfer |
|---|---|---|---|
| VLedger Canonical JSON | JSON | Available | Full audit trail in the file |
| Generic CSV | CSV, one row per journal line | Available | Dedicated columns |
| TallyPrime | Tally XML (Import Data / Vouchers) | Needs company name + ledger mappings | Narration |
| Zoho Books | JSON bodies for `POST /books/v3/journals` | Needs account_id mappings | Notes / line description |
| QuickBooks Online | JournalEntry JSON objects | Needs Account Id mappings | PrivateNote |
| Xero | Manual journal import CSV | Needs account code mappings | Narration |
| Custom | Configurable CSV columns | Needs a column layout | Configurable columns |
| BUSY / SAP / Microsoft Dynamics 365 | Documented architecture only | Not Implemented | — |

Native formats are generated from each product's documented import format; run a test import in the target product before relying on them. Direct API transfer (Zoho, QuickBooks) requires an OAuth connection and is marked Not Implemented. The complete attribution is always available in the separate audit metadata file.
