import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import { hasFinanceAccess } from "@/lib/roles";
import { billingMonthOf } from "@/lib/financePeriod";

export const dynamic = "force-dynamic";

/**
 * **청구월 옮기기** — 금액·번호는 그대로 두고 «몇 월분인가»만 바꿉니다.
 *
 * 재무 화면의 달이 다음 달에 머문 채 발행하면 10월에 낸 청구서가 11월분으로 찍힙니다. 그러면 11월 칸이
 * «청구됨»으로 잠겨 11월 청구를 못 합니다. 취소 후 재발행은 번호가 바뀌어 학부모가 받은 문자와 어긋나므로
 * 청구월만 옮깁니다.
 *
 * 옮길 달에 **같은 학비 항목이 담긴 살아 있는 장**이 이미 있으면 옮기지 않습니다 - 한 달에 같은 항목 두 장은
 * 중복 청구입니다(§2-21 과 같은 기준). 내력을 먼저 남기고 옮깁니다.
 */
export async function POST(req: Request) {
  const me = await getCurrentAppUser();
  if (!me) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  if (!hasFinanceAccess(me)) return NextResponse.json({ error: "재무 권한이 필요합니다." }, { status: 403 });

  const b = (await req.json().catch(() => null)) as { invoiceIds?: string[]; month?: string; reason?: string } | null;
  const ids = [...new Set((b?.invoiceIds ?? []).filter(Boolean))];
  const month = String(b?.month ?? "");
  const reason = String(b?.reason ?? "").trim() || "청구월 옮김";
  if (ids.length === 0) return NextResponse.json({ error: "옮길 청구서를 골라주세요." }, { status: 400 });
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return NextResponse.json({ error: "옮길 달은 2026-10 처럼 적어주세요." }, { status: 400 });

  const supabase = await createClient();
  const { data: invs, error: iErr } = await supabase
    .from("invoices")
    .select("id, invoice_no, student_id, billing_month, issue_date, status, stream, carried_to_invoice_id")
    .in("id", ids);
  if (iErr) return NextResponse.json({ error: iErr.message }, { status: 500 });
  const list = (invs ?? []) as {
    id: string;
    invoice_no: string;
    student_id: string;
    billing_month: string | null;
    issue_date: string;
    status: string;
    stream: string | null;
    carried_to_invoice_id: string | null;
  }[];

  // 옮길 달에 이미 있는 같은 학생의 살아 있는 장과 그 줄의 항목 번호.
  const studentIds = [...new Set(list.map((v) => v.student_id))];
  const { data: others, error: oErr } = await supabase
    .from("invoices")
    .select("id, student_id, status, carried_to_invoice_id")
    .in("student_id", studentIds)
    .eq("billing_month", month)
    .eq("status", "발행");
  if (oErr) return NextResponse.json({ error: oErr.message }, { status: 500 });
  const otherAlive = ((others ?? []) as { id: string; student_id: string; carried_to_invoice_id: string | null }[]).filter(
    (v) => !v.carried_to_invoice_id && !ids.includes(v.id),
  );
  const allIds = [...new Set([...ids, ...otherAlive.map((v) => v.id)])];
  const { data: lines, error: lErr } = allIds.length
    ? await supabase.from("invoice_lines").select("invoice_id, plan_id").in("invoice_id", allIds).not("plan_id", "is", null)
    : { data: [], error: null };
  if (lErr) return NextResponse.json({ error: lErr.message }, { status: 500 });
  const plansOf = new Map<string, Set<string>>();
  for (const l of (lines ?? []) as { invoice_id: string; plan_id: string }[]) {
    const s = plansOf.get(l.invoice_id) ?? new Set<string>();
    s.add(l.plan_id);
    plansOf.set(l.invoice_id, s);
  }

  const skipped: string[] = [];
  const moving: typeof list = [];
  for (const v of list) {
    if (v.status !== "발행") {
      skipped.push(`${v.invoice_no}(살아 있는 장이 아님)`);
      continue;
    }
    if (billingMonthOf(v) === month) continue;
    const mine = plansOf.get(v.id) ?? new Set<string>();
    const clash = otherAlive.find((o) => o.student_id === v.student_id && [...(plansOf.get(o.id) ?? [])].some((p) => mine.has(p)));
    if (clash) {
      skipped.push(`${v.invoice_no}(${month}에 같은 항목 청구서가 이미 있음)`);
      continue;
    }
    moving.push(v);
  }
  if (moving.length === 0) return NextResponse.json({ ok: true, moved: 0, skipped });

  const { error: logErr } = await supabase.from("invoice_billing_month_log").insert(
    moving.map((v) => ({ invoice_id: v.id, from_month: billingMonthOf(v), to_month: month, reason, changed_by: me.email })),
  );
  if (logErr) return NextResponse.json({ error: `내력을 남기지 못해 옮기지 않았습니다: ${logErr.message}` }, { status: 500 });

  const { error: upErr } = await supabase.from("invoices").update({ billing_month: month }).in("id", moving.map((v) => v.id));
  if (upErr) return NextResponse.json({ error: `내력은 남았지만 옮기지 못했습니다: ${upErr.message}` }, { status: 500 });
  return NextResponse.json({ ok: true, moved: moving.length, skipped });
}
