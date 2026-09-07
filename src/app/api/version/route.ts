import { NextResponse } from "next/server";
import { APP_VERSION } from "@/lib/version";

// 지금 서버에 올라와 있는 버전.
//
// 브라우저는 한 번 받아둔 자바스크립트를 계속 씁니다. 그래서 새 버전을 배포해도, 탭을 켜둔
// 사람은 **어제 코드로 계속 일합니다.** 고쳐놓은 버그가 그 사람 화면에서는 그대로 나고,
// 새로 만든 칸은 아예 없습니다. 화면에는 아무 표시도 없어서 본인은 최신인 줄 압니다.
//
// 이 주소는 늘 서버에서 새로 계산해 지금 버전을 알려줍니다. 화면이 자기 버전과 견주어
// 다르면 새로고침을 권합니다(자동으로 새로고침하지는 않습니다 - 아래 참고).
//
// 로그인 검사를 하지 않습니다. 버전 숫자는 비밀이 아니고, 로그인 화면에 머문 사람도
// 오래된 코드를 쓰고 있을 수 있습니다.
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  return NextResponse.json(
    { version: APP_VERSION },
    { headers: { "Cache-Control": "no-store, max-age=0" } }
  );
}
