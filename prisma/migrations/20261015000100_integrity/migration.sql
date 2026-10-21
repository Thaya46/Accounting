-- Accounting integrity rules enforced by PostgreSQL itself, independent of
-- application code: balanced journals, immutable ledger, append-only audit
-- trail, workspace isolation of references, and preserved attribution.

-- ── Amount checks ───────────────────────────────────────────────────────
ALTER TABLE "journal_lines"
  ADD CONSTRAINT "journal_lines_one_sided_positive"
  CHECK ("debit" >= 0 AND "credit" >= 0 AND (("debit" > 0 AND "credit" = 0) OR ("credit" > 0 AND "debit" = 0)));

ALTER TABLE "journal_entries"
  ADD CONSTRAINT "journal_entries_totals_balanced"
  CHECK ("totalDebit" = "totalCredit" AND "totalDebit" > 0);

ALTER TABLE "transactions"
  ADD CONSTRAINT "transactions_amount_positive" CHECK ("amount" > 0),
  ADD CONSTRAINT "transactions_exchange_rate_positive" CHECK ("exchangeRate" > 0),
  ADD CONSTRAINT "transactions_posted_has_journal" CHECK ("status" NOT IN ('POSTED', 'REVERSED') OR "journalEntryId" IS NOT NULL),
  ADD CONSTRAINT "transactions_reversed_has_reversal" CHECK ("status" <> 'REVERSED' OR "reversalEntryId" IS NOT NULL);

-- ── Append-only audit history ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION vl_reject_audit_change() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_events is append-only: % is not allowed', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "audit_events_append_only"
  BEFORE UPDATE OR DELETE ON "audit_events"
  FOR EACH ROW EXECUTE FUNCTION vl_reject_audit_change();

CREATE TRIGGER "audit_events_no_truncate"
  BEFORE TRUNCATE ON "audit_events"
  FOR EACH STATEMENT EXECUTE FUNCTION vl_reject_audit_change();

-- ── Immutable ledger ────────────────────────────────────────────────────
-- Posted journal entries and lines can never be deleted or have their amounts,
-- accounts or dates changed. Corrections are made with reversal/adjustment entries.
-- (Only reconciliation markers on lines may be updated.)
CREATE OR REPLACE FUNCTION vl_guard_journal_line() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'journal_lines are immutable: delete is not allowed';
  END IF;
  IF NEW."debit" <> OLD."debit" OR NEW."credit" <> OLD."credit"
     OR NEW."accountId" <> OLD."accountId" OR NEW."journalEntryId" <> OLD."journalEntryId"
     OR NEW."workspaceId" <> OLD."workspaceId" OR NEW."lineNo" <> OLD."lineNo" THEN
    RAISE EXCEPTION 'journal_lines are immutable: amounts and accounts cannot change';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "journal_lines_immutable"
  BEFORE UPDATE OR DELETE ON "journal_lines"
  FOR EACH ROW EXECUTE FUNCTION vl_guard_journal_line();

CREATE OR REPLACE FUNCTION vl_guard_journal_entry() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'journal_entries are immutable: delete is not allowed';
  END IF;
  IF NEW."totalDebit" <> OLD."totalDebit" OR NEW."totalCredit" <> OLD."totalCredit"
     OR NEW."date" <> OLD."date" OR NEW."workspaceId" <> OLD."workspaceId"
     OR NEW."postedById" <> OLD."postedById" OR NEW."type" <> OLD."type" THEN
    RAISE EXCEPTION 'journal_entries are immutable once posted';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "journal_entries_immutable"
  BEFORE UPDATE OR DELETE ON "journal_entries"
  FOR EACH ROW EXECUTE FUNCTION vl_guard_journal_entry();

