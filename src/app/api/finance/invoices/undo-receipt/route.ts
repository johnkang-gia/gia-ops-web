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

  /**
   * **항목 하나만 되돌리기.** 「교복 세트를 받았다」고 적었는데 알고 보니 안 받은 경우입니다.
   *
   * 한 번의 기록에 항목이 여럿 들어갈 수 있어서(교복 + 교재를 같은 날 받음), 장을 통째로
   * 지우면 멀쩡한 기록까지 사라집니다. 그래서 **그 줄만 빼고 입금도 그만큼 줄입니다.**
   * 줄이 하나도 안 남으면 그때 장을 지웁니다.
   */
  const one = body?.item as { invoiceId?: unknown; itemId?: unknown; name?: unknown } | undefined;
  if (typeof one?.invoiceId === "string" && one.invoiceId) {
    return undoOneItem(await createClient(), one.invoiceId, typeof one.itemId === "string" ? one.itemId : null, typeof one.name === "string" ? one.name : null);
  }

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

/**
 * 장 하나에서 **항목 한 줄만** 빼고, 그만큼 입금을 줄입니다.
 *
 * 순서가 중요합니다 — 줄을 먼저 지우면 합계 트리거가 장의 총액을 다시 세고, 그 다음 입금을
 * 맞춥니다. 반대로 하면 잠깐 「입금이 총액보다 적은」 상태가 되는데, 그 사이에 화면을 본
 * 사람에게는 미납으로 보입니다.
 */
async function undoOneItem(
  supabase: Awaited<ReturnType<typeof createClient>>,
  invoiceId: string,
  itemId: string | null,
  name: string | null,
) {
  const { data: inv, error: invErr } = await supabase
    .from("invoices")
    .select("id, invoice_no, status, issued_offline, exported_at, carried_to_invoice_id")
    .eq("id", invoiceId)
    .maybeSingle();
  if (invErr) return NextResponse.json({ error: `기록을 읽지 못했습니다: ${invErr.message}` }, { status: 500 });
  if (!inv) return NextResponse.json({ error: "그 기록을 찾지 못했습니다." }, { status: 404 });

  const v = inv as Row;
  const who = v.invoice_no ?? invoiceId.slice(0, 8);
  if (v.issued_offline !== true)
    return NextResponse.json({ error: `${who} — 「이미 받음」으로 적은 장이 아니라 실제로 나간 청구서입니다. 취소로 다뤄주세요.` }, { status: 400 });
  if (v.exported_at) return NextResponse.json({ error: `${who} — 올톡페이로 이미 내보냈습니다.` }, { status: 400 });
  if (v.carried_to_invoice_id) return NextResponse.json({ error: `${who} — 이월과 엮여 있습니다.` }, { status: 400 });

  const { data: lines, error: lineErr } = await supabase
    .from("invoice_lines")
    .select("id, name, item_id, amount")
    .eq("invoice_id", invoiceId);
  if (lineErr) return NextResponse.json({ error: `내역을 읽지 못했습니다: ${lineErr.message}` }, { status: 500 });

  const all = ((lines as { id: string; name: string; item_id: string | null; amount: number | string }[] | null) ?? []);
  // **번호로 먼저 고릅니다.** 이름이 같은 항목이 넷 있어서(학년별 중국어 교재) 이름으로
  // 고르면 엉뚱한 줄이 빠집니다.
  const hit = itemId ? all.filter((l) => l.item_id === itemId) : all.filter((l) => l.name === name);
  if (hit.length === 0)
    return NextResponse.json({ error: `${who} 에서 그 항목을 찾지 못했습니다. 화면을 새로 고쳐 다시 시도해주세요.` }, { status: 404 });

  const back = hit.reduce((n, l) => n + Number(l.amount), 0);
  const rest = all.length - hit.length;

  // 줄이 하나도 안 남으면 장 자체를 지웁니다. 빈 장은 「내역이 없는 청구서」로 남습니다.
  if (rest === 0) {
    const { error: pErr } = await supabase.from("payments").delete().eq("invoice_id", invoiceId);
    if (pErr) return NextResponse.json({ error: `입금을 지우지 못했습니다: ${pErr.message}` }, { status: 500 });
    const { error: lErr } = await supabase.from("invoice_lines").delete().eq("invoice_id", invoiceId);
    if (lErr) return NextResponse.json({ error: `내역을 지우지 못했습니다: ${lErr.message}` }, { status: 500 });
    const { error: dErr } = await supabase.from("invoices").delete().eq("id", invoiceId);
    if (dErr) return NextResponse.json({ error: `기록을 지우지 못했습니다: ${dErr.message}` }, { status: 500 });
    return NextResponse.json({ ok: true, undone: 1, amount: back, removedInvoice: true, blocked: [] });
  }

  const { error: rmErr } = await supabase.from("invoice_lines").delete().in("id", hit.map((l) => l.id));
  if (rmErr) return NextResponse.json({ error: `내역을 지우지 못했습니다: ${rmErr.message}` }, { status: 500 });

  /**
   * **입금도 그만큼 줄입니다.** 안 줄이면 받은 적 없는 돈이 장부에 남고, 그 장은 과납으로
   * 보입니다 - 과납은 다음 달에 돌려줄 돈으로 읽혀서 더 큰 사고가 됩니다.
   */
  const { data: pays } = await supabase
    .from("payments")
    .select("id, amount, paid_at")
    .eq("invoice_id", invoiceId)
    .order("paid_at", { ascending: false });
  let left = back;
  for (const p of ((pays as { id: string; amount: number | string }[] | null) ?? [])) {
    if (left <= 0) break;
    const cur = Number(p.amount);
    const next = Math.max(0, cur - left);
    left -= cur - next;
    const { error } =
      next === 0
        ? await supabase.from("payments").delete().eq("id", p.id)
        : await supabase.from("payments").update({ amount: next }).eq("id", p.id);
    if (error) return NextResponse.json({ error: `입금을 고치지 못했습니다: ${error.message}` }, { status: 500 });
  }

  return NextResponse.json({ ok: true, undone: 1, amount: back, removedInvoice: false, blocked: [] });
}
