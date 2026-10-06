import type { SupabaseClient } from "@supabase/supabase-js";
import { hasFinanceAccess, isAdminUser } from "@/lib/roles";
import { todayKst } from "@/lib/kst";
import type { FinanceRequest } from "@/lib/types";

/**
 * **돈이 장부에서 빠지는 일은 두 사람이 합니다** — 결손 · 환불.
 *
 * 환불은 누르는 순간 장부에 들어갔고, 받지 못할 돈을 정리하는 길(결손)은 없었습니다. 둘 다
 * 한 번 하면 되돌리기 어려운 일인데 한 사람이 혼자 끝낼 수 있었습니다. 실수든 아니든, 혼자
 * 끝난 일은 나중에 「누가 확인했나」에 답이 없습니다.
 *
 * 그래서 올리는 사람과 승인하는 사람을 나눕니다.
 *
 *   · 올리기: 재무 권한이 있는 사람 누구나
 *   · 승인: 관리자 이상이면서 재무 권한이 있는 사람 — **올린 사람 본인은 안 됩니다**
 *
 * 결재선을 결손·환불에만 둡니다. 청구·수납까지 결재를 걸면 하루 수십 건이 대기에 쌓이고,
 * 쌓인 결재는 아무도 읽지 않고 누르게 됩니다 - 그러면 결재가 없는 것과 같습니다.
 *
 * 본인 승인 금지는 데이터베이스 트리거도 같이 겁니다(`guard_finance_request`). 여기서
 * 막는 것은 화면에 이유를 보여주기 위해서입니다.
 */

export type RequestKind = FinanceRequest["kind"];

type Me = { email: string; name?: string | null } & Parameters<typeof isAdminUser>[0];

const lower = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();
const won = (n: number) => `${Math.round(n).toLocaleString("ko-KR")}원`;

/** 승인·반려를 할 수 있는가. 이유를 함께 돌려줍니다 - 단추를 그냥 숨기면 왜 없는지 모릅니다. */
export function decideBlock(me: Me, req: Pick<FinanceRequest, "requested_by" | "status">): string | null {
  if (req.status !== "대기") return `이미 ${req.status}된 요청입니다.`;
  if (!hasFinanceAccess(me)) return "재무 권한이 필요합니다.";
  if (!isAdminUser(me)) return "관리자 이상만 결재합니다.";
  if (lower(me?.email) === lower(req.requested_by)) return "직접 올린 요청은 다른 사람이 결재합니다.";
  return null;
}

/** 이 청구서에서 지금 돌려줄 수 있는 돈(받은 돈 − 이미 돌려준 돈). */
async function heldOf(supabase: SupabaseClient, invoiceId: string): Promise<{ held: number; error: string | null }> {
  const { data, error } = await supabase.from("payments").select("amount").eq("invoice_id", invoiceId);
  if (error) return { held: 0, error: error.message };
  return { held: (data ?? []).reduce((n, p) => n + Number((p as { amount: number | string }).amount), 0), error: null };
}

type InvoiceHead = {
  id: string;
  invoice_no: string;
  student_id: string | null;
  student_name: string;
  student_name_ko: string | null;
  status: string;
  total_amount: number | string;
  carried_to_invoice_id: string | null;
  written_off_amount: number | string | null;
  written_off_reason: string | null;
};

async function invoiceOf(supabase: SupabaseClient, id: string): Promise<{ inv: InvoiceHead | null; error: string | null }> {
  const { data, error } = await supabase
    .from("invoices")
    .select("id, invoice_no, student_id, student_name, student_name_ko, status, total_amount, carried_to_invoice_id, written_off_amount, written_off_reason")
    .eq("id", id)
    .maybeSingle();
  if (error) return { inv: null, error: error.message };
  return { inv: (data as InvoiceHead | null) ?? null, error: data ? null : "청구서를 찾지 못했습니다." };
}

/**
 * 얼마까지 올릴 수 있나.
 *
 *   · 환불: 받은 돈까지. 넘기면 잔액이 청구액보다 커지고 그 청구서는 영영 이상하게 남습니다.
 *   · 결손: 남은 돈(청구 − 입금 − 이미 결손)까지. 더 크게 잡으면 「받을 돈」이 음수가 됩니다.
 */
