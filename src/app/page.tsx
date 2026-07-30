import { redirect } from "next/navigation";

// 루트("/")는 항상 /home으로 보냅니다. 로그인 여부는 middleware.ts가 먼저 확인하므로
// 여기서는 별도 인증 검사 없이 그냥 넘겨도 안전합니다.
export default function RootPage() {
  redirect("/home");
}
