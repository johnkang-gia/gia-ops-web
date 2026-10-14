import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * **예치금 공유 묶음** — 누가 누구와 한 통의 예치금을 쓰는가.
 *
 * 형제가 있는 집은 한 아이 이름으로 맡긴 돈을 둘째 청구서에서도 빼 달라고 합니다. 돈은 지금처럼 입금 줄
 * (`payments.invoice_id is null`)에 **한 번만** 있고, 여기서는 «이 학생의 예치금을 찾을 때 누구 것까지 함께
 * 보는가»만 정합니다(`20261201000000_deposit_share.sql`). 공유 잔액은 따로 적어 두지 않고 그때그때 더합니다 -
 * 적어 두면 차감할 때 그 칸을 고치는 것을 잊는 날이 옵니다(§2-12).
 *
 * 예치금을 읽는 자리(차감·발행 자동 충당·청구서 인쇄·학생 창·사용내역서)는 모두 `poolOf` 로 학생 목록을 얻습니다.
 * 자리마다 묶음을 따로 읽으면 한 곳만 공유를 모르고, 그 화면은 오류 없이 «예치금 없음»을 말합니다.
 */

export type DepositShare = { id: string; name: string; note: string | null; memberIds: string[] };

/** 이 학생이 속한 묶음과, 함께 예치금을 쓰는 학생들(자기 포함). 묶음이 없으면 자기 혼자입니다. */
export async function poolOf(
  supabase: SupabaseClient,
  studentId: string,
): Promise<{ share: DepositShare | null; memberIds: string[]; error: string | null }> {
  const { data: mine, error } = await supabase.from("deposit_share_members").select("share_id").eq("student_id", studentId).maybeSingle();
  if (error) return { share: null, memberIds: [studentId], error: `예치금 공유 묶음을 읽지 못했습니다: ${error.message}` };
  if (!mine) return { share: null, memberIds: [studentId], error: null };
  const shareId = (mine as { share_id: string }).share_id;
  const [s, m] = await Promise.all([
    supabase.from("deposit_shares").select("id, name, note").eq("id", shareId).maybeSingle(),
    supabase.from("deposit_share_members").select("student_id").eq("share_id", shareId),
  ]);
  const bad = s.error ?? m.error;
  if (bad) return { share: null, memberIds: [studentId], error: `예치금 공유 묶음을 읽지 못했습니다: ${bad.message}` };
  const memberIds = [...new Set([studentId, ...(((m.data as { student_id: string }[] | null) ?? []).map((r) => r.student_id))])];
  const row = s.data as { id: string; name: string; note: string | null } | null;
  return { share: row ? { ...row, memberIds } : null, memberIds, error: null };
}

/** 여러 학생의 묶음을 한 번에. 학생 → 함께 쓰는 학생들(자기 포함). 인쇄본·대장처럼 여러 명을 그리는 자리용. */
export async function poolsOf(
  supabase: SupabaseClient,
  studentIds: string[],
): Promise<{ pools: Map<string, string[]>; names: Map<string, string>; error: string | null }> {
  const pools = new Map<string, string[]>(studentIds.map((id) => [id, [id]]));
  const names = new Map<string, string>();
  if (studentIds.length === 0) return { pools, names, error: null };
  const { data: mine, error } = await supabase.from("deposit_share_members").select("share_id, student_id").in("student_id", studentIds);
  if (error) return { pools, names, error: `예치금 공유 묶음을 읽지 못했습니다: ${error.message}` };
  const shareIds = [...new Set(((mine as { share_id: string }[] | null) ?? []).map((r) => r.share_id))];
  if (shareIds.length === 0) return { pools, names, error: null };
  const [all, sh] = await Promise.all([
    supabase.from("deposit_share_members").select("share_id, student_id").in("share_id", shareIds),
    supabase.from("deposit_shares").select("id, name").in("id", shareIds),
  ]);
  const bad = all.error ?? sh.error;
  if (bad) return { pools, names, error: `예치금 공유 묶음을 읽지 못했습니다: ${bad.message}` };
  const byShare = new Map<string, string[]>();
  for (const r of (all.data as { share_id: string; student_id: string }[] | null) ?? []) {
    byShare.set(r.share_id, [...(byShare.get(r.share_id) ?? []), r.student_id]);
  }
  const shareName = new Map(((sh.data as { id: string; name: string }[] | null) ?? []).map((r) => [r.id, r.name]));
  for (const r of (mine as { share_id: string; student_id: string }[] | null) ?? []) {
    pools.set(r.student_id, [...new Set([r.student_id, ...(byShare.get(r.share_id) ?? [])])]);
    names.set(r.student_id, shareName.get(r.share_id) ?? "공유 예치금");
  }
  return { pools, names, error: null };
}
