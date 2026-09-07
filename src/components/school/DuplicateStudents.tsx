"use client";

import { useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/common/ToastProvider";
import { useConfirm } from "@/components/common/ConfirmProvider";
import type { DupGroup, DupPerson } from "@/lib/studentDuplicates";

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

export type DupStudent = DupPerson;

export default function DuplicateStudents({ groups, canMerge }: { groups: DupGroup[]; canMerge: boolean }) {
  const notify = useToast();
  const confirmAction = useConfirm();
  const [rows, setRows] = useState(groups);
  const [busy, setBusy] = useState<string | null>(null);

  const total = useMemo(() => rows.reduce((n, g) => n + g.people.length, 0), [rows]);
  if (rows.length === 0) return null;

  async function merge(group: DupGroup, keep: DupStudent) {
    const others = group.people.filter((s) => s.id !== keep.id);
    const ok = await confirmAction(
      `${keep.name} ${others.length + 1}줄을 한 줄로 합칩니다.\n` +
        `남길 줄: ${keep.birth_date ?? "생일 없음"} · ${keep.grade ?? "?"}학년 ${keep.class_name ?? ""}\n\n` +
        `· 출결·셔틀·인보이스 같은 기록은 남길 줄로 옮겨집니다\n` +
        `· 남길 줄에 비어 있는 칸(생일·영문이름·연락처 등)은 지울 줄의 값으로 채워집니다\n` +
        `· 같은 날 출결처럼 겹치는 줄은 빈 칸끼리 합친 뒤 하나로 정리됩니다\n\n` +
        `되돌릴 수 없습니다.`,
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
    setRows((p) => p.filter((g) => g.key !== group.key));
    notify(`${keep.name} 을(를) 한 줄로 합쳤습니다.`, "success");
  }

  return (
    <section className="mb-4 rounded-2xl border-2 border-amber-300 bg-amber-50 p-3">
      <h2 className="mb-1 text-[15px] font-bold text-amber-900">
        👥 같은 아이일 수 있는 줄 {rows.length}건 ({total}줄)
      </h2>
      <p className="mb-2 text-[11px] leading-relaxed text-amber-800">
        이름이 같은 경우뿐 아니라 <b>한쪽 이름이 다른 쪽에 들어 있거나</b>(제이콥 · 제이콥 딜런 마), 생년월일이나 영문
        이름이 같은 줄도 함께 올립니다. <b>재학과 보류를 함께 봅니다</b> — 명부를 반영할 때 새 줄이 생기고 옛 줄이
        보류로 넘어가서, 중복은 대개 이 두 상태에 하나씩 걸쳐 있습니다. 같은 아이가 두 줄로 들어간 것일 수도, 정말
        동명이인일 수도 있습니다 —<b> 아래 근거와 생년월일·반을 보고</b> 판단해 주세요.
        {canMerge ? " 합치면 되돌릴 수 없습니다." : " 합치는 것은 관리자만 할 수 있습니다."}
      </p>

      <div className="flex flex-col gap-2">
        {rows.map((g) => (
          <div key={g.key} className="rounded-xl border border-amber-200 bg-white p-2">
            <p className="mb-1 flex flex-wrap items-baseline gap-2 text-[13px] font-bold text-slate-800">
              {g.people.map((s) => s.name).join(" · ")}
              {/* 왜 같은 아이로 의심하는지. 근거가 «이름 같음»뿐이면 동명이인일 가능성이
                  높고, 생년월일까지 같으면 거의 같은 아이입니다. */}
              {g.reasons.map((r) => (
                <span key={r} className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-800">
                  {r}
                </span>
              ))}
            </p>
            <ul className="flex flex-col gap-1">
              {g.people.map((s) => (
                <li key={s.id} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px]">
                  <b className="w-28 shrink-0 text-slate-800">{s.name}</b>
                  {/* 상태가 다른 두 줄이 가장 흔한 중복입니다. 어느 쪽이 「지금 쓰는 줄」인지
                      보여야 어느 쪽으로 합칠지 정할 수 있습니다 — 대개 재학 쪽으로 합칩니다. */}
                  <span
                    className={
                      "shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold " +
                      (s.status === "보류" ? "bg-amber-100 text-amber-800" : "bg-emerald-100 text-emerald-800")
                    }
                  >
                    {s.status === "보류" ? "보류" : "재학"}
                  </span>
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
