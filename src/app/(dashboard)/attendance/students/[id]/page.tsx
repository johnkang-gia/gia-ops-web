import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import { summarizeStudent, type RegisterRecord, type ReasonType } from "@/lib/attendanceRegister";
import { departmentOf } from "@/lib/department";

export const dynamic = "force-dynamic";

// 학생 한 명의 출결.
//
// 이 화면이 답하는 물음은 하나입니다 — **"이 아이가 이번 학기에 며칠 결석했나."**
// 상담 자리에서, 상급학교 서류를 쓸 때, 체류 증빙을 낼 때 실제로 묻는 것이 이 숫자입니다.
// 지금까지는 답이 없었습니다. 결석은 셔틀을 태울지 정하려고만 쌓였고, 학생 기준으로 모아본
// 적이 없었습니다.

const REASONS: ReasonType[] = ["질병", "인정", "기타", "무단"];

export default async function StudentAttendancePage({ params }: { params: Promise<{ id: string }> }) {
  const me = await getCurrentAppUser();
  if (!me) redirect("/login");

  const { id } = await params;
  const supabase = await createClient();

  const [stuRes, termRes, coverageRes] = await Promise.all([
    supabase.from("wr_students_basic").select("*").eq("id", id).maybeSingle(),
    supabase.from("terms").select("id, year, term_type, start_date, end_date").eq("status", "진행중").limit(1),
    supabase.from("attendance_coverage").select("starts_on").eq("id", true).maybeSingle(),
  ]);
  const student = stuRes.data as { id: string; name: string; name_en: string | null; grade: string | null; class_name: string | null; department: string | null } | null;
  if (!student) notFound();

  const term = ((termRes.data as { id: string; year: string; term_type: string; start_date: string | null; end_date: string | null }[] | null) ?? [])[0] ?? null;
  const coverageStart = (coverageRes.data as { starts_on: string | null } | null)?.starts_on ?? null;
  const from = term?.start_date ?? "2026-01-01";
  const to = term?.end_date ?? "2027-12-31";

  const [dayRes, recRes] = await Promise.all([
    supabase.from("school_days").select("day, is_school_day").gte("day", from).lte("day", to),
    supabase
      .from("attendance_records")
      .select("student_id, date, status, reason_type, source, confirmed_by_human, note, contacted_guardian")
      .eq("student_id", id)
      .gte("date", from)
      .lte("date", to)
      .order("date", { ascending: false }),
  ]);
  if (dayRes.error) console.error("[학생 출결] 수업일 달력을 읽지 못했습니다:", dayRes.error.message);
  if (recRes.error) console.error("[학생 출결] 출결을 읽지 못했습니다:", recRes.error.message);

  const schoolDayList = ((dayRes.data as { day: string; is_school_day: boolean }[] | null) ?? [])
    .filter((d) => d.is_school_day)
    .map((d) => d.day);
  const records = (recRes.data as (RegisterRecord & { note: string | null })[] | null) ?? [];
  const s = summarizeStudent(id, records, schoolDayList, coverageStart);

  // 월별로 나눠 봅니다. 학기 합계만 있으면 "언제부터 늘었나" 를 알 수 없는데, 상담에서
  // 실제로 궁금한 것은 대개 그 시점입니다.
  const byMonth = new Map<string, { absent: number; late: number; early: number }>();
  for (const r of records) {
    if (!schoolDayList.includes(r.date)) continue;
    const m = r.date.slice(0, 7);
    const cur = byMonth.get(m) ?? { absent: 0, late: 0, early: 0 };
    if (r.status === "결석") cur.absent += 1;
    else if (r.status === "지각") cur.late += 1;
    else if (r.status === "조퇴") cur.early += 1;
    byMonth.set(m, cur);
  }
  const months = [...byMonth.entries()].sort((a, b) => a[0].localeCompare(b[0]));

  const exceptions = records.filter((r) => r.status !== "출석" && schoolDayList.includes(r.date));

  const Stat = ({ label, value, tone }: { label: string; value: string | number; tone?: string }) => (
    <div className="rounded-xl border border-slate-200 bg-white px-3 py-2">
      <p className="text-[11px] text-slate-400">{label}</p>
      <p className={"text-lg font-bold tabular-nums " + (tone ?? "text-slate-800")}>{value}</p>
    </div>
  );

  return (
    <div className="mx-auto max-w-4xl p-4 sm:p-6">
      <div className="mb-1 flex flex-wrap items-baseline gap-2">
        <h1 className="text-lg font-bold">
          🗒️ {student.name}
          <span className="ml-1.5 text-[12px] font-normal text-slate-400">
            {student.class_name ?? `${student.grade ?? "?"}학년`} ·{" "}
            {departmentOf({ department: student.department, grade: student.grade }) ?? "미분류"}
          </span>
        </h1>
        <span className="text-xs text-slate-400">{term ? `${term.year} ${term.term_type}` : "학기 미지정"}</span>
        <Link href={`/students/${id}`} className="ml-auto text-[12px] font-semibold text-teal-700 underline">
          학생 정보 →
        </Link>
      </div>

      <div className="my-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
        <Stat label="수업일" value={`${s.schoolDays}일`} />
        <Stat label="결석" value={`${s.absent}일`} tone="text-red-600" />
        <Stat label="지각" value={`${s.late}일`} tone="text-amber-600" />
        <Stat label="조퇴" value={`${s.earlyLeave}일`} tone="text-orange-600" />
        <Stat label="출석률" value={s.rate === null ? "—" : `${s.rate}%`} tone="text-emerald-700" />
      </div>

      {/* 이 숫자를 얼마나 믿어도 되는지 먼저 말합니다.
          기록이 절반뿐인데 출석률만 크게 띄우면, 그 숫자가 그대로 서류에 옮겨 적힙니다. */}
      <p className="mb-4 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] leading-relaxed text-slate-600">
        수업일 <b>{s.schoolDays}일</b> 중 기록이 있는 날은 <b>{s.recorded}일</b>입니다
        {s.missing > 0 && (
          <>
            . 나머지 <b className="text-amber-700">{s.missing}일</b>은 아직 안 찍은 날이라 <b>결석이 아니라 자료 없음</b>이고,
            출석률 계산에서 빠져 있습니다
          </>
        )}
        . 출석률은 기록이 있는 날만 분모로 씁니다.
        {s.unconfirmed > 0 && (
          <>
            {" "}
            연락에서 저절로 들어와 <b className="text-amber-700">아직 확인 안 된 줄이 {s.unconfirmed}건</b> 있습니다.
          </>
        )}
      </p>

      <div className="mb-4 flex flex-wrap gap-1.5 text-[12px]">
        <span className="font-semibold text-slate-600">사유별 결석</span>
        {REASONS.map((k) => (
          <span
            key={k}
            className={
              "rounded-lg border px-2 py-0.5 " +
              (k === "무단" && s.byReason[k] > 0 ? "border-red-300 bg-red-50 font-bold text-red-700" : "border-slate-200 text-slate-600")
            }
          >
            {k} {s.byReason[k]}
          </span>
        ))}
        {s.absent - REASONS.reduce((n, k) => n + s.byReason[k], 0) > 0 && (
          <span className="rounded-lg border border-amber-200 bg-amber-50 px-2 py-0.5 text-amber-800">
            사유 안 고름 {s.absent - REASONS.reduce((n, k) => n + s.byReason[k], 0)}
          </span>
        )}
      </div>

      {months.length > 0 && (
        <div className="mb-4 overflow-hidden rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-[11px] font-semibold text-slate-500">
              <tr>
                <th className="px-3 py-2">월</th>
                <th className="px-3 py-2 text-right">결석</th>
                <th className="px-3 py-2 text-right">지각</th>
                <th className="px-3 py-2 text-right">조퇴</th>
              </tr>
            </thead>
            <tbody>
              {months.map(([m, v]) => (
                <tr key={m} className="border-t border-slate-100">
                  <td className="px-3 py-1.5 font-semibold text-slate-700">{Number(m.slice(5))}월</td>
                  <td className="px-3 py-1.5 text-right font-bold tabular-nums text-red-600">{v.absent || ""}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-amber-600">{v.late || ""}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-orange-600">{v.early || ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="mb-2 text-[12px] font-bold text-slate-700">빠진 날 ({exceptions.length}건)</p>
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-left text-sm">
          <tbody>
            {exceptions.map((r) => (
              <tr key={r.date} className="border-t border-slate-100">
                <td className="w-28 px-3 py-1.5 text-[12px] tabular-nums text-slate-500">{r.date}</td>
                <td className="w-16 px-2 py-1.5 text-[12px] font-bold text-slate-700">{r.status}</td>
                <td className="w-16 px-2 py-1.5 text-[12px] text-slate-500">{r.reason_type ?? ""}</td>
                <td className="px-3 py-1.5 text-[11px] text-slate-400">
                  {r.note}
                  {r.source && r.source !== "담임" && <span className="ml-1.5">· {r.source}에서</span>}
                  {r.confirmed_by_human === false && <span className="ml-1.5 font-bold text-amber-700">· 확인 필요</span>}
                </td>
              </tr>
            ))}
            {exceptions.length === 0 && (
              <tr>
                <td className="px-3 py-8 text-center text-sm text-slate-400">
                  {s.recorded === 0 ? "아직 이 학생의 출결 기록이 없습니다." : "빠진 날이 없습니다."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
