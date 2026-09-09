"use client";

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/common/ToastProvider";
import { todayKst, kstWeekday } from "@/lib/kst";
import { StudentPicker, KINDS, WEEK, type StudentPick } from "@/components/work/QuickEntryModals";
import {
  DISMISSAL_REPEATS,
  REPEAT_HINT,
  addDays,
  describeWeek,
  nextWeekStart,
  weekStartFor,
  weekStartOf,
  type DismissalRepeat,
} from "@/lib/dismissalWeek";
import { DISMISSAL_SELECT, isMissingWeekStart, WEEK_START_NOTICE, type DismissalRow } from "@/lib/dismissalToday";

/**
 * **하원수단 팝업** — 업무보드에서 화면을 떠나지 않고 오늘·앞날 하원을 관리합니다.
 *
 * ── 왜 팝업인가 ──────────────────────────────────────────────────────
 *
 * 예전에는 「하원수단 넣기·고치기」가 다른 화면으로 가는 링크였습니다. 업무보드는 하루 종일
 * 켜놓고 보는 화면인데, 여기서 나갔다 돌아오면 보고 있던 자리를 잃습니다. **나갔다 와야 하는
 * 일은 대개 나중으로 미뤄지고, 미룬 하원 변경은 그날 아무 데도 안 뜹니다.**
 *
 * ── 넣으면 그 자리에서 셔틀에 걸립니다 ───────────────────────────────
 *
 * 오늘 요일이고 셔틀이 아니면 `/api/work/dismissal` 이 `shuttle_boardings` 까지 겁니다.
 * 그래야 체크표뿐 아니라 안내보드·도착체크·사무실 대시보드가 같은 답을 합니다 - 화면마다
 * 다른 답이 나오면 결국 아무도 안 믿습니다.
 */

type Plan = DismissalRow & { name: string; className: string };

const KIND_TONE: Record<string, string> = {
  셔틀: "border-sky-300 bg-sky-50 text-sky-800",
  외부버스: "border-lime-300 bg-lime-50 text-lime-800",
  보호자픽업: "border-violet-300 bg-violet-50 text-violet-800",
  도보: "border-slate-300 bg-slate-50 text-slate-700",
  기타: "border-slate-300 bg-slate-50 text-slate-700",
};

const DOW = ["일", "월", "화", "수", "목", "금", "토"];
function dayLabel(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const days = Math.floor(Date.UTC(y, m - 1, d) / 86_400_000);
  return `${m}/${d}(${DOW[(days + 4) % 7]})`;
}

