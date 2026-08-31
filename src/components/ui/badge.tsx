import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva("g-chip", {
  variants: {
    tone: {
      neutral: "bg-slate-100/80 text-slate-600",
      accent: "bg-[var(--g-accent-soft)] text-[var(--g-accent-strong)]",
      ok: "bg-emerald-100/80 text-emerald-700",
      warn: "bg-amber-100/80 text-amber-800",
      bad: "bg-rose-100/80 text-rose-700",
      sky: "bg-sky-100/80 text-sky-700",
    },
  },
  defaultVariants: { tone: "neutral" },
});

export function Badge({
  className,
  tone,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}
