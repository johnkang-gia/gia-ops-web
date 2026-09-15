import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import { loadStudentDay } from "@/lib/studentDayLoad";
import { ALL_SCOPE, isVisibleDepartment } from "@/lib/department";
import { todayKst } from "@/lib/kst";

/**
 * **학생 하루 보드 창구.**
 *
 * 업무보드·중앙 대시보드·학생 프로필이 **같은 답**을 보게 하는 자리입니다. 화면마다 따로
 * 모으면 화면마다 다른 명단이 나오고, 그때는 어느 쪽이 맞는지 아무도 모릅니다.
 *
 * 부서는 **보는 사람 것이 기본**입니다(CLAUDE.md §2-4-4). 초등부 담당에게 중고등부 아이가
 * 뜨면 할 수 있는 일이 없는 줄이 자리만 먹습니다.
 */

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const me = await getCurrentAppUser();
  if (!me) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const url = new URL(req.url);
  const asked = (url.searchParams.get("department") ?? "").trim();

  // 소속이 「전체」인 사람(최고관리자·개발자)만 부서를 고를 수 있습니다. 그 밖은 자기
  // 부서로 못박습니다 - 주소만 바꿔서 남의 부서를 보는 길을 열어두지 않습니다.
  const mine = (me.department ?? "").trim();
  const canChoose = !mine || mine === ALL_SCOPE;
  const department = canChoose
    ? isVisibleDepartment(asked)
      ? asked
      : null // 전체
    : isVisibleDepartment(mine)
      ? mine
      : null;

  const supabase = await createClient();
  const board = await loadStudentDay(supabase, { date: todayKst(), department });

  return NextResponse.json({
    ...board,
    department,
    canChooseDepartment: canChoose,
  });
}
