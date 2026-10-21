"use client";

import * as React from "react";
import Link, { useLinkStatus } from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Dialog as DialogPrimitive } from "radix-ui";
import { useTheme } from "next-themes";
import { toast } from "sonner";
import {
  Building2,
  Loader2,
  Check,
  ChevronsUpDown,
  KeyRound,
  LogOut,
  Menu,
  Monitor,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  ShieldCheck,
  Sun,
  UserRound,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { apiFetch } from "@/lib/client/api";
import type { PermissionKey } from "@/lib/permissions";
import { Avatar } from "@/components/ui/misc";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  SheetContent,
} from "@/components/ui/overlay";
import { ADMIN_NAV, WORKSPACE_NAV, type NavItem, type NavSection } from "./nav";
import { startNavigationProgress } from "./navigation-progress";
import { AssistantLauncher } from "@/components/assistant/assistant-launcher";

export type ShellProps = {
  variant: "admin" | "workspace";
  user: { name: string; email: string; roleLabel: string };
  workspace?: { id: string; name: string; code: string } | null;
  workspaces?: { id: string; name: string; code: string; roleName: string }[];
  permissions?: PermissionKey[];
  children: React.ReactNode;
};

const COLLAPSE_KEY = "vl.sidebar.collapsed";

function useNav(variant: ShellProps["variant"], workspaceId: string | undefined, permissions: PermissionKey[]) {
  return React.useMemo<NavSection[]>(() => {
    if (variant === "admin") return ADMIN_NAV;
    const base = `/w/${workspaceId}`;
    return WORKSPACE_NAV.map((s) => ({
      ...s,
      items: s.items
        .filter((i) => !i.anyOf || i.anyOf.some((p) => permissions.includes(p)))
        .map((i) => ({ ...i, href: `${base}${i.href}` })),
    })).filter((s) => s.items.length);
  }, [variant, workspaceId, permissions]);
}

