import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getCurrentAppUser } from "@/lib/currentUser";
import { hasFinanceAccess } from "@/lib/roles";
import { ROLE_ORDER } from "@/lib/alltalkpay";

export const dynamic = "force-dynamic";

/**
 * **학생의 결제번호를 정합니다.** 올톡페이로 청구서가 실제로 나가는 번호입니다.
 *
 * ── 왜 서버로 옮겼나 ────────────────────────────────────────────────────────
 *
 * 예전에는 화면이 브라우저에서 바로 `wr_students` 를 고쳤습니다. 그런데 그 표의 자물쇠는
 * **명부 관리 권한(`is_wr_manager`)** 을 요구합니다. 재무 담당자에게 그 권한이 없으면
 * 업데이트가 **한 줄도 안 맞고, 그때 Supabase 는 오류를 내지 않습니다.**
 *
 * 그래서 화면은 「저장했습니다」라고 말하고 자기 상태만 바꿨습니다. 창을 닫았다 열면
 * 번호가 사라져 있었고, 왜 사라졌는지는 어디에도 안 남았습니다 — 조용한 실패입니다
 * (CLAUDE.md 5).
 *
 * 이제 **재무 권한으로 확인하고 서비스롤로 씁니다.** 그리고 고친 줄을 돌려받아
 * **정말 한 줄이 바뀌었는지 셉니다** — 안 바뀌었으면 실패로 답합니다. 기억이 아니라
 * 검사입니다.
 *
 * ── 번호를 언제 베끼나 ──────────────────────────────────────────────────────
 *
 * 어머니·아버지·보호자를 고르면 **번호를 베끼지 않습니다.** 명부의 그 칸을 그때그때
 * 읽습니다 - 베껴 두면 어머니가 번호를 바꿨을 때 명부는 새 번호·결제번호는 옛 번호가
 * 되는데, 둘 다 그럴듯해 보여 어느 쪽이 맞는지 알 수 없습니다.
 *
 * 「직접 등록」은 명부 셋 중 아무도 아닌 번호라 **여기가 원본**입니다. 그래서 번호 자체를
 * 저장합니다(결제만 담당하는 분이 따로 계신 집이 있습니다).
 */
export async function POST(req: Request) {
  const me = await getCurrentAppUser();
  if (!me) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  if (!hasFinanceAccess(me)) return NextResponse.json({ error: "재무 권한이 필요합니다." }, { status: 403 });

  const body = (await req.json().catch(() => null)) as { studentId?: string; role?: string | null; phone?: string } | null;
  const studentId = body?.studentId;
  const role = body?.role ?? null;
  if (!studentId) return NextResponse.json({ error: "학생을 고르지 못했습니다." }, { status: 400 });
  if (role !== null && !ROLE_ORDER.includes(role as (typeof ROLE_ORDER)[number])) {
    return NextResponse.json({ error: `모르는 결제번호 종류입니다: ${role}` }, { status: 400 });
  }

  // 직접 등록이면 번호가 있어야 합니다. 데이터베이스도 같은 짝을 검사합니다.
  const raw = String(body?.phone ?? "").trim();
  const phone = role === "direct" ? raw : null;
  if (role === "direct") {
    const digits = raw.replace(/\D/g, "");
    if (digits.length < 9) {
      return NextResponse.json({ error: "번호가 너무 짧습니다. 휴대폰 번호를 그대로 적어주세요." }, { status: 400 });
    }
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return NextResponse.json({ error: "서버 설정이 없습니다(SUPABASE_SERVICE_ROLE_KEY)." }, { status: 500 });
  const admin = createClient(url, key, { auth: { persistSession: false } });

  const { data, error } = await admin
    .from("wr_students")
    .update({ billing_phone_role: role, billing_phone: phone })
    .eq("id", studentId)
    // demo-ok: 번호로 한 명을 찍어 고칩니다. 명부를 훑지 않습니다.
    .select("id, name, billing_phone_role, billing_phone");

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  // **정말 바뀌었는지 셉니다.** 0줄이면 화면에는 성공으로 보이지만 아무것도 안 바뀐 것입니다.
  if (!data || data.length === 0) {
    return NextResponse.json({ error: "그 학생을 찾지 못했습니다. 명부에서 확인해주세요." }, { status: 404 });
  }

  return NextResponse.json({ ok: true, student: data[0] });
}
