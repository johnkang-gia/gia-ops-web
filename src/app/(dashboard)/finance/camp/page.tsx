import { redirect } from "next/navigation";
import { getCurrentAppUser } from "@/lib/currentUser";
import { hasFinanceAccess } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";
import { loadStudents } from "@/lib/students";
import CampClient, { type CampApp, type CampInvoice, type CampTerm, type CampStudent } from "@/components/finance/CampClient";

export const dynamic = "force-dynamic";

/**
 * **캠프 청구** — 구글폼 신청 → 학생 연결 → 금액 확인 → 청구서 한 장.
 *
 * 캠프는 정규학기와 완전히 따로 돕니다. 학기 고르개의 정규학기 화면(학비·학비외 일괄 발행)에 섞으면 정규 항목·
 * 정규 명단 사이에서 캠프 신청자를 찾아야 하고, 외부 학생은 그 명단에 아예 없습니다. 그래서 신청서 한 줄이
 * 곧 청구 한 줄인 화면을 따로 둡니다. 만든 청구서는 다른 청구서와 똑같아서 올톡 보내기·수납·미납금이 그대로 받습니다.
 */
export default async function CampPage({ searchParams }: { searchParams: Promise<{ term?: string }> }) {
  const me = await getCurrentAppUser();
  if (!me) redirect("/login");
  if (!hasFinanceAccess(me)) redirect("/home");
  const sp = await searchParams;
  const supabase = await createClient();

  const { data: termRows, error: termErr } = await supabase
    .from("terms")
    .select("id, term_type, year, status, start_date, end_date")
    .ilike("term_type", "%캠프%")
    .order("year", { ascending: false })
    .order("term_type");
  const terms = (termRows ?? []) as CampTerm[];
  // 열린 캠프가 여럿이면 신청이 들어와 있는(또는 폼이 이어진) 캠프를 먼저 엽니다. 빈 캠프가 먼저 열리면 «신청 0명»으로 보입니다.
  const open = terms.filter((t) => t.status !== "종료");
  let busyTerm: string | null = null;
  if (!terms.some((t) => t.id === sp.term) && open.length > 1) {
    const { data: hit } = await supabase.from("camp_applications").select("term_id").in("term_id", open.map((t) => t.id)).limit(1);
    busyTerm = (hit?.[0]?.term_id as string | undefined) ?? null;
  }
  const termId = terms.some((t) => t.id === sp.term) ? sp.term! : busyTerm ?? (open[0] ?? terms[0])?.id ?? "";

  let apps: CampApp[] = [];
  let invoices: CampInvoice[] = [];
  let link: { token: string; last_seen_at: string | null; last_result: string | null } | null = null;
  let loadError: string | null = termErr?.message ?? null;

  if (termId) {
    const [a, l] = await Promise.all([
      supabase.from("camp_applications").select("*").eq("term_id", termId).order("submitted_at", { ascending: true }),
      supabase.from("camp_intake_links").select("token, last_seen_at, last_result").eq("term_id", termId).eq("enabled", true).order("created_at", { ascending: false }).limit(1),
    ]);
    if (a.error) loadError = a.error.message;
    if (l.error) loadError = l.error.message;
    apps = (a.data ?? []) as CampApp[];
    link = l.data?.[0] ?? null;
    const invIds = apps.map((x) => x.invoice_id).filter((v): v is string => !!v);
    if (invIds.length > 0) {
      const [inv, pay] = await Promise.all([
        supabase.from("invoices").select("id, invoice_no, status, total_amount").in("id", invIds),
        supabase.from("payments").select("invoice_id, amount").in("invoice_id", invIds),
      ]);
      if (inv.error) loadError = inv.error.message;
      if (pay.error) loadError = pay.error.message;
      const paid = new Map<string, number>();
      for (const p of pay.data ?? []) paid.set(p.invoice_id as string, (paid.get(p.invoice_id as string) ?? 0) + Number(p.amount ?? 0));
      invoices = (inv.data ?? []).map((v) => ({
        id: v.id as string,
        invoice_no: v.invoice_no as string,
        status: v.status as string,
        total: Number(v.total_amount ?? 0),
        paid: paid.get(v.id as string) ?? 0,
      }));
    }
  }

  // 연결 후보. 퇴소생도 캠프에 다시 올 수 있어 전부 읽고, 화면이 상태를 함께 보여줍니다.
  const { rows, error: stuErr } = await loadStudents(supabase, { status: "all" });
  if (stuErr) loadError = stuErr;
  const students: CampStudent[] = rows.map((s) => ({
    id: s.id,
    name: s.name,
    name_en: s.name_en,
    grade: s.grade,
    class_name: s.class_name,
    birth_date: s.birth_date,
    status: s.status,
  }));

  return (
    <CampClient
      terms={terms}
      termId={termId}
      apps={apps}
      invoices={invoices}
      students={students}
      link={link}
      loadError={loadError}
    />
  );
}
