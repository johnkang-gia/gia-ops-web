import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import { hasFinanceAccess } from "@/lib/roles";

/**
 * **청구서 발행 취소 되돌리기.**
 *
 * 잘못 누른 취소를 바로잡을 길이 없으면 청구서를 다시 발행해야 하고, 그러면 새 번호가 붙어 학부모가
 * 받은 번호와 어긋납니다. 그래서 **같은 장을 그대로 살립니다.**
 *
 * 취소는 그 장의 수납을 함께 지우므로(`/cancel`) 수납은 돌아오지 않습니다 - 받은 돈이면 다시 적습니다.
 * 예전 판의 취소가 예치금으로 떼어낸 돈은 `detached_from_invoice_id` 로 찾아 다시 붙입니다. 이름이나
 * 금액으로 짐작하지 않습니다 - 같은 금액의 다른 예치금을 붙이면 장부가 조용히 틀립니다.
 *
 * 되돌리지 않는 경우
 *   · 「직접수납」 장 — 취소할 때 함께 만든 입금을 지웠습니다. 살리면 받은 돈 없는 장이 됩니다
 *   · 그 사이 같은 항목을 다시 청구한 장이 있을 때 — 살리면 같은 항목이 두 장에 나갑니다(§2-21)
 *   · 떼어낸 돈을 그 사이 다른 청구서에 썼을 때 — 그 돈은 이미 다른 곳에 있습니다. 장만 살리고 알립니다
 */

export const dynamic = "force-dynamic";

type Inv = {
  id: string;
  invoice_no: string;
  student_id: string | null;
  status: string;
  issued_offline: boolean | null;
  billing_month: string | null;
  issue_date: string | null;
  term_id: string | null;
  allow_duplicate: boolean | null;
};
type Line = { invoice_id: string; plan_id: string | null; item_id: string | null; carried_from_invoice_id: string | null; is_adjustment: boolean | null };

const monthOf = (v: { billing_month: string | null; issue_date: string | null }) => (v.billing_month || (v.issue_date ?? "").slice(0, 7));

