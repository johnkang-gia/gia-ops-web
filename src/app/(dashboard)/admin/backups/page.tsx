import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import { isAdminUser } from "@/lib/roles";
import type { BackupSummary } from "@/lib/types";
import AdminBackupsClient from "@/components/admin/AdminBackupsClient";

export const dynamic = "force-dynamic";

// 데이터 백업/복원 - 사건/회의/행사/제안함/채택예정/매뉴얼/업무/서류함이 실수나 버그로 꼬이거나
// 날아가는 사고에 대비한 안전망입니다(요청: "데이터가 꼬여서 날아가버리지않게 백업할수있게
// 만들어주고 백업복원도 관리자,개발자권한을 가진사람이 복원 할 수 있게"). 화면 접근은 관리자/
// 개발자로 제한하고(isAdminUser와 동일 기준), 실제 백업 생성·복원은 DB의 create_backup/
// restore_backup 함수가 한 번 더 is_app_admin()을 확인합니다(이중 방어).
export default async function AdminBackupsPage() {
  const me = await getCurrentAppUser();
  if (!me) redirect("/login");
  if (!isAdminUser(me)) {
    redirect("/home");
  }

  const supabase = await createClient();
  // snapshot(실제 백업 내용)은 목록에서는 안 내려받습니다 - 백업이 쌓일수록 목록 조회 자체가
  // 무거워지는 걸 막기 위해서입니다(복원은 id만으로 서버(RPC)가 처리합니다).
  const { data } = await supabase
    .from("backups")
    .select("id, label, created_by, created_at, tables")
    .order("created_at", { ascending: false });

  return <AdminBackupsClient initialBackups={(data as BackupSummary[] | null) ?? []} />;
}
