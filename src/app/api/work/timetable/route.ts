import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import { departmentOf } from "@/lib/department";

/**
 * **업무보드 「오늘 시간표」 창의 자료.**
 *
 * 반 · 담임 · 교실 · 교시 · 시간표를 한 번에 돌려줍니다. 화면이 표 다섯을 따로 읽으면 담임
 * 이름(계정 표)처럼 화면에서 못 읽는 것이 섞여, 어떤 반은 담임이 비고 어떤 반은 메일 주소가
 * 뜹니다.
 *
 * 「지금 어느 교시·어디」는 **화면이 계산합니다**(`whereNow`). 창을 열어 둔 채 시간이 흐르면
 * 교시가 바뀌는데, 서버가 계산해 보내면 다시 부르기 전까지 옛 교시가 남습니다.
 */

export const dynamic = "force-dynamic";

export async function GET() {
  const me = await getCurrentAppUser();
  if (!me) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const supabase = await createClient();
  const [clsRes, perRes, ttRes, userRes] = await Promise.all([
    supabase
      .from("wr_classes")
      .select("id, grade, class_name, room, department, teacher_name, teacher_email, sub_teacher_name, sub_teacher_email")
      .eq("is_demo", false),
    supabase.from("wr_periods").select("id, department, period_no, label, start_time, end_time").order("start_time"),
    supabase.from("wr_timetable").select("class_id, weekday, period_id, subject_name, teacher_name, room"),
    supabase.from("app_users").select("email, name").limit(500),
  ]);
  // 조용히 넘기지 않습니다(§5) - 시간표가 빈 창은 「오늘 수업이 없다」로 읽힙니다.
  const err = clsRes.error ?? perRes.error ?? ttRes.error;
  if (err) return NextResponse.json({ error: err.message }, { status: 500 });

  const nameByEmail = new Map(
    ((userRes.data as { email: string; name: string | null }[] | null) ?? []).filter((u) => u.name).map((u) => [u.email, u.name as string]),
  );
  const who = (email: string | null, name: string | null) => (email && nameByEmail.get(email)) || name || email || null;

  type Cls = {
    id: string;
    grade: string | null;
    class_name: string | null;
    room: string | null;
    department: string | null;
    teacher_name: string | null;
    teacher_email: string | null;
    sub_teacher_name: string | null;
    sub_teacher_email: string | null;
  };
  const classes = ((clsRes.data as Cls[] | null) ?? []).map((c) => ({
    id: c.id,
    grade: c.grade,
    className: c.class_name,
    room: c.room,
    // 교시표는 부서마다 다릅니다. 판정은 한 곳(departmentOf)에서 - 6학년은 중고등부입니다.
    department: departmentOf({ department: c.department, grade: c.grade }),
    teacher: who(c.teacher_email, c.teacher_name),
    subTeacher: who(c.sub_teacher_email, c.sub_teacher_name),
  }));

  return NextResponse.json({
    classes,
    periods: perRes.data ?? [],
    timetable: ttRes.data ?? [],
    // 담임 이름을 못 읽었으면 그 사실을 함께 보냅니다. 화면에는 이름 대신 메일이 뜹니다.
    warning: userRes.error ? `교직원 이름을 읽지 못해 담임이 메일 주소로 보일 수 있습니다: ${userRes.error.message}` : null,
  });
}
