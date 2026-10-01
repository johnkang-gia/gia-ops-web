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

/**
 * 학비내역 한 줄 — **정규과정이 먼저, 방과후가 다음, 나머지는 뒤.** 학비에서 제일 큰 돈이
 * 정규과정이라 그것이 맨 앞에 있어야 「이 아이는 연납인가 월납인가」가 한눈에 읽힙니다.
 * 이름은 줄여 적습니다 - 표 한 칸에 「Learning Management & Assessment Fee(Annual)」가
 * 그대로 들어가면 다른 칸이 밀립니다.
 */
type TuitionCell = { slot: "정규" | "방과후" | "그외"; label: string; amount: number; none: boolean };
function tuitionCells(charges: ReturnType<typeof buildLedger>["charges"]): TuitionCell[] {
  const slotOf = (name: string): TuitionCell["slot"] => (/정규/.test(name) ? "정규" : /방과후/.test(name) ? "방과후" : "그외");
  const all = charges.filter((c) => c.kind === "학비").sort((a, b) => a.label.localeCompare(b.label, "ko"));
  // 칸 안의 글자는 항목 이름이 아니라 **고른 것**입니다 - 칸 머리가 이미 「정규」「방과후」이므로
  // 정규 칸에는 「학기납」, 방과후 칸에는 「5일 월납」만 적습니다.
  const cell = (c: (typeof all)[number]): TuitionCell => {
    const slot = slotOf(c.label);
    const plan = shortPlan(c.label);
    const opt = c.optionName ? shortOption(c.optionName) : "";
    const label = slot === "정규" ? opt : slot === "방과후" ? `${plan.replace(/^방과후/, "")} ${opt}`.trim() : `${plan} ${opt}`.trim();
    return { slot, label, amount: c.amount, none: !c.optionName };
  };
  // 정규는 늘 한 칸(안 골랐으면 「신청안함」). 방과후는 2일·3일·5일이 따로 항목이라 전부
  // 적으면 「신청안함」이 셋 서고 정작 고른 것이 묻힙니다 - 고른 것만 적고, 하나도 안 골랐으면
  // 「신청안함」 한 칸. 그 외(LMA 등)는 고른 것만 적습니다.
  const out: TuitionCell[] = [];
  const regular = all.filter((c) => slotOf(c.label) === "정규");
  const after = all.filter((c) => slotOf(c.label) === "방과후");
  const rest = all.filter((c) => slotOf(c.label) === "그외");
  const regPicked = regular.filter((c) => c.optionName);
  if (regPicked.length > 0) out.push(...regPicked.map(cell));
  else out.push({ slot: "정규", label: "미신청", amount: 0, none: true });
  const afterPicked = after.filter((c) => c.optionName);
  if (afterPicked.length > 0) out.push(...afterPicked.map(cell));
  else out.push({ slot: "방과후", label: after.length > 0 ? "미신청" : "—", amount: 0, none: true });
  out.push(...rest.filter((c) => c.optionName).map(cell));
  return out;
}

/** 학비외는 분류별로 셉니다 - 「교재 5 · 교복 2」. 항목 이름을 다 적으면 한 줄에 열 개가 섭니다. */
function extraCells(charges: ReturnType<typeof buildLedger>["charges"]): { category: string; count: number; amount: number }[] {
  const m = new Map<string, { count: number; amount: number }>();
  for (const c of charges) {
    if (c.kind !== "학비외") continue;
    const cur = m.get(c.category) ?? { count: 0, amount: 0 };
    cur.count += 1;
    cur.amount += c.amount;
    m.set(c.category, cur);
  }
  return [...m.entries()].map(([category, v]) => ({ category, ...v })).sort((a, b) => b.amount - a.amount);
}

function shortPlan(name: string): string {
  const n = name.replace(/\(.*?\)/g, "").trim();
  if (/정규/.test(n)) return "정규";
  const m = /방과후\s*(\d+)\s*일/.exec(n);
  if (m) return `방과후${m[1]}일`;
  if (/Learning Management/i.test(n)) return "LMA";
  return n.length > 8 ? `${n.slice(0, 8)}…` : n;
}

function shortOption(name: string): string {
  const n = name.trim();
  if (/연|1년|year/i.test(n)) return "연납";
  if (/학기|분기/.test(n)) return "학기납";
  const m = /(\d+)\s*개월/.exec(n);
  if (m) return `${m[1]}개월`;
  if (/월/.test(n)) return "월납";
  if (/1회/.test(n)) return "1회";
  return n.length > 5 ? n.slice(0, 5) : n;
}

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
      tuition: tuitionCells(l.charges),
      tuitionTotal: l.charges.filter((c) => c.kind === "학비").reduce((n, c) => n + c.amount, 0),
      extra: extraCells(l.charges),
      extraTotal: l.charges.filter((c) => c.kind === "학비외").reduce((n, c) => n + c.amount, 0),
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
