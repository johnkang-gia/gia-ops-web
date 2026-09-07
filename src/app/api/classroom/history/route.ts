import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

// 교실 ↔ 행정실 기록. 로그인한 직원만 봅니다.
//
// 처리된 것도 함께 돌려줍니다. 끝난 일이 대시보드에서 내려가는 것은 맞지만, **내려간 것이
// 사라지면 안 됩니다** - 「그때 그 아이 다친 건 어떻게 처리했더라」를 되짚을 자리가 필요합니다.
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const { data: notes, error } = await supabase
    .from("classroom_notes")
    .select("id, class_id, kind, student_name, body, urgency, created_at, read_at, reply, done_at, done_by")
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const ids = [...new Set((notes ?? []).map((n) => n.class_id as string))];
  const { data: classes } = ids.length
    ? await supabase.from("wr_classes").select("id, grade, class_name").eq("is_demo", false).in("id", ids)
    : { data: [] as { id: string; grade: string | null; class_name: string | null }[] };
  const label = new Map(
    ((classes as { id: string; grade: string | null; class_name: string | null }[] | null) ?? []).map((c) => [
      c.id,
      `${c.grade ?? ""} ${c.class_name ?? ""}`.trim(),
    ])
  );

  return NextResponse.json({
    rows: (notes ?? []).map((n) => ({
      id: n.id as string,
      className: label.get(n.class_id as string) ?? "반 미확인",
      kind: n.kind as string,
      studentName: (n.student_name as string | null) ?? null,
      body: n.body as string,
      urgent: n.urgency === "급함",
      at: n.created_at as string,
      readAt: (n.read_at as string | null) ?? null,
      reply: (n.reply as string | null) ?? null,
      doneAt: (n.done_at as string | null) ?? null,
      doneBy: (n.done_by as string | null) ?? null,
    })),
  });
}
