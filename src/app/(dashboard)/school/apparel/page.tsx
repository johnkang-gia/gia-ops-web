import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import { hasFinanceAccess, isStaffOrAboveUser } from "@/lib/roles";
import { isDemoAccount } from "@/lib/sharedAccounts";
import { gradeSortKey } from "@/lib/department";
import type { ApparelExchange, ApparelOrder, ApparelOrderItem, ApparelOrderPiece, ApparelStock, StudentApparelSize, StudentGroup, Term } from "@/lib/types";
import ApparelClient, { type ApparelBilling, type ApparelStudent } from "@/components/school/ApparelClient";

export const dynamic = "force-dynamic";

// 의류 — 교복과 행사 티셔츠.
//
// 행사가 있을 때마다 아이들 사이즈를 다시 조사하고, 그 결과는 그 행사 한 번에 쓰이고
// 사라집니다. 그런데 사이즈는 **행사의 성질이 아니라 아이의 성질**입니다. 한 번 적어두면
// 다음에는 자란 아이와 새로 온 아이만 물으면 됩니다.
//
// 청구는 여기서 하지 않습니다. 돈은 재무 권한을 가진 사람이 인보이스에서 다룹니다. 다만 제작 건에
// 납부 항목을 달아 두면 명단의 아이에게 그 항목이 저절로 붙고(트리거), 청구서가 어디까지 갔는지는
// 여기서 보입니다 - 두 화면을 열어 놓고 이름을 대조하던 일을 없애기 위해서입니다.

