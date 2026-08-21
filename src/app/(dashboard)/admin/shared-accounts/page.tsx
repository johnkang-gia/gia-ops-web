import { redirect } from "next/navigation";
import { getCurrentAppUser } from "@/lib/currentUser";
import { isAdminUser } from "@/lib/roles";
import GuideButton from "@/components/common/GuideButton";
import SharedAccountsClient from "@/components/admin/SharedAccountsClient";

export const dynamic = "force-dynamic";

const GUIDE_SECTIONS = [
  {
    title: "🔑 공용 계정이란?",
    lines: [
      "특정 개인이 아니라 자리나 용도에 딸린 계정입니다. 회사 구글 계정 대신 아이디와 비밀번호로 로그인합니다(로그인 화면 아래 [공용 계정으로 로그인]).",
      "gia-demo — 신입교사 오리엔테이션용입니다. 교사 화면이 실제와 똑같이 보이지만 학생은 전부 가짜 데이터라, 설명하면서 마음껏 눌러보고 저장해도 실제 기록에는 아무 영향이 없습니다.",
      "gia-library — 도서관 대출 노트북 전용입니다. 이 계정으로는 운영앱(사건기록·학생 개인정보)에 들어올 수 없고 도서관 시스템만 열립니다.",
    ],
  },
  {
    title: "🔒 비밀번호를 다루는 방법",
    lines: [
      "비밀번호는 한 방향으로만 저장되어 관리자도 다시 꺼내볼 수 없습니다. 잊어버렸다면 이 화면에서 새로 정하면 됩니다.",
      "[자동 생성]을 누르면 브라우저가 예측 불가능한 16자리를 만들어줍니다. 0과 O처럼 헷갈리는 글자는 빠져 있어 종이에 적어 전달하기 좋습니다.",
      "여러 사람이 나눠 쓰는 계정이므로, 개인 계정에 쓰는 비밀번호를 절대 재사용하지 마세요.",
      "쓰지 않게 된 계정은 지우지 말고 [사용중지]로 잠가주세요. 지우면 그 계정이 남긴 기록의 연결이 끊깁니다.",
    ],
  },
  {
    title: "🧑‍🏫 오리엔테이션 진행 방법",
    lines: [
      "신입 선생님 노트북에서 gia-demo로 로그인하면 [내 담임반]에 3학년 Demo 반 학생 8명이 보입니다.",
      "학생 카드를 눌러 주간 관찰기록을 실제로 작성해보게 하세요. 김서준 학생에는 완성된 예시가, 이하윤 학생에는 임시저장 상태가 미리 들어 있어 '어느 정도로 적으면 되는지' 바로 보여줄 수 있습니다.",
      "[내 반 픽업 체크]에서는 6명이 데모 노선에 배정되어 있고 2명은 셔틀 미탑승이라, 두 경우가 어떻게 다르게 보이는지 함께 설명할 수 있습니다.",
      "원어민 선생님께는 사이드바 아래 [한국어 / English] 버튼으로 화면을 영어로 바꿔 보여주세요.",
    ],
  },
];

// 요청: "도서관이랑, 오리엔테이션용 가계정을 만들어서 관리하게 해줘"
//
// 계정을 새로 만들 수 있는 화면이라 관리자·개발자에게만 엽니다. 서버 API(/api/admin/shared-accounts)
// 에서도 같은 확인을 다시 하므로, 주소를 직접 입력해 들어오더라도 아무 것도 할 수 없습니다.
export default async function SharedAccountsPage() {
  const me = await getCurrentAppUser();
  if (!me) redirect("/login");
  if (!isAdminUser(me)) redirect("/home");

  return (
    <div className="mx-auto max-w-3xl p-4 sm:p-6">
      <div className="mb-1 flex items-center justify-between gap-2">
        <h1 className="text-lg font-bold">🔑 공용 계정 관리</h1>
        <GuideButton title="공용 계정 관리 가이드" sections={GUIDE_SECTIONS} />
      </div>
      <p className="mb-5 text-xs leading-relaxed text-slate-500">
        도서관 노트북·신입교사 오리엔테이션처럼 여러 사람이 함께 쓰는 계정을 여기서 만들고 비밀번호를 관리합니다. 개인 교직원
        계정은 회사 구글 계정으로 로그인하므로 여기에 만들지 않습니다.
      </p>
      <SharedAccountsClient />
    </div>
  );
}
