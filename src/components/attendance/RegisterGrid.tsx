"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import type { RegisterRecord, StudentSummary } from "@/lib/attendanceRegister";

/**
 * 학생 × 날짜 격자표.
 *
 * 카드로 늘어놓으면 한 아이의 한 달을 볼 수 없습니다. "이 아이가 언제 빠졌나" 는 세로로
 * 읽어야 보이고, "그 날 몇 명이 빠졌나" 는 가로로 읽어야 보입니다. 종이 출석부가 수십 년째
 * 이 모양인 데에는 이유가 있습니다.
 *
 * 칸에 글자를 넣지 않고 **한 글자만** 씁니다. 30일 × 20명이면 600칸이라, 두 글자만 되어도
 * 표가 화면을 넘어갑니다.
 */

const MARK: Record<string, { ch: string; cls: string; title: string }> = {
  출석: { ch: "", cls: "", title: "출석" },
  지각: { ch: "지", cls: "bg-amber-100 text-amber-800 font-bold", title: "지각" },
  결석: { ch: "결", cls: "bg-red-100 text-red-700 font-bold", title: "결석" },
  조퇴: { ch: "조", cls: "bg-orange-100 text-orange-700 font-bold", title: "조퇴" },
  기타: { ch: "기", cls: "bg-slate-200 text-slate-600 font-bold", title: "기타" },
};

export default function RegisterGrid({
  month,
  classes,
  selected,
  days,
  students,
  records,
  summaries,
}: {
  month: string;
  classes: { name: string; grade: string | null }[];
  selected: string | null;
  days: { day: string; is_school_day: boolean; label: string | null; closed_reason: string | null }[];
  students: { id: string; name: string }[];
  records: RegisterRecord[];
  summaries: Record<string, StudentSummary>;
}) {
  const router = useRouter();

  // 수업일만 세웁니다. 주말·방학까지 칸으로 만들면 표가 절반은 회색이 됩니다.
  const cols = days.filter((d) => d.is_school_day);

  const key = (s: string, d: string) => `${s}|${d}`;
  const byCell = new Map<string, RegisterRecord>();
  for (const r of records) byCell.set(key(r.student_id, r.date), r);

  function go(next: Record<string, string>) {
    const p = new URLSearchParams({ month, ...(selected ? { cls: selected } : {}), ...next });
    router.push(`/attendance/register?${p.toString()}`);
  }

  function shiftMonth(n: number) {
    const [y, m] = month.split("-").map(Number);
    const d = new Date(y, m - 1 + n, 1);
    go({ month: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}` });
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <button onClick={() => shiftMonth(-1)} className="rounded-lg border border-slate-200 px-2 py-1 text-xs font-semibold text-slate-500 hover:bg-slate-50">
          ‹ 지난달
        </button>
        <b className="text-sm text-slate-700">{month.replace("-", "년 ")}월</b>
        <button onClick={() => shiftMonth(1)} className="rounded-lg border border-slate-200 px-2 py-1 text-xs font-semibold text-slate-500 hover:bg-slate-50">
          다음달 ›
        </button>

        <span className="ml-2 flex flex-wrap gap-1">
          {classes.map((c) => (
            <button
              key={c.name}
              onClick={() => go({ cls: c.name })}
              className={
                "rounded-lg px-2.5 py-1 text-xs font-semibold " +
                (selected === c.name ? "bg-slate-800 text-white" : "border border-slate-200 text-slate-600 hover:bg-slate-50")
              }
            >
              {c.name}
            </button>
          ))}
        </span>

        <span className="ml-auto flex items-center gap-2 text-[11px] text-slate-400">
          <span className="rounded bg-red-100 px-1.5 font-bold text-red-700">결</span> 결석
          <span className="rounded bg-amber-100 px-1.5 font-bold text-amber-800">지</span> 지각
          <span className="rounded bg-orange-100 px-1.5 font-bold text-orange-700">조</span> 조퇴
          <span className="rounded border border-slate-200 px-1.5">·</span> 아직 안 찍음
        </span>
      </div>

      {students.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-200 p-8 text-center text-sm text-slate-400">
          {classes.length === 0 ? "볼 수 있는 반이 없습니다." : "이 반에 재학중인 학생이 없습니다."}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="text-left text-sm">
            <thead className="bg-slate-50 text-[10px] font-semibold text-slate-500">
              <tr>
                {/* 이름 칸은 가로로 넘칠 때도 붙어 있어야 합니다 - 스크롤하다 어느 줄이
                    누구 것인지 잃으면 표를 못 읽습니다. */}
                <th className="sticky left-0 z-10 min-w-[92px] bg-slate-50 px-2 py-2 text-left">이름</th>
                {cols.map((d) => (
                  <th key={d.day} className="w-7 px-0 py-2 text-center tabular-nums" title={d.day}>
                    {Number(d.day.slice(8))}
                  </th>
                ))}
                <th className="min-w-[54px] border-l border-slate-200 px-2 py-2 text-center">결석</th>
                <th className="min-w-[54px] px-2 py-2 text-center">출석률</th>
              </tr>
            </thead>
            <tbody>
              {students.map((s) => {
                const sum = summaries[s.id];
                return (
                  <tr key={s.id} className="border-t border-slate-100">
                    <td className="sticky left-0 z-10 bg-white px-2 py-1.5">
                      <Link href={`/attendance/students/${s.id}`} className="text-[12px] font-semibold text-slate-700 hover:underline">
                        {s.name}
                      </Link>
                    </td>
                    {cols.map((d) => {
                      const r = byCell.get(key(s.id, d.day));
                      const mark = r ? MARK[r.status] : null;
                      return (
                        <td
                          key={d.day}
                          title={
                            r
                              ? `${d.day} ${r.status}${r.reason_type ? ` (${r.reason_type})` : ""}${r.confirmed_by_human === false ? " · 확인 필요" : ""}`
                              : `${d.day} 아직 안 찍었습니다`
                          }
                          className={
                            "border-l border-slate-50 px-0 py-1.5 text-center text-[11px] " +
                            (mark ? mark.cls : "text-slate-200") +
                            // 확인 안 된 자동 줄은 밑줄로 표시합니다. 색을 또 쓰면 표가 어지럽습니다.
                            (r?.confirmed_by_human === false ? " underline decoration-amber-500 decoration-2" : "")
                          }
                        >
                          {r ? mark?.ch || "○" : "·"}
                        </td>
                      );
                    })}
                    <td className="border-l border-slate-200 px-2 py-1.5 text-center text-[12px] font-bold tabular-nums text-red-600">
                      {sum?.absent || ""}
                    </td>
                    <td className="px-2 py-1.5 text-center text-[12px] font-bold tabular-nums text-slate-600">
                      {sum?.rate === null || sum === undefined ? "—" : `${sum.rate}%`}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-2 text-[11px] leading-relaxed text-slate-400">
        가운뎃점(·)은 <b>아직 안 찍은 날</b>입니다 — 출석이 아니라 자료 없음이라, 출석률 계산에서 빠져 있습니다. 밑줄은 토들·구글챗
        연락에서 저절로 들어와 아직 확인하지 않은 줄입니다.
      </p>
    </div>
  );
}
