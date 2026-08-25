import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import { isStaffOrAboveUser } from "@/lib/roles";
import GuideButton from "@/components/common/GuideButton";
import DutyRosterClient, { type DutyRow } from "@/components/school/DutyRosterClient";

export const dynamic = "force-dynamic";

const GUIDE_SECTIONS = [
  {
    title: "🍚 당번표란?",
    lines: [
      "급식 당번처럼 \"누가 언제 어디를 맡는가\"를 적어두는 곳입니다(요청: \"당번표는 대시보드에 필요없고, 일단은 데이터만 넣을 수 있게\").",
      "지금은 여기에 모아두기만 합니다. 나중에 사무실 대시보드나 학사일정 달력에 띄우기로 하면 여기 적은 내용을 그대로 가져다 씁니다 - 그때 다시 입력하실 필요가 없습니다.",
      "급식 당번뿐 아니라 체육관·코딩실 사용, 도서관 당번처럼 같은 모양의 표는 전부 여기에 넣을 수 있습니다. [종류] 칸에 이름만 새로 적으면 새 당번표가 하나 생깁니다.",
    ],
  },
  {
    title: "✍️ 입력하는 방법",
    lines: [
      "[언제]는 두 가지 중에 고릅니다. 매주 반복되면 [매주 + 요일], 특정 날짜 하루면 [특정일 + 날짜]입니다.",
      "[구분]은 같은 당번 안에서 자리를 나눌 때 씁니다(예: 1층 / 2층, 점심 1부 / 2부). 나눌 필요가 없으면 비워두세요.",
      "[담당자]는 이름만 적어도 됩니다. 아직 앱에 가입하지 않은 선생님도 많고 당번은 종이로도 돌기 때문입니다. 앱에 있는 이름과 똑같이 적으면 계정까지 자동으로 연결되어 [계정 연결됨]이 붙습니다.",
      "잘못 넣었으면 [지우기]로 삭제하고 다시 넣어주세요.",
    ],
  },
  {
    title: "🔒 누가 볼 수 있나요?",
    lines: [
      "교직원이면 누구나 볼 수 있습니다. 당번은 모두가 알아야 하는 정보라서입니다.",
      "추가·삭제는 행정직원·관리자·개발자만 할 수 있습니다.",
    ],
  },
];

// 요청: "당번표는 대시보드에 필요없고, 일단은 데이터만 넣을 수 있게 해주고"
//
// 명부 PDF에 급식 당번·체육관 예약·도서관 일정 표가 여러 개 들어 있는데, 지금은 화면에 띄워
// 보여줄 필요가 없다고 하셔서 담아두는 곳만 만들었습니다. 종류(kind)로 구분하는 표 하나에
// 전부 넣어서, 새 당번이 생겨도 화면을 새로 만들 필요가 없습니다.
export default async function DutyRosterPage() {
  const me = await getCurrentAppUser();
  if (!me) redirect("/login");

  const supabase = await createClient();
  const [rowsRes, teamRes] = await Promise.all([
    supabase.from("duty_roster").select("*").order("kind").order("weekday").order("service_date"),
    supabase.from("app_users").select("email, name").eq("status", "approved").order("name"),
  ]);

  return (
    <div className="mx-auto max-w-6xl p-4 sm:p-6">
      <div className="mb-1 flex items-center justify-between gap-2">
        <h1 className="text-lg font-bold">🍚 당번표</h1>
        <GuideButton title="당번표 사용 가이드" sections={GUIDE_SECTIONS} />
      </div>
      <p className="mb-5 text-xs leading-relaxed text-slate-500">
        급식 당번·체육관 사용처럼 &quot;누가 언제 어디를 맡는가&quot;를 적어두는 곳입니다. 지금은 모아두기만 하고 화면 어디에도
        띄우지 않습니다 — 나중에 대시보드나 달력에 올리기로 하면 여기 적은 내용을 그대로 씁니다.
      </p>
      <DutyRosterClient
        initialRows={(rowsRes.data as DutyRow[] | null) ?? []}
        team={(teamRes.data as { email: string; name: string | null }[] | null) ?? []}
        canEdit={isStaffOrAboveUser(me)}
      />
    </div>
  );
}
