"use client";

import { useEffect, useState } from "react";
import DismissalModal from "./DismissalModal";
import { createClient } from "@/lib/supabase/client";
import { todayKst, kstWeekday } from "@/lib/kst";
import { loadDismissalForDay, DISMISSAL_SELECT, isMissingWeekStart, type DismissalRow } from "@/lib/dismissalToday";
import { addDays, nextWeekStart, weekStartOf } from "@/lib/dismissalWeek";

/**
 * **오늘 하원체크** — 업무보드 맨 위.
 *
 * ── 왜 이 자리인가 ───────────────────────────────────────────────────
 *
 * 매주 같은 요일에 학원 차를 타는 아이가 있습니다(월·금 14:40 와이키키짐). 셔틀을 안 타니
 * 하원 체크표에 줄이 없고, 학사일정도 아니라 달력에도 안 뜹니다.
 *
 * **반복되는 일이라 오히려 잊힙니다.** 한 번뿐인 일은 메모라도 남기는데, 매주 있는 일은
 * «늘 하던 것»이라 아무도 적지 않고, 그러다 한 주에 그냥 지나갑니다. 그래서 사람이 실제로
 * 앉아서 보는 화면의 맨 위에 둡니다.
 *
 * ── 비어 있어도 한 줄은 남깁니다 ─────────────────────────────────────
 *
 * 예전에는 없으면 통째로 사라졌습니다. 그러면 「오늘은 없다」와 「못 읽었다」가 화면에서
 * 똑같이 보입니다 - 아무도 안 데리러 가는 날에도 아무 일 없어 보입니다.
 *
 * 새 표를 만들지 않았습니다. 이 자료는 이미 [학생 → 하원수단]에 요일별로 있습니다 -
 * 같은 사실을 두 곳에 적으면 언젠가 어긋나고, 어긋난 쪽이 어느 쪽인지 아무도 모릅니다.
 */

type Row = { name: string; className: string; kind: string; label: string | null; time: string | null; note: string | null };
type Ahead = { name: string; date: string; kind: string; label: string | null; time: string | null };

const KIND_TONE: Record<string, string> = {
  외부버스: "border-lime-300 bg-lime-50 text-lime-800",
  보호자픽업: "border-sky-300 bg-sky-50 text-sky-800",
  도보: "border-slate-300 bg-slate-50 text-slate-700",
  기타: "border-slate-300 bg-slate-50 text-slate-700",
};

const DOW = ["일", "월", "화", "수", "목", "금", "토"];
function dayLabel(iso: string): string {
  const [, m, d] = iso.split("-").map(Number);
  const days = Math.floor(Date.UTC(Number(iso.slice(0, 4)), m - 1, d) / 86_400_000);
  return `${m}/${d}(${DOW[(days + 4) % 7]})`;
}

