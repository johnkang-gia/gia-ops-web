import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import { hasFinanceAccess } from "@/lib/roles";
import InvoiceSheet, { type SheetPart } from "@/components/finance/InvoiceSheet";
import type { Invoice, InvoiceLine } from "@/lib/types";
import { invoiceFileTitle } from "@/lib/invoiceTitle";
import { sortForSheet } from "@/lib/invoiceSections";
import { loadDepositView } from "@/lib/depositView";

export const dynamic = "force-dynamic";

/**
 * **학비 + 학비외를 한 장으로** — 학생 번호로 모읍니다.
 *
 * ── 왜 청구서 번호가 아니라 학생 번호인가 ───────────────────────────────────
 *
 * 형제 합본(`?also=<id>,<id>`)은 **무엇을 합칠지 사람이 정한 것**이라 번호를 주소에 적습니다.
 * 학비+학비외는 다릅니다 - 합칠 대상이 「그 아이의 살아 있는 청구서 전부」로 이미 정해져
 * 있습니다.
 *
 * 번호를 주소에 굳혀두면, 한쪽을 취소하고 다시 발행했을 때 그 링크는 **없어진 장**을 가리킵니다.
 * 학부모에게 이미 보낸 링크가 그렇게 되면 아무 말 없이 빈 종이가 되거나 옛 금액이 나옵니다.
 * 학생 번호로 모으면 열 때마다 지금 살아 있는 장을 읽으므로, 한쪽을 고치면 합본도 따라옵니다.
 *
 * ── 무엇을 담나 ─────────────────────────────────────────────────────────────
 *
 * 그 아이의 **발행 상태 청구서**만 담습니다.
 *
 *   · 취소된 장 — 없던 일입니다
 *   · 이월된 장(`carried_to_invoice_id`) — 그 돈은 새 장으로 옮겨갔고 새 장이 따로 담깁니다
 *   · 「직접수납」으로 적기만 한 장(`issued_offline`) — 밖으로 나간 적이 없습니다.
 *     학부모에게 가는 종이에 넣으면 이미 낸 돈을 또 청구하는 것이 됩니다
 *
 * 학기는 `?term=` 으로 좁힙니다. 안 주면 학기를 가리지 않습니다 - 화면이 어느 학기를 보고
 * 있는지는 화면이 알고, 여기서 또 정하면 두 곳이 어긋납니다.
 */

type Row = Invoice & { issued_offline?: boolean | null; carried_to_invoice_id?: string | null };

/**
 * `with` = 미리보기에서 열어 둔 그 청구서. **합본에는 늘 들어갑니다.**
 *
 * 「이 청구서만」으로는 보이는데 「학비+학비외 한 장」을 누르면 빈 화면이 떴습니다. 합본이 학기(`term_id`
 * 가 같은 것만)와 「직접수납」 거르기를 거치면서 **지금 보고 있던 장까지 빠지면** 담을 것이 하나도 없어
 * 404 가 났고, 미리보기 창 안에서는 그게 그냥 흰 화면이었습니다. 학기가 안 적힌 장(term_id 없음)도 같은
 * 학기로 보지 않아 빠졌습니다.
 *
 *   · 학기는 «같은 학기이거나 학기가 안 적힌 장»으로 좁힙니다
 *   · 보고 있던 장은 거르기와 상관없이 담습니다 - 사람이 지금 그 장을 보고 합본을 눌렀습니다
 *   · 그래도 비면 404 대신 **왜 비었는지**를 적습니다(§5)
 */
async function loadParts(studentId: string, term: string | undefined, withId?: string) {
  const supabase = await createClient();
  let q = supabase.from("invoices").select("*").eq("student_id", studentId).eq("status", "발행");
  // 주소에서 온 값이라 걸러 넣습니다 - 학기 번호(uuid) 모양이 아니면 학기로 좁히지 않습니다.
  if (term && /^[0-9a-f-]{36}$/i.test(term)) q = q.or(`term_id.eq.${term},term_id.is.null`);
  const { data, error } = await q;
  if (error) throw new Error(`청구서를 읽지 못했습니다: ${error.message}`);

  let rows = (data as Row[] | null) ?? [];
  if (withId && !rows.some((v) => v.id === withId)) {
    const { data: one } = await supabase.from("invoices").select("*").eq("id", withId).eq("student_id", studentId).maybeSingle();
    if (one) rows = [...rows, one as Row];
  }
  const live = sortForSheet(
    rows.filter((v) => v.id === withId || (!v.carried_to_invoice_id && v.issued_offline !== true)),
  );
  if (live.length === 0) return { parts: [] as SheetPart[], live };

  const { data: lines, error: lineErr } = await supabase
    .from("invoice_lines")
    .select("*")
    .in("invoice_id", live.map((v) => v.id))
    .order("seq");
  // 조용히 넘기지 않습니다(§5) - 내역 없는 청구서는 그대로 학부모에게 나갑니다.
  if (lineErr) throw new Error(`청구 내역을 읽지 못했습니다: ${lineErr.message}`);

  const all = (lines as InvoiceLine[] | null) ?? [];
  return {
    parts: live.map((inv) => ({ invoice: inv as Invoice, lines: all.filter((l) => l.invoice_id === inv.id) })),
    live,
  };
}

/**
 * PDF 파일 이름. 브라우저의 「PDF로 저장」이 탭 제목을 그대로 씁니다 - 안 두면 139명 것이
 * 모두 「GIA 운영」으로 저장됩니다.
 */
export async function generateMetadata({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ term?: string; with?: string }>;
}) {
  try {
    const { id } = await params;
    const { term, with: withId } = await searchParams;
    const { live } = await loadParts(id, term, withId);
    if (live.length === 0) return { title: "청구서" };
    const base = invoiceFileTitle(live[0] as Parameters<typeof invoiceFileTitle>[0]);
    // 「학비 청구서」가 아니라 「학비·학비외 청구서」임을 파일 이름에서부터 알립니다.
    return { title: live.length > 1 ? base.replace(/(학비외|학비)\s*청구서$/, "학비·학비외 청구서") : base };
  } catch {
    return { title: "청구서" };
  }
}

export default async function StudentInvoicePrintPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ embed?: string; term?: string; with?: string }>;
}) {
  const { id } = await params;
  const { embed, term, with: withId } = await searchParams;
  const me = await getCurrentAppUser();
  if (!me) redirect("/login");
  if (!hasFinanceAccess(me)) redirect("/home");

  const { parts } = await loadParts(id, term, withId);
  if (parts.length === 0) {
    return (
      <p className="mx-auto mt-10 max-w-md rounded-lg bg-amber-50 px-4 py-3 text-[13px] leading-relaxed text-amber-900">
        한 장으로 묶을 청구서가 없습니다. 이 학생의 「발행」 상태 청구서가 모두 이월되었거나 직접수납으로만 적혀 있습니다.
        「이 청구서만」으로 보세요.
      </p>
    );
  }

  const depositView = await loadDepositView(await createClient(), parts);
  return <InvoiceSheet parts={parts} embed={embed === "1"} deposit={depositView} />;
}
