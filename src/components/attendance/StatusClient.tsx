"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  summarizeAll,
  summarizeByDay,
  summarizeGroup,
  type GroupSummary,
  type RegisterRecord,
  type ReasonType,
  type StudentSummary,
} from "@/lib/attendanceRegister";

/**
 * 출석현황.
 *
 * 세 가지를 한 화면에 둡니다.
 *   ① 학교·학년·반 출석률 — 지금 어디가 낮은가
 *   ② 날짜별 그래프      — 언제부터 낮아졌나
 *   ③ 학생별 목록        — 누구인가
 *
 * 순서가 곧 물음의 순서입니다. 대개 ①에서 눈에 걸리는 것을 보고 ②로 시점을 찾은 다음 ③에서
 * 이름을 확인합니다. 셋을 다른 화면에 두면 그 흐름이 매번 끊깁니다.
 *
 * **결석만 출석률을 깎습니다.** 지각·조퇴는 학교에 온 날이라 따로 세기만 합니다.
 */

export type StatusStudent = {
  id: string;
  name: string;
  grade: string | null;
  className: string | null;
  department: string;
};

const REASONS: ReasonType[] = ["질병", "인정", "기타", "무단"];

function tone(rate: number | null): string {
  if (rate === null) return "text-slate-300";
  if (rate >= 97) return "text-emerald-700";
  if (rate >= 93) return "text-amber-700";
  return "text-red-700";
}

/** 출석률 막대. 숫자만 있으면 어느 쪽이 낮은지 훑어서 알기 어렵습니다. */
function Bar({ rate }: { rate: number | null }) {
  if (rate === null) return <span className="text-slate-300">—</span>;
  // 90~100% 구간을 늘려 그립니다. 0부터 그리면 모든 반이 거의 꽉 찬 막대라 차이가 안 보입니다.
  const w = Math.max(2, Math.min(100, (rate - 88) * (100 / 12)));
  return (
    <span className="flex items-center justify-end gap-1.5">
      <span className="h-1.5 w-16 overflow-hidden rounded-full bg-slate-100">
        <span
          className={"block h-full rounded-full " + (rate >= 97 ? "bg-emerald-500" : rate >= 93 ? "bg-amber-500" : "bg-red-500")}
          style={{ width: `${w}%` }}
        />
      </span>
      <b className={"w-11 text-right text-[12px] tabular-nums " + tone(rate)}>{rate}%</b>
    </span>
  );
}

