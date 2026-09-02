"use client";

import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/common/ToastProvider";
import { normalizeRulePattern, type LearningRule, type RosterStudent } from "@/lib/attendanceDigest";

// 🔎(명부 대조 실패)·⚠️(동명이인 미확정) 항목을 눌렀을 때 뜨는 "가르치기" 창입니다.
//
// 이 화면의 목적은 하나입니다 - **한 번 고치면 다시는 안 묻는 것**. 오늘 "Maya"를 김마야로
// 골라주면 그 사실이 규칙으로 저장되어, 내일부터 "Maya"가 들어오면 자동으로 김마야가 됩니다.
// AI를 부르지 않으므로 비용이 들지 않고, 저장하는 순간 바로 적용됩니다.
export default function AttendanceTeachModal({
  rawText,
  guessedName,
  roster,
  rules,
  currentUserEmail,
  onClose,
  onSaved,
}: {
  /** 원문. 여기서 어느 표기를 가르칠지 고릅니다. */
  rawText: string;
  /** 지금 화면에 뜬(추정된) 이름 - 기본 후보로 씁니다. */
  guessedName: string;
  roster: RosterStudent[];
  rules: LearningRule[];
  currentUserEmail: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const notify = useToast();
  const [pattern, setPattern] = useState(guessedName.trim());
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);

  // 이름 후보 - 검색어가 있으면 좁히고, 없으면 앞부분만 보여줍니다.
  const candidates = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q
      ? roster.filter((s) => s.name.toLowerCase().includes(q) || (s.nameEn ?? "").toLowerCase().includes(q))
      : roster;
    return list.slice(0, 40);
  }, [roster, query]);

  // 이미 이 표기로 배운 규칙이 있으면 알려줍니다(덮어쓰기라는 것을 미리 보여주려고).
  const existing = rules.find((r) => r.kind === "alias" && normalizeRulePattern(r.pattern) === normalizeRulePattern(pattern));

  async function save(kind: "alias" | "ignore", student?: RosterStudent) {
    const p = pattern.trim();
    if (!p) {
      notify("가르칠 표기를 적어주세요.", "error");
      return;
    }
    setBusy(true);
    const supabase = createClient();
    // 학생 id는 명부에서 찾아 넣습니다(이름이 바뀌어도 연결이 유지되도록).
    const { data: found } =
      kind === "alias" && student
        ? await supabase.from("wr_students").select("id").eq("is_demo", false).eq("name", student.name).limit(1).maybeSingle()
        : { data: null };

    const { error } = await supabase.from("attendance_learning_rules").upsert(
      {
        kind,
        pattern: normalizeRulePattern(p),
        student_id: (found as { id: string } | null)?.id ?? null,
        student_name: kind === "alias" ? (student?.name ?? null) : null,
        category: null,
        created_by: currentUserEmail,
      },
      { onConflict: "kind,pattern" }
    );
    setBusy(false);
    if (error) {
      notify("저장하지 못했습니다: " + error.message, "error");
      return;
    }
    notify(
      kind === "alias"
        ? `"${p}" → ${student?.name} 으로 배웠습니다. 다음부터 자동으로 연결됩니다.`
        : `"${p}" 는 학생 이름이 아닌 것으로 배웠습니다.`,
      "success"
    );
    onSaved();
    onClose();
  }

  // 화면 맨 위에 그립니다(createPortal → document.body).
  //
  // 담당자: "하원체크표에서 돋보기 누르니까 가르치기 창이 나오는데, 이 창 위로 아이들 위젯이
  //          나와 있어."
  //
  // 원인은 `fixed`가 화면이 아니라 **부모 기준**이 될 수 있다는 것입니다. 조상 중에 transform·
  // filter·sticky 같은 속성을 가진 요소가 있으면 그 요소가 새 기준이 되고, z-index도 그 안에서만
  // 셉니다. 하원체크표 사이드바가 바로 그런 구조라 z-[80]을 줘도 옆 위젯을 못 이겼습니다.
  // 같은 파일의 AttendanceRulesModal은 이미 portal을 쓰고 있어서 멀쩡했습니다.
  //
  // body에 직접 그리면 조상이 없으니 이런 일이 생기지 않습니다.
  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[80vh] w-full max-w-md flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
      >
        <div className="shrink-0 border-b border-black/5 px-4 py-3">
          <h2 className="text-sm font-bold text-slate-800">🎓 이 표기를 가르치기</h2>
          <p className="mt-0.5 text-[11px] leading-relaxed text-slate-500">
            한 번 알려주시면 규칙으로 저장되어, 다음부터 같은 표기는 자동으로 연결됩니다. AI를 쓰지 않아 비용이 들지 않고 바로
            적용됩니다.
          </p>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <p className="mb-2 rounded-lg bg-slate-50 px-2.5 py-2 text-[11px] leading-relaxed text-slate-600">{rawText}</p>

          <label className="mb-1 block text-[11px] font-semibold text-slate-600">원문에서 가르칠 표기</label>
          <input
            value={pattern}
            onChange={(e) => setPattern(e.target.value)}
            placeholder="예: Maya · 조영운"
            className="mb-1 w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm"
          />
          {existing && (
            <p className="mb-2 text-[11px] font-semibold text-amber-600">
              이미 &quot;{existing.student_name}&quot;으로 배워둔 표기입니다 — 새로 고르면 덮어씁니다.
            </p>
          )}

          <div className="mb-2 mt-3 flex items-center justify-between">
            <label className="text-[11px] font-semibold text-slate-600">어느 학생인가요?</label>
            <button
              type="button"
              disabled={busy}
              onClick={() => save("ignore")}
              className="rounded-lg bg-slate-100 px-2 py-1 text-[11px] font-semibold text-slate-500 hover:bg-slate-200 disabled:opacity-40"
              title="선생님 이름이나 흔한 낱말처럼 학생 이름이 아닌 경우 - 앞으로 이름 후보에서 뺍니다"
            >
              학생 이름 아님
            </button>
          </div>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="이름으로 찾기(한글·영문)"
            className="mb-2 w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm"
          />
          <div className="flex flex-col gap-1">
            {candidates.length === 0 ? (
              <p className="py-4 text-center text-xs text-slate-400">찾는 학생이 없습니다.</p>
            ) : (
              candidates.map((s) => (
                <button
                  key={`${s.name}-${s.grade ?? ""}-${s.birthDate ?? ""}`}
                  type="button"
                  disabled={busy}
                  onClick={() => save("alias", s)}
                  className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm transition hover:bg-blue-50 disabled:opacity-40"
                >
                  <b className="text-slate-700">{s.name}</b>
                  {s.grade && <span className="text-[11px] text-slate-400">{s.grade}학년</span>}
                  {s.nameEn && <span className="text-[11px] text-slate-400">{s.nameEn}</span>}
                </button>
              ))
            )}
          </div>
        </div>

        <div className="flex shrink-0 justify-end border-t border-black/5 px-4 py-2.5">
          <button type="button" onClick={onClose} className="rounded-lg px-3 py-1.5 text-xs font-semibold text-slate-500 hover:bg-slate-100">
            닫기
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