export async function requestCap(
  supabase: SupabaseClient,
  kind: RequestKind,
  invoiceId: string,
): Promise<{ cap: number; inv: InvoiceHead | null; error: string | null }> {
  const { inv, error } = await invoiceOf(supabase, invoiceId);
  if (!inv) return { cap: 0, inv: null, error };
  const { held, error: pErr } = await heldOf(supabase, invoiceId);
  if (pErr) return { cap: 0, inv, error: pErr };
  if (kind === "환불") return { cap: held, inv, error: null };

  if (inv.status === "취소") return { cap: 0, inv, error: "취소된 청구서는 결손 처리할 것이 없습니다." };
  if (inv.carried_to_invoice_id) return { cap: 0, inv, error: "다른 청구서로 이월된 장입니다. 이월받은 청구서에서 처리해주세요." };
  const balance = Math.round(Number(inv.total_amount)) - held - Math.round(Number(inv.written_off_amount ?? 0));
  return { cap: Math.max(0, balance), inv, error: null };
}

/** 요청을 올립니다. 금액 상한은 올릴 때 한 번, 승인할 때 한 번 더 봅니다 - 그 사이에 돈이 들어올 수 있습니다. */
export async function createRequest(
  supabase: SupabaseClient,
  me: Me,
  input: { kind: RequestKind; invoiceId: string; amount: number; reason: string; refundedAt?: string | null; method?: string | null },
): Promise<{ request: FinanceRequest | null; error: string | null; status: number }> {
  if (!hasFinanceAccess(me)) return { request: null, error: "재무 권한이 필요합니다.", status: 403 };
  const reason = input.reason.trim();
  const amount = Math.round(Number(input.amount));
  if (!reason) return { request: null, error: `${input.kind} 사유를 적어주세요.`, status: 400 };
  if (!Number.isFinite(amount) || amount <= 0) return { request: null, error: "금액을 적어주세요.", status: 400 };

  const { cap, inv, error } = await requestCap(supabase, input.kind, input.invoiceId);
  if (error || !inv) return { request: null, error: error ?? "청구서를 찾지 못했습니다.", status: 400 };
  if (amount > cap) {
    const what = input.kind === "환불" ? "이 청구서로 받은 돈" : "이 청구서에 남은 돈";
    return { request: null, error: `${what}은 ${won(cap)}입니다. 그보다 크게 올릴 수 없습니다.`, status: 400 };
  }

  const payload =
    input.kind === "환불"
      ? {
          refundedAt: input.refundedAt && /^\d{4}-\d{2}-\d{2}$/.test(input.refundedAt) ? input.refundedAt : todayKst(),
          method: (input.method ?? "").trim() || "계좌이체",
        }
      : {};

  const { data, error: insErr } = await supabase
    .from("finance_requests")
    .insert({
      kind: input.kind,
      invoice_id: inv.id,
      student_id: inv.student_id,
      amount,
      reason,
      payload,
      requested_by: lower(me.email),
    })
    .select()
    .single();
  if (insErr) {
    if (insErr.code === "23505") {
      return { request: null, error: `이 청구서에 이미 결재를 기다리는 ${input.kind} 요청이 있습니다.`, status: 409 };
    }
    return { request: null, error: insErr.message, status: 500 };
  }
  return { request: data as FinanceRequest, error: null, status: 200 };
}

/** 승인된 환불 → 반대 방향 입금 한 줄. 원래 입금 줄은 지우지 않습니다. */
async function applyRefund(supabase: SupabaseClient, req: FinanceRequest, approver: string) {
  const { cap, inv, error } = await requestCap(supabase, "환불", req.invoice_id);
  if (error || !inv) return { paymentId: null, error: error ?? "청구서를 찾지 못했습니다." };
  const amount = Math.round(Number(req.amount));
  if (amount > cap) return { paymentId: null, error: `요청 뒤에 금액이 바뀌었습니다. 지금 돌려줄 수 있는 돈은 ${won(cap)}입니다.` };
  const at = req.payload?.refundedAt ?? todayKst();
  const method = req.payload?.method ?? "계좌이체";

  const { data, error: insErr } = await supabase
    .from("payments")
    .insert({
      invoice_id: inv.id,
      student_id: inv.student_id,
      paid_at: at,
      amount: -amount,
      kind: "환불",
      refund_reason: req.reason,
      method,
      method_kind: method,
      payer_name: inv.student_name_ko ?? inv.student_name,
      memo: `환불 · ${req.reason} (요청 ${req.requested_by} · 승인 ${approver})`,
      source: "환불",
      origin: "환불",
      matched_by: approver,
      created_by: req.requested_by,
    })
    .select("id")
    .single();
  if (insErr) return { paymentId: null, error: insErr.message };
  return { paymentId: (data as { id: string }).id, error: null };
}

