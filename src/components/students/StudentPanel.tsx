"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { BADGE_STYLE, type InquiryBadge } from "@/lib/inquiryBadges";
import { kstDate } from "@/lib/kst";
import Link from "@/components/common/AppLink";
import { useRouter } from "next/navigation";
import StudentLedgerModal from "@/components/finance/StudentLedgerModal";
import { Who } from "@/components/common/HomonymProvider";
import StudentProfileNotes from "@/components/students/StudentProfileNotes";
import type { PanelTab } from "./StudentPanelProvider";

/**
 * **학생 창 — 한 아이의 전부를 탭 넷으로.**
 *
 *   기본      명부 · 연락처 · 셔틀 배정 · 하원수단
 *   특이사항  사건이 없어도 알아야 할 아이 이야기(자유 메모, 학기별)
 *   출결·픽업 최근 30일 결석·지각·조퇴 · 픽업/문의 요청
 *   회계      회계 창(StudentLedgerModal)을 그대로 끼움 - 재무 권한이 있을 때만 탭이 있음
 *   문의      지난 학부모 문의 전부(토들·전화·메모) - 날짜별, 찾기
 *   기록      사건 · 관찰기록 · 이어진 업무
 *
 * **옆에 붙여 띄우기(📌).** 가운데 큰 창은 뒤를 가려서, 전화를 받으며 학생을 보는 동안 메모장에 적을 수
 * 없었습니다. 붙이면 오른쪽에 붙고 뒤를 가리지 않습니다 - 업무보드에서는 처음부터 붙여서 엽니다. 고른 방식은
 * 이 브라우저에 기억합니다.
 *
 * 기본·출결·기록은 `/api/students/[id]/overview` 한 번으로 읽고, 회계 탭은 회계 창이 자기
 * API 로 읽습니다. 돈 자료가 이 창을 거쳐 재무 권한 없는 사람에게 가지 않게 하려는 것입니다.
 */
