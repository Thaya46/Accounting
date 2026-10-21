/**
 * Granular workspace permissions. Shared by server (enforcement) and client
 * (display only — the UI never decides access on its own).
 */
export const PERMISSIONS = {
  TRANSACTION_CREATE: { label: "Create Transactions", description: "Record income, expenses, transfers and journals (manual, text or voice)." },
  TRANSACTION_VIEW: { label: "View Transactions", description: "View every transaction in the workspace, not only your own." },
  TRANSACTION_EDIT_DRAFT: { label: "Edit Draft Transactions", description: "Edit transactions that are still in draft or were rejected." },
  TRANSACTION_POST: { label: "Post Transactions", description: "Post transactions to the general ledger." },
  TRANSACTION_REVERSE: { label: "Reverse Transactions", description: "Reverse posted transactions with a reason." },
  TRANSACTION_APPROVE: { label: "Approve Transactions", description: "Approve or reject submitted transactions." },
  REPORTS_VIEW: { label: "View Reports", description: "Financial reports, ledgers, balances and dashboards." },
  DATA_EXPORT: { label: "Export Data", description: "Use the Export Center and download files." },
  DATA_IMPORT: { label: "Import Data", description: "Import accounting data from JSON files." },
  ACCOUNTS_MANAGE: { label: "Manage Accounts", description: "Chart of accounts, bank/cash accounts, categories, contacts, reconciliation." },
  USERS_MANAGE: { label: "Manage Users", description: "Invite, edit, disable and reactivate users." },
  AUDIT_VIEW: { label: "View Audit Logs", description: "Read the workspace audit history." },
  SETTINGS_MANAGE: { label: "Manage Settings", description: "Workspace settings and accounting software integrations." },
} as const;

export type PermissionKey = keyof typeof PERMISSIONS;

export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as PermissionKey[];

export function isPermissionKey(value: string): value is PermissionKey {
  return value in PERMISSIONS;
}

export const SYSTEM_ROLES: { name: string; description: string; isAdmin: boolean; permissions: PermissionKey[] }[] = [
  {
    name: "Workspace Admin",
    description: "Full control of this workspace.",
    isAdmin: true,
    permissions: ALL_PERMISSIONS,
  },
  {
    name: "Accountant",
    description: "Records, posts and reverses entries; manages accounts; reports and exports.",
    isAdmin: false,
    permissions: [
      "TRANSACTION_CREATE",
      "TRANSACTION_VIEW",
      "TRANSACTION_EDIT_DRAFT",
      "TRANSACTION_POST",
      "TRANSACTION_REVERSE",
      "REPORTS_VIEW",
      "DATA_EXPORT",
      "DATA_IMPORT",
      "ACCOUNTS_MANAGE",
    ],
  },
  {
    name: "Approver",
    description: "Reviews and approves submitted transactions.",
    isAdmin: false,
    permissions: ["TRANSACTION_VIEW", "TRANSACTION_APPROVE", "TRANSACTION_POST", "REPORTS_VIEW"],
  },
  {
    name: "Staff",
    description: "Records their own income and expenses for review.",
    isAdmin: false,
    permissions: ["TRANSACTION_CREATE", "TRANSACTION_EDIT_DRAFT"],
  },
  {
    name: "Viewer",
    description: "Read-only access to transactions and reports.",
    isAdmin: false,
    permissions: ["TRANSACTION_VIEW", "REPORTS_VIEW"],
  },
];
