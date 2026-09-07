import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import { isStaffOrAboveUser } from "@/lib/roles";
import { selectTolerant } from "@/lib/selectTolerant";
import { applyRosterPlans, planRoster, type RosterRow, type StudentLite } from "@/lib/rosterPlan";

// 붙여넣은 명부를 **미리 보고** 넣습니다.
//
// 두 걸음으로 나눈 이유: 명부는 되돌리기 어렵습니다. 이름을 잘못 넣으면 그 아이의 출결과
// 관찰기록이 새 줄에 붙기 시작하고, 그때는 합치기로 정리해야 합니다. 그래서 넣기 전에
// **무엇이 새로 생기고 무엇이 바뀌는지**를 사람이 보게 합니다.
//
// 무엇이 바뀌는지 계산하는 일은 src/lib/rosterPlan.ts 한 곳에서만 합니다 - 구글시트에서
// 자동으로 들어오는 줄도 같은 계산을 거쳐야 두 화면이 다른 답을 내지 않습니다.

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const me = await getCurrentAppUser();
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!isStaffOrAboveUser(me)) return NextResponse.json({ error: "권한이 필요합니다." }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const rows = (body?.rows as RosterRow[] | undefined) ?? [];
  const apply = body?.apply === true;
  if (rows.length === 0) return NextResponse.json({ error: "넣을 줄이 없습니다." }, { status: 400 });

  const supabase = await createClient();
  const stuRes = await selectTolerant<StudentLite>(
    (columns) =>
      supabase.from("wr_students").select(columns).eq("is_demo", false) as unknown as
        PromiseLike<{ data: StudentLite[] | null; error: { message: string } | null }>,
    ["id", "name", "birth_date", "name_en", "grade", "class_name", "student_no", "status"],
    ["mother_phone", "father_phone", "parent_phone"],
  );
  if (stuRes.error) return NextResponse.json({ error: stuRes.error }, { status: 500 });

  const plans = planRoster(stuRes.data, rows);
  if (!apply) return NextResponse.json({ ok: true, plans });

  const valueOf = (p: { rowNo: number }) => rows.find((r) => r.rowNo === p.rowNo)?.values ?? {};
  const done = await applyRosterPlans(supabase, plans, valueOf);
  return NextResponse.json({ ok: true, ...done });
}