export default async function ApparelPage() {
  const me = await getCurrentAppUser();
  if (!me) redirect("/login");
  if (!isStaffOrAboveUser(me)) redirect("/home");

  const supabase = await createClient();
  const [orderRes, sizeRes, stuRes, termRes, groupRes, memberRes] = await Promise.all([
    supabase.from("apparel_orders").select("*").eq("is_demo", isDemoAccount(me.email)).order("created_at", { ascending: false }),
    supabase.from("student_apparel_sizes").select("*"),
    supabase
      .from("wr_students_basic")
      .select("id, name, name_en, grade, class_name, department")
      .eq("is_demo", isDemoAccount(me.email))
      .eq("status", "active")
      .order("name"),
    supabase.from("terms").select("*").order("status").order("start_date", { ascending: false, nullsFirst: false }),
    // 그룹으로 명단을 한꺼번에 채우기 위한 것. 동아리 티셔츠는 그 동아리 전원입니다.
    supabase.from("student_groups").select("*").eq("is_demo", isDemoAccount(me.email)).order("name"),
    supabase.from("student_group_members").select("group_id, student_id"),
  ]);

  // 표가 아직 없어도(마이그레이션 전) 화면은 열려야 합니다.
  if (orderRes.error) console.error("[의류] 제작 건을 읽지 못했습니다:", orderRes.error.message);
  if (sizeRes.error) console.error("[의류] 사이즈를 읽지 못했습니다:", sizeRes.error.message);

  const orders = (orderRes.data as ApparelOrder[] | null) ?? [];
  // 첫 화면에 필요한 만큼만. 제작 건마다 명단을 다 읽으면 학기가 쌓일수록 무거워집니다.
  const ids = orders.slice(0, 12).map((o) => o.id);
  const [pieceRes, itemRes, exRes] =
    ids.length > 0
      ? await Promise.all([
          supabase.from("apparel_order_pieces").select("*").in("order_id", ids).order("sort_order"),
          supabase.from("apparel_order_items").select("*").in("order_id", ids),
          supabase.from("apparel_exchanges").select("*").order("created_at", { ascending: false }).limit(300),
        ])
      : [{ data: [], error: null }, { data: [], error: null }, { data: [], error: null }];
  if (pieceRes.error) console.error("[의류] 구성 품목을 읽지 못했습니다:", pieceRes.error.message);
  if (itemRes.error) console.error("[의류] 제작 명단을 읽지 못했습니다:", itemRes.error.message);
  if (exRes.error) console.error("[의류] 교환 신청을 읽지 못했습니다:", exRes.error.message);

  // 재고는 원장을 더한 것(뷰)만 읽습니다. 더하는 규칙이 화면마다 다르면 숫자가 갈립니다.
  const pieceIds = ((pieceRes.data as { id: string }[] | null) ?? []).map((p) => p.id);
  const stockRes = pieceIds.length > 0 ? await supabase.from("apparel_stock_balance").select("*").in("piece_id", pieceIds) : { data: [], error: null };
  if (stockRes.error) console.error("[의류] 재고를 읽지 못했습니다:", stockRes.error.message);

  const students = ((stuRes.data as { id: string; name: string; name_en: string | null; grade: string | null; class_name: string | null; department: string | null }[] | null) ?? [])
    .map<ApparelStudent>((s) => ({ id: s.id, name: s.name, grade: s.grade, className: s.class_name, department: s.department }))
    .sort((a, b) => gradeSortKey(a.grade ?? "") - gradeSortKey(b.grade ?? "") || (a.className ?? "").localeCompare(b.className ?? "", "ko") || a.name.localeCompare(b.name, "ko"));

  // ── 납부 항목과 청구 상태 (재무 권한이 있을 때만) ─────────────────────────
  //
  // fee_items · invoices 는 재무 권한 뒤에 잠겨 있습니다(RLS). 권한이 없으면 읽어도 비어 오므로
  // 아예 묻지 않습니다 - 빈 결과를 「청구된 것이 없다」로 읽으면 안 됩니다.
  const canSeeFinance = hasFinanceAccess(me);
  let feeItems: { id: string; code: string | null; name: string; name_ko: string | null; unit_price: number }[] = [];
  const billing: Record<string, ApparelBilling> = {};
  if (canSeeFinance) {
    const { data: feeRows, error: feeErr } = await supabase
      .from("fee_items")
      .select("id, code, name, name_ko, unit_price, category, active")
      .eq("active", true)
      .order("category")
      .order("sort_order");
    if (feeErr) console.error("[의류] 납부 항목을 읽지 못했습니다:", feeErr.message);
    feeItems = ((feeRows as { id: string; code: string | null; name: string; name_ko: string | null; unit_price: number; category: string }[] | null) ?? [])
      // 학비는 제작 건에 달 일이 없습니다. 목록이 길어지면 교복 항목이 묻힙니다.
      .filter((f) => f.category !== "학비")
      .map((f) => ({ id: f.id, code: f.code, name: f.name, name_ko: f.name_ko, unit_price: Number(f.unit_price) }));

    const linkedItemIds = [...new Set(orders.map((o) => o.fee_item_id).filter(Boolean))] as string[];
    if (linkedItemIds.length > 0) {
      const { data: lineRows, error: lineErr } = await supabase
        .from("invoice_lines")
        .select("item_id, invoice:invoices!inner(id, invoice_no, student_id, status, total_amount)")
        .in("item_id", linkedItemIds)
        .neq("invoice.status", "취소");
      if (lineErr) console.error("[의류] 청구 줄을 읽지 못했습니다:", lineErr.message);
      type LineRow = { item_id: string; invoice: { id: string; invoice_no: string; student_id: string | null; status: string; total_amount: number | string } };
      const lines = ((lineRows as unknown as LineRow[] | null) ?? []).filter((l) => l.invoice?.student_id);
      const invIds = [...new Set(lines.map((l) => l.invoice.id))];
      const paidBy = new Map<string, number>();
      if (invIds.length > 0) {
        const { data: payRows } = await supabase.from("payments").select("invoice_id, amount").in("invoice_id", invIds);
        for (const p of ((payRows as { invoice_id: string | null; amount: number | string }[] | null) ?? [])) {
          if (p.invoice_id) paidBy.set(p.invoice_id, (paidBy.get(p.invoice_id) ?? 0) + Math.round(Number(p.amount)));
        }
      }
      for (const l of lines) {
        const key = `${l.item_id}|${l.invoice.student_id}`;
        const paid = (paidBy.get(l.invoice.id) ?? 0) >= Math.round(Number(l.invoice.total_amount));
        const prev = billing[key];
        // 한 아이에게 같은 항목 청구서가 둘이면(재청구) 수납된 쪽을 우선합니다.
        if (!prev || (paid && !prev.paid)) billing[key] = { invoiceNo: l.invoice.invoice_no, paid };
      }
    }
  }

  const groupMembers: Record<string, string[]> = {};
  for (const m of ((memberRes.data as { group_id: string; student_id: string }[] | null) ?? [])) {
    (groupMembers[m.group_id] ??= []).push(m.student_id);
  }

  return (
    <ApparelClient
      initialOrders={orders}
      initialPieces={(pieceRes.data as ApparelOrderPiece[] | null) ?? []}
      initialItems={(itemRes.data as ApparelOrderItem[] | null) ?? []}
      initialStock={(stockRes.data as ApparelStock[] | null) ?? []}
      initialExchanges={(exRes.data as ApparelExchange[] | null) ?? []}
      initialSizes={(sizeRes.data as StudentApparelSize[] | null) ?? []}
      students={students}
      terms={(termRes.data as Term[] | null) ?? []}
      groups={(groupRes.data as StudentGroup[] | null) ?? []}
      groupMembers={groupMembers}
      currentUserEmail={me.email}
      isDemo={isDemoAccount(me.email)}
      canSeeFinance={canSeeFinance}
      feeItems={feeItems}
      billing={billing}
    />
  );
}
