import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import { hasFinanceAccess } from "@/lib/roles";
import { DECISIONS } from "@/lib/alltalkSync";

export const dynamic = "force-dynamic";

/**
 * **올톡 대조의 사람 판단 저장.**
 *
 *   link      「이 올톡 이름·번호는 이 학생」 — 다음 파일부터 자동으로 붙습니다.
 *             학생 대신 decision 「학생 아님」을 주면 교직원·외부 판매로 기억합니다.
 *   decision  「앱에 넣음 / 앱에 안 넣음 / 해당없음 / 확인필요」 + 메모.
 *
 * 둘 다 비우면(학생도 판단도 메모도 없음) 지웁니다 - 잘못 고른 연결을 되돌릴 길입니다.
 */
export async function POST(req: Request) {
  const me = await getCurrentAppUser();
  if (!me) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  if (!hasFinanceAccess(me)) return NextResponse.json({ error: "재무 권한이 필요합니다." }, { status: 403 });

  const body = (await req.json().catch(() => null)) as { key?: string; kind?: string; studentId?: string | null; decision?: string | null; memo?: string | null } | null;
  const key = String(body?.key ?? "").trim();
  const kind = body?.kind === "link" ? "link" : body?.kind === "decision" ? "decision" : null;
  if (!key || !kind) return NextResponse.json({ error: "무엇을 저장할지 모릅니다(key·kind)." }, { status: 400 });
  if (kind === "link" && !key.startsWith("link|")) return NextResponse.json({ error: "학생 연결 열쇠가 아닙니다." }, { status: 400 });

  const decision = body?.decision ? String(body.decision) : null;
  if (decision && !(DECISIONS as readonly string[]).includes(decision)) {
    return NextResponse.json({ error: `판단은 ${DECISIONS.join(" · ")} 중 하나입니다.` }, { status: 400 });
  }
  const studentId = body?.studentId ? String(body.studentId) : null;
  const memo = body?.memo ? String(body.memo).trim().slice(0, 500) || null : null;

  const supabase = await createClient();
  if (!studentId && !decision && !memo) {
    const { error } = await supabase.from("alltalk_sync_marks").delete().eq("key", key);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, removed: true });
  }
  const { error } = await supabase.from("alltalk_sync_marks").upsert(
    { key, kind, student_id: studentId, decision, memo, updated_by: me.email, updated_at: new Date().toISOString() },
    { onConflict: "key" },
  );
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