export default function TodayDismissalReminder({
  /** 「배너」는 업무보드 맨 위(비어 있어도 한 줄), 「위젯」은 목록 안(비면 감춤). */
  variant = "위젯",
}: {
  variant?: "배너" | "위젯";
}) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [ahead, setAhead] = useState<Ahead[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  /** 팝업에서 고친 뒤 목록을 다시 읽기 위한 값. 안 바꾸면 닫아도 옛 목록이 남습니다. */
  const [tick, setTick] = useState(0);

  useEffect(() => {
    void (async () => {
      const supabase = createClient();
      const today = todayKst();
      const weekday = kstWeekday();

      // 「이번 주만」이 있으면 그것이 답이고 없으면 「매주」가 답입니다 - 판단은
      // loadDismissalForDay 한 곳에서 합니다.
      const { byStudent, error: loadErr, notice: loadNotice } = await loadDismissalForDay(supabase, {
        dayIso: today,
        weekday,
        excludeShuttle: true,
      });
      if (loadErr) {
        setError(loadErr);
        setRows([]);
        return;
      }
      // 읽기는 읽었는데 반쪽인 경우. 오류가 아니라 「지금 이만큼만 보입니다」입니다 -
      // 빨간 줄로 띄우면 사람이 오늘 하원이 잘못된 줄 압니다.
      if (loadNotice) setNotice(loadNotice);

      // 앞으로 예약된 것(이번 주 남은 날 + 다음 주). 「다음 주 화요일만 할머니가 데리러
      // 갑니다」를 넣어두면 지금까지는 그날 아침까지 아무 데도 안 보였습니다.
      const { data: aheadRows, error: aheadErr } = await supabase
        .from("student_dismissal_plans")
        .select(DISMISSAL_SELECT)
        .in("week_start", [weekStartOf(today), nextWeekStart(today)])
        .neq("kind", "셔틀");
      // 칸이 아직 없으면(마이그레이션 전) 예약이라는 개념 자체가 없습니다. 빈 목록이 맞습니다.
      if (aheadErr && aheadErr.code !== "PGRST205" && !isMissingWeekStart(aheadErr)) setError(aheadErr.message);

      const todayIds = [...byStudent.keys()];
      const aheadPlans = ((aheadRows as DismissalRow[] | null) ?? [])
        .map((p) => ({ ...p, date: addDays(p.week_start as string, p.weekday - 1) }))
        .filter((p) => p.date > today);
      const ids = [...new Set([...todayIds, ...aheadPlans.map((p) => p.student_id)])];
      if (ids.length === 0) {
        setRows([]);
        setAhead([]);
        return;
      }

      const { data: students } = await supabase
        .from("wr_students")
        .select("id, name, grade, class_name")
        .eq("is_demo", false)
        .in("id", ids);
      const byId = new Map(
        ((students as { id: string; name: string; grade: string | null; class_name: string | null }[] | null) ?? []).map((s) => [s.id, s]),
      );

      setRows(
        todayIds
          .map((sid) => {
            const st = byId.get(sid);
            const p = byStudent.get(sid);
            // 졸업·전학 등으로 명부에 없는 아이. 이름을 모르면 데리러 갈 수 없으므로 뺍니다.
            if (!st || !p) return null;
            return {
              name: st.name,
              className: [st.grade ? `${st.grade}학년` : null, st.class_name].filter(Boolean).join(" "),
              kind: p.kind,
              label: p.label,
              time: p.depart_time,
              note: p.note,
            };
          })
          .filter((x): x is Row => !!x)
          .sort((a, b) => (a.time ?? "99:99").localeCompare(b.time ?? "99:99") || a.name.localeCompare(b.name, "ko")),
      );

      setAhead(
        aheadPlans
          .map((p) => {
            const st = byId.get(p.student_id);
            if (!st) return null;
            return { name: st.name, date: p.date, kind: p.kind, label: p.label, time: p.depart_time };
          })
          .filter((x): x is Ahead => !!x)
          .sort((a, b) => a.date.localeCompare(b.date) || (a.time ?? "99:99").localeCompare(b.time ?? "99:99")),
      );
    })();
  }, [tick]);

  if (rows === null) return null;
  // 위젯 자리에서는 없으면 감춥니다(목록이 주인공입니다). 배너 자리는 비어 있어도 남깁니다 -
  // 「오늘은 없다」와 「못 읽었다」가 같아 보이면 안 됩니다.
  if (variant === "위젯" && rows.length === 0 && !error && !notice) return null;

  return (
    <div className="mb-2 rounded-xl border border-lime-200 bg-lime-50/60 px-2.5 py-2">
      <p className="mb-1.5 flex flex-wrap items-baseline gap-x-2 text-[11px]">
        <b className="text-lime-800">🎒 오늘 하원체크 {rows.length}명</b>
        <span className="text-lime-700/70">셔틀이 아닌 방법으로 가는 아이 · 체크표에는 줄이 없습니다</span>
        {/* 페이지를 옮기지 않고 그 자리에서 엽니다.
            업무보드는 하루 종일 켜놓고 보는 화면인데, 여기서 나갔다 돌아오면 보고 있던 자리를
            잃습니다. **나갔다 와야 하는 일은 대개 나중으로 미뤄지고**, 미룬 하원 변경은 그날
            아무 데도 안 뜹니다. */}
        <button
          type="button"
          onClick={() => setOpen(true)}
          title="하원수단을 넣거나 고칩니다. 오늘 것은 셔틀 체크표에 바로 반영됩니다."
          className="ml-auto rounded-full bg-lime-600 px-2.5 py-1 text-[11px] font-bold text-white transition hover:bg-lime-700"
        >
          🎒 하원수단 넣기·고치기
        </button>
      </p>

      {/* 못 읽은 것을 조용히 「없음」으로 보여주지 않습니다. */}
      {error && (
        <p className="mb-1 rounded-lg bg-rose-50 px-2 py-1 text-[11px] font-semibold text-rose-700">
          ⚠️ 하원수단을 읽지 못했습니다: {error}
        </p>
      )}

      {/* 반쪽만 읽은 상태. 오류가 아니라 「지금 이만큼만 보입니다」라고 적습니다. */}
      {notice && (
        <p className="mb-1 rounded-lg bg-amber-50 px-2 py-1 text-[11px] font-semibold text-amber-800">⚠️ {notice}</p>
      )}

      {rows.length === 0 && !error ? (
        <p className="text-[11px] text-lime-700/80">오늘은 전원 셔틀·평소대로 하원합니다.</p>
      ) : (
        <div className="flex flex-wrap gap-1">
          {rows.map((r, i) => (
            <span
              key={i}
              title={[r.name, r.className, r.kind, r.label, r.note].filter(Boolean).join(" · ")}
              className={"inline-flex items-baseline gap-1.5 rounded-lg border px-2 py-1 text-[11px] " + (KIND_TONE[r.kind] ?? KIND_TONE.기타)}
            >
              <b className="tabular-nums">{r.time ?? "시각 미정"}</b>
              <b>{r.name}</b>
              <span className="opacity-70">{r.label || r.kind}</span>
            </span>
          ))}
        </div>
      )}

      {/* 앞으로 예약된 것. 그날이 되면 저절로 위 목록으로 넘어갑니다 - 사람이 지워야 하는
          목록은 언젠가 안 지워집니다. */}
      {ahead.length > 0 && (
        <div className="mt-1.5 border-t border-lime-200 pt-1.5">
          <p className="mb-1 text-[11px] font-bold text-violet-800">📌 예약된 하원 {ahead.length}건</p>
          <div className="flex flex-wrap gap-1">
            {ahead.map((a, i) => (
              <span
                key={i}
                className="inline-flex items-baseline gap-1.5 rounded-lg border border-violet-200 bg-violet-50 px-2 py-1 text-[11px] text-violet-800"
                title={[a.name, a.kind, a.label].filter(Boolean).join(" · ")}
              >
                <b>{dayLabel(a.date)}</b>
                <span className="tabular-nums opacity-80">{a.time ?? "시각 미정"}</span>
                <b>{a.name}</b>
                <span className="opacity-70">{a.label || a.kind}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {open && (
        <DismissalModal
          onClose={() => {
            setOpen(false);
            // 닫으면 다시 읽습니다. 방금 넣은 것이 위 줄에 안 뜨면 사람은 저장이 안 된 줄 압니다.
            setTick((t) => t + 1);
          }}
        />
      )}
    </div>
  );
}
