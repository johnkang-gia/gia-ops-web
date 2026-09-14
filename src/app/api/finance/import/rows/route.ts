import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import { hasFinanceAccess } from "@/lib/roles";

export const dynamic = "force-dynamic";

const DECISIONS = ["대기", "승인", "보류", "건너뜀"] as const;

/**
 * **검수 — 사람이 정한 것을 적습니다.**
 *
 * 아직 아무것도 반영하지 않습니다. 여기서 바뀌는 것은 `payment_import_rows` 뿐입니다.
 *
 * 여러 줄을 한 번에 받습니다. 285줄을 한 줄씩 보내면 「자동 확정 전부 승인」이 285번의
 * 왕복이 되고, 중간에 끊기면 어디까지 갔는지 모릅니다.
 *
 * **이미 반영된 줄은 데이터베이스가 막습니다**(트리거). 나간 청구서와 여기 적힌 것이
 * 달라지면 그건 오류로 안 보이고 「이상한 기록」으로만 보입니다.
 */
export async function PATCH(req: Request) {
  const me = await getCurrentAppUser();
  if (!me) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  if (!hasFinanceAccess(me)) return NextResponse.json({ error: "재무 권한이 필요합니다." }, { status: 403 });

  const body = (await req.json().catch(() => null)) as
    | { ids?: string[]; decision?: string; studentId?: string | null; note?: string; setStudent?: boolean }
    | null;

  const ids = (body?.ids ?? []).filter((x) => typeof x === "string");
  if (ids.length === 0) return NextResponse.json({ error: "고른 줄이 없습니다." }, { status: 400 });

  const patch: Record<string, unknown> = { decided_by: me.email, decided_at: new Date().toISOString() };

  if (body?.decision !== undefined) {
    if (!DECISIONS.includes(body.decision as (typeof DECISIONS)[number])) {
      return NextResponse.json({ error: `모르는 결정입니다: ${body.decision}` }, { status: 400 });
    }
    patch.decision = body.decision;
  }
  // **학생을 비우는 것과 안 건드리는 것은 다릅니다.** `setStudent` 가 참일 때만 손댑니다 -
  // 없으면 승인만 누를 때 사람이 고른 학생이 조용히 지워집니다.
  if (body?.setStudent) patch.decided_student_id = body.studentId ?? null;
  if (body?.note !== undefined) patch.reviewer_note = String(body.note).trim() || null;

  const supabase = await createClient();
  const { data, error } = await supabase.from("payment_import_rows").update(patch).in("id", ids).select("id");

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  // **정말 바뀌었는지 셉니다.** 0줄이면 화면에는 성공으로 보이지만 아무것도 안 바뀐 것입니다.
  if (!data || data.length === 0) {
    return NextResponse.json({ error: "바뀐 줄이 없습니다. 이미 반영된 줄일 수 있습니다." }, { status: 400 });
  }
  if (data.length < ids.length) {
    return NextResponse.json(
      { ok: true, changed: data.length, warn: `${ids.length}줄 중 ${data.length}줄만 바뀌었습니다. 나머지는 이미 반영된 줄입니다.` },
      { status: 200 },
    );
  }
  return NextResponse.json({ ok: true, changed: data.length });
}
