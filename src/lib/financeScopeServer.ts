import { cookies } from "next/headers";
import { FINANCE_SCOPE_COOKIE, resolveScope } from "@/lib/financeScope";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadStudents } from "@/lib/students";
import { ALL_SCOPE } from "@/lib/department";
import { inScope } from "@/lib/financeScope";
/** 서버 화면이 지금 회계 범위를 읽는 곳. 화면마다 쿠키를 직접 읽지 않습니다. */
export async function getFinanceScope(me: { department?: string | null }): Promise<string> {
  const jar = await cookies();
  return resolveScope(jar.get(FINANCE_SCOPE_COOKIE)?.value ? decodeURIComponent(jar.get(FINANCE_SCOPE_COOKIE)!.value) : null, me.department);
}


/**
 * 이 장부에 드는 학생 번호. **「전체 회계」면 null** 입니다(거르지 않음).
 *
 * 퇴소생도 넣습니다 - 지난 청구서·미납은 퇴소한 뒤에도 그 부서의 장부에 남아야 합니다.
 */
export async function scopeStudentIds(supabase: SupabaseClient, scope: string): Promise<Set<string> | null> {
  if (scope === ALL_SCOPE) return null;
  const { rows } = await loadStudents(supabase, { status: "all" });
  return new Set(rows.filter((s) => inScope(scope, s)).map((s) => s.id));
}

/** 학생 번호가 장부에 드는가. 장부가 「전체」(null)면 언제나 듭니다. 번호가 없는 줄은 「전체」에만 둡니다. */
export function inScopeIds(ids: Set<string> | null, studentId: string | null | undefined): boolean {
  if (!ids) return true;
  return !!studentId && ids.has(studentId);
}
