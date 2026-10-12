import { redirect } from "next/navigation";
import { getCurrentAppUser } from "@/lib/currentUser";
import { hasFinanceAccess } from "@/lib/roles";
import AlltalkSyncClient from "@/components/finance/AlltalkSyncClient";

export const dynamic = "force-dynamic";

/**
 * **올톡 대조** — 올톡페이 「청구서관리목록」을 올리면 학생마다 운영앱과 어떻게 다른지, 무엇을
 * 하면 맞는지를 한 화면에 늘어놓고 그 자리에서 처리합니다.
 *
 * 청구는 앱에서, 발송·결제는 올톡페이에서 일어나서 두 곳이 매달 어긋납니다. 엑셀로 대조표를
 * 뽑아 한 줄씩 금전 창을 열어 넣는 일을 이 화면 한 장으로 줄입니다. 넣는 것은 여전히 사람이
 * 누릅니다 - 자동으로 맞추면 틀린 13%가 «정상»으로 보이는 채로 남습니다.
 */
export default async function AlltalkSyncPage() {
  const me = await getCurrentAppUser();
  if (!me) redirect("/login");
  if (!hasFinanceAccess(me)) redirect("/home");
  return <AlltalkSyncClient />;
}
