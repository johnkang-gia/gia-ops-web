"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Term } from "@/lib/types";

// 지금 보고 있는 학기.
//
// 화면 위에 늘 붙어 있습니다. 지난 학기를 열어둔 채로 새 기록을 남기려다 "왜 안 보이지"가
// 되는 일이 가장 흔한 사고라, **보고 있는 학기를 계속 눈에 띄게** 둡니다.

export default function TermScopeBar({ term, terms }: { term: Term | null; terms: Term[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState(false);

  if (!term || terms.length <= 1) return null;
  const past = term.status !== "진행중";

  function pick(id: string) {
    setBusy(true);
    void fetch("/api/terms/scope", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ termId: id }),
    })
      .then(() => start(() => router.refresh()))
      .finally(() => setBusy(false));
  }

  return (
    <span
      className={
        "flex shrink-0 items-center gap-1 rounded-lg px-1.5 py-0.5 " +
        (past ? "bg-amber-100" : "bg-transparent")
      }
      title="보고 있는 학기. 바꾸면 업무·회의·기록·셔틀·재무가 그 학기 것으로 바뀝니다."
    >
      <select
        value={term.id}
        disabled={busy || pending}
        onChange={(e) => pick(e.target.value)}
        className={
          "rounded-md border px-1.5 py-0.5 text-[11px] font-bold " +
          (past ? "border-amber-400 bg-white text-amber-900" : "border-[var(--shell-border)] bg-transparent text-[var(--shell-text-muted)]")
        }
      >
        {terms.map((t) => (
          <option key={t.id} value={t.id}>
            {t.year} {t.term_type}
            {t.status === "진행중" ? " (지금)" : ""}
          </option>
        ))}
      </select>
      {past && <span className="text-[10px] font-bold text-amber-800">지난 학기</span>}
    </span>
  );
}
