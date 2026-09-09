"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/common/ToastProvider";
import {
  DISMISSAL_KINDS,
  KIND_STYLE,
  WEEKDAY_NAMES,
  planLabel,
  type DismissalKind,
  type DismissalPlan,
} from "@/lib/dismissalPlan";
import { DISMISSAL_REPEATS, REPEAT_HINT, describeWeek, weekStartFor, type DismissalRepeat } from "@/lib/dismissalWeek";
import { todayKst } from "@/lib/kst";

// 하원수단 편집 — 요일 다섯 줄.
//
// **왜 다섯 줄을 한 화면에 펼쳐 두는가:** 백서아처럼 요일마다 다른 아이는 한 요일만 봐서는
// 맞는지 알 수 없습니다. 다섯 줄이 같이 보여야 "화·목은 메타프랩, 수·금은 블루웨일"이라는
// 모양이 눈에 들어오고, 빠뜨린 요일도 바로 보입니다.
//
// **어느 주를 보고 있는지 늘 적습니다.** 「매주」와 「이번주만」은 겹쳐 있을 수 있어서,
// 지금 고치는 것이 어느 쪽인지 화면이 말하지 않으면 매주짜리를 지웠다고 생각하고 창을
// 닫게 됩니다. 그러면 다음 주에 다시 나타나고, 그건 오류로 안 보입니다.

type Row = {
  kind: DismissalKind | "";
  label: string;
  depart_time: string;
  note: string;
};

const EMPTY: Row = { kind: "", label: "", depart_time: "", note: "" };

