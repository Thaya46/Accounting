"use client";

import { Check, X } from "lucide-react";
import { cn } from "@/lib/utils";

export const PASSWORD_RULES: [RegExp, string][] = [
  [/.{10,}/, "At least 10 characters"],
  [/[a-z]/, "A lowercase letter"],
  [/[A-Z]/, "An uppercase letter"],
  [/\d/, "A number"],
  [/[^A-Za-z0-9]/, "A symbol"],
];

export function PasswordChecklist({ password }: { password: string }) {
  return (
    <ul className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
      {PASSWORD_RULES.map(([re, label]) => {
        const ok = re.test(password);
        return (
          <li key={label} className={cn("flex items-center gap-1.5", ok ? "text-income" : "text-muted-foreground")}>
            {ok ? <Check className="h-3.5 w-3.5" /> : <X className="h-3.5 w-3.5" />} {label}
          </li>
        );
      })}
    </ul>
  );
}
