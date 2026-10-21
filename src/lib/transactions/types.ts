/**
 * Client-safe types and constants for the transactions module. Nothing in this
 * file may import server-only code (Prisma client, session, env).
 */

export const TRANSACTION_TYPES = ["INCOME", "EXPENSE", "TRANSFER", "JOURNAL"] as const;
export type TransactionTypeKey = (typeof TRANSACTION_TYPES)[number];

export const TRANSACTION_STATUSES = ["DRAFT", "PENDING_APPROVAL", "APPROVED", "POSTED", "REVERSED", "REJECTED"] as const;
export type TransactionStatusKey = (typeof TRANSACTION_STATUSES)[number];

export const ENTRY_SOURCES = ["VOICE", "TEXT", "MANUAL", "IMPORT"] as const;
export type EntrySourceKey = (typeof ENTRY_SOURCES)[number];

export const TYPE_LABELS: Record<TransactionTypeKey, string> = {
  INCOME: "Income",
  EXPENSE: "Expense",
  TRANSFER: "Transfer",
  JOURNAL: "Journal",
};

export const STATUS_LABELS: Record<TransactionStatusKey, string> = {
  DRAFT: "Draft",
  PENDING_APPROVAL: "Pending approval",
  APPROVED: "Approved",
  POSTED: "Posted",
  REVERSED: "Reversed",
  REJECTED: "Rejected",
};

export const SOURCE_LABELS: Record<EntrySourceKey, string> = {
  VOICE: "Voice",
  TEXT: "Text",
  MANUAL: "Manual",
  IMPORT: "Import",
};

/** Payment methods offered in forms (matches the AI extraction vocabulary). */
export const PAYMENT_METHODS = ["Bank Transfer", "UPI", "Cash", "Card", "Cheque", "Transfer"] as const;

/** Account subtypes usable as the paying / receiving side (mirrors coa-template PAYMENT_SUBTYPES). */
export const PAYMENT_SUBTYPE_KEYS = ["BANK", "CASH", "CREDIT_CARD", "RECEIVABLE", "PAYABLE", "WALLET"] as const;

export const SUBTYPE_LABELS: Record<string, string> = {
  BANK: "Bank",
  CASH: "Cash",
  WALLET: "Wallet / UPI",
  CREDIT_CARD: "Credit card",
  RECEIVABLE: "Receivable",
  PAYABLE: "Payable",
};

export const PAGE_SIZE = 25;

export const SORT_OPTIONS = ["date_desc", "date_asc", "amount_desc", "amount_asc", "created_desc"] as const;
export type SortKey = (typeof SORT_OPTIONS)[number];

export const RANGE_OPTIONS = ["this-month", "last-month", "this-fy", "custom"] as const;
export type RangeKey = (typeof RANGE_OPTIONS)[number];

export const AI_ENGINE_LABELS: Record<string, string> = {
  rules: "Built-in rules",
  anthropic: "Claude",
  openai: "OpenAI-compatible",
};

// ───────────────────────────── List ─────────────────────────────

export type TransactionRow = {
  id: string;
  number: number;
  ref: string;
  date: string;
  description: string;
  amount: string;
  currency: string;
  type: TransactionTypeKey;
  status: TransactionStatusKey;
  source: EntrySourceKey;
  reference: string | null;
  categoryName: string | null;
  counterparty: string | null;
  enteredBy: string;
  createdById: string;
  enteredByDisabled: boolean;
  aiConfidence: number | null;
};

export type ListTotals = {
  currency: string;
  income: string;
  expense: string;
  net: string;
  count: number;
  /** True when reversed and rejected entries were left out of the sums. */
  excludesInactive: boolean;
};

export type MemberOption = { id: string; name: string; disabled: boolean };

export type TransactionListResult = {
  rows: TransactionRow[];
  totals: ListTotals;
  page: number;
  pageSize: number;
  pageCount: number;
  total: number;
  members: MemberOption[];
};

// ───────────────────────────── Forms ─────────────────────────────

export type AccountOption = { id: string; code: string; name: string; type: string; subtype: string | null };
export type CategoryOption = { id: string; name: string; kind: "INCOME" | "EXPENSE"; accountId: string; accountName: string };

export type FormOptions = {
  workspaceId: string;
  currency: string;
  today: string;
  accounts: AccountOption[];
  categories: CategoryOption[];
  customers: string[];
  vendors: string[];
  settings: {
    autoPostEnabled: boolean;
    autoPostMinConfidence: number;
    requireApproval: boolean;
    approvalThreshold: string | null;
  };
  permissions: {
    canCreate: boolean;
    canPost: boolean;
    canViewAll: boolean;
    canEditDraft: boolean;
  };
  user: { id: string; name: string; ref: string };
};

