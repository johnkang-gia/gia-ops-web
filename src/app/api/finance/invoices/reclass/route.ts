import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import { hasFinanceAccess } from "@/lib/roles";

export const dynamic = "force-dynamic";

/**
 * **과목경정** — 금액은 그대로 두고 어느 세입과목으로 셀지만 바꿉니다.
 *
 * 교재비로 청구한 줄이 실은 체험비였다면, 청구서를 취소하거나 정정할 일이 아닙니다 - 학부모가 낼
 * 돈은 같습니다. 바뀌는 것은 학교 장부의 분류뿐입니다. 그래서 줄의 과목만 고치고, 언제·누가·왜
 * 바꿨는지를 `invoice_line_reclass_log` 에 남깁니다.
 */
export async function POST(req: Request) {
  const me = await getCurrentAppUser();
  if (!me) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  if (!hasFinanceAccess(me)) return NextResponse.json({ error: "재무 권한이 필요합니다." }, { status: 403 });

  const b = (await req.json().catch(() => null)) as { lineIds?: string[]; accountId?: string; reason?: string } | null;
  const ids = [...new Set((b?.lineIds ?? []).filter(Boolean))];
  const reason = String(b?.reason ?? "").trim();
  if (ids.length === 0) return NextResponse.json({ error: "바꿀 줄을 골라주세요." }, { status: 400 });
  if (!b?.accountId) return NextResponse.json({ error: "옮길 과목을 골라주세요." }, { status: 400 });
  if (!reason) return NextResponse.json({ error: "경정 사유를 적어주세요." }, { status: 400 });

  const supabase = await createClient();
  const { data: acc, error: aErr } = await supabase.from("revenue_accounts").select("id, level").eq("id", b.accountId).maybeSingle();
  if (aErr) return NextResponse.json({ error: aErr.message }, { status: 500 });
  // 관·항은 묶음입니다. 줄은 맨 아래 칸(목)에만 붙습니다 - 위에 붙이면 그 아래 어느 목인지 모릅니다.
  if (!acc || acc.level !== "목") return NextResponse.json({ error: "맨 아래 과목(목)을 골라주세요." }, { status: 400 });

  const { data: lines, error: lErr } = await supabase.from("invoice_lines").select("id, invoice_id, revenue_account_id").in("id", ids);
  if (lErr) return NextResponse.json({ error: lErr.message }, { status: 500 });
  const found = (lines ?? []) as { id: string; invoice_id: string; revenue_account_id: string | null }[];
  if (found.length !== ids.length) return NextResponse.json({ error: "고르신 줄 일부를 찾지 못했습니다. 화면을 다시 열어주세요." }, { status: 400 });

  const moving = found.filter((l) => l.revenue_account_id !== b.accountId);
  if (moving.length === 0) return NextResponse.json({ ok: true, changed: 0 });

  // 내력을 먼저 남깁니다. 줄을 먼저 바꾸고 내력이 실패하면, 바뀐 이유가 영영 없는 줄이 생깁니다.
  const { error: logErr } = await supabase.from("invoice_line_reclass_log").insert(
    moving.map((l) => ({
      line_id: l.id,
      invoice_id: l.invoice_id,
      from_account_id: l.revenue_account_id,
      to_account_id: b.accountId,
      reason,
      changed_by: me.email,
    })),
  );
  if (logErr) return NextResponse.json({ error: `경정 내력을 남기지 못해 바꾸지 않았습니다: ${logErr.message}` }, { status: 500 });

  const { error: upErr } = await supabase
    .from("invoice_lines")
    .update({ revenue_account_id: b.accountId })
    .in("id", moving.map((l) => l.id));
  if (upErr) return NextResponse.json({ error: `내력은 남았지만 과목을 바꾸지 못했습니다: ${upErr.message}` }, { status: 500 });

  return NextResponse.json({ ok: true, changed: moving.length });
}