function isActive(pathname: string, href: string, exact?: boolean) {
  if (exact) return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** Rendered inside each sidebar <Link>: swaps the icon for a spinner while that link's page is loading. */
function NavItemContent({ icon: Icon, label, active, collapsed }: { icon: NavItem["icon"]; label: string; active: boolean; collapsed: boolean }) {
  const { pending } = useLinkStatus();
  return (
    <>
      {pending ? (
        <Loader2 className="h-[18px] w-[18px] shrink-0 animate-spin text-primary" aria-hidden />
      ) : (
        <Icon className={cn("h-[18px] w-[18px] shrink-0", active ? "text-primary" : "text-muted-foreground group-hover:text-foreground")} />
      )}
      {!collapsed && <span className="truncate">{label}</span>}
      {pending && <span className="sr-only"> (loading)</span>}
    </>
  );
}

function SidebarNav({ sections, collapsed, onNavigate }: { sections: NavSection[]; collapsed: boolean; onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav className="flex-1 space-y-6 overflow-y-auto px-3 py-5 scrollbar-thin" aria-label="Main">
      {sections.map((section) => (
        <div key={section.title}>
          {!collapsed && <p className="mb-2 px-2.5 text-[10.5px] font-semibold uppercase tracking-[0.09em] text-muted-foreground/70">{section.title}</p>}
          <ul className="space-y-0.5">
            {section.items.map((item) => {
              const active = isActive(pathname, item.href, item.exact);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    // No viewport prefetch: a sidebar of ~15 links would fire ~15 server
                    // requests (each checking the session in the database) per page view.
                    prefetch={false}
                    onClick={onNavigate}
                    title={collapsed ? item.label : undefined}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "group relative flex items-center gap-3 rounded-xl px-2.5 py-2 text-[13.5px] font-medium transition-all",
                      active
                        ? "bg-gradient-to-r from-primary/14 via-primary/[0.07] to-transparent text-foreground before:absolute before:inset-y-2 before:left-0 before:w-[3px] before:rounded-full before:bg-brand"
                        : "text-sidebar-foreground hover:bg-accent/60 hover:text-foreground",
                      collapsed && "justify-center px-0 before:hidden",
                    )}
                  >
                    <NavItemContent icon={item.icon} label={item.label} active={active} collapsed={collapsed} />
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

function Brand({ collapsed, subtitle }: { collapsed: boolean; subtitle: string }) {
  return (
    <div className={cn("flex h-16 items-center gap-3 px-4", collapsed && "justify-center px-0")}>
      <div className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand text-[15px] font-bold text-white shadow-brand">
        V
        <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border-2 border-sidebar bg-emerald-400" aria-hidden />
      </div>
      {!collapsed && (
        <div className="min-w-0 leading-tight">
          <p className="truncate text-[15px] font-semibold tracking-tight">
            VLedger <span className="text-brand">AI</span>
          </p>
          <p className="truncate text-[11px] text-muted-foreground">{subtitle}</p>
        </div>
      )}
    </div>
  );
}

function WorkspaceSwitcher({ current, workspaces }: { current: NonNullable<ShellProps["workspace"]>; workspaces: NonNullable<ShellProps["workspaces"]> }) {
  const router = useRouter();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="flex h-10 max-w-[240px] items-center gap-2 rounded-xl border border-border/80 bg-card/80 px-2.5 text-sm font-medium shadow-xs transition-colors hover:border-primary/30 hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-brand text-[10px] font-bold text-white">{current.code.slice(0, 2)}</span>
          <span className="truncate">{current.name}</span>
          <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel>Switch workspace</DropdownMenuLabel>
        {workspaces.map((w) => (
          <DropdownMenuItem key={w.id} onSelect={() => { if (w.id !== current.id) { startNavigationProgress(); router.push(`/w/${w.id}/dashboard`); } }}>
            <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded bg-accent text-[10px] font-bold text-accent-foreground">{w.code.slice(0, 2)}</div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm">{w.name}</p>
              <p className="truncate text-xs text-muted-foreground">{w.roleName}</p>
            </div>
            {w.id === current.id && <Check className="!text-primary" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);
  const Icon = !mounted ? Monitor : theme === "dark" ? Moon : theme === "light" ? Sun : Monitor;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label="Change theme">
          <Icon className="h-[18px] w-[18px]" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-36">
        {[
          { v: "light", label: "Light", icon: Sun },
          { v: "dark", label: "Dark", icon: Moon },
          { v: "system", label: "System", icon: Monitor },
        ].map(({ v, label, icon: I }) => (
          <DropdownMenuItem key={v} onSelect={() => setTheme(v)}>
            <I /> {label}
            {mounted && theme === v && <Check className="ml-auto !text-primary" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function UserMenu({ user, base }: { user: ShellProps["user"]; base: string }) {
  const router = useRouter();
  const logout = async () => {
    try {
      await apiFetch("/api/auth/logout", { method: "POST" });
    } finally {
      router.replace("/login");
      router.refresh();
    }
  };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="flex items-center gap-2 rounded-full p-0.5 transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:rounded-md sm:py-1 sm:pl-1 sm:pr-2" aria-label="Account menu">
          <Avatar name={user.name} />
          <span className="hidden max-w-[140px] truncate text-sm font-medium lg:block">{user.name}</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-60">
        <div className="px-2 py-2">
          <p className="truncate text-sm font-medium">{user.name}</p>
          <p className="truncate text-xs text-muted-foreground">{user.email}</p>
          <p className="mt-1 text-xs text-primary">{user.roleLabel}</p>
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => { startNavigationProgress(); router.push(`${base}/profile`); }}>
          <UserRound /> Profile
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => { startNavigationProgress(); router.push(`${base}/security`); }}>
          <ShieldCheck /> Security & MFA
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => { startNavigationProgress(); router.push(`${base}/security#password`); }}>
          <KeyRound /> Change password
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={logout} className="text-expense focus:text-expense">
          <LogOut className="!text-expense" /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function AppShell({ variant, user, workspace, workspaces = [], permissions = [], children }: ShellProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [collapsed, setCollapsed] = React.useState(false);
  const [mobileOpen, setMobileOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const sections = useNav(variant, workspace?.id, permissions);
  const base = variant === "admin" ? "/admin" : `/w/${workspace?.id}`;

  React.useEffect(() => {
    try {
      setCollapsed(localStorage.getItem(COLLAPSE_KEY) === "1");
    } catch {}
  }, []);
  React.useEffect(() => setMobileOpen(false), [pathname]);

  const toggleCollapsed = () => {
    setCollapsed((c) => {
      try {
        localStorage.setItem(COLLAPSE_KEY, c ? "0" : "1");
      } catch {}
      return !c;
    });
  };

  const searchRef = React.useRef<HTMLInputElement>(null);
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return;
      if (t && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName))) return;
      e.preventDefault();
      searchRef.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const onSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const q = query.trim();
    if (!q) return;
    startNavigationProgress();
    if (variant === "admin") router.push(`/admin/workspaces?q=${encodeURIComponent(q)}`);
    else {
      const target = permissions.includes("TRANSACTION_VIEW") ? "transactions" : "transactions/mine";
      router.push(`${base}/${target}?q=${encodeURIComponent(q)}`);
    }
  };

  const subtitle = variant === "admin" ? "Super Admin" : (workspace?.name ?? "");

  return (
    <div className="flex min-h-dvh">
      {/* Desktop sidebar */}
      <aside
        className={cn(
          "sticky top-0 hidden h-dvh shrink-0 flex-col border-r border-sidebar-border bg-sidebar/90 bg-[linear-gradient(180deg,color-mix(in_srgb,var(--brand-from)_6%,transparent),transparent_28%)] backdrop-blur-sm transition-[width] duration-200 md:flex print:hidden",
          collapsed ? "w-[72px]" : "w-[260px]",
        )}
      >
        <Brand collapsed={collapsed} subtitle={subtitle} />
        <SidebarNav sections={sections} collapsed={collapsed} />
        <div className="border-t border-sidebar-border p-3">
          <button
            onClick={toggleCollapsed}
            className={cn("flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground", collapsed && "justify-center px-0")}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {collapsed ? <PanelLeftOpen className="h-[18px] w-[18px]" /> : <PanelLeftClose className="h-[18px] w-[18px]" />}
            {!collapsed && "Collapse"}
          </button>
        </div>
      </aside>

      {/* Mobile sidebar */}
      <DialogPrimitive.Root open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent title="Navigation">
          <Brand collapsed={false} subtitle={subtitle} />
          <SidebarNav sections={sections} collapsed={false} onNavigate={() => setMobileOpen(false)} />
        </SheetContent>
      </DialogPrimitive.Root>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-16 print:hidden items-center gap-2 border-b border-border/60 bg-background/75 px-4 backdrop-blur-xl supports-[backdrop-filter]:bg-background/60 sm:gap-3 sm:px-6 lg:px-8">
          <button className="-ml-1 flex h-10 w-10 items-center justify-center rounded-xl hover:bg-accent/70 md:hidden" onClick={() => setMobileOpen(true)} aria-label="Open navigation">
            <Menu className="h-5 w-5" />
          </button>
          {variant === "workspace" && workspace && <WorkspaceSwitcher current={workspace} workspaces={workspaces} />}
          {variant === "admin" && (
            <span className="hidden items-center gap-1.5 rounded-full border border-primary/20 bg-accent/70 px-3 py-1 text-xs font-semibold text-accent-foreground sm:inline-flex"><span className="h-1.5 w-1.5 rounded-full bg-brand" aria-hidden />Super Admin Console</span>
          )}
          <form onSubmit={onSearch} className="ml-auto hidden max-w-sm flex-1 sm:block" role="search">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                ref={searchRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={variant === "admin" ? "Search workspaces…" : "Search transactions…"}
                className="h-10 w-full rounded-xl border border-border/80 bg-card/80 pl-9 pr-10 text-sm shadow-xs transition-[border-color,box-shadow] placeholder:text-muted-foreground/80 hover:border-primary/30 focus-visible:border-primary focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/12"
                aria-label="Search"
              />
              <kbd className="pointer-events-none absolute right-2.5 top-1/2 hidden -translate-y-1/2 rounded-md border border-border bg-muted px-1.5 font-mono text-[10px] text-muted-foreground lg:block">/</kbd>
            </div>
          </form>
          <div className="ml-auto flex items-center gap-1 sm:ml-0">
            <ThemeToggle />
            <UserMenu user={user} base={base} />
          </div>
        </header>
        <main className={cn("mx-auto w-full max-w-[1440px] flex-1 px-4 py-6 sm:px-6 sm:py-8 lg:px-8", variant === "workspace" && permissions.includes("TRANSACTION_CREATE") && "pb-28 sm:pb-28")}>{children}</main>
        {variant === "workspace" && workspace && permissions.includes("TRANSACTION_CREATE") && (
          <AssistantLauncher workspaceId={workspace.id} canPost={permissions.includes("TRANSACTION_POST")} />
        )}
      </div>
    </div>
  );
}

export function notifyError(err: unknown) {
  toast.error(err instanceof Error ? err.message : "Something went wrong");
}
