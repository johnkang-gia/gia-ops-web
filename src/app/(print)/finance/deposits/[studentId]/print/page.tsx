import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import { hasFinanceAccess } from "@/lib/roles";
import { loadDepositStatement } from "@/lib/depositStatement";
import { todayKst } from "@/lib/kst";
import DepositStatementSheet from "@/components/finance/DepositStatementSheet";

export const dynamic = "force-dynamic";

/**
 * **예치금 사용내역서 인쇄본.** 학생 번호로 엽니다 - 공유 묶음이면 묶음 전체가 한 장에 나옵니다.
 *
 * 열 때마다 입금 줄에서 다시 셉니다. 숫자를 굳혀 두지 않으므로, 보낸 뒤에 차감을 고치면 다시 뽑은 종이가 그 사실을
 * 따라갑니다(기준일이 함께 찍힙니다).
 */
// finance-live-ok: 그 순간을 찍는 인쇄본입니다.

export async function generateMetadata({ params }: { params: Promise<{ studentId: string }> }) {
  try {
    const { studentId } = await params;
    const { students } = await loadDepositStatement(await createClient(), studentId);
    // 「PDF로 저장」의 파일 이름이 됩니다. 비우면 모두 같은 이름으로 저장됩니다.
    return { title: `${students.map((s) => s.name).join("·") || "학생"} 예치금 사용내역서 ${todayKst()}` };
  } catch {
    return { title: "예치금 사용내역서" };
  }
}

export default async function DepositStatementPage({ params }: { params: Promise<{ studentId: string }> }) {
  const me = await getCurrentAppUser();
  if (!me) redirect("/login");
  if (!hasFinanceAccess(me)) redirect("/home");
  const { studentId } = await params;
  const { statement, share, students } = await loadDepositStatement(await createClient(), studentId);
  return <DepositStatementSheet statement={statement} students={students} shareName={share?.name ?? null} asOf={todayKst()} />;
}
