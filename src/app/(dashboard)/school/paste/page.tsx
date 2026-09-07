import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentAppUser } from "@/lib/currentUser";
import { isStaffOrAboveUser } from "@/lib/roles";
import GuideButton from "@/components/common/GuideButton";
import PasteRosterClient from "@/components/school/PasteRosterClient";

export const dynamic = "force-dynamic";

const GUIDE_SECTIONS = [
  {
    title: "📋 어떻게 쓰나요?",
    lines: [
      "상자가 «둘»입니다. ① 머리줄(이름·학년·반 …) 한 줄, ② 학생 줄 여러 줄. 어디에 무엇이 들어가는지 사람이 정해주면 앱이 알아맞힐 일이 없습니다 - 한 상자에 같이 넣던 때는 머리줄이 학생 한 명으로 들어가는 일이 있었습니다.",
      "머리줄의 글자를 보고 어느 칸인지 앱이 정합니다. 시트의 칸 순서가 달라도 됩니다 - 순서를 코드에 박아두면 어느 날 조용히 학년 칸에 반 이름이 들어갑니다.",
      "③ 칸 짝짓기는 «언제나» 고칠 수 있습니다. 칸마다 그 칸의 실제 값 예시가 함께 나오니, 머리글이 헷갈리면 값을 보고 고르면 됩니다.",
      "머리줄 상자를 비워두면 칸을 전부 직접 고르게 합니다. 짐작해서 넣지 않습니다.",
      "붙여넣자마자 등록되지 않습니다. [무엇이 바뀌는지 먼저 보기]로 확인한 뒤 [이대로 넣기]를 눌러야 들어갑니다.",
    ],
  },
  {
    title: "🔍 짝은 어떻게 찾나요?",
    lines: [
      "이름 + 생년월일이 같으면 같은 학생으로 봅니다. 가장 확실한 조합입니다.",
      "생년월일이 없으면 이름으로만 찾되, 같은 이름이 둘 이상이면 «확인 필요»로 두고 건드리지 않습니다 - 잘못 고르면 남의 출결·관찰기록에 붙습니다. 그때는 시트에 생년월일 칸을 넣어 다시 붙여넣으면 저절로 갈립니다.",
      "시트에서 비어 있는 칸은 건드리지 않습니다. 시트에 값이 있으면 시트를 따릅니다(시트가 최신이므로).",
      "보류·퇴원 상태였던 학생이 시트에 다시 있으면 재학으로 돌아옵니다.",
    ],
  },
  {
    title: "📞 값은 어떻게 다듬나요?",
    lines: [
      "전화번호는 숫자만 남깁니다. 010-1234-5678, 01012345678, +82 10-1234-5678 이 모두 같은 번호가 됩니다 - 그대로 두면 같은 번호가 세 가지로 저장되고 번호로 찾는 화면이 어긋납니다.",
      "생년월일은 2015-03-04 / 2015.3.4 / 2015/03/04 / 20150304 을 읽습니다. 두 자리 연도(15.3.4)는 읽지 않습니다 - 1915년인지 2015년인지 기계가 정하면 언젠가 틀립니다.",
    ],
  },
];

export default async function PasteRosterPage() {
  const me = await getCurrentAppUser();
  if (!me) redirect("/login");
  if (!isStaffOrAboveUser(me)) redirect("/home");

  return (
    <div className="mx-auto w-full max-w-4xl p-4 sm:p-6">
      <div className="mb-1 flex items-center justify-between gap-2">
        <h1 className="text-lg font-bold">📋 명부 붙여넣기</h1>
        <GuideButton title="명부 붙여넣기 사용 가이드" sections={GUIDE_SECTIONS} />
      </div>
      <p className="mb-3 text-xs leading-relaxed text-slate-500">
        <b>머리줄</b>과 <b>학생 줄</b>을 각각 붙여넣으면 칸을 알아서 읽습니다. 넣기 전에 <b>무엇이 새로 생기고
        무엇이 바뀌는지</b> 먼저 보여줍니다 — 명부는 되돌리기 어렵습니다.{" "}
        <Link href="/school/data-check" className="font-semibold text-teal-700 underline">
          명부 점검
        </Link>
        에서 넣은 결과와 중복을 확인할 수 있습니다.
      </p>

      <PasteRosterClient />
    </div>
  );
}
