"use client";

import * as React from "react";
import { ArrowDown, ArrowUp, Plus, Save, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, NativeSelect } from "@/components/ui/input";
import { Switch } from "@/components/ui/misc";
import { FormField } from "@/components/ui/feedback";
import type { AdapterConfig, AdapterSpecDTO, CustomColumn } from "@/lib/export/types";

/** Workspace configuration form generated from an adapter's configFields. */
export function AdapterConfigForm({
  adapter,
  config,
  customFields,
  onSave,
  saving,
}: {
  adapter: Pick<AdapterSpecDTO, "key" | "configFields">;
  config: AdapterConfig;
  customFields: { field: string; label: string }[];
  onSave: (config: AdapterConfig) => Promise<void> | void;
  saving?: boolean;
}) {
  const [values, setValues] = React.useState<AdapterConfig>(config);
  React.useEffect(() => setValues(config), [config]);
  const dirty = JSON.stringify(values) !== JSON.stringify(config);
  const set = (key: string, v: AdapterConfig[string]) => setValues((s) => ({ ...s, [key]: v }));
  const missing = adapter.configFields.filter((f) => f.required && f.type !== "columns" && !String(values[f.key] ?? "").trim());

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        onSave(values);
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        {adapter.configFields
          .filter((f) => f.type !== "columns")
          .map((f) => {
            const id = `${adapter.key}-${f.key}`;
            if (f.type === "boolean") {
              return (
                <div key={f.key} className="flex items-start justify-between gap-3 rounded-lg border p-3 sm:col-span-2">
                  <div>
                    <label htmlFor={id} className="text-sm font-medium">
                      {f.label}
                    </label>
                    {f.help && <p className="text-xs text-muted-foreground">{f.help}</p>}
                  </div>
                  <Switch id={id} checked={values[f.key] === true} onCheckedChange={(v) => set(f.key, v)} />
                </div>
              );
            }
            return (
              <FormField key={f.key} label={f.label} htmlFor={id} hint={f.help} required={f.required}>
                {f.type === "select" ? (
                  <NativeSelect id={id} value={String(values[f.key] ?? "")} onChange={(e) => set(f.key, e.target.value)}>
                    {(f.options ?? []).map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </NativeSelect>
                ) : (
                  <Input id={id} value={String(values[f.key] ?? "")} maxLength={f.maxLength} placeholder={f.placeholder} onChange={(e) => set(f.key, e.target.value)} />
                )}
              </FormField>
            );
          })}
      </div>

      {adapter.configFields
        .filter((f) => f.type === "columns")
        .map((f) => (
          <ColumnsEditor key={f.key} label={f.label} help={f.help} fields={customFields} value={Array.isArray(values[f.key]) ? (values[f.key] as CustomColumn[]) : []} onChange={(cols) => set(f.key, cols)} />
        ))}

      <div className="flex flex-wrap items-center justify-end gap-2">
        {missing.length > 0 && <span className="text-xs text-warning">Required: {missing.map((m) => m.label).join(", ")}</span>}
        <Button type="button" variant="ghost" size="sm" disabled={!dirty || saving} onClick={() => setValues(config)}>
          Discard
        </Button>
        <Button type="submit" size="sm" loading={saving} disabled={!dirty}>
          <Save /> Save settings
        </Button>
      </div>
    </form>
  );
}

function ColumnsEditor({ label, help, fields, value, onChange }: { label: string; help?: string; fields: { field: string; label: string }[]; value: CustomColumn[]; onChange: (cols: CustomColumn[]) => void }) {
  const labelOf = (f: string) => fields.find((x) => x.field === f)?.label ?? f;
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= value.length) return;
    const next = [...value];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };
  const add = () => {
    const unused = fields.find((f) => !value.some((c) => c.field === f.field)) ?? fields[0];
    if (unused) onChange([...value, { field: unused.field, header: labelOf(unused.field).replace(/\s*\(.*\)$/, "") }]);
  };
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <p className="text-sm font-medium">
            {label}
            <span className="ml-0.5 text-expense">*</span>
          </p>
          {help && <p className="text-xs text-muted-foreground">{help}</p>}
        </div>
        <Button type="button" variant="outline" size="sm" onClick={add} disabled={value.length >= 60}>
          <Plus /> Add column
        </Button>
      </div>
      {value.length === 0 ? (
        <p className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">No columns yet. Add the fields your accounting software expects, in its order.</p>
      ) : (
        <ol className="space-y-2">
          {value.map((c, i) => (
            <li key={i} className="grid grid-cols-[auto_1fr_auto] items-center gap-2 rounded-lg border p-2 sm:grid-cols-[auto_1fr_1fr_auto]">
              <span className="w-6 text-center text-xs text-muted-foreground tabular">{i + 1}</span>
              <NativeSelect
                aria-label={`Field for column ${i + 1}`}
                value={c.field}
                onChange={(e) => onChange(value.map((x, k) => (k === i ? { ...x, field: e.target.value } : x)))}
                className="h-8"
              >
                {fields.map((f) => (
                  <option key={f.field} value={f.field}>
                    {f.label}
                  </option>
                ))}
              </NativeSelect>
              <Input
                aria-label={`Heading for column ${i + 1}`}
                value={c.header}
                maxLength={80}
                placeholder="Column heading"
                onChange={(e) => onChange(value.map((x, k) => (k === i ? { ...x, header: e.target.value } : x)))}
                className="col-span-2 h-8 sm:col-span-1"
              />
              <div className="col-start-3 row-start-1 flex items-center gap-0.5 sm:col-start-auto sm:row-start-auto">
                <Button type="button" variant="ghost" size="icon-sm" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)}>
                  <ArrowUp />
                </Button>
                <Button type="button" variant="ghost" size="icon-sm" aria-label="Move down" disabled={i === value.length - 1} onClick={() => move(i, 1)}>
                  <ArrowDown />
                </Button>
                <Button type="button" variant="ghost" size="icon-sm" aria-label="Remove column" onClick={() => onChange(value.filter((_, k) => k !== i))}>
                  <Trash2 />
                </Button>
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
