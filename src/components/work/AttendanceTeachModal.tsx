"use client";

import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/common/ToastProvider";
import { normalizeRulePattern, type LearningRule, type RosterStudent } from "@/lib/attendanceDigest";

// 🔎(명부 대조 실패)·⚠️(동명이인 미확정) 항목을 눌렀을 때 뜨는 "학생 지정" 창입니다.
//
// 예전에는 여기서 **가르치기밖에** 못 했습니다. 그런데 가르치기는 "앞으로 이 표기는 늘 이
// 아이"라고 정하는 일입니다. 학교에 Sophia 가 둘인데 오늘의 Sophia 가 소피아 민이라고 해서
// 다음 주 Sophia 도 그 아이인 것은 아닙니다. 한 번 가르쳐 두면 그 뒤로는 틀려도 아무도
// 모르게 지나갑니다 - 자동이 조용히 답을 내니까요.
//
// 그래서 둘을 나눕니다.
//   · **학생 고르기** — 이 한 건만 정합니다. 늘 되는 기본 동작입니다.
//   · **가르치기(체크)** — 켠 채로 고르면 규칙으로도 남아 다음부터 자동 연결됩니다.
//     "이 표기는 언제나 이 아이"가 확실할 때만 켭니다(예: 오타·애칭).
export default function AttendanceTeachModal({
  rawText,
  guessedName,
  entry,
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
  /**
   * 어느 건인지. 이게 있어야 "오늘만 이 아이로"가 됩니다.
   * 없으면(옛 호출) 가르치기만 할 수 있습니다.
   */
  entry?: { messageId: string; status: string; dateFrom: string; dateTo: string } | null;
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
  /**
   * 규칙으로도 남길지. **꺼진 채로 시작합니다.**
   *
   * 기본을 켜두면 오늘 한 번 고른 것이 앞으로 전부에 걸립니다. 되돌리려면 규칙 목록까지
   * 찾아가야 하는데, 그때는 이미 며칠치가 그 규칙으로 처리된 뒤입니다.
   */
  const [alsoTeach, setAlsoTeach] = useState(false);

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

  /**
   * 학생을 고릅니다. **이 건에만** 적용합니다.
   *
   * 가르치기 체크가 켜져 있으면 규칙도 함께 남깁니다. 규칙 저장이 실패해도 이 건 지정은
   * 이미 끝난 것으로 둡니다 - 둘을 한 덩어리로 묶으면 규칙 하나 때문에 오늘 명단이
   * 안 고쳐집니다.
   */
  async function pick(student: RosterStudent) {
    if (!entry) {
      // 이 건이 무엇인지 모르면 지정할 대상이 없습니다. 규칙만 저장합니다.
      await save("alias", student);
      return;
    }
    setBusy(true);
    const supabase = createClient();
    const { data: found } = await supabase
      .from("wr_students")
      .select("id")
      .eq("is_demo", false)
      .eq("name", student.name)
      .eq("birth_date", student.birthDate ?? "")
      .limit(1)
      .maybeSingle();
    let sid = (found as { id: string } | null)?.id ?? null;
    if (!sid) {
      // 생년월일이 비어 있는 줄도 있어서 이름으로 한 번 더 찾습니다. 후보가 둘 이상이면
      // 고르지 않습니다 - 엉뚱한 아이를 결석으로 만드는 것이 더 나쁩니다.
      const { data: hits } = await supabase
        .from("wr_students")
        .select("id")
        .eq("is_demo", false)
        .eq("name", student.name)
        .limit(2);
      const rows = (hits as { id: string }[] | null) ?? [];
      if (rows.length === 1) sid = rows[0].id;
    }
    if (!sid) {
      setBusy(false);
      notify(`${student.name} 학생을 명부에서 한 명으로 찾지 못했습니다.`, "error");
      return;
    }

    const res = await fetch("/api/attendance/entries", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        assign: {
          messageId: entry.messageId,
          fromName: guessedName.trim(),
          status: entry.status,
          dateFrom: entry.dateFrom,
          dateTo: entry.dateTo,
          studentId: sid,
          studentName: student.name,
        },
      }),
    });
    if (!res.ok) {
      setBusy(false);
      const msg = (await res.json().catch(() => ({}))) as { error?: string };
      notify("지정하지 못했습니다: " + (msg.error ?? ""), "error");
      return;
    }

    if (alsoTeach) {
      await save("alias", student, { silent: true });
      notify(`이 건은 ${student.name}. "${pattern.trim()}" 표기도 앞으로 그 아이로 배웠습니다.`, "success");
    } else {
      notify(`이 건만 ${student.name} 으로 지정했습니다. 규칙은 만들지 않았습니다.`, "success");
    }
    setBusy(false);
    onSaved();
    onClose();
  }

  async function save(kind: "alias" | "ignore", student?: RosterStudent, opts?: { silent?: boolean }) {
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
      notify("규칙을 저장하지 못했습니다: " + error.message, "error");
      return;
    }
    if (opts?.silent) return;
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
          <h2 className="text-sm font-bold text-slate-800">🙋 이 건은 누구인가요?</h2>
          <p className="mt-0.5 text-[11px] leading-relaxed text-slate-500">
            {entry
              ? "학생을 고르면 이 한 건만 그 아이로 정합니다. 같은 이름이 다음에 또 오면 다시 물어봅니다."
              : "이 표기를 어느 학생으로 볼지 규칙으로 저장합니다."}
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

          {/* 가르치기는 **선택**입니다.
              «앞으로 늘 이 아이»가 확실할 때만 켭니다 - Sophia 가 둘인 학교에서 오늘의
              Sophia 를 규칙으로 못박으면, 다음 주 다른 Sophia 도 조용히 그 아이가 됩니다. */}
          {entry && (
            <label
              className={
                "mb-2 flex cursor-pointer items-start gap-2 rounded-lg border px-2.5 py-2 text-[11px] leading-relaxed transition " +
                (alsoTeach ? "border-amber-300 bg-amber-50 text-amber-900" : "border-slate-200 bg-slate-50 text-slate-500")
              }
            >
              <input
                type="checkbox"
                checked={alsoTeach}
                onChange={(e) => setAlsoTeach(e.target.checked)}
                className="mt-0.5 h-3.5 w-3.5 shrink-0"
              />
              <span>
                <b>🎓 앞으로도 이 표기는 이 아이로 (가르치기)</b>
                <br />
                {alsoTeach ? (
                  <>
                    <b>&quot;{pattern.trim() || "…"}&quot;</b> 가 들어오면 다음부터 자동으로 이 아이가 됩니다. 같은 표기를 쓰는
                    아이가 또 있다면 켜지 마세요.
                  </>
                ) : (
                  <>꺼두면 이 한 건만 정합니다. 같은 이름이 다음에 또 오면 다시 물어봅니다.</>
                )}
              </span>
            </label>
          )}
          <div className="flex flex-col gap-1">
            {candidates.length === 0 ? (
              <p className="py-4 text-center text-xs text-slate-400">찾는 학생이 없습니다.</p>
            ) : (
              candidates.map((s) => (
                <button
                  key={`${s.name}-${s.grade ?? ""}-${s.birthDate ?? ""}`}
                  type="button"
                  disabled={busy}
                  onClick={() => pick(s)}
                  className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm transition hover:bg-blue-50 disabled:opacity-40"
                >
                  <b className="text-slate-700">{s.name}</b>
                  {/* 학년만으로는 동명이인을 못 가립니다 - 김재이가 셋인데 둘이 2학년입니다.
                      사람이 실제로 부르는 단위는 반이므로 반을 함께 적습니다. */}
                  {(s.grade || s.className) && (
                    <span className="text-[11px] text-slate-400">
                      {[s.grade ? `${s.grade}학년` : null, s.className].filter(Boolean).join(" ")}
                    </span>
                  )}
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
