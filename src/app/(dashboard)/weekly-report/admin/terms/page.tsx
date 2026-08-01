import { redirect } from "next/navigation";

// 위클리 리포트도 이제 운영(gia-ops)과 같은 학기 체계(terms - 연도+학기유형, 정규학기/캠프
// 통합)를 씁니다. 학기 관리 화면을 따로 두지 않고 기존 [학기] 화면 하나로 합쳤습니다.
export default function TermManageRedirectPage() {
  redirect("/terms");
}
