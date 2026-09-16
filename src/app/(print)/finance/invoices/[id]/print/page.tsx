import { redirect, notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import { hasFinanceAccess } from "@/lib/roles";
import InvoiceSheet, { type SheetPart } from "@/components/finance/InvoiceSheet";
import type { Invoice, InvoiceLine } from "@/lib/types";
import { invoiceFileTitle, familyFileTitle } from "@/lib/invoiceTitle";

export const dynamic = "force-dynamic";

/**
 * **형제 합본.** `?also=<청구서 id>,<청구서 id>` 를 붙이면 한 장에 함께 담습니다.
 *
 * 보호자 번호가 같으면 청구는 한 장으로 합쳐 보냅니다(올톡페이 일괄등록의 「형제 한 장으로
 * 합치기」). 그런데 종이 청구서는 아이마다 따로여서, 합쳐 보낸 집은 **금액만 보고 어느 아이
 * 몫이 얼마인지 알 수 없었습니다.**
 *
 * 주소에 적는 것은 **청구서 번호(id)** 입니다. 보호자 번호로 이 화면이 스스로 형제를 찾지
 * 않습니다 - 번호가 같다고 늘 한 장으로 보내는 것은 아니고, 무엇을 합칠지는 합치기를 누른
 * 사람이 이미 정했습니다. 그 결정을 이 화면이 다시 내리면 두 곳이 어긋납니다.
 */
function alsoIds(v: string | undefined): string[] {
  return (v ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * **PDF 파일 이름은 탭 제목에서 나옵니다.**
 *
 * 브라우저의 「PDF로 저장」은 `document.title` 을 그대로 파일 이름으로 씁니다. 두지 않으면
 * 139명 것이 전부 「GIA 운영」으로 저장되고, 받는 쪽은 열어봐야 누구 것인지 압니다.
 *
 * **화면에서 `document.title` 을 고치는 것으로는 안 됩니다** - Next 가 이 화면의 metadata
 * 로 제목을 다시 덮어씁니다. 그래서 서버에서 정합니다.
 *
 * 여기서 실패해도 화면은 떠야 합니다. 제목을 못 정하는 것보다 청구서가 안 나오는 것이
 * 훨씬 나쁩니다.
 */
export async function generateMetadata({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ also?: string }>;
}) {
  try {
    const { id } = await params;
    const { also } = await searchParams;
    const ids = [id, ...alsoIds(also)];
    const supabase = await createClient();
    const { data } = await supabase
      .from("invoices")
      .select("id, student_name, student_name_ko, grade_label, stream, category")
      .in("id", ids);
    const rows = (data as Parameters<typeof invoiceFileTitle>[0][] | null) ?? [];
    if (rows.length === 0) return { title: "청구서" };
    // 주소에 적은 순서대로 세웁니다. 데이터베이스가 돌려주는 순서는 정해져 있지 않아서,
    // 그대로 쓰면 같은 집 청구서가 열 때마다 다른 이름으로 저장됩니다.
    const ordered = ids.map((x) => rows.find((r) => (r as { id?: string }).id === x)).filter(Boolean) as typeof rows;
    return { title: ordered.length > 1 ? familyFileTitle(ordered) : invoiceFileTitle(ordered[0] ?? rows[0]) };
  } catch {
    return { title: "청구서" };
  }
}

export default async function InvoicePrintPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ embed?: string; also?: string }>;
}) {
  const { id } = await params;
  const { embed, also } = await searchParams;
  const me = await getCurrentAppUser();
  if (!me) redirect("/login");
  if (!hasFinanceAccess(me)) redirect("/home");

  const ids = [id, ...alsoIds(also)];
  const supabase = await createClient();
  const [invRes, lineRes] = await Promise.all([
    supabase.from("invoices").select("*").in("id", ids),
    supabase.from("invoice_lines").select("*").in("invoice_id", ids).order("seq"),
  ]);
  // 조용히 넘기지 않습니다(CLAUDE.md §5) - 빈 청구서는 「내역이 없는 청구서」로 보이고,
  // 그건 학부모에게 그대로 나갑니다.
  if (invRes.error) throw new Error(`인보이스를 읽지 못했습니다: ${invRes.error.message}`);
  if (lineRes.error) throw new Error(`청구 내역을 읽지 못했습니다: ${lineRes.error.message}`);

  const byId = new Map(((invRes.data as Invoice[] | null) ?? []).map((v) => [v.id, v]));
  const allLines = (lineRes.data as InvoiceLine[] | null) ?? [];
  const parts: SheetPart[] = ids
    .map((x) => byId.get(x))
    .filter((v): v is Invoice => !!v)
    .map((inv) => ({ invoice: inv, lines: allLines.filter((l) => l.invoice_id === inv.id) }));
  if (parts.length === 0) notFound();

  return <InvoiceSheet parts={parts} embed={embed === "1"} />;
}
