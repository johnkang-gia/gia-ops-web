"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/common/ToastProvider";

// 앞으로 예정된 픽업.
//
// 요청: "'이번주 목금 이라엘 픽업입니다' 이라던가 특정날짜가 보이면 이것도 분석해서 미리
// 예정으로 등록해주고, 지정한날이 되면 자동으로 리마인드도 해줘"
//
// 연락 하나가 여러 날을 가리키는 경우가 많아서, 날짜마다 한 줄씩 예약해둡니다. 당일 아침에
// 크론이 그날치를 꺼내 하원 체크표에 픽업으로 걸고 담임 선생님께 알립니다.
//
// 이 화면이 필요한 이유: 예약이 어딘가에 잡혔는데 눈으로 확인할 곳이 없으면 아무도 믿지
// 않습니다. 특히 "이번주 목금"처럼 해석이 들어간 건은 사람이 한 번 봐야 합니다.

export type ScheduleRow = {
  id: string;
  service_date: string;
  pickup_time: string | null;
  student_name: string | null;
  student_id: string | null;
  status: string;
  needs_confirm: boolean;
  source_note: string | null;
  homeroom_email: string | null;
};

function dateLabel(iso: string): string {
  const d = new Date(iso + "T00:00:00+09:00");
  const wd = ["일", "월", "화", "수", "목", "금", "토"][d.getDay()];
  const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });
  const tomorrow = new Date(Date.now() + 86400000).toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });
  if (iso === today) return `오늘(${wd})`;
  if (iso === tomorrow) return `내일(${wd})`;
  return `${d.getMonth() + 1}/${d.getDate()}(${wd})`;
}

export default function UpcomingPickups({ initialRows }: { initialRows: ScheduleRow[] }) {
  const notify = useToast();
  const [rows, setRows] = useState(initialRows);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const supabase = createClient();
    const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });
    const { data } = await supabase
      .from("pickup_schedules")
      .select("id, service_date, pickup_time, student_name, student_id, status, needs_confirm, source_note, homeroom_email")
      .gte("service_date", today)
      .in("status", ["예정", "적용됨", "실패"])
      .order("service_date", { ascending: true })
      .limit(200);
    setRows((data as ScheduleRow[] | null) ?? []);
  }, []);

  useEffect(() => {
    const supabase = createClient();
    const ch = supabase
      .channel("pickup-schedules")
      .on("postgres_changes", { event: "*", schema: "public", table: "pickup_schedules" }, () => load())
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [load]);

  // 날짜별로 묶습니다. 하루씩 훑는 것이 사람이 보는 방식입니다.
  const byDate = useMemo(() => {
    const map = new Map<string, ScheduleRow[]>();
    for (const r of rows) {
      if (r.status === "취소") continue;
      const list = map.get(r.service_date) ?? [];
      list.push(r);
      map.set(r.service_date, list);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [rows]);

  const needsConfirmCount = rows.filter((r) => r.needs_confirm && r.status === "예정").length;

  async function cancel(row: ScheduleRow) {
    setBusy(true);
    const supabase = createClient();
    setRows((prev) => prev.filter((r) => r.id !== row.id));
    const { error } = await supabase
      .from("pickup_schedules")
      .update({ status: "취소", cancelled_at: new Date().toISOString() })
      .eq("id", row.id);
    setBusy(false);
    if (error) {
      notify("취소하지 못했습니다: " + error.message, "error");
      load();
    }
  }

  async function confirm(row: ScheduleRow) {
    setBusy(true);
    const supabase = createClient();
    setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, needs_confirm: false } : r)));
    const { error } = await supabase.from("pickup_schedules").update({ needs_confirm: false }).eq("id", row.id);
    setBusy(false);
    if (error) {
      notify("바꾸지 못했습니다: " + error.message, "error");
      load();
    }
  }

  if (byDate.length === 0) return null;

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-bold text-slate-800">앞으로 예정된 픽업</h2>
        {needsConfirmCount > 0 && (
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-700">
            확인 필요 {needsConfirmCount}
          </span>
        )}
        <span className="text-[11px] text-slate-400">당일 아침에 하원 체크표에 자동으로 걸립니다</span>
      </div>

      <div className="flex flex-col gap-2">
        {byDate.map(([date, list]) => (
          <div key={date} className="rounded-xl border border-slate-100 bg-slate-50/60 p-2">
            <div className="mb-1 text-xs font-bold text-slate-600">
              {dateLabel(date)} · {list.length}명
            </div>
            <div className="flex flex-wrap gap-1.5">
              {list.map((r) => (
                <div
                  key={r.id}
                  className={
                    "flex items-center gap-1.5 rounded-lg border px-2 py-1 text-xs " +
                    (r.status === "실패"
                      ? "border-red-200 bg-red-50 text-red-700"
                      : r.needs_confirm
                      ? "border-amber-200 bg-amber-50 text-amber-800"
                      : "border-slate-200 bg-white text-slate-700")
                  }
                  title={r.source_note ?? undefined}
                >
                  <span className="font-semibold">{r.student_name ?? "학생 미확인"}</span>
                  {r.pickup_time && <span className="text-[11px] text-slate-500">{r.pickup_time}</span>}
                  {r.status === "적용됨" && <span className="text-[10px] text-emerald-600">반영됨</span>}
                  {r.status === "실패" && <span className="text-[10px]">확인 필요</span>}
                  {r.needs_confirm && r.status === "예정" && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => confirm(r)}
                      className="rounded bg-amber-600 px-1.5 py-0.5 text-[10px] font-semibold text-white disabled:opacity-50"
                    >
                      맞음
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => cancel(r)}
                    className="rounded px-1 text-[11px] text-slate-400 hover:text-red-500 disabled:opacity-50"
                    aria-label="예약 취소"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
