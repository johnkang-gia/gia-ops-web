import Link from "next/link";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * **아직 아무도 판단하지 않은 같은 이름 묶음** — 학생 관리·학교 화면 위에 띄우는 띠.
 *
 * 명부 점검 화면에만 두면 그 화면을 일부러 여는 사람만 봅니다. 같은 아이가 두 줄인 채로 며칠이 지나면 두 줄에
 * 출결·청구가 나뉘어 쌓이고, 그만큼 합치기가 어려워집니다. 그래서 학생을 다루는 화면 위에 숫자로 띄웁니다.
 * 판정은 데이터베이스 뷰(`student_same_name_open`) 하나가 하고, 사람이 «다른 아이로 확인»한 묶음은 빠집니다.
 */
export default async function SameNameBanner({ supabase }: { supabase: SupabaseClient }) {
  const { data, error } = await supabase.from("student_same_name_open").select("name, n, people");
  // 뷰가 아직 없으면(마이그레이션 적용 전) 띠를 안 띄웁니다 - 그 사실은 개발자 › 진단이 알려줍니다.
  if (error) return null;
  const rows = (data as { name: string; n: number; people: string }[] | null) ?? [];
  if (rows.length === 0) return null;
  return (
    <Link
      href="/school/data-check"
      className="mb-3 block rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 hover:bg-amber-100"
    >
      <b>같은 이름 {rows.length}묶음을 아직 확인하지 않았습니다</b> — {rows.slice(0, 4).map((r) => `${r.name}(${r.n}명)`).join(" · ")}
      {rows.length > 4 ? ` 외 ${rows.length - 4}` : ""}. 같은 아이면 합치고, 다른 아이면 «다른 아이로 확인»을 눌러 주세요 ›
    </Link>
  );
}
