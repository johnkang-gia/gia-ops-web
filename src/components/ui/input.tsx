import * as React from "react";
import { cn } from "@/lib/utils";

const base =
  "w-full rounded-xl border border-white/70 bg-white/65 px-2.5 py-1.5 text-xs text-[var(--g-ink)] outline-none backdrop-blur-sm transition placeholder:text-slate-400 focus:border-[var(--g-accent)]/45 focus:bg-white focus:ring-2 focus:ring-[var(--g-accent)]/20 disabled:opacity-50";

export function Input({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(base, className)} {...props} />;
}
export function Select({ className, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cn(base, "pr-7", className)} {...props} />;
}
export function Textarea({ className, ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(base, "resize-none", className)} {...props} />;
}
