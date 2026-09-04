"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/common/ToastProvider";

/**
 * 수업일 달력.
 *
 * 평일은 자동으로 깔고, **예외만 사람이 뺍니다.** 100일을 하나씩 누르게 하면 그 일은 결국
 * 안 하게 되고, 안 하면 출석부 전체가 멈춥니다. 공휴일은 SQL에서 미리 빼두었으므로 여기서는
 * 방학·재량휴업일·개교기념일만 손보면 됩니다.
 *
 * 날짜를 누르면 수업일 ↔ 쉬는 날이 뒤집힙니다. 뒤집은 날은 `touched_by_human` 이 켜져서,
 * 나중에 "달력 다시 깔기" 를 눌러도 되돌아가지 않습니다.
 */

type Day = { day: string; is_school_day: boolean; closed_reason: string | null; label: string | null; touched_by_human: boolean };
type Term = { id: string; year: string; term_type: string; start_date: string | null; end_date: string | null; status: string };

const REASONS = ["방학", "재량휴업일", "개교기념일", "공휴일", "기타"];
const WEEK = ["월", "화", "수", "목", "금"];

export default function CalendarClient({
  terms,
  initialTermId,
  initialDays,
  coverageStart,
  currentUserEmail,
}: {
  terms: Term[];
  initialTermId: string;
  initialDays: Day[];
  coverageStart: string | null;
  currentUserEmail: string;
}) {
  const router = useRouter();
  const notify = useToast();
  const [days, setDays] = useState(initialDays);
  const [termId, setTermId] = useState(initialTermId);
  const [reason, setReason] = useState("방학");
  const [busy, setBusy] = useState(false);
  const [start, setStart] = useState(coverageStart ?? "");

  const term = terms.find((t) => t.id === termId) ?? null;
  const open = days.filter((d) => d.is_school_day).length;

  // 월 → 주 → 날. 달력 모양이어야 "이 주가 통째로 방학이구나" 가 눈에 들어옵니다.
  const months = useMemo(() => {
    const m = new Map<string, Day[]>();
    for (const d of days) {
      const k = d.day.slice(0, 7);
      (m.get(k) ?? m.set(k, []).get(k)!).push(d);
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [days]);

  async function fill() {
    if (!termId) return;
    setBusy(true);
    const supabase = createClient();
    const { error } = await supabase.rpc("fill_school_days", { p_term_id: termId });
    if (error) {
      setBusy(false);
      notify("달력을 만들지 못했습니다: " + error.message, "error");
      return;
    }
    // 방금 만든 것을 그대로 다시 읽습니다. 화면에서 지어내면 실제 저장된 것과 어긋납니다.
    const { data } = await supabase
      .from("school_days")
      .select("day, is_school_day, closed_reason, label, touched_by_human")
      .gte("day", term?.start_date ?? "")
      .lte("day", term?.end_date ?? "")
      .order("day");
    setDays((data as Day[] | null) ?? []);
    setBusy(false);
    notify("평일을 수업일로 깔았습니다. 방학·휴업일만 눌러서 빼주세요.", "success");
    router.refresh();
  }

  async function toggle(d: Day) {
    const next = !d.is_school_day;
    setDays((p) => p.map((x) => (x.day === d.day ? { ...x, is_school_day: next, closed_reason: next ? null : reason, touched_by_human: true } : x)));
    const { error } = await createClient()
      .from("school_days")
      .update({
        is_school_day: next,
        closed_reason: next ? null : reason,
        label: next ? null : reason,
        touched_by_human: true,
        updated_by: currentUserEmail,
      })
      .eq("day", d.day);
    if (error) {
      // 조용히 넘기면 화면에서는 빠진 것처럼 보이는데 집계는 그 날을 계속 셉니다.
      notify("바꾸지 못했습니다: " + error.message, "error");
      setDays((p) => p.map((x) => (x.day === d.day ? d : x)));
    }
  }

  async function saveStart() {
    const { error } = await createClient()
      .from("attendance_coverage")
      .update({ starts_on: start || null, updated_by: currentUserEmail, updated_at: new Date().toISOString() })
      .eq("id", true);
    if (error) {
      notify("저장하지 못했습니다: " + error.message, "error");
      return;
    }
    notify("기록 시작일을 정했습니다.", "success");
    router.refresh();
  }

  return (
    <div className="mx-auto max-w-5xl p-4 sm:p-6">
      <div className="mb-1 flex flex-wrap items-baseline gap-2">
        <h1 className="text-lg font-bold">📅 수업일 달력</h1>
        <span className="text-xs text-slate-400">출석률의 분모입니다</span>
        <Link href="/attendance" className="ml-auto text-[12px] font-semibold text-teal-700 underline">
          ← 출석부로
        </Link>
      </div>
      <p className="mb-4 text-xs leading-relaxed text-slate-500">
        평일을 <b>자동으로 깔고</b>, 방학·재량휴업일만 눌러서 뺍니다. 한국 공휴일은 이미 빠져 있습니다. 한 번 손댄 날은 다시 깔아도
        되돌아가지 않습니다.
      </p>

      {/* 기록 시작일.
          이것이 없으면 출석부를 쓰기 전 날짜가 전부 '전원 출석' 으로 읽힙니다. */}
      <div className="mb-4 rounded-xl border border-slate-200 bg-white p-3">
        <p className="mb-1 text-[12px] font-bold text-slate-700">기록 시작일</p>
        <p className="mb-2 text-[11px] leading-relaxed text-slate-500">
          이 날부터의 기록만 집계에 씁니다. 출석부를 실제로 찍기 시작한 날을 적어주세요. 비워두면 학기 전체를 세는데, 그러면{" "}
          <b>기록이 없는 날이 전원 출석으로 읽힙니다.</b>
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="date"
            value={start}
            onChange={(e) => setStart(e.target.value)}
            className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
          />
          <button onClick={() => void saveStart()} className="rounded-lg bg-teal-600 px-3 py-1.5 text-sm font-semibold text-white">
            정하기
          </button>
          {!coverageStart && <span className="text-[11px] font-semibold text-amber-700">아직 정하지 않았습니다</span>}
        </div>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white p-3">
        <select value={termId} onChange={(e) => setTermId(e.target.value)} className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm">
          {terms.map((t) => (
            <option key={t.id} value={t.id}>
              {t.year} {t.term_type} {t.status === "진행중" ? "(진행중)" : ""}
            </option>
          ))}
        </select>
        <button
          onClick={() => void fill()}
          disabled={busy || !termId}
          className="rounded-lg bg-gia-navy px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-40"
        >
          {busy ? "만드는 중…" : "평일 깔기"}
        </button>
        <span className="text-[12px] text-slate-500">
          수업일 <b className="text-slate-800">{open}일</b> · 쉬는 날 {days.length - open}일
        </span>
        <span className="ml-auto flex items-center gap-1.5 text-[11px] text-slate-500">
          뺄 때 사유
          <select value={reason} onChange={(e) => setReason(e.target.value)} className="rounded border border-slate-200 px-1.5 py-1 text-[11px]">
            {REASONS.map((r) => (
              <option key={r}>{r}</option>
            ))}
          </select>
        </span>
      </div>

      {days.length === 0 && (
        <div className="rounded-xl border border-dashed border-slate-200 p-8 text-center text-sm text-slate-400">
          {term?.start_date && term?.end_date
            ? "아직 달력이 비어 있습니다. 위에서 «평일 깔기»를 눌러주세요."
            : "이 학기에 시작일·종료일이 없습니다. 학기 화면에서 먼저 적어주세요."}
        </div>
      )}

      <div className="space-y-4">
        {months.map(([m, list]) => (
          <div key={m}>
            <p className="mb-1.5 text-[13px] font-bold text-slate-700">
              {Number(m.slice(5))}월
              <span className="ml-1.5 text-[11px] font-normal text-slate-400">
                수업일 {list.filter((d) => d.is_school_day).length}일
              </span>
            </p>
            <div className="grid grid-cols-5 gap-1">
              {WEEK.map((w) => (
                <div key={w} className="pb-0.5 text-center text-[10px] font-semibold text-slate-400">
                  {w}
                </div>
              ))}
              {/* 그 달 첫 평일 앞의 빈칸. 요일이 안 맞으면 달력으로 안 읽힙니다. */}
              {Array.from({ length: (new Date(`${list[0].day}T00:00:00`).getDay() + 6) % 7 }).map((_, i) => (
                <div key={`pad${i}`} />
              ))}
              {list.map((d) => (
                <button
                  key={d.day}
                  onClick={() => void toggle(d)}
                  title={d.is_school_day ? "눌러서 쉬는 날로" : `${d.label ?? d.closed_reason ?? "쉬는 날"} — 눌러서 수업일로`}
                  className={
                    "rounded-lg border px-1 py-1.5 text-center transition " +
                    (d.is_school_day
                      ? "border-slate-200 bg-white hover:border-slate-400"
                      : "border-rose-200 bg-rose-50 hover:border-rose-400")
                  }
                >
                  <span className={"block text-[13px] font-bold tabular-nums " + (d.is_school_day ? "text-slate-700" : "text-rose-600")}>
                    {Number(d.day.slice(8))}
                  </span>
                  <span className="block truncate text-[9px] leading-tight text-rose-500">{d.is_school_day ? "" : d.label ?? d.closed_reason ?? "휴업"}</span>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
