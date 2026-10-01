import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import { isStaffOrAboveUser } from "@/lib/roles";
import { loadStudents } from "@/lib/students";
import { LIBRARY_URL, loadLibraryOverview } from "@/lib/library";
import LibraryOverviewClient from "@/components/library/LibraryOverviewClient";

export const dynamic = "force-dynamic";

// 도서관 현황 - 운영앱 안에서 **읽기만** 합니다.
//
// 대출·반납은 도서관 노트북(gia-lib-web)에서 바코드로 합니다. 행정실·담임이 궁금한 것은 그 일이
// 아니라 결과입니다 - 누가 연체인가, 오늘 누가 왔는가, 학생증을 아직 안 받은 아이가 누구인가.
// 그걸 보려고 다른 앱에 다시 로그인하게 하면 아무도 안 보고, 안 보는 연체는 쌓입니다.
export default async function LibraryPage() {
  const me = await getCurrentAppUser();
  if (!me) redirect("/login");
  if (!isStaffOrAboveUser(me)) redirect("/home");

  const supabase = await createClient();
  const [overview, stu] = await Promise.all([loadLibraryOverview(supabase), loadStudents(supabase)]);
  if (overview.error) console.error("[도서관] 자료를 읽지 못했습니다:", overview.error);
  if (stu.error) console.error("[도서관] 명부를 읽지 못했습니다:", stu.error);

  // 학생증 미발급 = 재학생 중 발급 기록이 없는 아이. 번호가 없는 아이는 발급 자체가 안 되므로 따로 셉니다.
  const noCard = stu.rows.filter((s) => s.student_no && !overview.cardIssuedNos.has(s.student_no));
  const noNumber = stu.rows.filter((s) => !s.student_no);

  return (
    <LibraryOverviewClient
      libraryUrl={LIBRARY_URL}
      error={overview.error}
      bookCount={overview.bookCount}
      active={overview.active}
      overdue={overview.overdue}
      borrowedToday={overview.borrowedToday}
      returnedToday={overview.returnedToday}
      visitsToday={overview.visitsToday}
      noCard={noCard.map((s) => ({ id: s.id, name: s.name, grade: s.grade, class_name: s.class_name }))}
      noNumber={noNumber.map((s) => ({ id: s.id, name: s.name, grade: s.grade, class_name: s.class_name }))}
    />
  );
}