export async function POST(req: Request) {
  const me = await getCurrentAppUser();
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!hasFinanceAccess(me)) return NextResponse.json({ error: "재무 권한이 필요합니다." }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const id = typeof body?.invoiceId === "string" ? body.invoiceId : "";
  if (!id) return NextResponse.json({ error: "invoiceId가 필요합니다." }, { status: 400 });

  const supabase = await createClient();
  const cols = "id, invoice_no, student_id, status, issued_offline, billing_month, issue_date, term_id, allow_duplicate";
  const { data: invRow, error: invErr } = await supabase.from("invoices").select(cols).eq("id", id).maybeSingle();
  if (invErr) return NextResponse.json({ error: `청구서를 읽지 못했습니다: ${invErr.message}` }, { status: 500 });
  const inv = invRow as Inv | null;
  if (!inv) return NextResponse.json({ error: "청구서를 찾지 못했습니다." }, { status: 404 });
  if (inv.status !== "취소") return NextResponse.json({ error: "취소된 청구서가 아닙니다." }, { status: 400 });
  if (inv.issued_offline) {
    return NextResponse.json(
      { error: `${inv.invoice_no} 은(는) 「직접수납」 기록입니다. 취소할 때 함께 적은 입금을 지웠으므로, 수납 창에서 다시 적어주세요.` },
      { status: 400 },
    );
  }

  // ── 같은 항목이 다른 살아 있는 장에 이미 있는가 ──────────────────────────
  // 데이터베이스 문지기(guard_invoice_line_duplicate)는 줄을 «넣을 때»만 봅니다. 상태를 되살리는
  // 것은 그 문을 지나지 않으므로, 같은 규칙으로 여기서 먼저 봅니다.
  if (inv.student_id && !inv.allow_duplicate) {
    const { data: mine, error: lErr } = await supabase
      .from("invoice_lines")
      .select("invoice_id, plan_id, item_id, carried_from_invoice_id, is_adjustment")
      .eq("invoice_id", id);
    if (lErr) return NextResponse.json({ error: `청구 항목을 읽지 못해 되돌리지 않았습니다: ${lErr.message}` }, { status: 500 });
    const keyLines = ((mine as Line[] | null) ?? []).filter((l) => !l.carried_from_invoice_id && !l.is_adjustment && (l.plan_id || l.item_id));
    if (keyLines.length > 0) {
      const { data: others, error: oErr } = await supabase
        .from("invoices")
        .select(cols)
        .eq("student_id", inv.student_id)
        .eq("status", "발행")
        .is("carried_to_invoice_id", null)
        .neq("id", id);
      if (oErr) return NextResponse.json({ error: `다른 청구서를 읽지 못해 되돌리지 않았습니다: ${oErr.message}` }, { status: 500 });
      const alive = (others as Inv[] | null) ?? [];
      if (alive.length > 0) {
        const { data: oLines, error: olErr } = await supabase
          .from("invoice_lines")
          .select("invoice_id, plan_id, item_id, carried_from_invoice_id, is_adjustment")
          .in("invoice_id", alive.map((v) => v.id));
        if (olErr) return NextResponse.json({ error: `다른 청구서 항목을 읽지 못해 되돌리지 않았습니다: ${olErr.message}` }, { status: 500 });
        const byId = new Map(alive.map((v) => [v.id, v]));
        const hit = ((oLines as Line[] | null) ?? []).find((o) => {
          if (o.carried_from_invoice_id || o.is_adjustment) return false;
          const other = byId.get(o.invoice_id);
          if (!other) return false;
          return keyLines.some(
            (k) =>
              (k.plan_id && o.plan_id === k.plan_id && monthOf(other) === monthOf(inv)) ||
              (k.item_id && o.item_id === k.item_id && !other.allow_duplicate && (!inv.term_id || !other.term_id || other.term_id === inv.term_id)),
          );
        });
        if (hit) {
          return NextResponse.json(
            { error: `같은 항목이 청구서 ${byId.get(hit.invoice_id)?.invoice_no ?? ""} 에 이미 있어 되돌리지 않았습니다. 그 장을 쓰거나, 그 장을 취소한 뒤 되돌려주세요.` },
            { status: 409 },
          );
        }
      }
    }
  }

  const { data: detached, error: dErr } = await supabase
    .from("payments")
    .select("id, amount, invoice_id")
    .eq("detached_from_invoice_id", id);
  if (dErr) return NextResponse.json({ error: `떼어낸 입금을 읽지 못해 되돌리지 않았습니다: ${dErr.message}` }, { status: 500 });
  const rows = (detached as { id: string; amount: number | string; invoice_id: string | null }[] | null) ?? [];
  const free = rows.filter((p) => !p.invoice_id);
  const usedElsewhere = rows.filter((p) => p.invoice_id && p.invoice_id !== id);

  // 장부터 살립니다. 돈을 먼저 붙이고 장을 못 살리면, 취소된 장에 돈이 매달려 화면 어디에도 안 보입니다.
  const { error: upErr, data: up } = await supabase
    .from("invoices")
    .update({ status: "발행", cancelled_at: null, cancelled_by: null, cancel_reason: null })
    .eq("id", id)
    .eq("status", "취소")
    .select("id");
  if (upErr) return NextResponse.json({ error: `청구서를 되살리지 못했습니다: ${upErr.message}` }, { status: 500 });
  if (!up || up.length === 0) return NextResponse.json({ error: "그 사이 상태가 바뀌었습니다. 창을 새로 열어 확인해주세요." }, { status: 409 });

  let reattached = 0;
  if (free.length > 0) {
    const { data: got, error: pErr } = await supabase
      .from("payments")
      .update({ invoice_id: id, matched_by: "취소 되돌림", detached_from_invoice_id: null })
      .in("id", free.map((p) => p.id))
      .is("invoice_id", null)
      .select("id, amount");
    if (pErr) {
      return NextResponse.json(
        { error: `청구서는 되살렸지만 받은 돈을 다시 붙이지 못했습니다(${pErr.message}). 예치금에 남아 있으니 예치금 단추로 붙여주세요.` },
        { status: 500 },
      );
    }
    reattached = ((got as { amount: number | string }[] | null) ?? []).reduce((n, p) => n + Number(p.amount), 0);
  }

  const usedAmount = usedElsewhere.reduce((n, p) => n + Number(p.amount), 0);
  return NextResponse.json({
    ok: true,
    invoiceNo: inv.invoice_no,
    reattached,
    note:
      usedAmount > 0
        ? `떼어낸 돈 중 ${usedAmount.toLocaleString("ko-KR")}원은 그 사이 다른 청구서에 쓰여 다시 붙이지 않았습니다. 이 장은 그만큼 미수로 남습니다.`
        : null,
  });
}
