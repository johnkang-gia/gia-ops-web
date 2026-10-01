import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import { hasFinanceAccess } from "@/lib/roles";
import { departmentTabs } from "@/lib/department";
import { loadLedgerWorld } from "@/lib/ledgerLoad";
import { buildLedger } from "@/lib/studentLedger";
import LedgerClient, { type LedgerRow, type LedgerInvoiceRow } from "@/components/finance/LedgerClient";

/**
 * **회계** — 학생이 이 학기에 내야 할 돈을 한 화면에서.
 *
 * 학생 탭: 아이마다 청구할 금액 · 미납 · 예치금. 이름을 누르면 학생 금전 창이 열리고 거기서
 * 발행·입금·영수증·항목 수정·올톡페이까지 다 합니다. 청구서 탭: 발행된 장을 학비/학비외
 * 따로, 부서·학년·반으로 보고 묶어서 올톡페이로 보냅니다.
 *
 * 숫자는 전부 `studentLedger.ts` 가 셉니다 - 학생 창과 같은 함수, 같은 자료입니다. 목록의
 * 숫자와 창의 숫자가 다르면 아무도 안 믿습니다.
 */
export const dynamic = "force-dynamic";

export default async function LedgerPage({ searchParams }: { searchParams: Promise<{ term?: string }> }) {
  const me = await getCurrentAppUser();
  if (!me) redirect("/login");
  if (!hasFinanceAccess(me)) redirect("/finance");
  const { term } = await searchParams;

  const supabase = await createClient();
  const { world, students, terms, errors } = await loadLedgerWorld(supabase, { termId: term || null });

  const rows: LedgerRow[] = students.map((s) => {
    const l = buildLedger(world, s);
    return {
      id: s.id,
      name: s.name,
      nameEn: s.name_en ?? null,
      grade: s.grade,
      className: s.class_name,
      department: s.department ?? null,
      tuition: l.charges.filter((c) => c.kind === "학비" && c.amount > 0).map((c) => `${c.label}${c.optionName ? ` · ${c.optionName}` : ""}`),
      extra: l.charges.filter((c) => c.kind === "학비외").length,
      toBill: l.totals.toBill,
      billed: l.totals.billed,
      unpaid: l.totals.unpaid,
      deposit: l.totals.deposit,
      expected: l.totals.expected,
    };
  });

  const nameById = new Map(students.map((s) => [s.id, s]));
  const invoices: LedgerInvoiceRow[] = world.invoices
    .filter((v) => v.status === "발행")
    .map((v) => {
      const s = v.student_id ? nameById.get(v.student_id) : null;
      const l = s ? buildLedger(world, s) : null;
      const settled = l?.invoices.find((x) => x.id === v.id)?.settled ?? null;
      return {
        id: v.id,
        invoiceNo: v.invoice_no,
        studentId: v.student_id,
        studentName: s?.name ?? v.student_name_ko ?? v.student_name,
        grade: s?.grade ?? null,
        className: s?.class_name ?? null,
        department: s?.department ?? null,
        stream: ((v as { stream?: string | null }).stream ?? (v.category === "학비" ? "학비" : "학비외")) as "학비" | "학비외",
        scope: (v as { plan_scope?: string | null }).plan_scope ?? (v.category ?? null),
        issueDate: v.issue_date,
        dueDate: v.due_date,
        amount: Number(v.total_amount),
        state: settled?.state ?? "미납",
        balance: settled?.balance ?? Number(v.total_amount),
        exported: !!v.exported_at,
        offline: v.issued_offline === true,
        termId: v.term_id ?? null,
      };
    });

  return (
    <LedgerClient
      rows={rows}
      invoices={invoices}
      termId={world.termId}
      terms={terms.map((t) => ({ id: t.id, name: `${t.year} ${t.term_type}`, status: t.status }))}
      deptTabs={departmentTabs(me.department)}
      loadError={errors.length ? errors.join(" · ") : null}
    />
  );
}