export default function DismissalModal({ onClose }: { onClose: () => void }) {
  const notify = useToast();
  const today = todayKst();
  const todayWd = kstWeekday();

  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const [plans, setPlans] = useState<Plan[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // ── 넣기 폼 ────────────────────────────────────────────────────────
  const [student, setStudent] = useState<StudentPick | null>(null);
  const [days, setDays] = useState<number[]>(todayWd >= 1 && todayWd <= 5 ? [todayWd] : []);
  const [repeat, setRepeat] = useState<DismissalRepeat>("이번주");
  const [kind, setKind] = useState<string>("보호자픽업");
  const [label, setLabel] = useState("");
  const [time, setTime] = useState("");
  const [note, setNote] = useState("");

  /**
   * 이번 주와 다음 주에 걸리는 줄을 전부 읽습니다(매주짜리 포함).
   *
   * 지나간 주의 줄은 읽지 않습니다 - 지금 할 수 있는 일이 없는데 목록만 길어지면, 정작
   * 오늘 봐야 할 줄이 묻힙니다.
   */
  const load = useCallback(async () => {
    const supabase = createClient();
    const weeks = [weekStartOf(today), nextWeekStart(today)];
    let res = await supabase
      .from("student_dismissal_plans")
      .select(DISMISSAL_SELECT)
      .or(`week_start.is.null,week_start.in.(${weeks.join(",")})`);
    if (isMissingWeekStart(res.error)) {
      // 칸이 아직 없으면(마이그레이션 전) 전부 매주로 읽습니다. 화면이 멈추면 그날 하원을
      // 아무도 못 고칩니다.
      const retry = await supabase
        .from("student_dismissal_plans")
        .select("student_id, weekday, kind, label, depart_time, note");
      res = { ...retry, data: (retry.data ?? []).map((r) => ({ ...r, week_start: null })) } as typeof res;
      setNotice(WEEK_START_NOTICE);
    }
    if (res.error) {
      setError(res.error.message);
      setPlans([]);
      return;
    }
    const rows = (res.data as DismissalRow[] | null) ?? [];
    const ids = [...new Set(rows.map((r) => r.student_id))];
    if (ids.length === 0) {
      setPlans([]);
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
    setPlans(
      rows
        .map((r) => {
          const st = byId.get(r.student_id);
          // 졸업·전학으로 명부에 없는 아이. 이름을 모르면 아무 판단도 할 수 없으므로 뺍니다.
          if (!st) return null;
          return {
            ...r,
            name: st.name,
            className: [st.grade ? `${st.grade}학년` : null, st.class_name].filter(Boolean).join(" "),
          };
        })
        .filter((x): x is Plan => !!x),
    );
  }, [today]);

  useEffect(() => {
    void load();
  }, [load]);

  async function save() {
    if (!student) return notify("학생을 골라주세요.", "error");
    if (days.length === 0) return notify("요일을 하나 이상 골라주세요.", "error");
    setBusy(true);
    try {
      const res = await fetch("/api/work/dismissal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          studentId: student.id,
          weekdays: days,
          kind,
          label,
          time,
          note,
          weekStart: weekStartFor(repeat, today),
        }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        appliesToday?: boolean;
        appliedSeats?: number;
      };
      if (!res.ok) return notify(body.error ?? "저장하지 못했습니다.", "error");

      // **무슨 일이 일어났는지 그대로 말합니다.** 「저장됨」만 뜨면 셔틀에 걸렸는지 아닌지를
      // 사람이 다시 확인하러 가야 합니다.
      notify(
        `${student.name} · ${days.map((d) => WEEK.find((w) => w.n === d)?.ko).join("·")} ${kind}` +
          (body.appliesToday
            ? body.appliedSeats
              ? " — 오늘 것이라 셔틀 체크표에서 뺐습니다."
              : " — 오늘 것이지만 셔틀 배정이 없는 아이라 뺄 자리가 없습니다."
            : " — 오늘이 아니라 그날이 되면 반영됩니다."),
        "success",
      );
      setStudent(null);
      setLabel("");
      setTime("");
      setNote("");
      void load();
    } finally {
      setBusy(false);
    }
  }

  async function remove(p: Plan) {
    setBusy(true);
    try {
      const res = await fetch("/api/work/dismissal", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ studentId: p.student_id, weekday: p.weekday, weekStart: p.week_start }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) return notify(body.error ?? "지우지 못했습니다.", "error");
      notify(
        `${p.name} ${WEEK.find((w) => w.n === p.weekday)?.ko}요일 하원수단을 지웠습니다.` +
          (p.weekday === todayWd ? " 오늘 걸어둔 픽업 표시는 그대로입니다 - 체크표에서 되돌려주세요." : ""),
        "success",
      );
      void load();
    } finally {
      setBusy(false);
    }
  }

  if (!mounted) return null;

  const all = plans ?? [];
  /** 오늘 실제로 적용되는 줄. 그 주짜리가 매주짜리를 이깁니다. */
  const todayRows = (() => {
    if (todayWd < 1 || todayWd > 5) return [];
    const ws = weekStartOf(today);
    const byStudent = new Map<string, Plan>();
    for (const p of all.filter((p) => p.weekday === todayWd)) {
      const cur = byStudent.get(p.student_id);
      if (p.week_start === ws) byStudent.set(p.student_id, p);
      else if (!cur && p.week_start === null) byStudent.set(p.student_id, p);
    }
    return [...byStudent.values()].sort(
      (a, b) => (a.depart_time ?? "99:99").localeCompare(b.depart_time ?? "99:99") || a.name.localeCompare(b.name, "ko"),
    );
  })();

  /** 앞으로 예약된 것(그 주짜리만). 매주짜리는 「예약」이 아니라 평소 규칙입니다. */
  const ahead = all
    .filter((p) => p.week_start)
    .map((p) => ({ ...p, date: addDays(p.week_start as string, p.weekday - 1) }))
    .filter((p) => p.date > today)
    .sort((a, b) => a.date.localeCompare(b.date) || (a.depart_time ?? "99:99").localeCompare(b.depart_time ?? "99:99"));

  /** 평소(매주) 규칙. 요일별로 묶어 보여줍니다. */
  const weekly = all.filter((p) => !p.week_start).sort((a, b) => a.weekday - b.weekday || a.name.localeCompare(b.name, "ko"));

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto bg-black/40 p-4" onClick={onClose}>
      <div
        className="my-6 w-full max-w-2xl rounded-2xl bg-white p-4 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-2 flex items-center gap-2">
          <h3 className="text-sm font-bold text-slate-800">🎒 하원수단</h3>
          <span className="text-[11px] text-slate-400">넣으면 오늘 것은 셔틀 체크표에 바로 반영됩니다</span>
          <Link href="/work/dismissal" className="ml-auto text-[11px] font-semibold text-slate-500 underline decoration-dotted">
            여러 명 한 번에 넣기 ↗
          </Link>
          <button onClick={onClose} className="rounded px-1.5 text-slate-400 hover:bg-slate-100">
            ✕
          </button>
        </div>

        {error && (
          <p className="mb-2 rounded-lg bg-rose-50 px-2 py-1 text-[11px] font-semibold text-rose-700">
            ⚠️ 하원수단을 읽지 못했습니다: {error}
          </p>
        )}
        {notice && (
          <p className="mb-2 rounded-lg bg-amber-50 px-2 py-1 text-[11px] font-semibold text-amber-800">⚠️ {notice}</p>
        )}

        {/* ── 넣기 ───────────────────────────────────────────────────── */}
        <section className="mb-3 rounded-xl border border-slate-200 bg-slate-50/60 p-2.5">
          <p className="mb-1.5 text-[11px] font-bold text-slate-700">넣기</p>

          <div className="mb-2">
            <StudentPicker value={student} onPick={setStudent} />
          </div>

          <div className="mb-2 flex flex-wrap items-center gap-1">
            <span className="mr-1 text-[11px] font-semibold text-slate-500">요일</span>
            {WEEK.map((w) => (
              <button
                key={w.n}
                type="button"
                onClick={() => setDays((d) => (d.includes(w.n) ? d.filter((x) => x !== w.n) : [...d, w.n]))}
                className={
                  "h-8 w-9 rounded-lg text-xs font-bold " +
                  (days.includes(w.n) ? "bg-slate-800 text-white" : "bg-white text-slate-500 ring-1 ring-slate-200")
                }
              >
                {w.ko}
                {w.n === todayWd && <span className="block text-[8px] font-normal opacity-70">오늘</span>}
              </button>
            ))}
          </div>

          <div className="mb-2 flex flex-wrap items-center gap-1">
            <span className="mr-1 text-[11px] font-semibold text-slate-500">언제까지</span>
            {DISMISSAL_REPEATS.map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setRepeat(r)}
                title={REPEAT_HINT[r]}
                className={
                  "rounded-lg px-2.5 py-1 text-[12px] font-bold " +
                  (repeat === r ? "bg-slate-800 text-white" : "bg-white text-slate-500 ring-1 ring-slate-200")
                }
              >
                {r === "매주" ? "매주" : `${r}만`}
              </button>
            ))}
            <span className="text-[11px] text-slate-400">{REPEAT_HINT[repeat]}</span>
          </div>

          <div className="mb-2 flex flex-wrap items-center gap-1">
            <span className="mr-1 text-[11px] font-semibold text-slate-500">수단</span>
            {KINDS.map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setKind(k)}
                className={
                  "rounded-lg px-2.5 py-1 text-[12px] font-semibold " +
                  (kind === k ? "bg-slate-800 text-white" : "bg-white text-slate-600 ring-1 ring-slate-200")
                }
              >
                {k}
              </button>
            ))}
          </div>

          <div className="mb-2 grid grid-cols-1 gap-1.5 sm:grid-cols-3">
            <input
              value={time}
              onChange={(e) => setTime(e.target.value)}
              placeholder="시각 (14:40)"
              className="rounded-lg border border-slate-300 px-2 py-1.5 text-[12px]"
            />
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder={kind === "외부버스" ? "차 이름 (메타프랩버스)" : "이름(선택)"}
              className="rounded-lg border border-slate-300 px-2 py-1.5 text-[12px]"
            />
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="메모(선택)"
              className="rounded-lg border border-slate-300 px-2 py-1.5 text-[12px]"
            />
          </div>

          <button
            onClick={() => void save()}
            disabled={busy}
            className="w-full rounded-lg bg-emerald-600 py-2 text-[13px] font-bold text-white hover:bg-emerald-700 disabled:opacity-40"
          >
            {busy ? "저장 중…" : "저장"}
          </button>
          <p className="mt-1 text-[11px] text-slate-400">
            셔틀이 아닌 수단을 <b>오늘</b> 요일로 넣으면 그 자리에서 셔틀 명단에서 빠집니다. 「셔틀」로 넣으면 그대로 탑니다.
          </p>
        </section>

        {/* ── 오늘 ───────────────────────────────────────────────────── */}
        <section className="mb-3">
          <p className="mb-1 text-[11px] font-bold text-lime-800">
            🎒 오늘 하원 {todayRows.length}명
            <span className="ml-1.5 font-normal text-slate-400">
              {todayWd >= 1 && todayWd <= 5 ? `${DOW[todayWd]}요일` : "주말이라 하원 차량이 없습니다"}
            </span>
          </p>
          {todayRows.length === 0 ? (
            <p className="text-[11px] text-slate-400">오늘 따로 적힌 하원수단이 없습니다.</p>
          ) : (
            <div className="flex flex-col gap-1">
              {todayRows.map((p) => (
                <PlanRow key={`${p.student_id}-${p.weekday}-${p.week_start ?? "w"}`} p={p} today={today} busy={busy} onRemove={remove} />
              ))}
            </div>
          )}
        </section>

        {/* ── 앞으로 예약 ────────────────────────────────────────────── */}
        <section className="mb-3">
          <p className="mb-1 text-[11px] font-bold text-violet-800">📌 예약된 하원 {ahead.length}건</p>
          {ahead.length === 0 ? (
            <p className="text-[11px] text-slate-400">앞으로 예약된 것이 없습니다.</p>
          ) : (
            <div className="flex flex-col gap-1">
              {ahead.map((p) => (
                <PlanRow
                  key={`${p.student_id}-${p.weekday}-${p.week_start}`}
                  p={p}
                  today={today}
                  busy={busy}
                  onRemove={remove}
                  dateLabel={dayLabel(p.date)}
                />
              ))}
            </div>
          )}
        </section>

        {/* ── 평소(매주) ─────────────────────────────────────────────── */}
        <section>
          <p className="mb-1 text-[11px] font-bold text-slate-600">🔁 매주 {weekly.length}건</p>
          {weekly.length === 0 ? (
            <p className="text-[11px] text-slate-400">매주 반복으로 적어둔 것이 없습니다.</p>
          ) : (
            <div className="flex max-h-48 flex-col gap-1 overflow-y-auto">
              {weekly.map((p) => (
                <PlanRow key={`${p.student_id}-${p.weekday}-w`} p={p} today={today} busy={busy} onRemove={remove} />
              ))}
            </div>
          )}
        </section>
      </div>
    </div>,
    document.body,
  );
}

