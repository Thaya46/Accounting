import * as React from "react";
import { cn } from "@/lib/utils";

const fieldBase =
  "flex w-full rounded-lg border border-input bg-card px-3 py-1 text-sm shadow-xs transition-[border-color,box-shadow] placeholder:text-muted-foreground/80 hover:border-primary/30 focus-visible:outline-none focus-visible:border-primary focus-visible:ring-4 focus-visible:ring-primary/12 disabled:cursor-not-allowed disabled:opacity-60 aria-[invalid=true]:border-destructive";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(({ className, type, ...props }, ref) => (
  <input type={type} className={cn(fieldBase, "h-9 file:border-0 file:bg-transparent file:text-sm file:font-medium", className)} ref={ref} {...props} />
));
Input.displayName = "Input";

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(({ className, ...props }, ref) => (
  <textarea className={cn(fieldBase, "min-h-[80px] py-2", className)} ref={ref} {...props} />
));
Textarea.displayName = "Textarea";

/** Styled native select — accessible, works without JS, and simple in forms. */
export const NativeSelect = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(({ className, children, ...props }, ref) => (
  <select
    ref={ref}
    className={cn(
      fieldBase,
      "h-9 appearance-none bg-[url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%2364748b' stroke-width='2'><path d='m6 9 6 6 6-6'/></svg>\")] bg-[length:16px] bg-[right_0.6rem_center] bg-no-repeat pr-8",
      className,
    )}
    {...props}
  >
    {children}
  </select>
));
NativeSelect.displayName = "NativeSelect";