-- ── Workspace isolation of ledger references ────────────────────────────
CREATE OR REPLACE FUNCTION vl_check_line_workspace() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "journal_entries" e WHERE e."id" = NEW."journalEntryId" AND e."workspaceId" = NEW."workspaceId") THEN
    RAISE EXCEPTION 'journal line workspace does not match its journal entry';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM "accounts" a WHERE a."id" = NEW."accountId" AND a."workspaceId" = NEW."workspaceId") THEN
    RAISE EXCEPTION 'journal line account belongs to a different workspace';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "journal_lines_same_workspace"
  BEFORE INSERT ON "journal_lines"
  FOR EACH ROW EXECUTE FUNCTION vl_check_line_workspace();

-- ── Balanced journals (checked at COMMIT so multi-line inserts are atomic) ──
CREATE OR REPLACE FUNCTION vl_check_journal_balanced() RETURNS trigger AS $$
DECLARE
  entry_id text;
  d numeric;
  c numeric;
  n int;
  td numeric;
  tc numeric;
BEGIN
  entry_id := CASE WHEN TG_TABLE_NAME = 'journal_entries' THEN NEW."id" ELSE NEW."journalEntryId" END;
  SELECT COALESCE(SUM("debit"), 0), COALESCE(SUM("credit"), 0), COUNT(*)
    INTO d, c, n FROM "journal_lines" WHERE "journalEntryId" = entry_id;
  SELECT "totalDebit", "totalCredit" INTO td, tc FROM "journal_entries" WHERE "id" = entry_id;
  IF n < 2 OR d <> c OR d <> td OR c <> tc THEN
    RAISE EXCEPTION 'journal entry % is not balanced (lines %, debits %, credits %)', entry_id, n, d, c;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER "journal_lines_balanced"
  AFTER INSERT ON "journal_lines"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION vl_check_journal_balanced();

CREATE CONSTRAINT TRIGGER "journal_entries_have_balanced_lines"
  AFTER INSERT ON "journal_entries"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION vl_check_journal_balanced();

-- ── Transactions: workspace-consistent references, preserved attribution ──
CREATE OR REPLACE FUNCTION vl_guard_transaction() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD."status" IN ('POSTED', 'REVERSED') THEN
      RAISE EXCEPTION 'posted transactions cannot be deleted; reverse them instead';
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW."createdById" <> OLD."createdById" OR NEW."createdByName" <> OLD."createdByName"
       OR NEW."createdAt" <> OLD."createdAt" OR NEW."workspaceId" <> OLD."workspaceId" OR NEW."number" <> OLD."number" THEN
      RAISE EXCEPTION 'transaction attribution is immutable (created by / created at / workspace)';
    END IF;
    IF OLD."status" IN ('POSTED', 'REVERSED') AND (
         NEW."amount" <> OLD."amount" OR NEW."date" <> OLD."date" OR NEW."type" <> OLD."type"
         OR NEW."debitAccountId" IS DISTINCT FROM OLD."debitAccountId"
         OR NEW."creditAccountId" IS DISTINCT FROM OLD."creditAccountId"
         OR NEW."journalEntryId" IS DISTINCT FROM OLD."journalEntryId") THEN
      RAISE EXCEPTION 'posted transactions are immutable; use a reversal or adjustment entry';
    END IF;
  END IF;

  IF NEW."debitAccountId" IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM "accounts" WHERE "id" = NEW."debitAccountId" AND "workspaceId" = NEW."workspaceId") THEN
    RAISE EXCEPTION 'debit account belongs to a different workspace';
  END IF;
  IF NEW."creditAccountId" IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM "accounts" WHERE "id" = NEW."creditAccountId" AND "workspaceId" = NEW."workspaceId") THEN
    RAISE EXCEPTION 'credit account belongs to a different workspace';
  END IF;
  IF NEW."categoryId" IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM "account_categories" WHERE "id" = NEW."categoryId" AND "workspaceId" = NEW."workspaceId") THEN
    RAISE EXCEPTION 'category belongs to a different workspace';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "transactions_guard"
  BEFORE INSERT OR UPDATE OR DELETE ON "transactions"
  FOR EACH ROW EXECUTE FUNCTION vl_guard_transaction();
