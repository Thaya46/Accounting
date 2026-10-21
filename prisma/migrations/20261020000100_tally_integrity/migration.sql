-- Workspace isolation for the references added in 20261020000000_tally_groups_gst,
-- enforced by PostgreSQL in the same way as 20261015000100_integrity: a row may
-- only point at groups, accounts and transactions of its own workspace.

-- ── Account groups: the parent group must be in the same workspace ──────
CREATE OR REPLACE FUNCTION vl_check_account_group_workspace() RETURNS trigger AS $$
BEGIN
  IF NEW."parentGroupId" IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM "account_groups" WHERE "id" = NEW."parentGroupId" AND "workspaceId" = NEW."workspaceId") THEN
    RAISE EXCEPTION 'parent group belongs to a different workspace';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "account_groups_same_workspace"
  BEFORE INSERT OR UPDATE OF "parentGroupId", "workspaceId" ON "account_groups"
  FOR EACH ROW EXECUTE FUNCTION vl_check_account_group_workspace();

-- ── Accounts: the ledger group must be in the same workspace ────────────
CREATE OR REPLACE FUNCTION vl_check_account_workspace() RETURNS trigger AS $$
BEGIN
  IF NEW."groupId" IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM "account_groups" WHERE "id" = NEW."groupId" AND "workspaceId" = NEW."workspaceId") THEN
    RAISE EXCEPTION 'account group belongs to a different workspace';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "accounts_same_workspace"
  BEFORE INSERT OR UPDATE OF "groupId", "workspaceId" ON "accounts"
  FOR EACH ROW EXECUTE FUNCTION vl_check_account_workspace();

-- ── Bill-wise allocations: voucher and party ledger in the same workspace ──
CREATE OR REPLACE FUNCTION vl_check_bill_allocation_workspace() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "transactions" WHERE "id" = NEW."transactionId" AND "workspaceId" = NEW."workspaceId") THEN
    RAISE EXCEPTION 'bill allocation transaction belongs to a different workspace';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM "accounts" WHERE "id" = NEW."accountId" AND "workspaceId" = NEW."workspaceId") THEN
    RAISE EXCEPTION 'bill allocation account belongs to a different workspace';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "bill_allocations_same_workspace"
  BEFORE INSERT OR UPDATE OF "transactionId", "accountId", "workspaceId" ON "bill_allocations"
  FOR EACH ROW EXECUTE FUNCTION vl_check_bill_allocation_workspace();

-- ── Transactions: the party ledger joins the existing reference checks ──
-- Same function as 20261015000100_integrity plus the partyLedgerId check.
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
  IF NEW."partyLedgerId" IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM "accounts" WHERE "id" = NEW."partyLedgerId" AND "workspaceId" = NEW."workspaceId") THEN
    RAISE EXCEPTION 'party ledger belongs to a different workspace';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
