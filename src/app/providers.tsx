"use client";

import { ThemeProvider } from "next-themes";
import { Toaster } from "sonner";
import { NavigationProgress } from "@/components/shell/navigation-progress";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      <NavigationProgress />
      {children}
      <Toaster richColors closeButton position="top-right" toastOptions={{ className: "text-sm" }} />
    </ThemeProvider>
  );
}
