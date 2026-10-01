"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import StudentLedgerModal from "@/components/finance/StudentLedgerModal";
import { Who } from "@/components/common/HomonymProvider";
import type { PanelTab } from "./StudentPanelProvider";

/**
 * **학생 창 — 한 아이의 전부를 탭 넷으로.**
 *
 *   기본      명부 · 연락처 · 셔틀 배정 · 하원수단
 *   출결·픽업 최근 30일 결석·지각·조퇴 · 픽업/문의 요청
 *   회계      회계 창(StudentLedgerModal)을 그대로 끼움 - 재무 권한이 있을 때만 탭이 있음
 *   기록      사건 · 관찰기록 · 이어진 업무
 *
 * 기본·출결·기록은 `/api/students/[id]/overview` 한 번으로 읽고, 회계 탭은 회계 창이 자기
 * API 로 읽습니다. 돈 자료가 이 창을 거쳐 재무 권한 없는 사람에게 가지 않게 하려는 것입니다.
 */
type Overview = {
  today: string;
  since: string;
  canSeeFinance: boolean;
  student: {
    id: string;
    name: string;
    name_en: string | null;
    grade: string | null;
    class_name: string | null;
    department: string | null;
    status: string | null;
    birth_date: string | null;
    mother_phone: string | null;
    father_phone: string | null;
    parent_phone: string | null;
  };
  shuttle: { id: string; routeNo: string; routeName: string | null; direction: string; term: string; active: boolean; stop: string | null; weekdays: number[] }[];
  dismissal: { weekday: number; mode: string; note: string | null }[];
  attendance: { summary: { 결석: number; 지각: number; 조퇴: number }; rows: { date: string; status: string; note: string | null }[] };
  pickups: { id: string; kind: string; status: string; service_date: string | null; ai_pickup_time: string | null; summary: string | null; answered_at: string | null }[];
  incidents: { id: string; title: string | null; date: string | null; category: string | null }[];
  reports: { id: string; report_date: string; term: string | null }[];
  tasks: { id: string; title: string; status: string; due_at: string | null }[];
  warnings: string[];
};

const WD = ["일", "월", "화", "수", "목", "금", "토"];

export default function StudentPanel({
  studentId,
  initialTab,
  canSeeFinance,
  onClose,
}: {
  studentId: string;
  initialTab: PanelTab;
  canSeeFinance: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<PanelTab>(initialTab === "회계" && !canSeeFinance ? "기본" : initialTab);
  const [data, setData] = useState<Overview | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setData(null);
    setErr(null);
    void fetch(`/api/students/${studentId}/overview`, { cache: "no-store" })
      .then(async (r) => {
        const b = (await r.json().catch(() => ({}))) as Overview & { error?: string };
        if (!alive) return;
        if (!r.ok) setErr(b.error ?? `읽지 못했습니다 (${r.status})`);
        else setData(b);
      })
      .catch((e) => alive && setErr(String(e)));
    return () => {
      alive = false;
    };
  }, [studentId]);

  useEffect(() => {
    // 회계 탭은 자기 하위 창(입금·취소…)이 Esc 를 먼저 받아야 하므로 거기서는 닫지 않습니다.
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && tab !== "회계" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, tab]);

  const tabs: PanelTab[] = canSeeFinance ? ["기본", "출결·픽업", "회계", "기록"] : ["기본", "출결·픽업", "기록"];
  const s = data?.student;

  return (
    <div className="fixed inset-0 z-[85] flex items-center justify-center bg-black/40 p-3" onClick={onClose}>
      <div className="flex max-h-[94vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-slate-50 px-4 py-2">
          <div className="text-base font-black text-slate-900">
            {s ? <Who id={s.id} name={s.name} plain /> : "…"}
            {s && (
              <span className="ml-1.5 text-[12px] font-semibold text-slate-500">
                {[s.grade ? `${s.grade}학년` : null, s.class_name, s.department].filter(Boolean).join(" · ")}
                {s.name_en ? ` · ${s.name_en}` : ""}
                {s.status && s.status !== "active" ? ` · ${s.status}` : ""}
              </span>
            )}
          </div>
          <span className="ml-2 flex overflow-hidden rounded-lg border border-slate-300 text-[12px] font-bold">
            {tabs.map((t) => (
              <button key={t} onClick={() => setTab(t)} className={"px-3 py-1 " + (tab === t ? "bg-slate-800 text-white" : "bg-white text-slate-500 hover:bg-slate-50")}>
                {t}
              </button>
            ))}
          </span>
          <Link href={`/students/${studentId}`} className="ml-auto text-[11px] font-semibold text-indigo-700 underline" onClick={onClose}>
            전체 프로필 →
          </Link>
          <button onClick={onClose} className="px-1 text-lg font-bold text-slate-400 hover:text-slate-700" title="닫기 (Esc)">
            ✕
          </button>
        </div>

        {err && <p className="m-3 rounded-lg bg-rose-50 px-3 py-2 text-[12px] font-bold text-rose-700">읽지 못했습니다: {err}</p>}
        {data?.warnings.length ? <p className="mx-3 mt-2 rounded-lg bg-amber-50 px-3 py-1.5 text-[11px] font-semibold text-amber-800">일부 자료를 못 읽었습니다: {data.warnings.join(" · ")}</p> : null}

        {tab === "회계" && canSeeFinance ? (
          <StudentLedgerModal studentId={studentId} onClose={onClose} onChanged={() => router.refresh()} embedded />
        ) : !data ? (
          !err && <p className="p-8 text-center text-sm text-slate-400">읽는 중…</p>
        ) : tab === "기본" ? (
          <BasicTab d={data} />
        ) : tab === "출결·픽업" ? (
          <AttendanceTab d={data} />
        ) : (
          <RecordsTab d={data} />
        )}
      </div>
    </div>
  );
}