function GroupTable({ rows }: { rows: { label: string; sub?: string; g: GroupSummary }[] }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
      <table className="w-full text-left text-sm">
        <thead className="bg-slate-50 text-[11px] font-semibold text-slate-500">
          <tr>
            <th className="px-3 py-2">구분</th>
            <th className="px-2 py-2 text-right">인원</th>
            <th className="px-2 py-2 text-right text-red-600">결석</th>
            <th className="px-2 py-2 text-right">조퇴</th>
            <th className="px-2 py-2 text-right">지각</th>
            <th className="px-2 py-2 text-right" title="연락 없이 오지 않은 날">
              무단
            </th>
            <th className="px-3 py-2 text-right">출석률</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ label, sub, g }) => (
            <tr key={label} className="border-t border-slate-100">
              <td className="px-3 py-2">
                <span className="font-semibold text-slate-800">{label}</span>
                {sub && <span className="ml-1.5 text-[11px] text-slate-400">{sub}</span>}
              </td>
              <td className="px-2 py-2 text-right text-[12px] tabular-nums text-slate-500">{g.students}</td>
              <td className="px-2 py-2 text-right text-[12px] font-bold tabular-nums text-red-600">{g.absent || ""}</td>
              <td className="px-2 py-2 text-right text-[12px] tabular-nums text-orange-600">{g.earlyLeave || ""}</td>
              <td className="px-2 py-2 text-right text-[12px] tabular-nums text-amber-600">{g.late || ""}</td>
              <td className="px-2 py-2 text-right text-[12px] font-bold tabular-nums text-red-700">{g.byReason.무단 || ""}</td>
              <td className="px-3 py-2 text-right">
                <Bar rate={g.rate} />
              </td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={7} className="px-3 py-8 text-center text-sm text-slate-400">
                집계할 것이 없습니다.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

export default function StatusClient({
  month,
  termLabel,
  students,
  records,
  schoolDays,
  coverageStart,
}: {
  month: string;
  termLabel: string;
  students: StatusStudent[];
  records: RegisterRecord[];
  /** 학기 전체 수업일(기록 시작일 뒤). */
  schoolDays: string[];
  coverageStart: string | null;
}) {
  const router = useRouter();
  const [scope, setScope] = useState<"학교" | "학년" | "반" | "학생">("학교");
  const [q, setQ] = useState("");

  const monthDays = useMemo(() => schoolDays.filter((d) => d.startsWith(month)), [schoolDays, month]);
  const ids = useMemo(() => students.map((s) => s.id), [students]);

  // 학기 전체 집계(①③)와 이번 달 날짜별(②)을 따로 냅니다.
  const termSummaries = useMemo(() => summarizeAll(ids, records, schoolDays, coverageStart), [ids, records, schoolDays, coverageStart]);
  const byDay = useMemo(() => summarizeByDay(ids, records, monthDays), [ids, records, monthDays]);

  const sum = (list: StatusStudent[]): GroupSummary =>
    summarizeGroup(list.map((s) => termSummaries.get(s.id)!).filter(Boolean) as StudentSummary[]);

  const school = useMemo(() => sum(students), [students, termSummaries]);

  const grades = useMemo(() => {
    const m = new Map<string, StatusStudent[]>();
    for (const s of students) {
      const k = s.grade ?? "미배정";
      (m.get(k) ?? m.set(k, []).get(k)!).push(s);
    }
    return [...m.entries()]
      .sort((a, b) => Number(a[0].replace(/\D/g, "") || 99) - Number(b[0].replace(/\D/g, "") || 99))
      .map(([g, list]) => ({ label: `${g}학년`, sub: `${list[0]?.department ?? ""}`, g: sum(list) }));
  }, [students, termSummaries]);

  const klasses = useMemo(() => {
    const m = new Map<string, StatusStudent[]>();
    for (const s of students) {
      const k = s.className ?? "미배정";
      (m.get(k) ?? m.set(k, []).get(k)!).push(s);
    }
    return [...m.entries()]
      .sort((a, b) => a[0].localeCompare(b[0], "ko"))
      .map(([c, list]) => ({ label: c, sub: list[0]?.grade ? `${list[0].grade}학년` : undefined, g: sum(list) }));
  }, [students, termSummaries]);

  const studentRows = useMemo(() => {
    const k = q.trim().toLowerCase();
    const list = k ? students.filter((s) => s.name.toLowerCase().includes(k)) : students;
    // 결석이 많은 아이가 위로. 이 목록을 여는 이유가 대개 그 아이를 찾기 위해서입니다.
    return [...list]
      .map((s) => ({ s, sum: termSummaries.get(s.id)! }))
      .filter((x) => x.sum)
      .sort((a, b) => b.sum.absent - a.sum.absent || a.s.name.localeCompare(b.s.name, "ko"));
  }, [students, termSummaries, q]);

  function shiftMonth(n: number) {
    const [y, m] = month.split("-").map(Number);
    const d = new Date(y, m - 1 + n, 1);
    router.push(`/attendance/status?month=${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }

  const worstDay = byDay.reduce<null | (typeof byDay)[number]>((w, d) => (w === null || d.absent > w.absent ? d : w), null);

  return (
    <div>
      <div className="mb-1 flex flex-wrap items-baseline gap-2">
        <h1 className="text-lg font-bold">📊 출석현황</h1>
        <span className="text-xs text-slate-400">
          {termLabel} · 수업일 {schoolDays.length}일
        </span>
        <Link href="/attendance" className="ml-auto text-[12px] font-semibold text-teal-700 underline">
          ← 오늘 출석부
        </Link>
      </div>
      <p className="mb-3 text-[11px] leading-relaxed text-slate-500">
        표시 없는 날은 <b>출석</b>입니다. 출석률 = (수업일수 − 결석일수) ÷ 수업일수 —{" "}
        <b>지각과 조퇴는 학교에 온 날이라 출석률을 깎지 않습니다.</b>
        {!coverageStart && (
          <>
            {" "}
            <Link href="/attendance/calendar" className="font-bold text-amber-700 underline">
              기록 시작일이 아직 없습니다
            </Link>{" "}
            — 출석부를 쓰기 전 날짜까지 세고 있습니다.
          </>
        )}
      </p>

      {schoolDays.length === 0 ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-6 text-center text-[13px] text-amber-900">
          <b>수업일 달력이 비어 있습니다.</b> 며칠이 수업일인지 모르면 출석률을 낼 수 없습니다.
          <br />
          <Link href="/attendance/calendar" className="mt-1 inline-block font-bold underline">
            수업일 달력 만들기 →
          </Link>
        </div>
      ) : (
        <>
          {/* ① 학교 전체. 가장 먼저 보는 숫자라 크게 둡니다. */}
          <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-5">
            {[
              { l: "학교 전체 출석률", v: school.rate === null ? "—" : `${school.rate}%`, t: tone(school.rate) },
              { l: "학생", v: `${school.students}명`, t: "text-slate-700" },
              { l: "결석", v: `${school.absent}일`, t: "text-red-600" },
              { l: "조퇴", v: `${school.earlyLeave}일`, t: "text-orange-600" },
              { l: "지각", v: `${school.late}일`, t: "text-amber-600" },
            ].map((x) => (
              <div key={x.l} className="rounded-xl border border-slate-200 bg-white px-3 py-2">
                <p className="text-[11px] text-slate-400">{x.l}</p>
                <p className={"text-lg font-bold tabular-nums " + x.t}>{x.v}</p>
              </div>
            ))}
          </div>

          {/* ② 날짜별 그래프. 언제부터 나빠졌는지는 합계로는 안 보입니다. */}
          <div className="mb-4 rounded-xl border border-slate-200 bg-white p-3">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <button onClick={() => shiftMonth(-1)} className="rounded-lg border border-slate-200 px-2 py-0.5 text-xs font-semibold text-slate-500 hover:bg-slate-50">
                ‹
              </button>
              <b className="text-[13px] text-slate-700">{Number(month.slice(5))}월 날짜별</b>
              <button onClick={() => shiftMonth(1)} className="rounded-lg border border-slate-200 px-2 py-0.5 text-xs font-semibold text-slate-500 hover:bg-slate-50">
                ›
              </button>
              <span className="text-[11px] text-slate-400">수업일 {monthDays.length}일</span>
              {worstDay && worstDay.absent > 0 && (
                <span className="ml-auto text-[11px] text-slate-500">
                  가장 많이 빠진 날 <b className="text-red-600">{Number(worstDay.day.slice(8))}일 · 결석 {worstDay.absent}명</b>
                </span>
              )}
            </div>

            {monthDays.length === 0 ? (
              <p className="py-6 text-center text-[12px] text-slate-400">이 달에는 수업일이 없습니다.</p>
            ) : (
              <>
                {/* 막대는 결석 인원, 높이는 출석률. 막대가 솟은 날이 곧 문제가 있던 날입니다. */}
                <div className="flex h-24 items-end gap-[3px] border-b border-slate-200 pb-0.5">
                  {byDay.map((d) => {
                    // 90~100%를 늘려 그립니다. 100%에서 0으로 잡으면 모든 날이 천장에 붙습니다.
                    const h = d.rate === null ? 0 : Math.max(3, Math.min(100, (d.rate - 88) * (100 / 12)));
                    return (
                      <div
                        key={d.day}
                        className="group relative flex-1"
                        title={`${Number(d.day.slice(5, 7))}/${Number(d.day.slice(8))} · 출석률 ${d.rate ?? "—"}% · 결석 ${d.absent} 지각 ${d.late} 조퇴 ${d.earlyLeave}`}
                      >
                        <div
                          style={{ height: `${h}%` }}
                          className={
                            "w-full rounded-t transition group-hover:brightness-90 " +
                            (d.absent === 0 ? "bg-emerald-300" : d.rate !== null && d.rate < 93 ? "bg-red-400" : "bg-amber-300")
                          }
                        />
                      </div>
                    );
                  })}
                </div>
                <div className="flex gap-[3px] pt-0.5">
                  {byDay.map((d) => (
                    <div key={d.day} className="flex-1 text-center text-[8px] tabular-nums text-slate-400">
                      {Number(d.day.slice(8))}
                    </div>
                  ))}
                </div>
                <p className="mt-1.5 text-[10px] text-slate-400">
                  막대 높이는 그 날의 출석률입니다(88~100% 구간을 늘려 그렸습니다). 마우스를 올리면 결석·지각·조퇴 인원이 뜹니다.
                </p>
              </>
            )}
          </div>

          {/* ③ 학교 / 학년 / 반 / 학생 */}
          <div className="mb-2 flex flex-wrap items-center gap-1.5">
            {(["학교", "학년", "반", "학생"] as const).map((v) => (
              <button
                key={v}
                onClick={() => setScope(v)}
                className={
                  "rounded-lg px-2.5 py-1 text-xs font-semibold " +
                  (scope === v ? "bg-slate-800 text-white" : "border border-slate-200 text-slate-600 hover:bg-slate-50")
                }
              >
                {v}별
              </button>
            ))}
            {scope === "학생" && (
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="이름으로 찾기"
                className="ml-auto w-40 rounded-lg border border-slate-300 px-2 py-1 text-xs"
              />
            )}
          </div>

          {scope === "학교" && <GroupTable rows={[{ label: "전교", sub: `${school.students}명`, g: school }]} />}
          {scope === "학년" && <GroupTable rows={grades} />}
          {scope === "반" && <GroupTable rows={klasses} />}

          {scope === "학생" && (
            <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50 text-[11px] font-semibold text-slate-500">
                  <tr>
                    <th className="px-3 py-2">이름</th>
                    <th className="px-2 py-2 text-right text-red-600">결석</th>
                    <th className="px-2 py-2 text-right">조퇴</th>
                    <th className="px-2 py-2 text-right">지각</th>
                    <th className="px-2 py-2 text-right">무단</th>
                    <th className="px-3 py-2 text-right">출석률</th>
                  </tr>
                </thead>
                <tbody>
                  {studentRows.map(({ s, sum: v }) => (
                    <tr key={s.id} className="border-t border-slate-100 hover:bg-slate-50">
                      <td className="px-3 py-1.5">
                        <Link href={`/attendance/students/${s.id}`} className="text-[13px] font-semibold text-slate-800 hover:underline">
                          {s.name}
                        </Link>
                        <span className="ml-1.5 text-[11px] text-slate-400">{s.className ?? s.grade ?? ""}</span>
                      </td>
                      <td className="px-2 py-1.5 text-right text-[12px] font-bold tabular-nums text-red-600">{v.absent || ""}</td>
                      <td className="px-2 py-1.5 text-right text-[12px] tabular-nums text-orange-600">{v.earlyLeave || ""}</td>
                      <td className="px-2 py-1.5 text-right text-[12px] tabular-nums text-amber-600">{v.late || ""}</td>
                      <td className="px-2 py-1.5 text-right text-[12px] font-bold tabular-nums text-red-700">{v.byReason.무단 || ""}</td>
                      <td className="px-3 py-1.5 text-right">
                        <Bar rate={v.rate} />
                      </td>
                    </tr>
                  ))}
                  {studentRows.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-3 py-8 text-center text-sm text-slate-400">
                        찾는 학생이 없습니다.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}

          {/* 사유별 결석은 표 아래 한 줄로. 칸을 더 만들면 표가 가로로 넘칩니다. */}
          <p className="mt-2 text-[11px] text-slate-600">
            <b>사유별 결석</b>
            {REASONS.map((k) => (
              <span key={k} className="ml-2.5">
                {k} <b className={k === "무단" ? "text-red-700" : "text-slate-700"}>{school.byReason[k]}</b>
              </span>
            ))}
            <span className="ml-3 text-slate-400">
              사유 안 고른 결석 {Math.max(0, school.absent - REASONS.reduce((n, k) => n + school.byReason[k], 0))}건
            </span>
            {school.unconfirmed > 0 && (
              <span className="ml-3 font-semibold text-amber-700">연락에서 들어와 아직 확인 안 된 줄 {school.unconfirmed}건</span>
            )}
          </p>
        </>
      )}
    </div>
  );
}
