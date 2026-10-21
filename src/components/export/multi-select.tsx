"use client";

import * as React from "react";
import { ChevronDown, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/misc";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/overlay";
import { cn } from "@/lib/utils";

export type Option = { value: string; label: string; hint?: string; group?: string };

/** Searchable checkbox list in a popover. Empty selection means "all". */
export function MultiSelect({ options, value, onChange, allLabel, noun, id, disabled }: { options: Option[]; value: string[]; onChange: (v: string[]) => void; allLabel: string; noun: string; id?: string; disabled?: boolean }) {
  const [query, setQuery] = React.useState("");
  const q = query.trim().toLowerCase();
  const visible = q ? options.filter((o) => `${o.label} ${o.hint ?? ""}`.toLowerCase().includes(q)) : options;
  const selected = new Set(value);
  const summary = value.length === 0 ? allLabel : value.length === 1 ? (options.find((o) => o.value === value[0])?.label ?? `1 ${noun}`) : `${value.length} ${noun}s`;
  const groups = [...new Set(visible.map((o) => o.group ?? ""))];

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button id={id} type="button" variant="outline" disabled={disabled} className="w-full justify-between font-normal">
          <span className={cn("truncate", value.length === 0 && "text-muted-foreground")}>{summary}</span>
          <ChevronDown className="opacity-60" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[min(22rem,calc(100vw-2rem))] p-0">
        <div className="border-b p-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={`Search ${noun}s`} className="pl-8" aria-label={`Search ${noun}s`} />
          </div>
        </div>
        <div className="max-h-72 overflow-y-auto p-1 scrollbar-thin">
          {visible.length === 0 && <p className="p-3 text-center text-sm text-muted-foreground">No matches</p>}
          {groups.map((g) => (
            <div key={g || "all"}>
              {g && <p className="px-2 pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{g}</p>}
              {visible
                .filter((o) => (o.group ?? "") === g)
                .map((o) => (
                  <label key={o.value} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted">
                    <Checkbox checked={selected.has(o.value)} onCheckedChange={(c) => onChange(c ? [...value, o.value] : value.filter((v) => v !== o.value))} />
                    <span className="min-w-0 flex-1 truncate">{o.label}</span>
                    {o.hint && <span className="shrink-0 font-mono text-xs text-muted-foreground">{o.hint}</span>}
                  </label>
                ))}
            </div>
          ))}
        </div>
        {value.length > 0 && (
          <div className="flex items-center justify-between border-t p-2">
            <span className="text-xs text-muted-foreground">{value.length} selected</span>
            <Button type="button" variant="ghost" size="sm" onClick={() => onChange([])}>
              <X /> Clear
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
