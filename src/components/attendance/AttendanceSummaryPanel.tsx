"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { GroupSummary, ReasonType, StudentSummary } from "@/lib/attendanceRegister";
import { summarizeGroup } from "@/lib/attendanceRegister";

/**
 * 출결 현황 - 전체 · 학년 · 반.
 *
 * 오늘 누가 결석인지는 위 화면이 답합니다. 여기가 답하는 것은 **쌓인 뒤의 물음**입니다 -
 * "이번 학기에 며칠 결석했나", "어느 반이 유독 많나", "무단결석이 몇 회인가".
 *
 * 한 화면에 둔 이유: 오늘을 찍는 사람과 학기를 보는 사람이 같은 사람입니다. 화면을 나누면
 * 오늘만 찍고 나머지는 아무도 안 봅니다.
 */

export type SummaryRow = {
  studentId: string;
  name: string;
  grade: string | null;
  className: string | null;
  department: string;
  summary: StudentSummary;
};

type Level = "전체" | "학년" | "반" | "학생";

const REASON_KEYS: ReasonType[] = ["질병", "인정", "기타", "무단"];

function rateTone(rate: number | null): string {
  if (rate === null) return "text-slate-300";
  if (rate >= 95) return "text-emerald-700";
  if (rate >= 90) return "text-amber-700";
  return "text-red-700";
}

/** 집계 한 줄. 전체·학년·반이 같은 모양이라 한 곳에서 그립니다. */
function GroupRow({ label, sub, g, onClick }: { label: string; sub?: string; g: GroupSummary; onClick?: () => void }) {
  return (
    <tr
      className={"border-t border-slate-100 " + (onClick ? "cursor-pointer hover:bg-slate-50" : "")}
      onClick={onClick}
    >
      <td className="px-3 py-2">
        <span className="font-semibold text-slate-800">{label}</span>
        {sub && <span className="ml-1.5 text-[11px] text-slate-400">{sub}</span>}
      </td>
      <td className="px-2 py-2 text-right text-[12px] tabular-nums text-slate-500">{g.students}</td>
      <td className="px-2 py-2 text-right text-[12px] tabular-nums text-slate-600">{g.present}</td>
      <td className="px-2 py-2 text-right text-[12px] font-semibold tabular-nums text-red-600">{g.absent || ""}</td>
      <td className="px-2 py-2 text-right text-[12px] tabular-nums text-amber-600">{g.late || ""}</td>
      <td className="px-2 py-2 text-right text-[12px] tabular-nums text-orange-600">{g.earlyLeave || ""}</td>
      <td className="px-2 py-2 text-right text-[12px] font-bold tabular-nums text-red-700">{g.byReason.무단 || ""}</td>
      <td className={"px-3 py-2 text-right text-[13px] font-bold tabular-nums " + rateTone(g.rate)}>
        {g.rate === null ? "—" : `${g.rate}%`}
      </td>
    </tr>
  );
}

function Head() {
  return (
    <thead className="bg-slate-50 text-[11px] font-semibold text-slate-500">
      <tr>
        <th className="px-3 py-2 text-left">구분</th>
        <th className="px-2 py-2 text-right">인원</th>
        <th className="px-2 py-2 text-right">출석</th>
        <th className="px-2 py-2 text-right">결석</th>
        <th className="px-2 py-2 text-right">지각</th>
        <th className="px-2 py-2 text-right">조퇴</th>
        <th className="px-2 py-2 text-right" title="연락 없이 오지 않은 날. 상급학교 서류에서 실제로 묻는 숫자입니다">
          무단
        </th>
        <th className="px-3 py-2 text-right">출석률</th>
      </tr>
    </thead>
  );
}

