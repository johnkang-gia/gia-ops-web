"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { timeAgo, kstDateOffset } from "@/lib/kst";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/common/ToastProvider";
import { Who } from "@/components/common/HomonymProvider";
import { loadStudents } from "@/lib/students";

/**
 * 직원 활동 기록 — 누가 언제 무엇을 했나. 모든 직원이 봅니다.
 *
 * 예전 로그는 업무 카드의 시스템 댓글만 보여줬고, 부서 탭이 「전체」이면 아예 숨었습니다. 문의에 답하거나
 * 처리 완료를 누르거나 학생 메모를 남긴 일은 어디에도 안 보여서, 같은 학부모에게 두 사람이 답하거나
 * 「누가 처리했지?」를 물으러 다녔습니다.
 *
 * 기록은 화면이 남기지 않습니다. 표마다 트리거가 남깁니다(`20261222000000_staff_activity_log.sql`) -
 * 어느 화면에서 눌러도 빠지지 않습니다. 여기서는 읽기만 합니다.
 */

type Act = {
  id: string;
  at: string;
  actor_email: string | null;
  actor_name: string;
  area: string;
  action: string;
  summary: string | null;
  student_id: string | null;
};

const AREA_STYLE: Record<string, string> = {
  문의: "bg-blue-100 text-blue-700",
  픽업: "bg-amber-100 text-amber-700",
  업무: "bg-slate-200 text-slate-700",
  쪽지: "bg-yellow-100 text-yellow-800",
  "학생 메모": "bg-violet-100 text-violet-700",
  "하원 체크표": "bg-orange-100 text-orange-700",
  "셔틀 메모": "bg-orange-50 text-orange-700",
  출결: "bg-rose-100 text-rose-700",
};

const WD = ["일", "월", "화", "수", "목", "금", "토"];
const shiftDay = (iso: string, d: number) => {
  const x = new Date(iso + "T00:00:00Z");
  x.setUTCDate(x.getUTCDate() + d);
  return x.toISOString().slice(0, 10);
};
const dayTitle = (iso: string) => {
  const d = new Date(iso + "T00:00:00Z");
  return `${d.getUTCMonth() + 1}월 ${d.getUTCDate()}일 (${WD[d.getUTCDay()]})`;
};
const timeKst = (iso: string) =>
  new Date(iso).toLocaleTimeString("ko-KR", { timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit", hour12: false });

export default function ActivityLogTicker(_props: { department?: string; isAdmin?: boolean; currentUserEmail?: string }) {
  const [latest, setLatest] = useState<Act | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;
    supabase
      .from("staff_activity_log")
      .select("*")
      .order("at", { ascending: false })
      .limit(1)
      .then(({ data }) => {
        if (!cancelled) setLatest(((data as Act[] | null) ?? [])[0] ?? null);
      });
    const ch = supabase
      .channel("staff-activity-ticker")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "staff_activity_log" }, (p) => setLatest(p.new as Act))
      .subscribe();
    return () => {
      cancelled = true;
      void supabase.removeChannel(ch);
    };
  }, []);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="모든 직원의 활동 기록 보기"
        className="mx-2 flex min-w-0 max-w-[26rem] flex-1 items-center gap-1.5 rounded-full bg-black/5 px-3 py-1 text-left text-[11px] text-slate-500 transition hover:bg-black/10"
      >
        <span className="shrink-0">🔔</span>
        <span className="min-w-0 flex-1 truncate">
          {latest ? (
            <>
              <b className="text-slate-700">{latest.actor_name}</b> {latest.action}
              {latest.summary ? ` · ${latest.summary}` : ""} <span className="opacity-50">· {timeAgo(latest.at)}</span>
            </>
          ) : (
            <span className="opacity-50">아직 활동 기록이 없습니다.</span>
          )}
        </span>
        <span className="shrink-0 text-[10px] font-semibold text-blue-500">활동 기록 →</span>
      </button>
      {open && typeof document !== "undefined" && createPortal(<ActivityModal onClose={() => setOpen(false)} />, document.body)}
    </>
  );
}