function Section({ title, children, right }: { title: string; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-slate-200 p-3">
      <h3 className="mb-1.5 flex items-center justify-between text-[12px] font-black text-slate-700">
        <span>{title}</span>
        {right}
      </h3>
      {children}
    </section>
  );
}

function BasicTab({ d }: { d: Overview }) {
  const s = d.student;
  const phones = [
    ["어머니", s.mother_phone],
    ["아버지", s.father_phone],
    ["보호자", s.parent_phone],
  ].filter(([, v]) => v) as [string, string][];
  return (
    <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 overflow-y-auto p-3 text-[12px] md:grid-cols-2">
      <Section title="명부">
        <dl className="grid grid-cols-[72px_1fr] gap-y-1 text-slate-700">
          <dt className="text-slate-400">이름</dt>
          <dd>
            {s.name}
            {s.name_en ? ` (${s.name_en})` : ""}
          </dd>
          <dt className="text-slate-400">학년 · 반</dt>
          <dd>{[s.grade ? `${s.grade}학년` : null, s.class_name].filter(Boolean).join(" ") || "—"}</dd>
          <dt className="text-slate-400">부서</dt>
          <dd>{s.department ?? "—"}</dd>
          <dt className="text-slate-400">생년월일</dt>
          <dd>{s.birth_date ?? "—"}</dd>
          <dt className="text-slate-400">연락처</dt>
          <dd>{phones.length ? phones.map(([k, v]) => `${k} ${v}`).join(" · ") : "—"}</dd>
        </dl>
      </Section>
      <Section title="셔틀" right={<Link href="/shuttle/students" className="text-[10px] font-semibold text-indigo-700 underline">탑승 배정</Link>}>
        {d.shuttle.length === 0 ? (
          <p className="text-slate-400">배정 없음</p>
        ) : (
          <ul className="space-y-1">
            {d.shuttle.map((a) => (
              <li key={a.id} className={a.active ? "" : "text-slate-400"}>
                <span className={"mr-1 rounded px-1 text-[10px] font-bold " + (a.direction === "하원" ? "bg-indigo-100 text-indigo-700" : "bg-amber-100 text-amber-700")}>{a.direction}</span>
                <b>{a.routeNo}호</b> {a.routeName ?? ""} · {a.stop ?? "정류장 미지정"} · {a.weekdays.map((w) => WD[w]).join("")}
                {!a.active && <span className="ml-1 text-[10px]">(대기)</span>}
                {a.term !== "정규학기" && <span className="ml-1 text-[10px]">({a.term})</span>}
              </li>
            ))}
          </ul>
        )}
      </Section>
      <Section title="하원수단 (요일별)">
        {d.dismissal.length === 0 ? (
          <p className="text-slate-400">정해진 것 없음 — 셔틀 배정대로</p>
        ) : (
          <ul className="flex flex-wrap gap-1">
            {[1, 2, 3, 4, 5].map((w) => {
              const p = d.dismissal.find((x) => x.weekday === w);
              return (
                <li key={w} className={"rounded border px-1.5 py-0.5 " + (p ? "border-slate-300" : "border-dashed border-slate-200 text-slate-300")}>
                  {WD[w]} {p ? p.mode : "—"}
                  {p?.note ? <span className="ml-1 text-[10px] text-slate-400">{p.note}</span> : null}
                </li>
              );
            })}
          </ul>
        )}
      </Section>
    </div>
  );
}

