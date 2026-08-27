import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { SCHEMA_CHECKS } from "@/lib/schemaChecks";

// 데이터베이스가 앱이 기대하는 모양을 갖췄는지 실제로 물어봅니다.
//
// information_schema를 뒤지는 방법도 있지만, 여기서는 **실제로 그 칸을 읽어봅니다.**
// 권한(RLS)까지 함께 확인되기 때문입니다 - 칸이 있어도 읽을 수 없으면 기능은 똑같이
// 안 됩니다. "분명히 있는데 왜 안 되지?"를 없애려면 앱과 같은 방식으로 확인해야 합니다.

export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const results = [];
  for (const check of SCHEMA_CHECKS) {
    const missing: string[] = [];
    let tableMissing = false;
    let note: string | null = null;

    for (const col of check.columns) {
      const { error } = await supabase.from(check.table).select(col).limit(1);
      if (!error) continue;
      const msg = `${error.message} ${error.details ?? ""}`;
      // 표 자체가 없는 경우와 칸 하나가 없는 경우는 고치는 방법이 같지만 화면에는 다르게
      // 보여야 합니다. 표가 없으면 마이그레이션이 통째로 안 걸린 것입니다.
      if (/relation .* does not exist|Could not find the table/i.test(msg)) {
        tableMissing = true;
        note = error.message;
        break;
      }
      missing.push(col);
      note = error.message;
    }

    // 칸이 다 있어도 저장이 안 되는 경우를 잡습니다. 실제로 넣어보고 곧바로 지웁니다.
    if (!tableMissing && missing.length === 0 && check.upsertProbe) {
      const p = check.upsertProbe;
      const { error } = await supabase.from(check.table).upsert(p.row, { onConflict: p.onConflict, ignoreDuplicates: true });
      if (error) {
        missing.push("저장 실패");
        note = error.message;
      }
      let q = supabase.from(check.table).delete();
      for (const [col, val] of Object.entries(p.cleanup)) q = q.eq(col, val);
      await q;
    }

    results.push({
      feature: check.feature,
      table: check.table,
      migration: check.migration,
      impact: check.impact,
      ok: !tableMissing && missing.length === 0,
      tableMissing,
      missing,
      note,
    });
  }

  return NextResponse.json({
    checkedAt: new Date().toISOString(),
    allOk: results.every((r) => r.ok),
    results,
  });
}
