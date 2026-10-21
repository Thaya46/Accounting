# Production deployment

VLedger AI is a standard Next.js server application backed by PostgreSQL. It runs on any Node.js 20+ host (a VM, a container platform, or a Node-capable PaaS). It does not require Docker.

## 1. Infrastructure checklist

| Component | Recommendation |
|---|---|
| Node.js | 20 LTS or newer |
| PostgreSQL | 14+ (tested on 17 and 18). Managed service with automated backups and point-in-time recovery. |
| Region | **Run the app in the same region as the database.** Each request performs several queries; cross-continent latency (≈200 ms per round trip) makes pages slow. |
| TLS | Terminate HTTPS at a load balancer or reverse proxy. Session cookies are `Secure` in production. |
| Email | Brevo account with a verified sender domain (SPF/DKIM). |
| Secrets | A secret manager or the platform's encrypted environment variables. |

## 2. Environment variables

| Variable | Required | Notes |
|---|---|---|
| `DATABASE_URL` | yes | Application connection. When using a pooler (PgBouncer), append `pgbouncer=true`. Add `connection_limit`/`pool_timeout` to suit your instance size. If the provider closes idle connections (Layerbase does after 300 s), set `max_idle_connection_lifetime` below that, e.g. `240`. |
| `DIRECT_DATABASE_URL` | yes | Direct (non-pooled) connection used by `prisma migrate deploy`. |
| `APP_URL` | yes | Public base URL, e.g. `https://ledger.example.com` (used in email links). |
| `APP_ENCRYPTION_KEY` | yes | 32 random bytes, base64. Encrypts TOTP secrets. **Back it up** — losing it invalidates every enrolled authenticator. |
| `BREVO_API_KEY` | yes | Brevo API key (`xkeysib-…`), or an SMTP key (`xsmtpsib-…`) together with `BREVO_SMTP_LOGIN`. |
| `BREVO_SMTP_LOGIN` | with SMTP key | Brevo SMTP login. |
| `BREVO_SENDER_EMAIL`, `BREVO_SENDER_NAME` | yes | Must be a verified Brevo sender. |
| `EMAIL_DEV_OUTBOX` | set `false` | In production undelivered email bodies (which may contain one-time links) must not be stored. |
| `AI_PROVIDER` | optional | `none` (default, rule-based), `anthropic`, or `openai`. |
| `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` | if `anthropic` | Model defaults to `claude-opus-5-5`. |
| `OPENAI_COMPATIBLE_BASE_URL`, `OPENAI_COMPATIBLE_API_KEY`, `OPENAI_COMPATIBLE_MODEL` | if `openai` | Any OpenAI-compatible chat endpoint. |
| `SEED_SUPER_ADMIN_EMAIL`, `SEED_SUPER_ADMIN_PASSWORD` | first deploy | Creates the first Super Admin. Use a strong one-off password and rotate after first sign-in. |
| `SEED_DEMO` | set `false` | Never seed demo workspaces in production. |
| `CRON_SECRET` | optional | Enables `POST /api/cron/summaries?period=daily\|monthly` with `Authorization: Bearer <secret>` for scheduled summary emails. |
| `COOKIE_SECURE` | optional | `auto` (default): the session cookie is `Secure` when the request arrived over https (directly or via a proxy's `X-Forwarded-Proto`). Set `true` behind a TLS proxy that does not send that header. |

### Opening the site from other devices (IP address on a local network)

`npm start` and `npm run dev` listen on every network interface, so other devices on the same network can open `http://<this-computer's-IP>:3000`.

* **Sign-in** works over plain http because the session cookie only gets the `Secure` flag on https requests.
* **Email links** use `APP_URL`. Set it to the address other people open, e.g. `APP_URL="http://192.168.1.20:3000"`, and restart.
* **Voice input** (microphone) only works on `https://` addresses or `http://localhost`, because browsers block the microphone elsewhere. Over a plain http IP address the app says so and typing still works. For voice on other devices, serve the site over https (a reverse proxy with a certificate). For a quick test on one device, add the address under `chrome://flags/#unsafely-treat-insecure-origin-as-secure` in that device's Chrome. Spoken replies (text-to-speech) work either way.
* **Firewall** — allow inbound TCP port 3000 for Node.js on private networks (Windows asks the first time the server starts).

## 3. Build and release

```bash
npm ci
npx prisma migrate deploy        # uses DIRECT_DATABASE_URL
SEED_DEMO=false npm run db:seed  # first deploy only: permissions, adapters, Super Admin
npm run build
npm start                        # listens on port 3000 (set PORT or put a proxy in front)
```

### Deploying on Vercel

`vercel.json` pins the server functions to `iad1` (US East). Keep that region close to the database: every page makes several queries, so distance multiplies. It also schedules the summary emails.

1. In Vercel choose **Add New → Project**, import the GitHub repository, and keep the detected Next.js settings. The build command `npm run build` runs `prisma generate` first.
2. Under **Settings → Environment Variables**, add the variables from the table above for Production (and Preview if used):
   * `DATABASE_URL` — on serverless, lower the pool per instance, e.g. `connection_limit=5`, and keep `max_idle_connection_lifetime`. Set `DIRECT_DATABASE_URL` too.
   * `APP_ENCRYPTION_KEY` — the **same** value the database was set up with, or enrolled authenticator apps stop working.
   * `BREVO_*`, `EMAIL_DEV_OUTBOX=false`, `AI_*` as needed. Add `CRON_SECRET`, a long random string, to enable the scheduled summaries.
   * `APP_URL` is optional. Without it, email links use the project's production domain (`VERCEL_PROJECT_PRODUCTION_URL`). Set it when you use a custom domain.
   * Leave out the local-only variables `TEST_DATABASE_URL`, `LOCAL_PG_PORT`, `SEED_*`. Never upload a `.env` that still has `APP_URL="http://localhost:3000"`.
3. **Brevo:** if *Authorised IPs* is enabled in Brevo (Security → Authorised IPs), the API rejects requests from Vercel with `401 unrecognised IP`. Vercel's outgoing addresses change, so deactivate the IP restriction for this key, or send through a fixed-IP relay.
4. **Migrations** are not run by the build. Before deploying a change that adds a migration, run `npx prisma migrate deploy` once against the production database from a trusted machine.
5. Cron: `vercel.json` calls `/api/cron/summaries?period=daily` at 00:30 UTC and `?period=monthly` at 01:00 UTC on the 1st. Vercel sends `Authorization: Bearer $CRON_SECRET` automatically.

Migrations are forward-only SQL in `prisma/migrations`. They include the integrity triggers (balanced journals, append-only audit, immutable ledger, workspace isolation). Do not edit applied migrations; add new ones.

Run the application as a non-root user. Start several instances behind a load balancer if needed — sessions and rate limits are stored in PostgreSQL, so instances are stateless.

## 4. After the first deploy

1. Sign in as the Super Admin and enrol an authenticator app (mandatory). Store the recovery codes offline.
2. In **Platform Settings** set accounting defaults, session lifetime, invitation lifetime and whether MFA is required for all users.
3. In **Email outbox** send a test email to confirm Brevo delivery.
4. Create the first workspace; the Workspace Admin receives an invitation link.

## 5. Scheduled summary emails

Workspaces can opt in to daily (previous day) and monthly (previous month) summaries. Trigger them once per period from any scheduler:

* **HTTP** (hosted cron, e.g. a platform scheduler): `POST https://<host>/api/cron/summaries?period=daily` with `Authorization: Bearer $CRON_SECRET`.
* **CLI** (cron on macOS/Linux, Task Scheduler on Windows): `npm run summaries -- daily` and `npm run summaries -- monthly`.

## 6. Operations

* **Backups** — rely on managed PostgreSQL backups plus periodic logical dumps (`pg_dump`). Audit history lives in `audit_events` and must be retained according to your record-keeping obligations.
* **Monitoring** — watch HTTP 5xx rates, database CPU/connections, and `notification_logs` with status `FAILED`.
* **Security headers** — set in `next.config.ts` (`X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`, a restrictive `Permissions-Policy` that allows only same-origin microphone use for voice entry). Add HSTS at your proxy.
* **Key rotation** — rotating `APP_ENCRYPTION_KEY` requires re-encrypting `mfa_credentials.secretEncrypted` (decrypt with the old key, encrypt with the new key) in a maintenance window.
* **Data isolation** — every workspace query is scoped in the application, and PostgreSQL triggers reject cross-workspace ledger references. Super Admins see usage metrics, not workspace financial records.
