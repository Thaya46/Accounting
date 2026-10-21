import { requireSuperAdmin } from "@/lib/auth/guards";
import { AppShell } from "@/components/shell/app-shell";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const { user } = await requireSuperAdmin();
  return (
    <AppShell variant="admin" user={{ name: user.name, email: user.email, roleLabel: "Super Admin" }}>
      {children}
    </AppShell>
  );
}