export default function AttendanceSummaryPanel({
  rows,
  termLabel,
  schoolDays,
  coverageStart,
  missingTotal,
  unconfirmedTotal,
}: {
  rows: SummaryRow[];
  termLabel: string;
  /** 이 기간의 수업일수. 집계의 분모입니다. */
  schoolDays: number;
  /** 기록을 실제로 찍기 시작한 날. 없으면 아직 정해지지 않은 것입니다. */
  coverageStart: string | null;
  missingTotal: number;
  unconfirmedTotal: number;
}) {
  const [level, setLevel] = useState<Level>("전체");
  const [q, setQ] = useState("");

  const all = useMemo(() => summarizeGroup(rows.map((r) => r.summary)), [rows]);

  const byGrade = useMemo(() => {
    const m = new Map<string, SummaryRow[]>();
    for (const r of rows) {
      const k = r.grade ?? "미배정";
      (m.get(k) ?? m.set(k, []).get(k)!).push(r);
    }
    return [...m.entries()].sort((a, b) => Number(a[0].replace(/\D/g, "") || 99) - Number(b[0].replace(/\D/g, "") || 99));
  }, [rows]);

  const byClass = useMemo(() => {
    const m = new Map<string, SummaryRow[]>();
    for (const r of rows) {
      const k = r.className ?? "미배정";
      (m.get(k) ?? m.set(k, []).get(k)!).push(r);
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0], "ko"));
  }, [rows]);

  const students = useMemo(() => {
    const k = q.trim().toLowerCase();
    const list = k ? rows.filter((r) => r.name.toLowerCase().includes(k)) : rows;
    // 결석이 많은 아이가 위로. 이 표를 여는 이유가 대개 그 아이를 찾기 위해서입니다.
    return [...list].sort((a, b) => b.summary.absent - a.summary.absent || a.name.localeCompare(b.name, "ko"));
  }, [rows, q]);

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        {(["전체", "학년", "반", "학생"] as Level[]).map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => setLevel(v)}
            className={
              "rounded-lg px-2.5 py-1 text-xs font-semibold " +
              (level === v ? "bg-slate-800 text-white" : "border border-slate-200 text-slate-600 hover:bg-slate-50")
            }
          >
            {v}
          </button>
        ))}
        <span className="ml-1 text-[11px] text-slate-400">
          {termLabel} · 수업일 {schoolDays}일
        </span>
        {level === "학생" && (
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="이름으로 찾기"
            className="ml-auto w-40 rounded-lg border border-slate-300 px-2 py-1 text-xs"
          />
        )}
      </div>

      {/* 믿어도 되는 숫자인지 먼저 말합니다.
          아직 안 찍은 날과 확인 안 된 자동 줄이 많으면, 아래 표는 아직 실제 출결이 아닙니다.
          이 줄이 없으면 사람은 화면의 숫자를 그대로 서류에 옮겨 적습니다. */}
      {(schoolDays === 0 || !coverageStart || missingTotal > 0 || unconfirmedTotal > 0) && (
        <div className="mb-2 space-y-0.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] leading-relaxed text-amber-900">
          {schoolDays === 0 && (
            <p>
              <b>수업일 달력이 아직 비어 있습니다.</b> 며칠이 수업일인지 모르면 출석일수를 낼 수 없습니다 —{" "}
              <Link href="/attendance/calendar" className="font-bold underline">
                달력 만들기
              </Link>
            </p>
          )}
          {!coverageStart && (
            <p>
              <b>기록 시작일이 정해지지 않았습니다.</b> 출석부를 쓰기 전 날짜에는 기록이 없는데, 그것을 그냥 세면 &ldquo;전원
              출석&rdquo;으로 읽힙니다.
            </p>
          )}
          {missingTotal > 0 && (
            <p>
              아직 찍지 않은 자리 <b>{missingTotal.toLocaleString()}칸</b>. <b>결석이 아니라 자료 없음</b>이라 출석률 계산에서
              빠져 있습니다.
            </p>
          )}
          {unconfirmedTotal > 0 && (
            <p>
              연락에서 저절로 들어와 <b>아직 확인 안 된 줄 {unconfirmedTotal}건</b>. 담임이 한 번 눌러 확인해야 합니다.
            </p>
          )}
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-left text-sm">
          <Head />
          <tbody>
            {level === "전체" && <GroupRow label="전교" sub={`${rows.length}명`} g={all} />}

            {level === "학년" &&
              byGrade.map(([g, list]) => (
                <GroupRow key={g} label={`${g}학년`} g={summarizeGroup(list.map((r) => r.summary))} />
              ))}

            {level === "반" &&
              byClass.map(([c, list]) => (
                <GroupRow
                  key={c}
                  label={c}
                  sub={list[0]?.grade ? `${list[0].grade}학년` : undefined}
                  g={summarizeGroup(list.map((r) => r.summary))}
                />
              ))}

            {level === "학생" &&
              students.map((r) => {
                const s = r.summary;
                return (
                  <tr key={r.studentId} className="border-t border-slate-100 hover:bg-slate-50">
                    <td className="px-3 py-2">
                      <Link href={`/attendance/students/${r.studentId}`} className="font-semibold text-slate-800 hover:underline">
                        {r.name}
                      </Link>
                      <span className="ml-1.5 text-[11px] text-slate-400">{r.className ?? r.grade ?? ""}</span>
                    </td>
                    <td className="px-2 py-2 text-right text-[11px] tabular-nums text-slate-400" title="기록이 있는 날">
                      {s.recorded}/{s.schoolDays}
                    </td>
                    <td className="px-2 py-2 text-right text-[12px] tabular-nums text-slate-600">{s.present}</td>
                    <td className="px-2 py-2 text-right text-[12px] font-semibold tabular-nums text-red-600">{s.absent || ""}</td>
                    <td className="px-2 py-2 text-right text-[12px] tabular-nums text-amber-600">{s.late || ""}</td>
                    <td className="px-2 py-2 text-right text-[12px] tabular-nums text-orange-600">{s.earlyLeave || ""}</td>
                    <td className="px-2 py-2 text-right text-[12px] font-bold tabular-nums text-red-700">{s.byReason.무단 || ""}</td>
                    <td className={"px-3 py-2 text-right text-[13px] font-bold tabular-nums " + rateTone(s.rate)}>
                      {s.rate === null ? "—" : `${s.rate}%`}
                    </td>
                  </tr>
                );
              })}

            {rows.length === 0 && (
              <tr>
                <td colSpan={8} className="px-3 py-10 text-center text-sm text-slate-400">
                  집계할 학생이 없습니다.
                </td>
              </tr>
            )}
          </tbody>

          {/* 사유별 결석은 표 아래 한 줄로. 칸을 더 만들면 표가 가로로 넘칩니다. */}
          {rows.length > 0 && (
            <tfoot className="border-t-2 border-slate-200 bg-slate-50/60 text-[11px] text-slate-600">
              <tr>
                <td colSpan={8} className="px-3 py-2">
                  <b>사유별 결석</b>
                  {REASON_KEYS.map((k) => (
                    <span key={k} className="ml-2.5">
                      {k} <b className={k === "무단" ? "text-red-700" : "text-slate-700"}>{all.byReason[k]}</b>
                    </span>
                  ))}
                  <span className="ml-3 text-slate-400">
                    사유를 안 고른 결석 {Math.max(0, all.absent - REASON_KEYS.reduce((n, k) => n + all.byReason[k], 0))}건
                  </span>
                </td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}