/** 승인된 결손 → 청구서의 결손 칸을 늘립니다. 청구액·입금은 건드리지 않습니다. */
async function applyWriteOff(supabase: SupabaseClient, req: FinanceRequest, approver: string) {
  const { cap, inv, error } = await requestCap(supabase, "결손", req.invoice_id);
  if (error || !inv) return { error: error ?? "청구서를 찾지 못했습니다." };
  const amount = Math.round(Number(req.amount));
  if (amount > cap) return { error: `요청 뒤에 돈이 들어왔습니다. 지금 남은 돈은 ${won(cap)}입니다 - 다시 올려주세요.` };

  const before = Math.round(Number(inv.written_off_amount ?? 0));
  const reason = inv.written_off_reason ? `${inv.written_off_reason} / ${req.reason}` : req.reason;
  const { error: upErr } = await supabase
    .from("invoices")
    .update({
      written_off_amount: before + amount,
      written_off_at: new Date().toISOString(),
      written_off_by: approver,
      written_off_reason: reason,
    })
    .eq("id", inv.id);
  return { error: upErr?.message ?? null };
}

/**
 * 결재합니다.
 *
 * **승인 표시를 먼저 하고 장부에 반영합니다.** 반대로 하면 장부에 들어간 뒤 승인 표시가
 * 실패했을 때 요청이 대기로 남아, 다른 사람이 한 번 더 승인해 두 번 빠집니다. 반영이 실패하면
 * 대기로 되돌리고 이유를 돌려줍니다.
 */
export async function decideRequest(
  supabase: SupabaseClient,
  me: Me,
  id: string,
  action: "승인" | "반려" | "취소",
  note: string | null,
): Promise<{ ok: boolean; error: string | null; status: number }> {
  const { data: row, error } = await supabase.from("finance_requests").select("*").eq("id", id).maybeSingle();
  if (error) return { ok: false, error: error.message, status: 500 };
  const req = row as FinanceRequest | null;
  if (!req) return { ok: false, error: "요청을 찾지 못했습니다.", status: 404 };

  if (action === "취소") {
    if (req.status !== "대기") return { ok: false, error: `이미 ${req.status}된 요청입니다.`, status: 409 };
    if (lower(me.email) !== lower(req.requested_by)) return { ok: false, error: "요청은 올린 사람만 거둘 수 있습니다.", status: 403 };
    const { error: e } = await supabase.from("finance_requests").update({ status: "취소", decision_note: note }).eq("id", id).eq("status", "대기");
    return { ok: !e, error: e?.message ?? null, status: e ? 500 : 200 };
  }

  const block = decideBlock(me, req);
  if (block) return { ok: false, error: block, status: 403 };

  const approver = lower(me.email);
  const { data: marked, error: markErr } = await supabase
    .from("finance_requests")
    .update({ status: action, decided_by: approver, decision_note: note })
    .eq("id", id)
    .eq("status", "대기")
    .select("id");
  if (markErr) return { ok: false, error: markErr.message, status: 400 };
  if (!marked || marked.length === 0) return { ok: false, error: "다른 사람이 먼저 처리했습니다. 화면을 다시 확인해주세요.", status: 409 };
  if (action === "반려") return { ok: true, error: null, status: 200 };

  const applied =
    req.kind === "환불" ? await applyRefund(supabase, req, approver) : { paymentId: null, ...(await applyWriteOff(supabase, req, approver)) };

  if (applied.error) {
    const { error: backErr } = await supabase.from("finance_requests").update({ status: "대기", decision_note: null }).eq("id", id);
    return {
      ok: false,
      error: backErr
        ? `장부에 반영하지 못했고(${applied.error}) 요청도 대기로 되돌리지 못했습니다(${backErr.message}). 개발자에게 알려주세요.`
        : `장부에 반영하지 못해 대기로 되돌렸습니다: ${applied.error}`,
      status: 400,
    };
  }

  const { error: doneErr } = await supabase
    .from("finance_requests")
    .update({ applied_payment_id: applied.paymentId, applied_at: new Date().toISOString() })
    .eq("id", id);
  // 반영은 끝났습니다. 표시만 못 남긴 것이라 실패로 돌리지 않되 그 사실은 알립니다.
  return { ok: true, error: doneErr ? `반영은 되었지만 결재 기록에 반영 시각을 남기지 못했습니다: ${doneErr.message}` : null, status: 200 };
}
