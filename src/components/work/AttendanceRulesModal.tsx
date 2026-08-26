"use client";

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/common/ToastProvider";

// 가르친 규칙 목록 - 보고, 고치고, 지웁니다.
//
// 담당자 요청: "인박스 가르치기에서 혹시 잘못 가르친 게 있을 수 있으니 가르치기 목록 불러오고
// 수정할 수 있게 해줘."
//
// 맞는 지적입니다. 지금까지는 **넣기만 되고 꺼내 볼 수가 없었습니다.** 한 번 잘못 가르치면
// 그 뒤로 계속 틀린 채로 자동 적용되는데, 어디서 잘못됐는지 볼 방법이 없었습니다.
// 학습하는 기능에는 **되돌리는 자리가 반드시 함께** 있어야 합니다.

type Rule = {
  id: string;
  kind: "alias" | "category" | "ignore";
  pattern: string;
  student_name: string | null;
  student_id: string | null;
  category: string | null;
  created_at?: string | null;
};

const KIND_LABEL: Record<Rule["kind"], { label: string; help: string; chip: string }> = {
  alias: { label: "별칭", help: "이 표기는 이 학생", chip: "bg-blue-50 text-blue-700" },
  category: { label: "분류", help: "이 말은 이 종류", chip: "bg-violet-50 text-violet-700" },
  ignore: { label: "제외", help: "이 말은 출결이 아님", chip: "bg-slate-100 text-slate-500" },
};

export default function AttendanceRulesModal({ onClose }: { onClose: () => void }) {
  const notify = useToast();
  const [rules, setRules] = useState<Rule[]>([]);
  const [students, setStudents] = useState<{ id: string; name: string; grade: string | null }[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const supabase = createClient();
    const [{ data: r }, { data: s }] = await Promise.all([
      supabase.from("attendance_learning_rules").select("*").order("kind").order("pattern"),
      supabase.from("wr_students").select("id, name, grade").eq("status", "active").eq("is_demo", false).order("name"),
    ]);
    setRules((r as Rule[] | null) ?? []);
    setStudents((s as { id: string; name: string; grade: string | null }[] | null) ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function remove(rule: Rule) {
    setBusy(rule.id);
    const supabase = createClient();
    const { error } = await supabase.from("attendance_learning_rules").delete().eq("id", rule.id);
    setBusy(null);
    if (error) return notify("지우지 못했습니다: " + error.message, "error");
    setRules((prev) => prev.filter((x) => x.id !== rule.id));
    notify(`"${rule.pattern}" 규칙을 지웠습니다`, "success");
  }

  async function reassign(rule: Rule, studentId: string) {
    setBusy(rule.id);
    const supabase = createClient();
    const st = students.find((x) => x.id === studentId);
    const { error } = await supabase
      .from("attendance_learning_rules")
      .update({ student_id: studentId || null, student_name: st?.name ?? null })
      .eq("id", rule.id);
    setBusy(null);
    if (error) return notify("바꾸지 못했습니다: " + error.message, "error");
    setRules((prev) => prev.map((x) => (x.id === rule.id ? { ...x, student_id: studentId, student_name: st?.name ?? null } : x)));
    notify("바꿨습니다", "success");
  }

  const body = (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="flex max-h-[80vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-black/5 px-4 py-3">
          <div>
            <h2 className="text-sm font-bold text-slate-800">가르친 규칙</h2>
            <p className="mt-0.5 text-[11px] text-slate-500">
              출결 인박스에서 🔎·⚠️ 를 눌러 알려준 것들입니다. 셔틀 이름 대조에도 함께 쓰입니다.
            </p>
          </div>
          <button type="button" onClick={onClose} className="rounded p-1 text-slate-400 hover:bg-slate-100">
            ✕
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {loading ? (
            <p className="py-8 text-center text-xs text-slate-400">불러오는 중…</p>
          ) : rules.length === 0 ? (
            <p className="py-8 text-center text-xs text-slate-400">
              아직 가르친 규칙이 없습니다.
              <br />
              출결내역에서 🔎 나 ⚠️ 를 눌러 알려주면 여기에 쌓입니다.
            </p>
          ) : (
            <div className="flex flex-col gap-1.5">
              {rules.map((r) => {
                const k = KIND_LABEL[r.kind] ?? KIND_LABEL.alias;
                return (
                  <div key={r.id} className="flex items-center gap-2 rounded-lg border border-black/5 px-2.5 py-2">
                    <span className={"shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold " + k.chip} title={k.help}>
                      {k.label}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[12px] font-semibold text-slate-700" title={r.pattern}>
                      {r.pattern}
                    </span>
                    <span className="shrink-0 text-[11px] text-slate-400">→</span>

                    {r.kind === "alias" ? (
                      // 별칭은 어느 학생인지 바로 바꿀 수 있어야 합니다 - 잘못 가르친 것의
                      // 대부분이 "다른 아이로 연결한" 경우입니다.
                      <select
                        value={r.student_id ?? ""}
                        disabled={busy === r.id}
                        onChange={(e) => reassign(r, e.target.value)}
                        className="min-w-0 max-w-[45%] flex-1 rounded border border-black/10 bg-white px-1.5 py-1 text-[11px] text-slate-700 outline-none focus:border-blue-300 disabled:opacity-40"
                      >
                        <option value="">(연결 안 됨)</option>
                        {students.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name}
                            {s.grade ? ` (${s.grade})` : ""}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span className="max-w-[45%] flex-1 truncate text-[11px] text-slate-600">
                        {r.category ?? r.student_name ?? "-"}
                      </span>
                    )}

                    <button
                      type="button"
                      disabled={busy === r.id}
                      onClick={() => remove(r)}
                      className="shrink-0 rounded px-1.5 py-1 text-[11px] text-slate-400 transition hover:bg-red-50 hover:text-red-600 disabled:opacity-40"
                      title="이 규칙을 지웁니다 - 다음부터 자동 적용되지 않습니다"
                    >
                      지우기
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="shrink-0 border-t border-black/5 px-4 py-2.5 text-[11px] text-slate-500">
          규칙을 지우면 그 표기는 다시 <b>🔎 확인 필요</b>로 돌아옵니다. 잘못 가르친 것이 있으면 지우고 다시 알려주세요.
        </div>
      </div>
    </div>
  );

  if (typeof document === "undefined") return null;
  return createPortal(body, document.body);
}
