import { NextResponse } from "next/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import { isDeveloperEmail } from "@/lib/roles";
import { probeAnon } from "@/lib/inspectRun";

/**
 * **로그인 없이 무엇이 읽히는가** — 눌렀을 때만 돕니다.
 *
 * 표 164개를 하나씩 물어봐야 하고(한 번에 묻는 창구가 없습니다) 표당 30밀리초쯤,
 * 전부 4~5초입니다. 점검 화면을 열 때마다 돌려서 그 화면이 6.2초였습니다.
 *
 * 빠르게 만드는 다른 길은 **추측하는 것**입니다 - 정책만 읽어 「열렸을 것이다」를 계산하면
 * 한 번에 끝납니다. 그 추측이 틀려서 이 저장소에서 세 번 새어나갔으므로(뷰 아홉 개 ·
 * 표 여섯 개 · 역할 없는 정책 넷) 실제로 물어보는 쪽을 지킵니다. 대신 **언제 물어볼지**를
 * 사람이 정합니다.
 *
 * 개발자만 부릅니다. 돌려주는 것이 「무엇이 뚫려 있는지」의 목록이라, 이 답 자체가 열쇠에
 * 가깝습니다.
 */

export const dynamic = "force-dynamic";

export async function POST() {
  const me = await getCurrentAppUser();
  if (!me) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  if (!isDeveloperEmail(me.email)) return NextResponse.json({ error: "개발자만 쓸 수 있습니다." }, { status: 403 });

  const rows = await probeAnon();
  return NextResponse.json({ rows });
}
