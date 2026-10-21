"use client";

import * as React from "react";
import { useRouter, usePathname } from "next/navigation";
import { Calendar, ChevronUp, ChevronDown, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";

const SHORTCUTS = [
  { key: "F2", label: "Date", action: "date" },
  { key: "F4", label: "Contra", type: "CONTRA" },
  { key: "F5", label: "Payment", type: "PAYMENT" },
  { key: "F6", label: "Receipt", type: "RECEIPT" },
  { key: "F7", label: "Journal", type: "JOURNAL" },
  { key: "F8", label: "Sales", type: "SALES" },
  { key: "F9", label: "Purchase", type: "PURCHASE" },
];

export function TallyShortcutBar({ workspaceId }: { workspaceId: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const [collapsed, setCollapsed] = React.useState(false);
  const [showDatePicker, setShowDatePicker] = React.useState(false);
  const [targetDate, setTargetDate] = React.useState(new Date().toISOString().slice(0, 10));

  const triggerVoucher = React.useCallback((type: string) => {
    // Open manual entry pre-filled with the voucher type or prompt
    router.push(`/w/${workspaceId}/transactions/new?type=${type}`);
  }, [router, workspaceId]);

  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't intercept if user is typing in an input or textarea
      const target = e.target as HTMLElement;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) {
        return;
      }

      switch (e.key) {
        case "F2":
          e.preventDefault();
          setShowDatePicker((prev) => !prev);
          break;
        case "F4":
          e.preventDefault();
          triggerVoucher("CONTRA");
          break;
        case "F5":
          e.preventDefault();
          triggerVoucher("PAYMENT");
          break;
        case "F6":
          e.preventDefault();
          triggerVoucher("RECEIPT");
          break;
        case "F7":
          e.preventDefault();
          triggerVoucher("JOURNAL");
          break;
        case "F8":
          e.preventDefault();
          triggerVoucher("SALES");
          break;
        case "F9":
          e.preventDefault();
          triggerVoucher("PURCHASE");
          break;
        case "Escape":
          setShowDatePicker(false);
          break;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [triggerVoucher]);

  return (
    <>
      {/* Date Switcher Modal (F2) */}
      {showDatePicker && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-xs">
          <div className="w-full max-w-sm rounded-xl border bg-card p-5 shadow-lg">
            <h3 className="flex items-center gap-2 text-base font-semibold">
              <Calendar className="h-4 w-4 text-primary" /> Change Voucher Date (F2)
            </h3>
            <p className="mt-1 text-xs text-muted-foreground">Select date to jump to in Day Book or new voucher.</p>
            <div className="mt-4">
              <input
                type="date"
                value={targetDate}
                onChange={(e) => setTargetDate(e.target.value)}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
              />
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setShowDatePicker(false)}>
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={() => {
                  setShowDatePicker(false);
                  router.push(`/w/${workspaceId}/daybook?date=${targetDate}`);
                }}
              >
                Go to Day Book
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Floating Bottom Shortcut Bar (Centered dock so it never overlaps AI Entry button) */}
      <div className="fixed bottom-3 left-1/2 -translate-x-1/2 z-40 hidden md:block">
        <div className="flex items-center gap-1.5 rounded-xl border border-border/80 bg-card/95 px-2.5 py-1.5 shadow-lg backdrop-blur-md">
          <button
            onClick={() => setCollapsed(!collapsed)}
            className="flex items-center gap-1 rounded px-2 py-1 text-xs font-semibold text-muted-foreground hover:bg-muted"
            title="Toggle Tally Shortcut Bar"
          >
            <span className="font-mono text-primary font-bold">Tally</span>
            {collapsed ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          </button>

          {!collapsed && (
            <div className="flex items-center gap-1">
              {SHORTCUTS.map((s) => (
                <button
                  key={s.key}
                  onClick={() => {
                    if (s.action === "date") setShowDatePicker(true);
                    else if (s.type) triggerVoucher(s.type);
                  }}
                  className="flex items-center gap-1 rounded bg-muted/80 px-2.5 py-1 text-xs font-medium transition-colors hover:bg-primary hover:text-primary-foreground"
                >
                  <kbd className="font-mono font-bold text-xs">{s.key}</kbd>
                  <span className="text-[11px] opacity-80">{s.label}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