type Overview = {
  today: string;
  since: string;
  canSeeFinance: boolean;
  me: { email: string; name: string };
  currentTermId: string | null;
  termLabels: Record<string, string>;
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
const DOCK_KEY = "gia-student-panel-dock-v1";

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
  const pathname = usePathname() ?? "";
  const [docked, setDocked] = useState<boolean>(() => {
    try {
      const v = localStorage.getItem(DOCK_KEY);
      if (v === "on") return true;
      if (v === "off") return false;
    } catch {
      /* 기억 못 해도 동작은 같습니다 */
    }
    return pathname.startsWith("/work");
  });
  const toggleDock = () => {
    const next = !docked;
    setDocked(next);
    try {
      localStorage.setItem(DOCK_KEY, next ? "on" : "off");
    } catch {
      /* 이번 창에서만 */
    }
  };
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

  const tabs: PanelTab[] = canSeeFinance
    ? ["기본", "특이사항", "출결·픽업", "문의", "회계", "기록"]
    : ["기본", "특이사항", "출결·픽업", "문의", "기록"];
  const s = data?.student;

  return (
    <div
      className={docked ? "pointer-events-none fixed inset-y-0 right-0 z-[85] flex w-full items-stretch justify-end p-2 sm:w-[min(640px,48vw)]" : "fixed inset-0 z-[85] flex items-center justify-center bg-black/40 p-3"}
      onClick={docked ? undefined : onClose}
    >
      <div
        className={
          "pointer-events-auto flex w-full flex-col overflow-hidden rounded-2xl bg-white shadow-2xl " +
          (docked ? "h-full border border-slate-300" : "max-h-[94vh] max-w-5xl")
        }
        onClick={(e) => e.stopPropagation()}
      >
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
          <button
            type="button"
            onClick={toggleDock}
            className={"ml-auto rounded-lg border px-2 py-0.5 text-[11px] font-bold " + (docked ? "border-indigo-300 bg-indigo-50 text-indigo-700" : "border-slate-300 bg-white text-slate-500")}
            title={docked ? "가운데 큰 창으로 엽니다" : "오른쪽에 붙여 띄웁니다. 뒤 화면(메모장 등)을 함께 쓸 수 있습니다."}
          >
            {docked ? "⬜ 크게" : "📌 옆에 붙이기"}
          </button>
          <Link href={`/students/${studentId}`} className="text-[11px] font-semibold text-indigo-700 underline" onClick={onClose}>
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
        ) : tab === "특이사항" ? (
          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            <StudentProfileNotes
              studentId={studentId}
              studentName={data.student.name}
              currentTermId={data.currentTermId ?? null}
              termLabels={data.termLabels ?? {}}
              me={data.me?.email ?? ""}
              myName={data.me?.name ?? ""}
            />
          </div>
        ) : tab === "출결·픽업" ? (
          <AttendanceTab d={data} />
        ) : tab === "문의" ? (
          <InquiryTab studentId={studentId} />
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
                {t.due_at && <span className="tabular-nums text-[10px] text-slate-400">{kstDate(t.due_at)}</span>}
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}

type InqRow = {
  id: string;
  received_at: string;
  source: string | null;
  kind: string | null;
  badges: string[] | null;
  summary: string | null;
  raw_text: string | null;
  replied_at: string | null;
  replied_by: string | null;
  replied_via: string | null;
  answered_at: string | null;
  skipped_at?: string | null;
  is_demo?: boolean | null;
};

const dayOf = (iso: string) => new Date(iso).toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });
const hhmm = (iso: string) =>
  new Date(iso).toLocaleTimeString("ko-KR", { timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit", hour12: false });

/**
 * 지난 문의 — 이 아이에게 온 학부모 연락 전부(최근 300건). 학생 번호로만 찾습니다(이름으로 찾으면 동명이인의
 * 문의가 섞입니다). 날짜별로 묶고, 글자로 걸러 봅니다. 줄을 누르면 원문이 펼쳐집니다.
 */
function InquiryTab({ studentId }: { studentId: string }) {
  const [rows, setRows] = useState<InqRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setRows(null);
    void createClient()
      .from("pickup_requests")
      .select("*")
      .eq("student_id", studentId)
      .order("received_at", { ascending: false })
      .limit(300)
      .then(({ data, error }) => {
        if (!alive) return;
        if (error) setErr(error.message);
        setRows(((data as InqRow[] | null) ?? []).filter((r) => !r.is_demo));
      });
    return () => {
      alive = false;
    };
  }, [studentId]);

  const groups = useMemo(() => {
    const t = q.trim().toLowerCase();
    const list = (rows ?? []).filter(
      (r) => !t || `${r.summary ?? ""} ${r.raw_text ?? ""} ${(r.badges ?? []).join(" ")}`.toLowerCase().includes(t),
    );
    const m = new Map<string, InqRow[]>();
    for (const r of list) {
      const d = dayOf(r.received_at);
      m.set(d, [...(m.get(d) ?? []), r]);
    }
    return [...m.entries()];
  }, [rows, q]);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden text-[12px]">
      <div className="flex shrink-0 items-center gap-2 border-b border-slate-100 px-3 py-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="문의 내용에서 찾기 (예: 픽업, 결석, 물건)"
          className="w-full rounded-lg border border-slate-200 px-2 py-1 outline-none focus:border-indigo-400"
        />
        <span className="shrink-0 text-[11px] text-slate-400">{rows ? `${rows.length}건` : ""}</span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {err && <p className="mb-2 rounded-lg bg-rose-50 px-3 py-2 font-bold text-rose-700">문의를 읽지 못했습니다: {err}</p>}
        {!rows ? (
          <p className="p-6 text-center text-slate-400">읽는 중…</p>
        ) : groups.length === 0 ? (
          <p className="p-6 text-center text-slate-400">{q ? "찾는 문의가 없습니다." : "이 학생 앞으로 온 문의가 없습니다."}</p>
        ) : (
          groups.map(([d, list]) => (
            <div key={d} className="mb-3">
              <p className="mb-1 text-[11px] font-black text-slate-500">
                {d} ({WD[new Date(d + "T00:00:00+09:00").getDay()]}) · {list.length}건
              </p>
              <ul className="space-y-1">
                {list.map((r) => (
                  <li key={r.id} className="rounded-lg border border-slate-200 px-2 py-1">
                    <button type="button" onClick={() => setOpenId(openId === r.id ? null : r.id)} className="flex w-full items-baseline gap-1.5 text-left">
                      <span className="w-10 shrink-0 tabular-nums text-slate-400">{hhmm(r.received_at)}</span>
                      <span className="shrink-0 rounded bg-slate-100 px-1 text-[10px] font-bold text-slate-500">{r.source ?? "?"}</span>
                      {(r.badges ?? []).slice(0, 2).map((b) => (
                        <span key={b} className={"shrink-0 rounded-full border px-1 text-[9px] font-bold " + (BADGE_STYLE[b as InquiryBadge] ?? "")}>
                          {b}
                        </span>
                      ))}
                      <span className={"min-w-0 flex-1 " + (openId === r.id ? "" : "truncate ") + (r.answered_at || r.skipped_at ? "text-slate-400" : "text-slate-700")}>
                        {r.summary || r.raw_text || "(내용 없음)"}
                      </span>
                      <span className="shrink-0 text-[10px] font-bold">
                        {r.answered_at ? (
                          <span className="text-emerald-600">완료</span>
                        ) : r.skipped_at ? (
                          <span className="text-slate-400">넘김</span>
                        ) : r.replied_at ? (
                          <span className="text-sky-600">답함</span>
                        ) : (
                          <span className="text-rose-600">대기</span>
                        )}
                      </span>
                    </button>
                    {openId === r.id && r.raw_text && (
                      <p className="mt-1 whitespace-pre-wrap rounded bg-slate-50 p-1.5 text-[11.5px] text-slate-700">{r.raw_text}</p>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
