import { redirect } from "next/navigation";

// 예전 "관리자 대시보드" 화면입니다. 여기 있던 분석(반복 사건·학생 랭킹·월별 추이·부서별
// 완료율)은 학교 관리 대시보드(/school)로 합쳤습니다(요청: "중복되는 기능들을 통합"). 이 경로를
// 즐겨찾기해둔 사람이 있을 수 있어 URL 자체는 남겨두고 /school로 그대로 보내줍니다.
export default function AdminDashboardRedirectPage() {
  redirect("/school");
}
