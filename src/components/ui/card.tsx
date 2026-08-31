import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * 유리판 카드.
 *
 * `solid`는 글자가 빽빽한 판(표·목록)에 씁니다 - 반투명이 지나치면 읽기가 나빠지는데,
 * 이 앱은 하원 4시에 여러 명이 동시에 보는 화면이 중심이라 읽기가 먼저입니다.
 */
function Card({
  className,
  solid = false,
  hover = false,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { solid?: boolean; hover?: boolean }) {
  return (
    <div
      className={cn(solid ? "g-panel-solid" : "g-panel", hover && "g-panel-hover", className)}
      {...props}
    />
  );
}

function CardHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex flex-wrap items-center justify-between gap-2 px-4 pt-3.5", className)} {...props} />;
}
function CardTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={cn("text-[13px] font-bold text-[var(--g-ink)]", className)} {...props} />;
}
function CardDescription({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn("text-[11px] text-[var(--g-muted)]", className)} {...props} />;
}
function CardContent({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("px-4 py-3", className)} {...props} />;
}

export { Card, CardHeader, CardTitle, CardDescription, CardContent };
