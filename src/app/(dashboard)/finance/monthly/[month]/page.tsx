import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import FinanceLive from "@/components/finance/FinanceLive";
import MonthCloseBar, { type MonthClose } from "@/components/finance/MonthCloseBar";
import StudentMonthClient from "@/components/finance/StudentMonthClient";
import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import { hasFinanceAccess } from "@/lib/roles";
import { todayKst } from "@/lib/kst";
import { readAll, readNotice } from "@/lib/financeFetch";
import { lastDayOf, monthLabel, shiftMonth } from "@/lib/financePeriod";
import { buildStudentMonth, type MonthInvoice, type MonthPayment } from "@/lib/studentMonthLedger";

export const dynamic = "force-dynamic";

/**
 * **한 달을 학생별로 펼친 화면.**
 *
 * 월별 화면은 학교 전체 합계까지만 답합니다 - 「9월에 청구 3,200만원」. 행정실에서 실제로
 * 하는 물음은 그 다음입니다: **「9월에 김사랑한테 얼마 나갔죠?」**
 *
 * 9월 2일에 30만, 9월 20일에 20만을 따로 보냈으면 답은 50만인데, 지금까지는 청구서를
 * 하나씩 찾아 더해야 했습니다. 더하다 한 장을 빠뜨려도 그 사실이 어디에도 안 나타납니다.
 *
 * 통장 조회와 같은 모양으로 둡니다 - 시간순 한 줄기에 청구(+) · 수납(−) · 잔액. 학부모가
 * 전화로 물으면 이 화면만 보고 답할 수 있어야 합니다.
 *
 * 달은 주소에 있습니다(`/finance/monthly/2026-09`). 화면 안 상태로 두면 그 달을 남에게
 * 보낼 수가 없습니다 - 「9월 것 좀 봐주세요」가 링크 한 줄이 되어야 합니다.
 */
