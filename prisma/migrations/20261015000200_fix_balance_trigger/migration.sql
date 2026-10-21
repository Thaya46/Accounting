-- The balance check is shared by triggers on journal_entries and journal_lines.
-- Resolve the entry id with IF/ELSE so PL/pgSQL only touches the column that
-- exists on the triggering table.
CREATE OR REPLACE FUNCTION vl_check_journal_balanced() RETURNS trigger AS $$
DECLARE
  entry_id text;
  d numeric;
  c numeric;
  n int;
  td numeric;
  tc numeric;
BEGIN
  IF TG_TABLE_NAME = 'journal_entries' THEN
    entry_id := NEW."id";
  ELSE
    entry_id := NEW."journalEntryId";
  END IF;
  SELECT COALESCE(SUM("debit"), 0), COALESCE(SUM("credit"), 0), COUNT(*)
    INTO d, c, n FROM "journal_lines" WHERE "journalEntryId" = entry_id;
  SELECT "totalDebit", "totalCredit" INTO td, tc FROM "journal_entries" WHERE "id" = entry_id;
  IF n < 2 OR d <> c OR d <> td OR c <> tc THEN
    RAISE EXCEPTION 'journal entry % is not balanced (lines %, debits %, credits %)', entry_id, n, d, c;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
