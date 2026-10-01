"use client";

import { useState } from "react";
import Link from "next/link";
import { Who } from "@/components/common/HomonymProvider";
import { overdueDays, type LibLoan, type LibVisit } from "@/lib/library";

type Lite = { id: string; name: string; grade: string | null; class_name: string | null };

type Props = {
  libraryUrl: string;
  error: string | null;
  bookCount: number;
  active: LibLoan[];
  overdue: LibLoan[];
  borrowedToday: LibLoan[];
  returnedToday: LibLoan[];
  visitsToday: LibVisit[];
  noCard: Lite[];
  noNumber: Lite[];
};

type Tab = "overdue" | "today" | "active" | "card";

const hm = (iso: string) => new Date(iso).toLocaleTimeString("ko-KR", { timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit", hour12: false });
const md = (d: string) => d.slice(5).replace("-", "/");

export default function LibraryOverviewClient(p: Props) {
  // 연체가 있으면 연체부터. 없으면 오늘. 첫 화면이 「할 일」이어야 합니다.
  const [tab, setTab] = useState<Tab>(p.overdue.length > 0 ? "overdue" : "today");
  const tabs: { key: Tab; label: string; n: number; tone?: string }[] = [
    { key: "overdue", label: "연체", n: p.overdue.length, tone: p.overdue.length ? "text-red-600" : undefined },
    { key: "today", label: "오늘", n: p.borrowedToday.length + p.returnedToday.length },
    { key: "active", label: "대출 중", n: p.active.length },
    { key: "card", label: "학생증 미발급", n: p.noCard.length + p.noNumber.length, tone: p.noCard.length + p.noNumber.length ? "text-amber-600" : undefined },
  ];

  return (
    <div className="mx-auto max-w-5xl p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-lg font-bold text-slate-800">📚 도서관</h1>
          <p className="text-[11px] text-slate-400">
            장서 {p.bookCount.toLocaleString()}권 · 대출 중 {p.active.length}권 · 오늘 방문 {p.visitsToday.filter((v) => v.kind === "입실").length}명.
            여기서는 보기만 합니다 - 대출·반납·발급은 도서관 앱에서 합니다.
          </p>
        </div>
        {p.libraryUrl ? (
          <a
            href={p.libraryUrl}
            target="_blank"
            rel="noreferrer"
            className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-bold text-white hover:bg-emerald-700"
            title="도서관 앱을 새 탭으로 엽니다. 같은 구글 계정으로 한 번 더 로그인합니다."
          >
            도서관 앱 열기 ↗
          </a>
        ) : (
          <span className="rounded-lg border border-dashed border-slate-300 px-3 py-1.5 text-[11px] text-slate-400" title="Vercel 환경변수 NEXT_PUBLIC_LIBRARY_URL 에 도서관 앱 주소를 넣으면 단추가 생깁니다.">
            도서관 앱 주소 미설정
          </span>
        )}
      </div>

      {p.error && (
        <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          도서관 자료를 읽지 못했습니다: {p.error}
        </div>
      )}

      <div className="mb-3 flex gap-1 border-b border-slate-200">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={
              "px-3 py-1.5 text-sm font-semibold " +
              (tab === t.key ? "border-b-2 border-slate-800 text-slate-800" : "text-slate-400 hover:text-slate-600")
            }
          >
            {t.label} <span className={"text-xs " + (t.tone ?? "text-slate-400")}>{t.n}</span>
          </button>
        ))}
      </div>

      {tab === "overdue" && <LoanTable rows={p.overdue} empty="연체가 없습니다." showOverdue />}
      {tab === "active" && <LoanTable rows={p.active} empty="대출 중인 책이 없습니다." showOverdue />}
      {tab === "today" && (
        <div className="grid gap-3 md:grid-cols-2">
          <div className="g-panel-solid p-3">
            <h2 className="mb-1.5 text-xs font-bold text-slate-600">오늘 대출 {p.borrowedToday.length}</h2>
            <LoanTable rows={p.borrowedToday} empty="오늘 대출이 없습니다." compact />
          </div>
          <div className="g-panel-solid p-3">
            <h2 className="mb-1.5 text-xs font-bold text-slate-600">오늘 반납 {p.returnedToday.length}</h2>
            <LoanTable rows={p.returnedToday} empty="오늘 반납이 없습니다." compact returned />
          </div>
          <div className="g-panel-solid p-3 md:col-span-2">
            <h2 className="mb-1.5 text-xs font-bold text-slate-600">오늘 방문 {p.visitsToday.length}건</h2>
            {p.visitsToday.length === 0 ? (
              <p className="text-xs text-slate-400">오늘 방문 기록이 없습니다.</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {p.visitsToday.map((v) => (
                  <span key={v.id} className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[11px] text-slate-700">
                    {hm(v.visited_at)} <Who id={v.student_id} name={v.student_name} plain /> <span className="text-slate-400">{v.kind}</span>
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
      {tab === "card" && (
        <div className="grid gap-3 md:grid-cols-2">
          <div className="g-panel-solid p-3">
            <h2 className="mb-1.5 text-xs font-bold text-slate-600">발급 기록이 없는 재학생 {p.noCard.length}</h2>
            <p className="mb-2 text-[11px] text-slate-400">도서관 앱에서 발급하면 여기서 빠집니다.</p>
            <StudentChips rows={p.noCard} />
          </div>
          <div className="g-panel-solid p-3">
            <h2 className="mb-1.5 text-xs font-bold text-amber-700">학생 번호가 없는 아이 {p.noNumber.length}</h2>
            <p className="mb-2 text-[11px] text-slate-400">번호가 없으면 바코드를 만들 수 없습니다. 학생 관리에서 번호를 먼저 매깁니다.</p>
            <StudentChips rows={p.noNumber} />
          </div>
        </div>
      )}
    </div>
  );
}

function StudentChips({ rows }: { rows: Lite[] }) {
  if (rows.length === 0) return <p className="text-xs text-slate-400">없습니다.</p>;
  return (
    <div className="flex flex-wrap gap-1.5">
      {rows.map((s) => (
        <Link key={s.id} href={`/students/${s.id}`} className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[11px] text-slate-700 hover:bg-slate-50">
          {s.name} <span className="text-slate-400">{s.class_name ?? s.grade ?? ""}</span>
        </Link>
      ))}
    </div>
  );
}

function LoanTable({ rows, empty, showOverdue, compact, returned }: { rows: LibLoan[]; empty: string; showOverdue?: boolean; compact?: boolean; returned?: boolean }) {
  if (rows.length === 0) return <p className="text-xs text-slate-400">{empty}</p>;
  return (
    <div className={compact ? "" : "g-panel-solid overflow-hidden"}>
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-slate-100 text-left text-[11px] text-slate-400">
            <th className="px-2 py-1.5 font-semibold">학생</th>
            <th className="px-2 py-1.5 font-semibold">책</th>
            <th className="w-20 px-2 py-1.5 font-semibold">{returned ? "반납" : "대출"}</th>
            <th className="w-20 px-2 py-1.5 font-semibold">기한</th>
            {showOverdue && <th className="w-16 px-2 py-1.5 font-semibold">연체</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((l) => {
            const od = overdueDays(l.due_date);
            return (
              <tr key={l.id} className={"border-b border-slate-50 last:border-0 " + (showOverdue && od > 0 ? "bg-red-50/40" : "")}>
                <td className="px-2 py-1.5">
                  {l.student_id ? (
                    <Link href={`/students/${l.student_id}`} className="font-semibold text-slate-800 hover:underline">
                      <Who id={l.student_id} name={l.student_name} plain />
                    </Link>
                  ) : (
                    <span className="font-semibold text-slate-800">{l.student_name}</span>
                  )}
                  <span className="ml-1 text-slate-400">{l.student_class ?? ""}</span>
                </td>
                <td className="px-2 py-1.5 text-slate-700">
                  {l.book?.title ?? "(책 정보 없음)"}
                  {l.renew_count > 0 && <span className="ml-1 text-[10px] text-slate-400">연장 {l.renew_count}</span>}
                </td>
                <td className="px-2 py-1.5 text-slate-500">{returned && l.returned_at ? md(l.returned_at.slice(0, 10)) : md(l.borrowed_at.slice(0, 10))}</td>
                <td className="px-2 py-1.5 text-slate-500">{md(l.due_date)}</td>
                {showOverdue && <td className={"px-2 py-1.5 font-bold " + (od > 0 ? "text-red-600" : "text-slate-300")}>{od > 0 ? `${od}일` : "-"}</td>}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
