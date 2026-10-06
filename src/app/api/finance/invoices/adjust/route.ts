import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import { hasFinanceAccess } from "@/lib/roles";

export const dynamic = "force-dynamic";

/**
 * **보낸 청구서를 정정합니다** — 원래 줄은 그대로 두고 차액 줄을 더합니다.
 *
 * 학부모에게 보내기 전이면 취소하고 다시 발행하는 편이 깔끔합니다 - 종이에 정정 줄이 남지
 * 않습니다. 그래서 이 창구는 **보낸 청구서만** 받습니다(`exported_at`).
 *
 * 보낸 뒤에 취소·재발행하면 번호가 바뀝니다. 학부모 손에 있는 종이는 옛 번호를 말하고 장부는
 * 새 번호를 말해서, 「이 돈이 그 돈인가」를 서로 확인할 수 없습니다. 정정 줄은 번호를 그대로
 * 두고 무엇이 왜 바뀌었는지를 그 장 안에 남깁니다.
 *
 * 합계는 트리거가 다시 셉니다(`invoice_lines` → `invoices.total_amount`, 내력은
 * `invoice_amount_log`). 마감된 달이면 데이터베이스가 막고, 그 말을 그대로 전합니다.
 */
type Change = { lineId?: string | null; name?: string; amount?: number };

export async function POST(req: Request) {
  const me = await getCurrentAppUser();
  if (!me) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  if (!hasFinanceAccess(me)) return NextResponse.json({ error: "재무 권한이 필요합니다." }, { status: 403 });

  const b = (await req.json().catch(() => null)) as { invoiceId?: string; reason?: string; changes?: Change[] } | null;
  const reason = String(b?.reason ?? "").trim();
  if (!b?.invoiceId) return NextResponse.json({ error: "청구서를 골라주세요." }, { status: 400 });
  // 이유 없는 정정은 몇 달 뒤 아무도 설명하지 못합니다. 데이터베이스도 같은 검사를 겁니다.
  if (!reason) return NextResponse.json({ error: "정정 사유를 적어주세요." }, { status: 400 });
  const changes = (b.changes ?? []).filter((c) => Number.isFinite(Number(c.amount)) && Math.round(Number(c.amount)) !== 0);
  if (changes.length === 0) return NextResponse.json({ error: "바뀌는 금액이 없습니다." }, { status: 400 });

  const supabase = await createClient();
  const { data: inv, error: invErr } = await supabase
    .from("invoices")
    .select("id, invoice_no, status, exported_at, carried_to_invoice_id, total_amount")
    .eq("id", b.invoiceId)
    .maybeSingle();
  if (invErr) return NextResponse.json({ error: invErr.message }, { status: 500 });
  if (!inv) return NextResponse.json({ error: "청구서를 찾지 못했습니다." }, { status: 404 });
  if (inv.status === "취소") return NextResponse.json({ error: "취소된 청구서입니다." }, { status: 400 });
  if (inv.carried_to_invoice_id) return NextResponse.json({ error: "다른 청구서로 이월된 장입니다. 이월받은 청구서에서 정정해주세요." }, { status: 400 });
  if (!inv.exported_at) {
    return NextResponse.json(
      { error: "아직 학부모에게 보내지 않은 청구서입니다. ↩ 취소 후 다시 발행하는 편이 깔끔합니다 - 종이에 정정 줄이 남지 않습니다." },
      { status: 400 },
    );
  }

  const { data: lines, error: lErr } = await supabase
    .from("invoice_lines")
    .select("id, seq, name, amount, item_id, plan_id, revenue_account_id")
    .eq("invoice_id", inv.id)
    .order("seq");
  if (lErr) return NextResponse.json({ error: lErr.message }, { status: 500 });
  type L = { id: string; seq: number; name: string; amount: number | string; item_id: string | null; plan_id: string | null; revenue_account_id: string | null };
  const byId = new Map(((lines ?? []) as L[]).map((l) => [l.id, l]));
  let seq = Math.max(0, ...((lines ?? []) as L[]).map((l) => l.seq));

  const delta = changes.reduce((n, c) => n + Math.round(Number(c.amount)), 0);
  const after = Math.round(Number(inv.total_amount)) + delta;
  if (after < 0) return NextResponse.json({ error: "정정 뒤 합계가 0원보다 작아집니다." }, { status: 400 });

  const now = new Date().toISOString();
  const rows = [];
  for (const c of changes) {
    const amount = Math.round(Number(c.amount));
    const target = c.lineId ? byId.get(c.lineId) : undefined;
    if (c.lineId && !target) return NextResponse.json({ error: "고치려는 줄을 찾지 못했습니다. 화면을 다시 열어주세요." }, { status: 400 });
    const label = target ? target.name.replace(/^[\s　└]+/, "").trim() : String(c.name ?? "").trim();
    if (!label) return NextResponse.json({ error: "새 줄의 이름을 적어주세요." }, { status: 400 });
    rows.push({
      invoice_id: inv.id,
      seq: ++seq,
      name: `정정 · ${label}`,
      qty: 1,
      unit_price: amount,
      amount,
      is_adjustment: true,
      adjust_reason: reason,
      adjusted_by: me.email,
      adjusted_at: now,
      // 고친 줄과 같은 과목으로 셉니다. 비워두면 과목별 수입현황에서 정정분만 「미분류」로 떨어집니다.
      item_id: target?.item_id ?? null,
      plan_id: target?.plan_id ?? null,
      revenue_account_id: target?.revenue_account_id ?? null,
    });
  }

  const { error: insErr } = await supabase.from("invoice_lines").insert(rows);
  if (insErr) return NextResponse.json({ error: insErr.message }, { status: 400 });

  const { data: fresh } = await supabase.from("invoices").select("total_amount").eq("id", inv.id).maybeSingle();
  return NextResponse.json({ ok: true, before: Number(inv.total_amount), after: Number(fresh?.total_amount ?? after), invoiceNo: inv.invoice_no });
}
