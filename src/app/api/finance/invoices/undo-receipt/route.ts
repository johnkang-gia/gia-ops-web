import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import { hasFinanceAccess } from "@/lib/roles";

/**
 * **「이미 받음」 기록 되돌리기** — 적어둔 것을 적기 전으로 돌립니다.
 *
 * ── 왜 취소가 아니라 지우기인가 ─────────────────────────────────────────────
 *
 * 청구서는 **지우지 않고 취소로 남깁니다**(`/cancel`). 학부모가 이미 받은 종이가 있고, 번호가
 * 비면 「그 청구서 어디 갔냐」에 답할 수 없기 때문입니다.
 *
 * 「이미 받음」으로 만든 장은 다릅니다. 이것은 **밖으로 나간 적이 없는 우리 쪽 기록**입니다 -
 * 이미 받은 돈을 장부에 남기려고 만든 짝(장 + 입금)이고, 청구서 목록·발행·올톡페이 발송
 * 명단 어디에도 안 뜹니다(`issued_offline`). 금액이나 날짜를 잘못 적었을 때 취소로 남기면
 * 취소된 장이 쌓이기만 하고, 그 장은 처음부터 아무도 못 본 것입니다.
 *
 * 그래서 **적기 전으로 되돌립니다.**
 *
 * ── 지우면 안 되는 것 ───────────────────────────────────────────────────────
 *
 * 밖에 자국이 남은 장은 되돌리지 않습니다. 되돌려도 그 자국은 안 사라지고, 그러면 장부와
 * 밖이 어긋납니다.
 *
 *   · `issued_offline` 이 아닌 장 — 진짜 청구서입니다. 취소로만 다룹니다
 *   · 현금영수증이 붙은 장 — 국세청에 이미 갔습니다
 *   · 올톡페이로 내보낸 장 — 학부모에게 갔습니다
 *   · 다음 장으로 이월된 장 — 그 돈이 다른 장에 살아 있습니다
 *
 * 막을 때는 **왜 막혔는지**를 말합니다(§5). 「되돌릴 수 없습니다」만 뜨면 담당자는 화면을
 * 뒤지다 결국 포기합니다.
 */

export const dynamic = "force-dynamic";

type Row = {
  id: string;
  invoice_no: string | null;
  status: string | null;
  issued_offline: boolean | null;
  exported_at: string | null;
  carried_to_invoice_id: string | null;
  total_amount: number | string;
  issue_date: string | null;
};

export async function POST(req: Request) {
  const me = await getCurrentAppUser();
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!hasFinanceAccess(me)) return NextResponse.json({ error: "재무 권한이 필요합니다." }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const ids = Array.isArray(body?.invoiceIds)
    ? (body.invoiceIds as unknown[]).filter((x): x is string => typeof x === "string" && x.length > 0)
    : [];
  if (ids.length === 0) return NextResponse.json({ error: "되돌릴 기록을 골라주세요." }, { status: 400 });

  const supabase = await createClient();

  const { data, error } = await supabase
    .from("invoices")
    .select("id, invoice_no, status, issued_offline, exported_at, carried_to_invoice_id, total_amount, issue_date")
    .in("id", ids);
  if (error) return NextResponse.json({ error: `기록을 읽지 못했습니다: ${error.message}` }, { status: 500 });

  const rows = (data as Row[] | null) ?? [];
  if (rows.length === 0) return NextResponse.json({ error: "그 기록을 찾지 못했습니다." }, { status: 404 });

  // 현금영수증이 붙었는지. 붙었으면 국세청에 이미 갔으므로 우리 쪽만 지울 수 없습니다.
  const { data: receipts } = await supabase.from("cash_receipts").select("invoice_id").in("invoice_id", ids);
  const hasReceipt = new Set(((receipts as { invoice_id: string | null }[] | null) ?? []).map((r) => r.invoice_id));

  // 이 장을 이월 받은 다음 장이 있는지. 있으면 그 돈이 다른 장에 살아 있습니다.
  const { data: carried } = await supabase.from("invoices").select("id, carried_from_invoice_id").in("carried_from_invoice_id", ids);
  const carriedFrom = new Set(
    ((carried as { carried_from_invoice_id: string | null }[] | null) ?? []).map((r) => r.carried_from_invoice_id),
  );

  const blocked: string[] = [];
  const ok: Row[] = [];
  for (const v of rows) {
    const who = v.invoice_no ?? v.id.slice(0, 8);
    if (v.issued_offline !== true) {
      blocked.push(`${who} — 「이미 받음」으로 적은 장이 아니라 실제로 나간 청구서입니다. 취소로 다뤄주세요`);
    } else if (v.exported_at) {
      blocked.push(`${who} — 올톡페이로 이미 내보냈습니다`);
    } else if (hasReceipt.has(v.id)) {
      blocked.push(`${who} — 현금영수증이 붙어 있습니다`);
    } else if (v.carried_to_invoice_id || carriedFrom.has(v.id)) {
      blocked.push(`${who} — 이월과 엮여 있습니다`);
    } else {
      ok.push(v);
    }
  }

  if (ok.length === 0) {
    return NextResponse.json({ error: `되돌릴 수 있는 기록이 없습니다.\n${blocked.join("\n")}` }, { status: 400 });
  }

  const okIds = ok.map((v) => v.id);

  /**
   * **붙어 있는 것부터 지웁니다.** 장을 먼저 지우면 입금·줄이 주인 없이 남거나, 외래키가
   * 막아 절반만 지워집니다. 절반만 지워진 상태는 원래도 되돌린 것도 아닙니다(§2-7).
   */
  const { error: payErr } = await supabase.from("payments").delete().in("invoice_id", okIds);
  if (payErr) return NextResponse.json({ error: `입금 기록을 지우지 못했습니다: ${payErr.message}` }, { status: 500 });

  const { error: lineErr } = await supabase.from("invoice_lines").delete().in("invoice_id", okIds);
  if (lineErr) {
    // 입금은 지웠는데 줄이 남았습니다. **조용히 넘기지 않습니다** - 금액만 있고 내역이 없는
    // 장이 남으면 화면에는 정상으로 보입니다.
    return NextResponse.json(
      { error: `입금은 지웠는데 내역을 못 지웠습니다(${lineErr.message}). 청구서 ${ok.map((v) => v.invoice_no ?? v.id).join(", ")} 를 직접 확인해주세요.` },
      { status: 500 },
    );
  }

  const { error: invErr } = await supabase.from("invoices").delete().in("id", okIds);
  if (invErr) {
    return NextResponse.json(
      { error: `입금과 내역은 지웠는데 장을 못 지웠습니다(${invErr.message}). 청구서 ${ok.map((v) => v.invoice_no ?? v.id).join(", ")} 를 직접 확인해주세요.` },
      { status: 500 },
    );
  }

  const amount = ok.reduce((n, v) => n + Number(v.total_amount), 0);
  return NextResponse.json({
    ok: true,
    undone: ok.length,
    amount,
    by: me.name || me.email,
    // 막힌 것이 있으면 함께 돌려줍니다. 되돌린 것만 말하면 나머지가 왜 남았는지 모릅니다.
    blocked,
  });
}