export default function DismissalPlanEditor({
  studentId,
  studentName,
  initialPlans,
  userEmail,
  /** 담임 화면처럼 읽기만 하면 되는 자리에서는 편집을 잠급니다. */
  readOnly = false,
}: {
  studentId: string;
  studentName: string;
  initialPlans: DismissalPlan[];
  userEmail: string;
  readOnly?: boolean;
}) {
  const notify = useToast();
  const today = todayKst();
  const [plans, setPlans] = useState<DismissalPlan[]>(initialPlans);
  // 프로필의 기본은 **매주**입니다. 여기는 「이 아이는 평소에 어떻게 가는가」를 적는 자리이고,
  // 그 주 한 번짜리는 업무보드의 빠른등록으로 들어옵니다.
  const [repeat, setRepeat] = useState<DismissalRepeat>("매주");
  const weekStart = weekStartFor(repeat, today);

  const rowsFor = (all: DismissalPlan[], ws: string | null): Record<number, Row> => {
    const out: Record<number, Row> = { 1: { ...EMPTY }, 2: { ...EMPTY }, 3: { ...EMPTY }, 4: { ...EMPTY }, 5: { ...EMPTY } };
    for (const p of all) {
      if (p.weekday < 1 || p.weekday > 5) continue;
      // **그 갈래에 실제로 있는 줄만** 채웁니다. 매주짜리를 「이번주만」 칸에 미리 채워두면,
      // 저장을 누른 순간 매주짜리가 이번 주짜리로 복사되어 다음 주에 사라집니다.
      if ((p.week_start ?? null) !== ws) continue;
      out[p.weekday] = { kind: p.kind, label: p.label ?? "", depart_time: p.depart_time ?? "", note: p.note ?? "" };
    }
    return out;
  };

  const [rows, setRows] = useState<Record<number, Row>>(() => rowsFor(initialPlans, null));
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function pickRepeat(next: DismissalRepeat) {
    setRepeat(next);
    setRows(rowsFor(plans, weekStartFor(next, today)));
  }

  function update(day: number, patch: Partial<Row>) {
    setRows((prev) => ({ ...prev, [day]: { ...prev[day], ...patch } }));
  }

  /**
   * 한 요일을 다른 요일에 그대로 복사합니다.
   *
   * "화·목이 같고 수·금이 같은" 식이 흔합니다. 다섯 번 타이핑하게 두면 오타가 섞이고,
   * 오타 하나가 곧 "그 아이가 어느 버스를 타는지 모른다"가 됩니다.
   */
  function copyTo(from: number, to: number) {
    setRows((prev) => ({ ...prev, [to]: { ...prev[from] } }));
  }

  async function save() {
    setBusy(true);
    setError(null);
    const supabase = createClient();

    // 요일 하나씩 저장합니다. 저장도 지우기도 함수 한 곳(set/clear_dismissal_plan)에서
    // 합니다 - 「매주」와 「그 주만」이 각각 하나씩 있어야 해서 조건부 인덱스를 쓰는데,
    // upsert 로는 어느 쪽인지 가리킬 수 없습니다.
    const saved: DismissalPlan[] = [];
    for (let d = 1; d <= 5; d++) {
      const r = rows[d];
      if (!r.kind) {
        // 비운 요일은 지웁니다. 남겨두면 "예전에는 학원 버스였다"가 지금 값처럼 보입니다.
        const { error: delErr } = await supabase.rpc("clear_dismissal_plan", {
          p_student: studentId,
          p_weekday: d,
          p_week_start: weekStart,
        });
        if (delErr) {
          setBusy(false);
          setError(`${WEEKDAY_NAMES[d]}요일을 지우지 못했습니다: ${delErr.message}`);
          return;
        }
        continue;
      }
      const { error: upErr } = await supabase.rpc("set_dismissal_plan", {
        p_student: studentId,
        p_weekday: d,
        p_kind: r.kind,
        p_label: r.label.trim() || null,
        p_time: r.depart_time.trim() || null,
        p_note: r.note.trim() || null,
        p_week_start: weekStart,
        p_by: userEmail,
      });
      if (upErr) {
        setBusy(false);
        // 실패한 이유를 그 자리에 적습니다. "저장 실패" 넉 자만 뜨면 무엇을 해야 할지
        // 알 수 없고, 그대로 창을 닫으면 적은 것이 사라집니다.
        setError(
          upErr.code === "42883" || upErr.code === "PGRST202"
            ? "하원수단 저장 함수가 아직 없습니다. 관리자에게 알려주세요 — 20260914000000_dismissal_week.sql"
            : `${WEEKDAY_NAMES[d]}요일을 저장하지 못했습니다: ${upErr.message}`,
        );
        return;
      }
      saved.push({
        student_id: studentId,
        weekday: d,
        kind: r.kind,
        label: r.label.trim() || null,
        depart_time: r.depart_time.trim() || null,
        note: r.note.trim() || null,
        week_start: weekStart,
      });
    }

    // 화면이 들고 있던 목록도 같이 맞춥니다. 안 맞추면 「매주 ↔ 이번주만」을 오갈 때
    // 방금 저장한 것이 안 보이고, 사람은 저장이 안 된 줄 압니다.
    setPlans((prev) => [...prev.filter((p) => (p.week_start ?? null) !== weekStart), ...saved]);
    setBusy(false);
    setEditing(false);
    notify(`${studentName} 하원수단(${repeat === "매주" ? "매주" : `${repeat}만`})을 저장했습니다.`, "success");
  }

  const filled = Object.entries(rows).filter(([, r]) => r.kind);
  /** 지금 보고 있지 않은 갈래에 무엇이 있는지. 겹쳐 있는 것을 모르면 엉뚱한 쪽을 고칩니다. */
  const otherLayers = [...new Set(plans.map((p) => p.week_start ?? null))]
    .filter((ws) => ws !== weekStart)
    .map((ws) => describeWeek(ws, today));

  return (
    <div className="mb-5 g-panel-solid p-4 shadow-sm">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="text-sm font-bold text-slate-700">🏠 하원수단 (요일별)</h2>
        {/* 지금 보고 있는 갈래. 「매주」와 「이번주만」이 겹쳐 있을 수 있어서, 어느 쪽을
            고치는지 화면이 말하지 않으면 엉뚱한 쪽을 지우고 창을 닫게 됩니다. */}
        <div className="ml-auto flex gap-1">
          {DISMISSAL_REPEATS.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => pickRepeat(r)}
              title={REPEAT_HINT[r]}
              className={
                "rounded-lg px-2 py-1 text-[11px] font-bold " +
                (repeat === r ? "bg-slate-800 text-white" : "bg-slate-100 text-slate-500 hover:bg-slate-200")
              }
            >
              {r === "매주" ? "매주" : `${r}만`}
            </button>
          ))}
        </div>
        {!readOnly && (
          <button
            type="button"
            onClick={() => setEditing((v) => !v)}
            className="rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-50"
          >
            {editing ? "닫기" : filled.length > 0 ? "수정" : "입력"}
          </button>
        )}
      </div>

      {/* 다른 갈래에 적힌 것이 있으면 알려줍니다. 「매주」만 보고 있는데 이번 주 목요일이
          할머니로 덮여 있으면, 그 사실을 여기서 말하지 않으면 아무도 모릅니다. */}
      {otherLayers.length > 0 && (
        <p className="mb-1.5 rounded-lg bg-amber-50 px-2 py-1 text-[11px] text-amber-800">
          다른 주에도 적힌 것이 있습니다: <b>{otherLayers.join(" · ")}</b> — 위 단추로 옮겨서 보세요.
        </p>
      )}

      {!editing && (
        <>
          {filled.length === 0 ? (
            <p className="text-xs text-slate-400">
              {repeat === "매주"
                ? "아직 적힌 하원수단이 없습니다. 셔틀만 타는 아이는 비워두셔도 됩니다 — 요일마다 다른 차를 타거나 학원 버스를 타는 아이만 적어주세요."
                : `${repeat}에 따로 정해진 것이 없습니다. 비어 있으면 「매주」에 적힌 대로 갑니다.`}
            </p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {[1, 2, 3, 4, 5].map((d) => {
                const r = rows[d];
                if (!r.kind) {
                  return (
                    <span key={d} className="rounded-lg border border-dashed border-slate-200 px-2 py-1 text-[11px] text-slate-300">
                      {WEEKDAY_NAMES[d]} 미지정
                    </span>
                  );
                }
                const st = KIND_STYLE[r.kind];
                return (
                  <span key={d} className={"rounded-lg px-2 py-1 text-[11px] font-semibold " + st.chip} title={r.note || undefined}>
                    <b className="mr-1">{WEEKDAY_NAMES[d]}</b>
                    {st.emoji}{" "}
                    {planLabel({ kind: r.kind, label: r.label, depart_time: r.depart_time })}
                  </span>
                );
              })}
            </div>
          )}
        </>
      )}

      {editing && (
        <div className="flex flex-col gap-2">
          {[1, 2, 3, 4, 5].map((d) => {
            const r = rows[d];
            return (
              <div key={d} className="flex flex-wrap items-center gap-1.5 rounded-lg bg-slate-50 px-2 py-1.5">
                <span className="w-6 shrink-0 text-center text-xs font-bold text-slate-600">{WEEKDAY_NAMES[d]}</span>
                <select
                  value={r.kind}
                  onChange={(e) => update(d, { kind: e.target.value as DismissalKind | "" })}
                  className="rounded-lg border border-slate-300 px-2 py-1 text-xs"
                >
                  <option value="">— 미지정 —</option>
                  {DISMISSAL_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {KIND_STYLE[k].emoji} {k}
                    </option>
                  ))}
                </select>
                <input
                  value={r.depart_time}
                  onChange={(e) => update(d, { depart_time: e.target.value })}
                  placeholder="1:55"
                  className="w-16 rounded-lg border border-slate-300 px-2 py-1 text-xs"
                />
                <input
                  value={r.label}
                  onChange={(e) => update(d, { label: e.target.value })}
                  placeholder={r.kind === "외부버스" ? "메타프랩버스" : "이름(선택)"}
                  className="w-32 rounded-lg border border-slate-300 px-2 py-1 text-xs"
                />
                <input
                  value={r.note}
                  onChange={(e) => update(d, { note: e.target.value })}
                  placeholder="메모(선택)"
                  className="min-w-24 flex-1 rounded-lg border border-slate-300 px-2 py-1 text-xs"
                />
                {d > 1 && (
                  <button
                    type="button"
                    onClick={() => copyTo(d - 1, d)}
                    title={`${WEEKDAY_NAMES[d - 1]}요일과 똑같이 채웁니다`}
                    className="rounded border border-slate-300 px-1.5 py-1 text-[10px] text-slate-500 hover:bg-white"
                  >
                    ↑ 위와 같이
                  </button>
                )}
              </div>
            );
          })}

          {error && (
            <p className="rounded-lg bg-red-50 px-2 py-1.5 text-[11px] font-semibold text-red-600">
              ⚠️ 저장 실패: {error}
              <br />
              <span className="font-normal">창을 닫지 마시고 잠시 뒤 다시 시도해주세요.</span>
            </p>
          )}

          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={save}
              className="rounded-lg bg-gia-navy px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50"
            >
              {busy ? "저장 중…" : "저장"}
            </button>
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-600"
            >
              취소
            </button>
            <span className="text-[11px] text-slate-400">
              지금 고치는 것은 <b>{repeat === "매주" ? "매주" : `${repeat}만`}</b>입니다 — {REPEAT_HINT[repeat]}.{" "}
              셔틀 호차는 여기가 아니라 <b>셔틀 &gt; 탑승배정</b>이 정답입니다. 여기에는 &quot;셔틀&quot;이라고만
              적어두세요 — 같은 값을 두 곳에서 고치면 어느 쪽이 맞는지 알 수 없게 됩니다.
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
