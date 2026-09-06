"use client";

import { useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/common/ToastProvider";
import { useConfirm } from "@/components/common/ConfirmProvider";

/**
 * 이름이 겹치는 재학생.
 *
 * 명부를 반영할 때 «이름 + 생년월일»로 짝을 찾습니다. 앱에 이미 있던 줄의 생년월일이
 * 명부와 다르면 짝을 못 찾고 **새 학생으로 만듭니다.** 그렇게 조하윤이 두 줄이 됐습니다.
 *
 * 이름이 겹친다고 전부 중복은 아닙니다 — 김재이가 셋, 이준서가 둘입니다. 그래서 여기서는
 * 보여주기만 하고 **사람이 고른 것만** 합칩니다. 합치는 일은 되돌릴 수 없습니다.
 *
 * 합치기는 DB 함수(merge_students)가 합니다. 화면에서 표를 하나씩 옮기지 않는 이유는,
 * 학생을 가리키는 표가 지금 25곳이고 앞으로도 늘기 때문입니다. 목록을 화면에 적어두면
 * 새 표가 생길 때마다 여기를 고쳐야 하고, 잊으면 그 표만 옛 학생을 가리킨 채 남습니다.
 */

export type DupStudent = {
  id: string;
  name: string;
  name_en: string | null;
  grade: string | null;
  class_name: string | null;
  birth_date: string | null;
  created_at: string;
};

export default function DuplicateStudents({ groups, canMerge }: { groups: DupStudent[][]; canMerge: boolean }) {
  const notify = useToast();
  const confirmAction = useConfirm();
  const [rows, setRows] = useState(groups);
  const [busy, setBusy] = useState<string | null>(null);

  const total = useMemo(() => rows.reduce((n, g) => n + g.length, 0), [rows]);
  if (rows.length === 0) return null;

  async function merge(group: DupStudent[], keep: DupStudent) {
    const others = group.filter((s) => s.id !== keep.id);
    const ok = await confirmAction(
      `${keep.name} ${others.length + 1}줄을 한 줄로 합칩니다.\n` +
        `남길 줄: ${keep.birth_date ?? "생일 없음"} · ${keep.grade ?? "?"}학년 ${keep.class_name ?? ""}\n\n` +
        `출결·셔틀·인보이스 같은 기록은 남길 줄로 옮겨집니다. 되돌릴 수 없습니다.`,
      { danger: true },
    );
    if (!ok) return;

    setBusy(keep.id);
    const supabase = createClient();
    for (const o of others) {
      const { error } = await supabase.rpc("merge_students", { keep_id: keep.id, drop_id: o.id });
      if (error) {
        // 조용히 넘기면 화면에서는 합쳐진 것처럼 보이는데 두 줄이 그대로 남습니다.
        setBusy(null);
        notify("합치지 못했습니다: " + error.message, "error");
        return;
      }
    }
    setBusy(null);
    setRows((p) => p.filter((g) => g[0]?.name !== group[0]?.name));
    notify(`${keep.name} 을(를) 한 줄로 합쳤습니다.`, "success");
  }

  return (
    <section className="mb-4 rounded-2xl border-2 border-amber-300 bg-amber-50 p-3">
      <h2 className="mb-1 text-[15px] font-bold text-amber-900">
        👥 이름이 겹치는 학생 {rows.length}건 ({total}줄)
      </h2>
      <p className="mb-2 text-[11px] leading-relaxed text-amber-800">
        같은 아이가 두 줄로 들어간 것일 수도, 정말 동명이인일 수도 있습니다. <b>생년월일과 반을 보고</b> 판단해 주세요.
        {canMerge ? " 합치면 되돌릴 수 없습니다." : " 합치는 것은 관리자만 할 수 있습니다."}
      </p>

      <div className="flex flex-col gap-2">
        {rows.map((g) => (
          <div key={g[0].id} className="rounded-xl border border-amber-200 bg-white p-2">
            <p className="mb-1 text-[13px] font-bold text-slate-800">{g[0].name}</p>
            <ul className="flex flex-col gap-1">
              {g.map((s) => (
                <li key={s.id} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px]">
                  <span className="w-20 shrink-0 text-slate-500">{s.birth_date ?? "생일 없음"}</span>
                  <span className="text-slate-700">
                    {s.grade ? `${s.grade}학년` : "학년 없음"} {s.class_name ?? "반 없음"}
                  </span>
                  {s.name_en && <span className="text-slate-400">{s.name_en}</span>}
                  <span className="text-[10px] text-slate-300">등록 {s.created_at.slice(0, 10)}</span>
                  {canMerge && (
                    <button
                      type="button"
                      disabled={busy === s.id}
                      onClick={() => void merge(g, s)}
                      className="ml-auto rounded-lg border border-amber-400 px-2 py-0.5 text-[11px] font-semibold text-amber-800 hover:bg-amber-100 disabled:opacity-40"
                      title="이 줄을 남기고 나머지를 여기에 합칩니다"
                    >
                      {busy === s.id ? "합치는 중…" : "이 줄로 합치기"}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}
