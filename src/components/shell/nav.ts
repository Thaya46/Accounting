import {
  Activity,
  ArrowDownUp,
  BarChart3,
  BookOpen,
  Building2,
  CheckCheck,
  ClipboardList,
  FileInput,
  FileOutput,
  FolderTree,
  LayoutDashboard,
  ListChecks,
  Mail,
  PlugZap,
  PlusCircle,
  ScrollText,
  Settings,
  Sparkles,
  Users,
  Contact,
  type LucideIcon,
} from "lucide-react";
import type { PermissionKey } from "@/lib/permissions";

export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Shown when the user has ANY of these permissions (none = everyone). */
  anyOf?: PermissionKey[];
  exact?: boolean;
};

export type NavSection = { title: string; items: NavItem[] };

/** Workspace navigation. Paths are relative to /w/[workspaceId]. Visibility mirrors server checks. */
export const WORKSPACE_NAV: NavSection[] = [
  {
    title: "Overview",
    items: [{ href: "/dashboard", label: "Dashboard", icon: LayoutDashboard }],
  },
  {
    title: "Record",
    items: [
      { href: "/entry", label: "AI & Voice Entry", icon: Sparkles, anyOf: ["TRANSACTION_CREATE"] },
      { href: "/transactions/new", label: "Manual Entry", icon: PlusCircle, anyOf: ["TRANSACTION_CREATE"], exact: true },
    ],
  },
  {
    title: "Transactions",
    items: [
      { href: "/daybook", label: "Day Book (Tally)", icon: BookOpen, anyOf: ["TRANSACTION_VIEW"] },
      { href: "/transactions", label: "All Transactions", icon: ArrowDownUp, anyOf: ["TRANSACTION_VIEW"], exact: true },
      { href: "/transactions/mine", label: "My Transactions", icon: ListChecks, exact: true },
      { href: "/approvals", label: "Approvals", icon: CheckCheck, anyOf: ["TRANSACTION_APPROVE"] },
    ],
  },
  {
    title: "Accounting",
    items: [
      { href: "/accounts", label: "Chart of Accounts", icon: FolderTree, anyOf: ["ACCOUNTS_MANAGE", "REPORTS_VIEW"] },
      { href: "/categories", label: "Categories", icon: ClipboardList, anyOf: ["ACCOUNTS_MANAGE"] },
      { href: "/contacts", label: "Customers & Vendors", icon: Contact, anyOf: ["ACCOUNTS_MANAGE"] },
      { href: "/reports", label: "Reports", icon: BarChart3, anyOf: ["REPORTS_VIEW"] },
    ],
  },
  {
    title: "Data",
    items: [
      { href: "/export", label: "Export Center", icon: FileOutput, anyOf: ["DATA_EXPORT"] },
      { href: "/import", label: "Import", icon: FileInput, anyOf: ["DATA_IMPORT"] },
      { href: "/integrations", label: "Integrations", icon: PlugZap, anyOf: ["SETTINGS_MANAGE"] },
    ],
  },
  {
    title: "Administration",
    items: [
      { href: "/users", label: "Users & Roles", icon: Users, anyOf: ["USERS_MANAGE"] },
      { href: "/audit", label: "Audit Log", icon: ScrollText, anyOf: ["AUDIT_VIEW"] },
      { href: "/settings", label: "Workspace Settings", icon: Settings, anyOf: ["SETTINGS_MANAGE"] },
    ],
  },
];

/** Super Admin navigation (absolute paths). */
export const ADMIN_NAV: NavSection[] = [
  {
    title: "Platform",
    items: [
      { href: "/admin", label: "Dashboard", icon: LayoutDashboard, exact: true },
      { href: "/admin/workspaces", label: "Workspaces", icon: Building2 },
      { href: "/admin/activity", label: "Activity Log", icon: Activity },
    ],
  },
  {
    title: "Configuration",
    items: [
      { href: "/admin/integrations", label: "Export Integrations", icon: PlugZap },
      { href: "/admin/settings", label: "Platform Settings", icon: Settings },
      { href: "/admin/outbox", label: "Email Outbox", icon: Mail },
      { href: "/admin/docs", label: "API Reference", icon: BookOpen },
    ],
  },
];