function AttendanceTab({ d }: { d: Overview }) {
  const a = d.attendance;
  return (
    <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 overflow-y-auto p-3 text-[12px] md:grid-cols-2">
      <Section
        title={`출결 — 최근 30일 (${d.since} ~)`}
        right={<Link href={`/attendance/students/${d.student.id}`} className="text-[10px] font-semibold text-indigo-700 underline">전체 출석부</Link>}
      >
        <div className="mb-2 flex gap-2">
          {(["결석", "지각", "조퇴"] as const).map((k) => (
            <span key={k} className={"rounded-lg px-2 py-1 font-bold " + (a.summary[k] > 0 ? "bg-rose-50 text-rose-700" : "bg-slate-50 text-slate-400")}>
              {k} {a.summary[k]}
            </span>
          ))}
        </div>
        {a.rows.length === 0 ? (
          <p className="text-slate-400">결석·지각·조퇴 없음</p>
        ) : (
          <ul className="space-y-0.5">
            {a.rows.map((r, i) => (
              <li key={i}>
                <span className="tabular-nums text-slate-500">{r.date}</span> <b>{r.status}</b>
                {r.note ? <span className="ml-1 text-slate-500">{r.note}</span> : null}
              </li>
            ))}
          </ul>
        )}
      </Section>
      <Section title="픽업 · 문의 요청 — 최근 30일" right={<Link href="/pickup/inbox" className="text-[10px] font-semibold text-indigo-700 underline">픽업 인박스</Link>}>
        {d.pickups.length === 0 ? (
          <p className="text-slate-400">없음</p>
        ) : (
          <ul className="space-y-0.5">
            {d.pickups.map((p) => (
              <li key={p.id} className="flex items-baseline gap-1">
                <span className="tabular-nums text-slate-500">{p.service_date ?? "—"}</span>
                <span className="rounded bg-slate-100 px-1 text-[10px] font-bold text-slate-600">{p.kind}</span>
                {p.ai_pickup_time && <span className="tabular-nums">{p.ai_pickup_time}</span>}
                <span className="min-w-0 flex-1 truncate text-slate-700" title={p.summary ?? ""}>{p.summary ?? ""}</span>
                <span className={"text-[10px] font-bold " + (p.status === "확정" ? "text-emerald-700" : p.status === "무시" ? "text-slate-400" : "text-amber-700")}>{p.status}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}

function RecordsTab({ d }: { d: Overview }) {
  return (
    <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 overflow-y-auto p-3 text-[12px] md:grid-cols-3">
      <Section title={`사건 기록 (${d.incidents.length})`}>
        {d.incidents.length === 0 ? (
          <p className="text-slate-400">없음</p>
        ) : (
          <ul className="space-y-0.5">
            {d.incidents.map((i) => (
              <li key={i.id}>
                <span className="tabular-nums text-slate-500">{i.date ?? ""}</span> {i.category ? <span className="rounded bg-slate-100 px-1 text-[10px]">{i.category}</span> : null} {i.title ?? ""}
              </li>
            ))}
          </ul>
        )}
      </Section>
      <Section title={`주간 관찰기록 (${d.reports.length})`} right={<Link href={`/weekly-report/students/${d.student.id}`} className="text-[10px] font-semibold text-indigo-700 underline">전체</Link>}>
        {d.reports.length === 0 ? (
          <p className="text-slate-400">없음</p>
        ) : (
          <ul className="space-y-0.5">
            {d.reports.map((r) => (
              <li key={r.id}>
                <span className="tabular-nums text-slate-500">{r.report_date}</span> {r.term ?? ""}
              </li>
            ))}
          </ul>
        )}
      </Section>
      <Section title={`이어진 업무 (${d.tasks.length})`}>
        {d.tasks.length === 0 ? (
          <p className="text-slate-400">없음</p>
        ) : (
          <ul className="space-y-0.5">
            {d.tasks.map((t) => (
              <li key={t.id} className="flex items-baseline gap-1">
                <span className={"rounded px-1 text-[10px] font-bold " + (t.status === "완료" ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700")}>{t.status}</span>
                <span className="min-w-0 flex-1 truncate">{t.title}</span>
                {t.due_at && <span className="tabular-nums text-[10px] text-slate-400">{t.due_at.slice(0, 10)}</span>}
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}
