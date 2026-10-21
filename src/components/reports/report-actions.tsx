"use client";

import { Download, Printer } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

export type CsvRows = (string | number | null | undefined)[][];

/** Neutralises spreadsheet formulas while keeping negative numbers intact. */
function cell(value: string | number | null | undefined) {
  let v = value === null || value === undefined ? "" : String(value);
  if (/^[=+@\t\r]/.test(v) || /^-[^\d.]/.test(v)) v = `'${v}`;
  return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export function toCsv(rows: CsvRows) {
  return "﻿" + rows.map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
}

export function downloadCsv(filename: string, rows: CsvRows) {
  const blob = new Blob([toCsv(rows)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(".csv") ? filename : `${filename}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** CSV download (generated in the browser from the visible report) and print. */
export function ReportActions({ filename, rows, printable = true }: { filename: string; rows: CsvRows; printable?: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-2 print:hidden">
      <Button
        variant="outline"
        size="sm"
        onClick={() => {
          try {
            downloadCsv(filename, rows);
          } catch {
            toast.error("Could not generate the CSV file");
          }
        }}
      >
        <Download /> Download CSV
      </Button>
      {printable && (
        <Button variant="outline" size="sm" onClick={() => window.print()}>
          <Printer /> Print
        </Button>
      )}
    </div>
  );
}
