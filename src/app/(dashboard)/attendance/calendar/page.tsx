import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import { isStaffOrAboveUser } from "@/lib/roles";
import CalendarClient from "@/components/attendance/CalendarClient";
import { loadSchoolDaysPanel } from "@/lib/panels/schoolDays";

export const dynamic = "force-dynamic";

// 수업일 달력.
//
// 출석부의 분모입니다. 며칠이 수업일인지 모르면 출석일수도 출석률도 낼 수 없습니다.
//
// 고치는 것은 행정실만 합니다 - 하루를 잘못 빼면 그 날 결석한 아이 전원의 결석 일수가 함께
// 틀어지고, 그 숫자가 상급학교 서류로 나갑니다.

export default async function AttendanceCalendarPage() {
  const me = await getCurrentAppUser();
  if (!me) redirect("/login");
  // 담임은 달력을 고칠 수 없습니다. 하루를 잘못 빼면 그 날 결석한 아이 전원의 결석 일수가
  // 함께 틀어지고, 그 숫자가 상급학교 서류로 나갑니다.
  if (!isStaffOrAboveUser(me)) redirect("/attendance");

  const supabase = await createClient();
  // [출석부]·[출석현황] 위의 팝업에서도 같은 화면이 열립니다. 자료를 모으는 일은 **같은
  // 함수**를 씁니다 - 분모가 되는 자료라 두 자리가 다른 답을 하면 출석률이 화면마다 달라집니다.
  const d = await loadSchoolDaysPanel(supabase);

  return (
    <>
      {d.loadError && (
        <p className="m-4 rounded-lg border border-orange-200 bg-orange-50 px-3 py-2 text-[12px] text-orange-800">
          자료를 읽지 못했습니다: {d.loadError}
        </p>
      )}
      <CalendarClient
        terms={d.terms}
        initialTermId={d.initialTermId}
        initialDays={d.initialDays}
        coverageStart={d.coverageStart}
        currentUserEmail={me.email}
      />
    </>
  );
}
