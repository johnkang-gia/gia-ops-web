import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import { isStaffOrAboveUser } from "@/lib/roles";
import { callClaudeJson, CLAUDE_MODEL_FAST } from "@/lib/ai/claude";
import { buildBackfillCategorySystemPrompt, buildBackfillCategoryEntryBlock } from "@/lib/ai/prompts";
import { loadPolicyCategoryNames } from "@/lib/policyCategories";
import type { BackfillCategoryResult } from "@/lib/ai/types";
import { logApiError } from "@/lib/logging";

// 기존 사건/회의를 정책 항목(policy_categories) 고정 목록으로 소급 태깅하는 배치 기능입니다
// (요청 확인: "기존 기록도 AI로 훑어서 새 항목에 소급 태깅"). [정책 항목 관리] 화면에서 관리자·
// 행정직원이 "다음 배치 실행" 버튼을 누를 때마다 이만큼씩 처리하고, 남은 건수를 돌려줍니다.
// 전체 재분류(remediationOptions 등)를 다시 만들지 않고 딱 항목명만 고르는 가벼운 작업이라
// Haiku로 처리해 과금을 최소화합니다.
const BATCH_SIZE = 10;

type BackfillType = "incidents" | "meetings";

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const me = await getCurrentAppUser();
  if (!isStaffOrAboveUser(me)) {
    return NextResponse.json({ error: "관리자·행정직원만 사용할 수 있습니다." }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const type = body.type as BackfillType;
  if (!["incidents", "meetings"].includes(type)) {
    return NextResponse.json({ error: "type은 incidents/meetings 중 하나여야 합니다." }, { status: 400 });
  }

  try {
    const existingCategories = await loadPolicyCategoryNames(supabase);

    // manual_cat/op_plan_cat 둘 중 하나라도 아직 null(=한 번도 검토 안 됨)인 기록만 대상입니다.
    // AI가 "해당 항목 없음"으로 판단해도 null 대신 빈 문자열로 채워 넣어(아래 patch 로직),
    // 다음 배치에서 같은 행을 계속 다시 뽑아 토큰을 낭비하지 않게 합니다.
    const { data: rows, error } = await supabase
      .from(type)
      .select("*")
      .or("manual_cat.is.null,op_plan_cat.is.null")
      .order("date", { ascending: false })
      .limit(BATCH_SIZE);
    if (error) throw new Error(error.message);

    const { count: remainingCount } = await supabase
      .from(type)
      .select("id", { count: "exact", head: true })
      .or("manual_cat.is.null,op_plan_cat.is.null");

    if (!rows || rows.length === 0) {
      return NextResponse.json({ success: true, processed: 0, remaining: 0 });
    }

    let processed = 0;
    for (const row of rows) {
      const summary =
        type === "incidents"
          ? [row.title, row.detail, row.good, row.lack, row.suggest].filter(Boolean).join("\n")
          : [row.content, row.final_record].filter(Boolean).join("\n");

      const patch: Record<string, string> = {};
      if (!summary.trim()) {
        // 내용이 비어 있으면 AI를 부를 필요 없이 "해당 없음"으로 바로 처리합니다(토큰 절약).
        if (row.manual_cat === null) patch.manual_cat = "";
        if (row.op_plan_cat === null) patch.op_plan_cat = "";
      } else {
        const systemPrompt = buildBackfillCategorySystemPrompt();
        const userPrompt = buildBackfillCategoryEntryBlock(summary, existingCategories);
        const result = (await callClaudeJson(systemPrompt, userPrompt, {
          model: CLAUDE_MODEL_FAST,
          route: `backfill-categories:${type}`,
          maxTokens: 300,
        })) as BackfillCategoryResult;

        if (row.manual_cat === null) patch.manual_cat = result.manualCat || "";
        if (row.op_plan_cat === null) patch.op_plan_cat = result.opPlanCat || "";
      }

      if (Object.keys(patch).length > 0) {
        await supabase.from(type).update(patch).eq("id", row.id);
      }
      processed += 1;
    }

    const remaining = Math.max(0, (remainingCount ?? 0) - processed);
    return NextResponse.json({ success: true, processed, remaining });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await logApiError(supabase, `backfill-categories:${type}`, err, user.email);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