function ActivityModal({ onClose }: { onClose: () => void }) {
  const notify = useToast();
  const [day, setDay] = useState(kstDateOffset(0));
  const [rows, setRows] = useState<Act[] | null>(null);
  const [who, setWho] = useState<string>("전체");
  const [area, setArea] = useState<string>("전체");
  const [names, setNames] = useState<Map<string, string>>(new Map());
  const today = kstDateOffset(0);

  const load = useCallback(async () => {
    const { data, error } = await createClient()
      .from("staff_activity_log")
      .select("*")
      .gte("at", `${day}T00:00:00+09:00`)
      .lt("at", `${shiftDay(day, 1)}T00:00:00+09:00`)
      .order("at", { ascending: false })
      .limit(1000);
    if (error) {
      notify("활동 기록을 읽지 못했습니다: " + error.message, "error");
      setRows([]);
      return;
    }
    setRows((data as Act[] | null) ?? []);
  }, [day, notify]);

  useEffect(() => {
    setRows(null);
    void load();
  }, [load]);

  useEffect(() => {
    // 학생 이름은 번호로 찾습니다.
    void loadStudents(createClient(), { status: "all" }).then(({ rows: st }) => setNames(new Map(st.map((s) => [s.id, s.name]))));
    if (day !== today) return;
    const supabase = createClient();
    const ch = supabase
      .channel("staff-activity-modal")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "staff_activity_log" }, (p) =>
        setRows((prev) => (prev ? [p.new as Act, ...prev] : prev)),
      )
      .subscribe();
    return () => void supabase.removeChannel(ch);
  }, [day, today]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const people = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows ?? []) m.set(r.actor_name, (m.get(r.actor_name) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [rows]);
  const areas = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows ?? []) m.set(r.area, (m.get(r.area) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [rows]);
  const shown = (rows ?? []).filter((r) => (who === "전체" || r.actor_name === who) && (area === "전체" || r.area === area));

  const chip = (active: boolean) =>
    "rounded-full border px-2 py-0.5 text-[10px] font-bold " +
    (active ? "border-blue-500 bg-blue-600 text-white" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50");

  return (
    <div className="fixed inset-0 z-[900] flex items-start justify-center bg-black/40 p-3 sm:p-6" onClick={onClose}>
      <div
        className="flex max-h-full w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-black/5 px-4 py-2.5">
          <h2 className="text-sm font-bold text-slate-800">🔔 직원 활동 기록</h2>
          <div className="flex items-center gap-1">
            <button type="button" onClick={() => setDay(shiftDay(day, -1))} className="rounded border px-1.5 text-xs hover:bg-slate-50">
              ◀
            </button>
            <input
              type="date"
              value={day}
              max={today}
              onChange={(e) => e.target.value && setDay(e.target.value)}
              className="rounded border px-1.5 py-0.5 text-xs"
            />
            <button
              type="button"
              disabled={day >= today}
              onClick={() => setDay(shiftDay(day, 1))}
              className="rounded border px-1.5 text-xs hover:bg-slate-50 disabled:opacity-30"
            >
              ▶
            </button>
            <span className="text-xs font-bold text-slate-600">{dayTitle(day)}</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="ml-auto rounded-lg bg-slate-800 px-3 py-1 text-[12px] font-bold text-white hover:bg-slate-700"
          >
            닫기
          </button>
        </div>

        <div className="shrink-0 space-y-1 border-b border-black/5 px-4 py-1.5">
          <div className="flex flex-wrap items-center gap-1">
            <span className="mr-1 text-[10px] font-bold text-slate-400">사람</span>
            <button type="button" className={chip(who === "전체")} onClick={() => setWho("전체")}>
              전체 {rows?.length ?? 0}
            </button>
            {people.map(([n, c]) => (
              <button key={n} type="button" className={chip(who === n)} onClick={() => setWho(n)}>
                {n} {c}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-1">
            <span className="mr-1 text-[10px] font-bold text-slate-400">종류</span>
            <button type="button" className={chip(area === "전체")} onClick={() => setArea("전체")}>
              전체
            </button>
            {areas.map(([a, c]) => (
              <button key={a} type="button" className={chip(area === a)} onClick={() => setArea(a)}>
                {a} {c}
              </button>
            ))}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-2">
          {rows === null ? (
            <p className="p-6 text-center text-xs text-slate-400">불러오는 중…</p>
          ) : shown.length === 0 ? (
            <p className="p-6 text-center text-xs text-slate-400">이날 남은 활동이 없습니다.</p>
          ) : (
            <ul className="divide-y divide-black/5">
              {shown.map((r) => {
                const sName = r.student_id ? names.get(r.student_id) : null;
                return (
                  <li key={r.id} className="flex items-start gap-2 py-1.5 text-[12px]">
                    <span className="w-11 shrink-0 tabular-nums text-slate-400">{timeKst(r.at)}</span>
                    <span className="w-20 shrink-0 truncate font-bold text-slate-800" title={r.actor_email ?? r.actor_name}>
                      {r.actor_name}
                    </span>
                    <span className={"shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold " + (AREA_STYLE[r.area] ?? "bg-slate-100 text-slate-600")}>
                      {r.area}
                    </span>
                    <span className="shrink-0 font-bold text-slate-700">{r.action}</span>
                    <span className="min-w-0 flex-1 text-slate-600">
                      {sName && <Who id={r.student_id} name={sName} className="mr-1 font-bold text-slate-800" />}
                      {r.summary}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
