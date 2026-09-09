"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { createClient } from "@/lib/supabase/client";
import { todayKst } from "@/lib/kst";
import { DISMISSAL_REPEATS, REPEAT_HINT, weekStartFor, type DismissalRepeat } from "@/lib/dismissalWeek";

/**
 * 업무보드에서 연락 하나를 **그 자리에서** 처리하는 팝업들.
 *
 * 지금까지는 자동이 읽은 대로 등록되거나, 아니면 다른 화면으로 옮겨가야 했습니다. 그런데
 * 기간을 적는 방법은 사람마다 다릅니다 - 「내일부터 3일간」·「다음주 월~수」·「금요일까지」.
 * 자동을 100%로 만들려고 붙들기보다, **자동이 무엇을 읽었는지 보여주고 3초 만에 고치게**
 * 하는 편이 확실합니다.
 *
 *   ① 기간 고치기   - 자동이 읽은 날짜를 눌러서 바로 고칩니다
 *   ② 직접 등록     - 자동이 아예 못 읽은 연락을 손으로 넣습니다
 *   ③ 하원수단      - 「내일은 학원차 타요」를 탭을 옮기지 않고 여기서 넣습니다
 */

const DOW = ["일", "월", "화", "수", "목", "금", "토"];

function addDays(key: string, n: number): string {
  const d = new Date(`${key}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function label(key: string): string {
  const d = new Date(`${key}T00:00:00Z`);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}(${DOW[d.getUTCDay()]})`;
}

/** 이번 주 금요일. 주말에 적었으면 다음 금요일입니다. */
function thisFriday(from: string): string {
  const d = new Date(`${from}T00:00:00Z`);
  return addDays(from, (5 - d.getUTCDay() + 7) % 7);
}

function Shell({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;
  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-2xl bg-white p-4 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-bold text-slate-800">{title}</h3>
          <button onClick={onClose} className="rounded px-1.5 text-slate-400 hover:bg-slate-100">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body
  );
}

/** 시작·끝 두 칸 + 자주 쓰는 기간 버튼. 세 팝업이 같은 것을 씁니다. */
function RangePicker({
  from,
  to,
  setFrom,
  setTo,
}: {
  from: string;
  to: string;
  setFrom: (v: string) => void;
  setTo: (v: string) => void;
}) {
  const today = todayKst();
  const quick: [string, () => void][] = [
    ["오늘 하루", () => { setFrom(today); setTo(today); }],
    ["내일 하루", () => { setFrom(addDays(today, 1)); setTo(addDays(today, 1)); }],
    ["내일부터 3일", () => { setFrom(addDays(today, 1)); setTo(addDays(today, 3)); }],
    ["이번주 끝까지", () => { setFrom(today); setTo(thisFriday(today)); }],
    ["다음주 월~금", () => {
      const d = new Date(`${today}T00:00:00Z`);
      const mon = addDays(today, (8 - d.getUTCDay()) % 7 || 7);
      setFrom(mon);
      setTo(addDays(mon, 4));
    }],
  ];
  const days = Math.round((new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime()) / 86400000) + 1;

  return (
    <div>
      <div className="mb-1.5 flex flex-wrap gap-1">
        {quick.map(([t, fn]) => (
          <button key={t} type="button" onClick={fn} className="rounded-lg bg-slate-100 px-2 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-200">
            {t}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-1.5">
        <input type="date" value={from} onChange={(e) => { setFrom(e.target.value); if (e.target.value > to) setTo(e.target.value); }} className="rounded-lg border border-slate-300 px-2 py-1 text-[12px]" />
        <span className="text-slate-400">~</span>
        <input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} className="rounded-lg border border-slate-300 px-2 py-1 text-[12px]" />
      </div>
      <p className={"mt-1 text-[11px] " + (days > 0 ? "text-slate-500" : "text-rose-600 font-bold")}>
        {days > 0 ? `${label(from)} ~ ${label(to)} · ${days}일` : "끝날이 시작날보다 앞입니다"}
      </p>
    </div>
  );
}

export type StudentPick = { id: string; name: string; grade: string | null; class_name: string | null };

/**
 * 명부에서 아이 고르기. 이름만으로는 김재이가 셋이라 반을 함께 보여줍니다.
 *
 * 하원수단 팝업도 이걸 그대로 씁니다 - 고르는 방식이 화면마다 다르면 같은 아이를
 * 다르게 찾게 되고, 그러면 어느 화면에서 잘못 골랐는지 알 수 없습니다.
 */
export function StudentPicker({
  value,
  onPick,
  initialQuery,
}: {
  value: StudentPick | null;
  onPick: (s: StudentPick | null) => void;
  initialQuery?: string;
}) {
  const [all, setAll] = useState<StudentPick[]>([]);
  const [q, setQ] = useState(initialQuery ?? "");
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();
    supabase
      .from("wr_students")
      .select("id, name, grade, class_name")
      .eq("is_demo", false)
      .eq("status", "active")
      .order("name")
      .then(({ data, error }) => {
        // 조용히 빈 목록을 두면 「명부에 없는 아이」로 보입니다.
        if (error) setErr(error.message);
        else setAll((data as StudentPick[]) ?? []);
      });
  }, []);

  const hits = useMemo(() => {
    const key = q.trim();
    if (!key) return [];
    return all.filter((s) => s.name.includes(key)).slice(0, 8);
  }, [all, q]);

  if (value) {
    return (
      <div className="flex items-center gap-2 rounded-lg bg-teal-50 px-2 py-1.5 text-[12px]">
        <b className="text-teal-900">{value.name}</b>
        <span className="text-[11px] text-teal-700">{value.class_name ?? value.grade ?? ""}</span>
        <button onClick={() => onPick(null)} className="ml-auto rounded border border-teal-300 px-1.5 text-[11px] text-teal-700">
          바꾸기
        </button>
      </div>
    );
  }

  return (
    <div>
      <input
        autoFocus
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="학생 이름"
        className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-[12px]"
      />
      {err && <p className="mt-1 text-[11px] font-bold text-rose-700">명부를 읽지 못했습니다: {err}</p>}
      {q.trim() !== "" && hits.length === 0 && !err && (
        <p className="mt-1 text-[11px] text-rose-600">명부에서 「{q.trim()}」를 찾지 못했습니다.</p>
      )}
      <div className="mt-1 flex flex-wrap gap-1">
        {hits.map((s) => (
          <button
            key={s.id}
            onClick={() => onPick(s)}
            className="rounded-lg border border-slate-300 px-2 py-1 text-[12px] hover:bg-slate-50"
          >
            {s.name} <span className="text-[10px] text-slate-400">{s.class_name ?? s.grade ?? ""}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ── ① 기간 고치기 ───────────────────────────────────────────────────────────

export function RangeEditModal({
  entryId,
  name,
  status,
  from0,
  to0,
  onClose,
  onSaved,
}: {
  entryId: string;
  name: string;
  status: string;
  from0: string;
  to0: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [from, setFrom] = useState(from0);
  const [to, setTo] = useState(to0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    if (to < from) return setErr("끝날이 시작날보다 앞입니다.");
    setBusy(true);
    const res = await fetch("/api/attendance/entries", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: entryId, dateFrom: from, dateTo: to, state: "등록" }),
    });
    setBusy(false);
    if (!res.ok) {
      const b = await res.json().catch(() => ({}));
      return setErr((b as { error?: string }).error || "저장하지 못했습니다.");
    }
    onSaved();
    onClose();
  }

  return (
    <Shell title={`기간 고치기 — ${name} ${status}`} onClose={onClose}>
      <RangePicker from={from} to={to} setFrom={setFrom} setTo={setTo} />
      {err && <p className="mt-2 rounded bg-rose-50 px-2 py-1 text-[11px] font-bold text-rose-700">{err}</p>}
      <button
        onClick={() => void save()}
        disabled={busy}
        className="mt-3 w-full rounded-lg bg-emerald-600 py-2 text-[13px] font-bold text-white disabled:opacity-40"
      >
        {busy ? "저장 중…" : "이 기간으로 등록"}
      </button>
      <p className="mt-1 text-[11px] text-slate-400">고쳐서 저장하면 확인한 것으로 보고 바로 등록됩니다.</p>
    </Shell>
  );
}

// ── ② 직접 등록 ─────────────────────────────────────────────────────────────

const STATUSES = ["결석", "지각", "조퇴", "픽업"] as const;

export function ManualAttendanceModal({
  initialName,
  messageId,
  rawText,
  initialStatus,
  initialFrom,
  initialTo,
  fromName,
  onClose,
  onSaved,
}: {
  initialName?: string;
  messageId?: string | null;
  rawText?: string | null;
  /** 인박스에서 열 때 **자동이 읽은 값**을 그대로 채워둡니다(틀린 데만 고치도록). */
  initialStatus?: string;
  initialFrom?: string;
  initialTo?: string;
  /** 자동이 추정해 화면에 떠 있던 이름. 다른 아이로 정하면 그 줄을 내립니다. */
  fromName?: string | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const today = todayKst();
  const [student, setStudent] = useState<StudentPick | null>(null);
  const [status, setStatus] = useState<string>(
    initialStatus && (STATUSES as readonly string[]).includes(initialStatus) ? initialStatus : "결석",
  );
  const [from, setFrom] = useState(initialFrom || today);
  const [to, setTo] = useState(initialTo || initialFrom || today);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    if (!student) return setErr("학생을 골라주세요.");
    if (to < from) return setErr("끝날이 시작날보다 앞입니다.");
    setBusy(true);
    const res = await fetch("/api/attendance/entries", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        manual: {
          studentId: student.id,
          studentName: student.name,
          status,
          dateFrom: from,
          dateTo: to,
          note: note.trim() || null,
          messageId: messageId ?? null,
          rawText: rawText ?? null,
          fromName: fromName ?? null,
        },
      }),
    });
    setBusy(false);
    if (!res.ok) {
      const b = await res.json().catch(() => ({}));
      return setErr((b as { error?: string }).error || "저장하지 못했습니다.");
    }
    onSaved();
    onClose();
  }

  return (
    <Shell title="출결 직접 등록" onClose={onClose}>
      {/* ── 근거가 되는 원문 ──────────────────────────────────────────────
          손으로 넣은 기록은 나중에 «왜 이 날짜인가»를 물어보는 순간이 옵니다. 그때 근거가
          없으면 넣은 사람도 기억하지 못하고, 결국 아무도 못 고칩니다. 인박스에서 열었으면
          그 연락이 곧 근거이므로 **함께 저장하고 여기 그대로 보여줍니다.** */}
      {rawText && (
        <div className="mb-2 rounded-lg border border-slate-200 bg-slate-50 p-2">
          <p className="mb-0.5 text-[10px] font-bold text-slate-400">이 연락을 근거로 저장합니다</p>
          <p className="max-h-20 overflow-y-auto whitespace-pre-wrap break-words text-[11px] leading-relaxed text-slate-600">
            {rawText}
          </p>
        </div>
      )}
      <div className="mb-2">
        <p className="mb-1 text-[11px] font-semibold text-slate-500">학생</p>
        <StudentPicker value={student} onPick={setStudent} initialQuery={initialName} />
      </div>

      <div className="mb-2">
        <p className="mb-1 text-[11px] font-semibold text-slate-500">종류</p>
        <div className="flex gap-1">
          {STATUSES.map((s) => (
            <button
              key={s}
              onClick={() => setStatus(s)}
              className={
                "rounded-lg px-2.5 py-1 text-[12px] font-semibold " +
                (status === s ? "bg-slate-800 text-white" : "bg-slate-100 text-slate-600")
              }
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      <div className="mb-2">
        <p className="mb-1 text-[11px] font-semibold text-slate-500">기간</p>
        <RangePicker from={from} to={to} setFrom={setFrom} setTo={setTo} />
      </div>

      <input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="사유 (가족 여행 등) — 비워도 됩니다"
        className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-[12px]"
      />

      {err && <p className="mt-2 rounded bg-rose-50 px-2 py-1 text-[11px] font-bold text-rose-700">{err}</p>}
      <button
        onClick={() => void save()}
        disabled={busy}
        className="mt-3 w-full rounded-lg bg-emerald-600 py-2 text-[13px] font-bold text-white disabled:opacity-40"
      >
        {busy ? "등록 중…" : "등록"}
      </button>
    </Shell>
  );
}

// ── ③ 하원수단 ──────────────────────────────────────────────────────────────

export const KINDS = ["셔틀", "외부버스", "보호자픽업", "도보", "기타"] as const;
export const WEEK = [
  { n: 1, ko: "월" },
  { n: 2, ko: "화" },
  { n: 3, ko: "수" },
  { n: 4, ko: "목" },
  { n: 5, ko: "금" },
];

export function DismissalQuickModal({
  initialName,
  onClose,
  onSaved,
}: {
  initialName?: string;
  onClose: () => void;
  onSaved: (msg: string) => void;
}) {
  const [student, setStudent] = useState<StudentPick | null>(null);
  const [days, setDays] = useState<number[]>([]);
  const [kind, setKind] = useState<string>("보호자픽업");
  const [labelText, setLabelText] = useState("");
  const [time, setTime] = useState("");
  // **기본은 이번주.** 여기로 들어오는 연락은 거의 다 그 주 한 번짜리입니다("오늘은 할머니가
  // 데리러 가요"). 매주가 기본이면 그 한 번짜리가 영원히 남고, 다음 주에 지우기를 잊습니다.
  const [repeat, setRepeat] = useState<DismissalRepeat>("이번주");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    if (!student) return setErr("학생을 골라주세요.");
    if (days.length === 0) return setErr("요일을 하나 이상 골라주세요.");
    setBusy(true);
    const supabase = createClient();
    const weekStart = weekStartFor(repeat, todayKst());
    // 표를 새로 만들지 않습니다 - 하원수단 화면과 **같은 표**를 씁니다. 같은 사실을 두 곳에
    // 적으면 언젠가 어긋나고, 어긋난 쪽이 어느 쪽인지 아무도 모릅니다.
    //
    // 저장은 함수 하나(set_dismissal_plan)로 합니다. 「매주」와 「그 주만」이 각각 하나씩
    // 있어야 해서 조건부 인덱스를 쓰는데, upsert 로는 어느 쪽인지 가리킬 수 없습니다.
    for (const w of days) {
      const { error } = await supabase.rpc("set_dismissal_plan", {
        p_student: student.id,
        p_weekday: w,
        p_kind: kind,
        p_label: labelText.trim() || null,
        p_time: time.trim() || null,
        p_note: null,
        p_week_start: weekStart,
      });
      // 한 요일이 실패하면 거기서 멈춥니다. 나머지를 마저 넣고 「저장했습니다」를 띄우면
      // 빠진 요일이 있는 줄 모른 채 창을 닫습니다.
      if (error) {
        setBusy(false);
        return setErr(`${WEEK.find((x) => x.n === w)?.ko}요일을 저장하지 못했습니다: ${error.message}`);
      }
    }
    setBusy(false);
    onSaved(
      `${student.name} · ${days.map((d) => WEEK.find((w) => w.n === d)?.ko).join("·")} ${kind} · ${repeat === "매주" ? "매주" : `${repeat}만`}으로 저장했습니다.`,
    );
    onClose();
  }

  return (
    <Shell title="🎒 하원수단 넣기" onClose={onClose}>
      <div className="mb-2">
        <p className="mb-1 text-[11px] font-semibold text-slate-500">학생</p>
        <StudentPicker value={student} onPick={setStudent} initialQuery={initialName} />
      </div>

      <div className="mb-2">
        <p className="mb-1 text-[11px] font-semibold text-slate-500">요일</p>
        <div className="flex gap-1">
          {WEEK.map((w) => (
            <button
              key={w.n}
              onClick={() => setDays((d) => (d.includes(w.n) ? d.filter((x) => x !== w.n) : [...d, w.n]))}
              className={
                "h-8 w-9 rounded-lg text-xs font-bold " +
                (days.includes(w.n) ? "bg-slate-800 text-white" : "bg-slate-100 text-slate-500")
              }
            >
              {w.ko}
            </button>
          ))}
        </div>
      </div>

      {/* 언제까지. 「이번주」가 먼저 눌려 있습니다 - 여기로 들어오는 연락은 거의 다 그 주
          한 번짜리이고, 매주로 잘못 넣으면 다음 주에도 할머니를 기다립니다. */}
      <div className="mb-2">
        <p className="mb-1 text-[11px] font-semibold text-slate-500">언제까지</p>
        <div className="flex gap-1">
          {DISMISSAL_REPEATS.map((r) => (
            <button
              key={r}
              onClick={() => setRepeat(r)}
              title={REPEAT_HINT[r]}
              className={
                "flex-1 rounded-lg px-2 py-1.5 text-[12px] font-bold " +
                (repeat === r ? "bg-slate-800 text-white" : "bg-slate-100 text-slate-500")
              }
            >
              {r === "매주" ? "매주" : `${r}만`}
            </button>
          ))}
        </div>
        <p className="mt-0.5 text-[11px] text-slate-400">{REPEAT_HINT[repeat]}</p>
      </div>

      <div className="mb-2">
        <p className="mb-1 text-[11px] font-semibold text-slate-500">수단</p>
        <div className="flex flex-wrap gap-1">
          {KINDS.map((k) => (
            <button
              key={k}
              onClick={() => setKind(k)}
              className={
                "rounded-lg px-2.5 py-1 text-[12px] font-semibold " +
                (kind === k ? "bg-slate-800 text-white" : "bg-slate-100 text-slate-600")
              }
            >
              {k}
            </button>
          ))}
        </div>
      </div>

      <div className="flex gap-1.5">
        <input
          value={labelText}
          onChange={(e) => setLabelText(e.target.value)}
          placeholder="어디 차인지 (예: 수학학원)"
          className="min-w-0 flex-1 rounded-lg border border-slate-300 px-2 py-1.5 text-[12px]"
        />
        <input
          value={time}
          onChange={(e) => setTime(e.target.value)}
          placeholder="14:40"
          className="w-20 rounded-lg border border-slate-300 px-2 py-1.5 text-[12px]"
        />
      </div>

      {err && <p className="mt-2 rounded bg-rose-50 px-2 py-1 text-[11px] font-bold text-rose-700">{err}</p>}
      <button
        onClick={() => void save()}
        disabled={busy}
        className="mt-3 w-full rounded-lg bg-emerald-600 py-2 text-[13px] font-bold text-white disabled:opacity-40"
      >
        {busy ? "저장 중…" : "저장"}
      </button>
      <p className="mt-1 text-[11px] text-slate-400">
        한 아이의 한 요일에는 하원수단이 하나뿐이라, 같은 갈래에 이미 있으면 덮어씁니다. 「이번주만」은 평소
        하원수단을 지우지 않고 그 주에만 앞섭니다.
      </p>
    </Shell>
  );
}
