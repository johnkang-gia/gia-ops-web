import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import { isStaffOrAboveUser } from "@/lib/roles";
import { ALL_SCOPE, VISIBLE_DEPARTMENTS } from "@/lib/department";
import NotesWindow from "@/components/work/NotesWindow";

/**
 * **쪽지 전용 창** — 업무보드에서 ✉ 를 누르면 주소창 없는 작은 창으로 뜹니다.
 *
 * 사이드바·상단탭이 없는 자리라 `(dashboard)` 밖에 둡니다. 작은 창에 메뉴가 함께 뜨면
 * 정작 쪽지가 손바닥만 해집니다.
 */

/**
 * 창 제목을 따로 둡니다. 크롬 작업표시줄·창 목록에서 「GIA 운영」이 둘이면 어느 쪽이
 * 업무 화면인지 눌러 봐야 압니다.
 */
export const metadata = { title: "GIA 운영 — 쪽지" };

export const dynamic = "force-dynamic";

export default async function NotesWindowPage() {
  const me = await getCurrentAppUser();
  if (!me) redirect("/login");
  if (!isStaffOrAboveUser(me)) redirect("/home");

  // 부서 목록은 보는 사람 것이 기본입니다(CLAUDE.md §2-4-4). 「전체」인 사람만 고를 수
  // 있습니다 - 창을 띄운 뒤에는 업무보드의 부서 탭이 안 보이므로 여기서 고릅니다.
  const mine = (me.department ?? "").trim();
  const canChoose = !mine || mine === ALL_SCOPE;
  const departments = canChoose ? [...VISIBLE_DEPARTMENTS] : [mine];

  const supabase = await createClient();
  const { data } = await supabase.from("app_users").select("name").eq("email", me.email).maybeSingle();

  return (
    <NotesWindow
      departments={departments}
      initialDepartment={departments[0] ?? "초등부"}
      currentUserEmail={me.email}
      currentUserName={(data?.name as string | null) ?? me.name ?? null}
    />
  );
}