export default async function FinanceMonthStudentsPage({ params }: { params: Promise<{ month: string }> }) {
  const { month } = await params;
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) notFound();

  const me = await getCurrentAppUser();
  if (!me) redirect("/login");
  if (!hasFinanceAccess(me)) redirect("/home");

  const supabase = await createClient();
  const today = todayKst();

  // 그 달 청구서만 읽습니다. 청구월 칸이 빈 옛 줄이 있어 **발행일로도** 한 번 더 봅니다 -
  // 조건을 하나만 걸면 그 줄들이 어느 달에도 안 나타납니다.
  const first = `${month}-01`;
  // 말일은 **세어서** 만듭니다. `-31` 로 굳히면 9월·2월에 없는 날짜가 되어 데이터베이스가
  // 거부합니다 - 그러면 그 달 화면이 통째로 안 뜹니다.
  const lastOfMonth = lastDayOf(month);
  const invRes = await readAll<MonthInvoice>((from, to) =>
    supabase
      .from("invoices")
      .select(
        "id, invoice_no, student_id, student_name, student_name_ko, billing_month, issue_date, due_date, total_amount, status, stream, category, carried_to_invoice_id, note",
      )
      .or(`billing_month.eq.${month},and(billing_month.is.null,issue_date.gte.${first},issue_date.lte.${lastOfMonth})`)
      .order("issue_date")
      .order("invoice_no")
      .range(from, to),
  );

  const invoiceIds = invRes.rows.map((v) => v.id);
  // 그 청구서들에 붙은 돈은 **언제 들어왔든** 함께 봅니다. 9월분을 10월에 낸 돈을 빼면
  // 9월 표에 청구만 남아 영영 미납으로 보입니다.
  const payRes =
    invoiceIds.length === 0
      ? { rows: [] as MonthPayment[], truncated: false, error: null }
      : await readAll<MonthPayment>((from, to) =>
          supabase
            .from("payments")
            .select("invoice_id, amount, paid_at, method_kind, method, kind")
            .in("invoice_id", invoiceIds)
            .order("paid_at")
            .range(from, to),
        );

  // 그 달에 **실제로 통장·올톡페이로 찍힌 돈**. 위와 다른 질문이라 따로 읽습니다.
  const inMonthRes = await readAll<{ amount: number | string }>((from, to) =>
    supabase.from("payments").select("amount, paid_at").gte("paid_at", first).lte("paid_at", lastOfMonth).order("paid_at").range(from, to),
  );

  const [stuRes, closeRes] = await Promise.all([
    supabase.from("wr_students").select("id, name, grade, class_name").eq("is_demo", false),
    supabase.from("finance_month_closes").select("*").eq("month", month).maybeSingle(),
  ]);

  const students = (stuRes.data as { id: string; name: string; grade: string | null; class_name: string | null }[] | null) ?? [];
  const nameById = new Map(students.map((s) => [s.id, s.name]));
  const whereById = new Map(students.map((s) => [s.id, s.class_name || (s.grade ? `${s.grade}학년` : "")]));

  const { rows, totals } = buildStudentMonth(invRes.rows, payRes.rows, {
    month,
    today,
    nameOf: (id) => nameById.get(id) ?? null,
    whereOf: (id) => whereById.get(id) || null,
  });

  const receivedInMonth = inMonthRes.rows.reduce((n, p) => n + Math.round(Number(p.amount ?? 0)), 0);
  const notice = readNotice(invRes, payRes, inMonthRes);
  const loadError = stuRes.error?.message ?? null;

  return (
    <div className="mx-auto flex h-full max-w-5xl flex-col p-4 sm:p-6">
      {/* 돈에 닿는 자료가 바뀌면 이 화면도 함께 다시 그립니다(CLAUDE.md 2-12). */}
      <FinanceLive />

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Link href="/finance/monthly" className="text-[12px] font-semibold text-teal-700 underline">
          ← 월별
        </Link>
        <h1 className="text-lg font-bold">
          🧾 {month.slice(0, 4)}년 {monthLabel(month)} 학생별
        </h1>
        <MonthCloseBar month={month} state={(closeRes.data as MonthClose | null) ?? null} />
        {/* 앞뒤 달로 바로 갑니다. 달을 바꾸려고 목록으로 돌아갔다 오면 펼쳐둔 줄이 닫히고,
            두 달을 견주는 일이 번거로워집니다. */}
        <span className="ml-2 flex items-center gap-1">
          <Link
            href={`/finance/monthly/${shiftMonth(month, -1)}`}
            className="rounded border border-slate-200 px-1.5 py-0.5 text-[11px] font-semibold text-slate-500 hover:bg-slate-50"
          >
            ‹ {monthLabel(shiftMonth(month, -1))}
          </Link>
          <Link
            href={`/finance/monthly/${shiftMonth(month, 1)}`}
            className="rounded border border-slate-200 px-1.5 py-0.5 text-[11px] font-semibold text-slate-500 hover:bg-slate-50"
          >
            {monthLabel(shiftMonth(month, 1))} ›
          </Link>
        </span>
        <Link href="/finance/unpaid" className="ml-auto text-[12px] font-semibold text-teal-700 underline">
          미납금 →
        </Link>
      </div>

      <p className="mb-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] leading-relaxed text-slate-700">
        <b>통장 조회와 같은 모양</b>입니다 — 줄을 누르면 그 학생의 {monthLabel(month)} 거래내역이 열립니다.
        입금·출금 자리에 <b>청구(+)</b>와 <b>수납(−)</b>이 들어가고, 오른쪽 잔액이 그때까지 못 받은 돈입니다.
        <br />
        한 사람에게 그 달에 여러 번 청구했으면 <b>모두 더해</b> 한 줄로 보여줍니다. 지금까지의 전체 내역은
        줄 오른쪽 「명세서」에 있습니다.
      </p>

      {(notice || loadError) && (
        <p className="mb-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[12px] font-semibold text-rose-700">
          {notice ?? `자료를 읽지 못했습니다: ${loadError}`}
        </p>
      )}

      <StudentMonthClient month={month} rows={rows} totals={totals} receivedInMonth={receivedInMonth} />
    </div>
  );
}