export type DuplicateWarning = {
  /** null when the match belongs to a transaction the caller may not view. */
  id: string | null;
  ref: string;
  date: string;
  amount: string;
  description: string | null;
  enteredBy: string | null;
  status: TransactionStatusKey;
  score: number;
  visible: boolean;
};

/** Values for the manual form when editing an existing draft. */
export type FormInitial = {
  type: TransactionTypeKey;
  date: string;
  amount: string;
  currency: string;
  exchangeRate: string;
  description: string;
  categoryId: string;
  debitAccountId: string;
  creditAccountId: string;
  /** Ledger account override that differs from the category's account. */
  accountOverrideId: string;
  lines: { accountId: string; debit: string; credit: string; description: string }[];
  isAdjustment: boolean;
  paymentMethod: string;
  reference: string;
  notes: string;
  customerName: string;
  vendorName: string;
};

// ───────────────────────────── Detail ─────────────────────────────

export type JournalLineView = {
  lineNo: number;
  accountId: string;
  accountCode: string;
  accountName: string;
  debit: string;
  credit: string;
  description: string | null;
};

export type JournalView = {
  id: string | null;
  ref: string | null;
  type: string;
  date: string;
  postedByName: string | null;
  postedAt: string | null;
  lines: JournalLineView[];
  totalDebit: string;
  totalCredit: string;
  proposed: boolean;
};

export type AuditChange = { field: string; label: string; before: string | null; after: string | null };

export type AuditEventView = {
  id: string;
  action: string;
  actorName: string;
  actorUserId: string | null;
  createdAt: string;
  reason: string | null;
  approvalId: string | null;
  reversalId: string | null;
  changes: AuditChange[];
  summary: string | null;
};

export type ApprovalView = {
  id: string;
  decision: "APPROVED" | "REJECTED";
  comment: string | null;
  decidedByName: string;
  createdAt: string;
};

export type PersonStamp = { id: string | null; name: string | null; at: string | null };

export type TransactionDetailView = {
  id: string;
  number: number;
  ref: string;
  workspace: { id: string; ref: string; name: string; code: string; currency: string; timeZone: string };
  date: string;
  type: TransactionTypeKey;
  status: TransactionStatusKey;
  source: EntrySourceKey;
  amount: string;
  currency: string;
  exchangeRate: string;
  baseAmount: string;
  description: string;
  category: { id: string; name: string } | null;
  debitAccount: { id: string; code: string; name: string } | null;
  creditAccount: { id: string; code: string; name: string } | null;
  paymentMethod: string | null;
  reference: string | null;
  notes: string | null;
  customer: string | null;
  vendor: string | null;
  isAdjustment: boolean;
  aiConfidence: number | null;
  rawInput: string | null;
  createdBy: {
    id: string;
    ref: string;
    nameSnapshot: string;
    currentName: string;
    email: string;
    userStatus: string;
    membershipStatus: string | null;
    disabled: boolean;
  };
  createdAt: string;
  updated: PersonStamp;
  approved: PersonStamp;
  posted: PersonStamp;
  reversed: PersonStamp & { reason: string | null };
  importInfo: {
    jobId: string | null;
    fileName: string | null;
    externalRef: string | null;
    externalCreatorId: string | null;
    externalCreatorName: string | null;
  } | null;
  journal: JournalView | null;
  reversal: JournalView | null;
  missingForPosting: string[];
  approvals: ApprovalView[];
  audit: AuditEventView[];
  isOwn: boolean;
};

export type TransactionAbilities = {
  canEdit: boolean;
  canSubmit: boolean;
  canApprove: boolean;
  selfApprovalBlocked: boolean;
  canApproveAndPost: boolean;
  canPost: boolean;
  postBlockedReason: string | null;
  canReverse: boolean;
};

// ───────────────────────────── Approvals ─────────────────────────────

export type ApprovalQueueItem = {
  id: string;
  ref: string;
  date: string;
  type: TransactionTypeKey;
  status: TransactionStatusKey;
  description: string;
  amount: string;
  currency: string;
  categoryName: string | null;
  debitAccountName: string | null;
  creditAccountName: string | null;
  counterparty: string | null;
  enteredBy: string;
  createdById: string;
  isOwn: boolean;
  canView: boolean;
  /** Who moved it into the current state (submitter for pending, approver for approved). */
  actorName: string | null;
  actorAt: string | null;
  missing: string[];
};

export type ApprovalQueue = { pending: ApprovalQueueItem[]; approved: ApprovalQueueItem[] };

// ───────────────────────────── API payloads ─────────────────────────────

export type SavedTransaction = {
  id: string;
  number: number;
  ref: string;
  status: TransactionStatusKey;
  type: TransactionTypeKey;
  amount: string;
  currency: string;
  date: string;
  description: string;
  createdByName: string;
};
