"use client";

import { useRouter, usePathname } from "next/navigation";
import { useState } from "react";

// 학기 고르개. 반/담임 배정 관리와 과목반 세팅 위에 같이 붙습니다.
//
// 담당자: "반/담임 배정관리와 과목의 경우도 정규학기 안에 포함되도록 해서, 학기를 바꾸면
//         이전 학기 반 세팅이 나오도록."
//
// [진행중] 학기는 **지금 세팅**을 그대로 고쳐 씁니다. 지난 학기는 그 학기가 끝날 때 떠둔
// **보관본**을 읽기 전용으로 보여줍니다. 지난 학기 반 배정을 이제 와서 고칠 일은 없고,
// 고칠 수 있게 만들면 오히려 "지금 반"과 헷갈립니다.

export type TermOption = {
  id: string;
  label: string;
  status: "진행중" | "종료";
  hasSnapshot: boolean;
};

export default function TermSettingTabs({
  terms,
  currentTermId,
  selectedTermId,
}: {
  terms: TermOption[];
  /** 지금 진행중인 학기. 이걸 고르면 편집 화면이 나옵니다. */
  currentTermId: string | null;
  selectedTermId: string | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const selected = selectedTermId ?? currentTermId;

  function go(termId: string) {
    router.push(termId === currentTermId ? pathname : `${pathname}?term=${termId}`);
  }

  // 지금 세팅을 이 학기 기록으로 저장. 평소에는 학기 종료 크론이 알아서 뜨지만,
  // 학기 중에 "지금 모습"을 남겨두고 싶을 때 씁니다.
  async function saveNow() {
    if (!currentTermId) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/school/term-snapshot", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ termId: currentTermId }),
      });
      const json = (await res.json()) as { ok?: boolean; classes?: number; subjects?: number; error?: string };
      setMsg(json.ok ? `저장했습니다 · 반 ${json.classes}개 · 과목 ${json.subjects}개` : (json.error ?? "저장하지 못했습니다."));
      if (json.ok) router.refresh();
    } catch {
      setMsg("저장하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mb-3 flex flex-wrap items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 p-2">
      <span className="text-[11px] font-bold text-slate-500">학기</span>
      {terms.map((t) => {
        const isSel = t.id === selected;
        // 보관본이 없는 지난 학기는 눌러도 볼 게 없습니다. 눌리게 두되 흐리게 표시합니다 -
        // 아예 감추면 "그 학기가 없다"로 오해합니다.
        const dim = t.status === "종료" && !t.hasSnapshot;
        return (
          <button
            key={t.id}
            type="button"
            onClick={() => go(t.id)}
            title={dim ? "이 학기의 반·과목 기록이 없습니다" : undefined}
            className={
              "rounded-lg px-2.5 py-1 text-[11px] font-bold transition " +
              (isSel
                ? "bg-slate-800 text-white"
                : dim
                  ? "border border-slate-200 text-slate-300 hover:bg-white"
                  : "border border-slate-300 text-slate-600 hover:bg-white")
            }
          >
            {t.label}
            {t.status === "진행중" && <span className="ml-1 text-emerald-400">●</span>}
          </button>
        );
      })}

      {selected === currentTermId && currentTermId && (
        <>
          <span className="mx-1 h-4 w-px bg-slate-200" />
          <button
            type="button"
            onClick={saveNow}
            disabled={busy}
            className="rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-100 disabled:opacity-50"
          >
            {busy ? "저장 중…" : "📌 지금 세팅을 이 학기 기록으로 저장"}
          </button>
          <span className="text-[11px] text-slate-400">
            학기가 끝날 때 저절로 저장됩니다. 이 버튼은 지금 모습을 미리 남겨둘 때만 쓰세요.
          </span>
        </>
      )}
      {msg && <span className="w-full text-[11px] text-slate-500">{msg}</span>}
    </div>
  );
}
