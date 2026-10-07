import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import { hasFinanceAccess } from "@/lib/roles";
import { loadLedgerWorld } from "@/lib/ledgerLoad";
import { buildLedger } from "@/lib/studentLedger";
import { inDepartment, inTerm, isDefaultFor } from "@/lib/feeItems";

/**
 * **학생 원장 한 명분.** 학생 창이 열릴 때마다 새로 읽습니다 - 창에서 발행·입금을 하면 바로
 * 다시 불러 같은 함수로 다시 셉니다. 숫자를 창 안에서 손으로 고치지 않습니다(§2-12).
 */
export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ studentId: string }> }) {
  const me = await getCurrentAppUser();
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!hasFinanceAccess(me)) return NextResponse.json({ error: "재무 권한이 필요합니다." }, { status: 403 });

  const { studentId } = await ctx.params;
  const sp = new URL(req.url).searchParams;
  const termId = sp.get("term") || null;
  // 보고 있는 달. 주면 월 단위 학비를 그 달 청구서로 판정합니다(`tuitionMonth.ts`).
  const month = sp.get("month") || null;
  const supabase = await createClient();
  const { world, students, terms, errors } = await loadLedgerWorld(supabase, { termId, studentId, month });
  const student = students[0];
  if (!student) return NextResponse.json({ error: "학생을 찾지 못했습니다." }, { status: 404 });
  const ledger = buildLedger(world, student);
  // 창에서 **더 넣을 수 있는** 학비외 항목. 이 학생 부서·이 학기 것 중 아직 안 붙은 것만.
  // 전교생 항목 목록을 통째로 내려보내면 창이 느려지고, 다른 부서 교재를 실수로 넣는 자리가 생깁니다.
  const have = new Set(ledger.charges.filter((c) => c.kind === "학비외").map((c) => c.id));
  const sl = { id: student.id, grade: student.grade, className: student.class_name, department: student.department ?? null };
  const addableItems = world.items
    .filter((i) => i.active && inTerm(i, world.termId ?? "", world.termIsCurrent) && inDepartment(i, sl) && !have.has(i.id))
    .map((i) => ({
      id: i.id,
      label: i.name_ko ? `${i.name_ko} (${i.name})` : i.name,
      category: i.category,
      unitPrice: Number(i.unit_price),
      isDefault: isDefaultFor(i, sl),
    }));
  return NextResponse.json({
    ledger,
    addableItems,
    termId: world.termId,
    month: world.month ?? null,
    terms: terms.map((t) => ({ id: t.id, name: `${t.year} ${t.term_type}`, status: t.status })),
    // 읽기 실패는 숨기지 않습니다. 반쪽 자료로 셈한 금액을 그대로 보여주면 틀린 숫자가 「청구할 금액」이 됩니다.
    warnings: errors,
  });
}
