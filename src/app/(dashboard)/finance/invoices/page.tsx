import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import { hasFinanceAccess } from "@/lib/roles";
import { todayKst } from "@/lib/kst";
import { selectTolerant } from "@/lib/selectTolerant";
import InvoiceGridClient, { type Student } from "@/components/finance/InvoiceGridClient";
import type { FeeItem, Term, Invoice, StudentFeeItem } from "@/lib/types";

export const dynamic = "force-dynamic";

type Row = {
  id: string; name: string; name_en: string | null; grade: string | null; class_name: string | null;
  department: string | null; student_no: string | null;
  mother_phone?: string | null; father_phone?: string | null; parent_phone?: string | null;
  parent_email?: string | null; instrument?: string | null;
};

export default async function InvoicesPage() {
  const me = await getCurrentAppUser();
  if (!me) redirect("/login");
  if (!hasFinanceAccess(me)) redirect("/home");

  const supabase = await createClient();
  // 명부는 **원본 표**에서 읽습니다. 공용 뷰(wr_students_basic)에도 학생이 있지만, 이 화면은
  // 돈에 관한 화면이라 재무 권한으로만 열리고 필요한 칸이 전부 원본에 있습니다.
  const [stuRes, itemsRes, ovRes, invRes, termRes, gmRes, gRes] = await Promise.all([
    // 명부의 칸을 그대로 가져옵니다. 보호자 연락처가 없으면 청구서가 못 나가고, 악기 칸이
    // 없으면 인보이스의 악기가 명부와 어긋나도 아무도 모릅니다.
    //
    // 보호자 연락처·악기는 나중에 붙인 칸이라, 마이그레이션을 아직 안 돌린 DB에는 없습니다.
    // 그 한 칸 때문에 명단 전체가 안 뜨면 안 되므로 없는 칸만 빼고 읽고, 무엇이 없었는지는
    // 화면 위에 띄웁니다.
    selectTolerant<Row>(
      (columns) =>
        supabase
          .from("wr_students")
          .select(columns)
          .eq("status", "active")
          .eq("is_demo", false)
          .order("grade")
          .order("name") as unknown as PromiseLike<{ data: Row[] | null; error: { message: string } | null }>,
      ["id", "name", "name_en", "grade", "class_name", "department", "student_no"],
      ["mother_phone", "father_phone", "parent_phone", "parent_email", "instrument"],
    ),
    supabase.from("fee_items").select("*").order("category").order("sort_order").order("name"),
    supabase.from("student_fee_items").select("*"),
    supabase.from("invoices").select("*").order("issue_date", { ascending: false }).order("created_at", { ascending: false }).limit(1000),
    supabase.from("terms").select("*").order("status").order("start_date", { ascending: false, nullsFirst: false }).order("created_at", { ascending: false }),
    // 수강 그룹 명단. 그룹을 대상으로 삼은 항목(방과후 교재)이 붙는 근거입니다.
    supabase.from("student_group_members").select("group_id, student_id"),
    supabase.from("student_groups").select("id, name"),
  ]);
  if (termRes.error) console.error("[인보이스] 학기를 읽지 못했습니다:", termRes.error.message);

  // 학생 → 속한 그룹. 그룹을 대상으로 삼은 항목이 붙으려면 이것이 있어야 합니다.
  const groupOf: Record<string, string[]> = {};
  for (const m of ((gmRes.data as { group_id: string; student_id: string }[] | null) ?? [])) {
    (groupOf[m.student_id] ??= []).push(m.group_id);
  }

  // 항목에 그룹 이름을 붙여 둡니다. 표의 열 머리에 '수강 그룹' 대신 실제 이름이 떠야
  // 무슨 항목인지 알 수 있습니다.
  const groupName = new Map(((gRes.data as { id: string; name: string }[] | null) ?? []).map((g) => [g.id, g.name]));
  const itemsWithGroupName = ((itemsRes.data as FeeItem[] | null) ?? []).map((i) =>
    i.target_group_id ? { ...i, target_group_name: groupName.get(i.target_group_id) ?? null } : i,
  );

  const students: Student[] = stuRes.data.map((s) => ({
    id: s.id,
    name: s.name,
    nameEn: s.name_en,
    grade: s.grade,
    className: s.class_name,
    department: s.department,
    studentNo: s.student_no,
    motherPhone: s.mother_phone ?? null,
    fatherPhone: s.father_phone ?? null,
    parentPhone: s.parent_phone ?? null,
    parentEmail: s.parent_email ?? null,
    instrument: s.instrument ?? null,
    // 수강 그룹(방과후·악기반). 이걸 안 넘기면 그룹 대상 항목이 아무에게도 안 붙습니다.
    groupIds: groupOf[s.id] ?? [],
  }));

  // 빠진 칸은 감추지 않습니다. 연락처 없이 명단만 보이면 청구가 왜 안 나가는지 알 수 없습니다.
  const missingNote =
    stuRes.missing.length > 0
      ? `명부에 아직 없는 칸: ${stuRes.missing.join(", ")} — 이 칸들은 비어 보입니다. 보호자 연락처 SQL(20260903060000_guardian_phones.sql)을 실행하면 채워집니다.`
      : null;
  const loadError =
    stuRes.error ?? itemsRes.error?.message ?? ovRes.error?.message ?? invRes.error?.message ?? missingNote;

  return (
    <InvoiceGridClient
      students={students}
      items={itemsWithGroupName}
      initialOverrides={(ovRes.data as StudentFeeItem[] | null) ?? []}
      recentInvoices={(invRes.data as Invoice[] | null) ?? []}
      terms={(termRes.data as Term[] | null) ?? []}
      currentUserEmail={me.email}
      loadError={loadError}
      today={todayKst()}
    />
  );
}