function PlanRow({
  p,
  today,
  busy,
  onRemove,
  dateLabel,
}: {
  p: Plan;
  today: string;
  busy: boolean;
  onRemove: (p: Plan) => void;
  dateLabel?: string;
}) {
  return (
    <div className={"flex items-center gap-2 rounded-lg border px-2 py-1.5 text-[11px] " + (KIND_TONE[p.kind] ?? KIND_TONE.기타)}>
      <b className="w-8 shrink-0 text-center">{WEEK.find((w) => w.n === p.weekday)?.ko}</b>
      {dateLabel && <span className="shrink-0 tabular-nums opacity-70">{dateLabel}</span>}
      <b className="shrink-0 tabular-nums">{p.depart_time ?? "시각 미정"}</b>
      <b className="shrink-0">{p.name}</b>
      <span className="shrink-0 opacity-60">{p.className}</span>
      <span className="min-w-0 truncate">{p.label || p.kind}</span>
      {p.note && <span className="min-w-0 truncate opacity-60">· {p.note}</span>}
      {/* 어느 갈래인지 적습니다. 「매주」와 「이번주만」이 겹칠 수 있어서, 무엇을 지우는지
          모르면 엉뚱한 줄을 지우게 됩니다. */}
      <span className="ml-auto shrink-0 rounded bg-white/70 px-1.5 py-0.5 text-[10px] font-bold opacity-80">
        {describeWeek(p.week_start ?? null, today)}
      </span>
      <button
        type="button"
        disabled={busy}
        onClick={() => onRemove(p)}
        title="이 줄을 지웁니다"
        className="shrink-0 rounded px-1 text-[11px] font-bold opacity-50 hover:bg-white/60 hover:opacity-100 disabled:opacity-30"
      >
        ✕
      </button>
    </div>
  );
}
