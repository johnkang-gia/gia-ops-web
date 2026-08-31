"use client";

import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

// shadcn 규약을 따르되 글래스 토큰(globals.css의 --g-*)을 씁니다.
// 색을 여기 직접 적지 않는 이유: 나중에 톤을 바꿀 때 부품마다 찾아다니지 않기 위해서입니다.
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-xl text-xs font-bold transition-all disabled:pointer-events-none disabled:opacity-45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--g-accent)]/40",
  {
    variants: {
      variant: {
        default:
          "bg-[var(--g-accent)] text-white shadow-[0_4px_14px_-4px_rgba(79,70,229,0.5)] hover:bg-[var(--g-accent-strong)]",
        soft: "bg-[var(--g-accent-soft)] text-[var(--g-accent-strong)] hover:brightness-95",
        glass:
          "bg-white/65 text-[var(--g-ink)] border border-white/70 backdrop-blur-md hover:bg-white/85",
        outline: "border border-slate-300 bg-white/60 text-slate-600 hover:bg-white",
        ghost: "text-slate-500 hover:bg-white/70",
        danger: "bg-rose-500 text-white hover:bg-rose-600",
      },
      size: { sm: "h-7 px-2.5 text-[11px]", md: "h-9 px-3.5", lg: "h-11 px-5 text-sm" },
    },
    defaultVariants: { variant: "default", size: "md" },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />;
  }
);
Button.displayName = "Button";

export { Button, buttonVariants };
