import { redirect } from "next/navigation";
import { getCurrentAppUser } from "@/lib/currentUser";
import { isAdminUser, isStaffOrAboveUser } from "@/lib/roles";
import GuideButton from "@/components/common/GuideButton";
import PageTabs from "@/components/common/PageTabs";
import { ROSTER_TABS } from "@/components/school/rosterTabs";
import RosterSyncClient from "@/components/school/RosterSyncClient";

export const dynamic = "force-dynamic";

const GUIDE_SECTIONS = [
  {
    title: "🔗 어떻게 설정하나요?",
    lines: [
      "[연결 만들기] → [스크립트 보기] → [스크립트 복사].",
      "script.google.com 에서 «새 프로젝트»를 만들어 붙여넣습니다. 시트에 붙이지 않습니다 - 시트를 편집할 수 있는 직원이면 코드도 토큰도 꺼내 볼 수 있습니다.",
      "고칠 곳은 둘뿐입니다. SHEET_ID(시트 주소의 /d/ 와 /edit 사이 글자)와 SHEET_NAME(시트 아래 탭 이름).",
      "[명부보내기]를 한 번 실행해 권한을 허용하고, 왼쪽 ⏰ 트리거에서 «시간 기반 > 분 단위 타이머 > 10분마다»로 걸어둡니다.",
    ],
  },
  {
    title: "🛡️ 토큰이 새면 어떻게 되나요?",
    lines: [
      "들어온 줄은 명부를 바로 고치지 않고 «반영 대기»에 쌓입니다. 사람이 보고 [이대로 넣기]를 눌러야 들어갑니다 - 최악이 «대기함에 쓰레기 줄이 쌓이는 것»으로 끝납니다.",
      "받는 창구는 쓰기 전용입니다. 명부를 읽어가는 데는 쓸 수 없고, 답으로도 «몇 줄 받아 몇 줄이 대기함에 들어갔는지»만 돌려줍니다.",
      "토큰은 언제든 재발급합니다. 재발급하면 스크립트의 TOKEN 도 바꿔야 합니다.",
    ],
  },
  {
    title: "📞 값은 어떻게 다듬나요?",
    lines: [
      "머리줄의 글자를 보고 어느 칸인지 정합니다. 시트의 칸 순서가 달라도 됩니다 - 순서를 코드에 박아두면 어느 날 조용히 학년 칸에 반 이름이 들어갑니다.",
      "전화번호는 숫자만 남깁니다. 010-1234-5678, 01012345678, +82 10-1234-5678 이 모두 같은 번호가 됩니다.",
      "생년월일은 2015-03-04 / 2015.3.4 / 2015/03/04 / 20150304 을 읽습니다. 두 자리 연도(15.3.4)는 읽지 않습니다 - 1915년인지 2015년인지 기계가 정하면 언젠가 틀립니다.",
      "이름 + 생년월일이 같으면 같은 학생으로 봅니다. 생년월일이 없고 같은 이름이 둘 이상이면 «확인 필요»로 두고 건드리지 않습니다 - 잘못 고르면 남의 출결·관찰기록에 붙습니다.",
    ],
  },
];

export default async function RosterSheetPage() {
  const me = await getCurrentAppUser();
  if (!me) redirect("/login");
  if (!isStaffOrAboveUser(me)) redirect("/home");

  return (
    <div className="mx-auto w-full max-w-4xl p-4 sm:p-6">
      <PageTabs tabs={ROSTER_TABS} isAdmin={isAdminUser(me)} />
      <div className="mb-1 flex items-center justify-between gap-2">
        <h1 className="text-lg font-bold">🔗 구글시트 연결</h1>
        <GuideButton title="구글시트 연결 사용 가이드" sections={GUIDE_SECTIONS} />
      </div>
      <p className="mb-3 text-xs leading-relaxed text-slate-500">
        명부는 구글시트에서만 갱신됩니다. 시트가 <b>10분마다 앱으로 보내오고</b>, 들어온 줄은 <b>확인한 뒤에</b> 명부에
        들어갑니다.
      </p>

      <RosterSyncClient />
    </div>
  );
}
