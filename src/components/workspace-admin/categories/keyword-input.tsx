"use client";

import * as React from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

/** Chip input for AI keywords: Enter, comma or Tab adds; Backspace on empty input removes the last chip. */
export function KeywordInput({ id, value, onChange, max = 60, placeholder = "Type a keyword and press Enter" }: { id?: string; value: string[]; onChange: (next: string[]) => void; max?: number; placeholder?: string }) {
  const [draft, setDraft] = React.useState("");
  const inputRef = React.useRef<HTMLInputElement>(null);

  function add(raw: string) {
    const parts = raw
      .split(/[,\n]/)
      .map((p) => p.trim().toLowerCase().slice(0, 60))
      .filter(Boolean);
    if (!parts.length) return;
    const next = [...value];
    for (const p of parts) if (!next.includes(p) && next.length < max) next.push(p);
    onChange(next);
    setDraft("");
  }

  return (
    <div
      className="flex min-h-9 w-full cursor-text flex-wrap items-center gap-1.5 rounded-md border border-input bg-card px-2 py-1.5 shadow-xs focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/40"
      onClick={() => inputRef.current?.focus()}
    >
      {value.map((k) => (
        <span key={k} className="inline-flex items-center gap-1 rounded-full bg-accent px-2 py-0.5 text-xs font-medium text-accent-foreground">
          {k}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onChange(value.filter((v) => v !== k));
            }}
            className="rounded-full p-0.5 hover:bg-primary/15"
            aria-label={`Remove ${k}`}
          >
            <X className="h-3 w-3" />
          </button>
        </span>
      ))}
      <input
        id={id}
        ref={inputRef}
        value={draft}
        onChange={(e) => {
          const v = e.target.value;
          if (v.includes(",")) add(v);
          else setDraft(v);
        }}
        onKeyDown={(e) => {
          if ((e.key === "Enter" || e.key === "Tab") && draft.trim()) {
            e.preventDefault();
            add(draft);
          } else if (e.key === "Backspace" && !draft && value.length) {
            onChange(value.slice(0, -1));
          }
        }}
        onBlur={() => draft.trim() && add(draft)}
        onPaste={(e) => {
          const text = e.clipboardData.getData("text");
          if (/[,\n]/.test(text)) {
            e.preventDefault();
            add(text);
          }
        }}
        placeholder={value.length ? "" : placeholder}
        className={cn("min-w-[8rem] flex-1 bg-transparent py-0.5 text-sm outline-none placeholder:text-muted-foreground")}
        disabled={value.length >= max}
      />
    </div>
  );
}
