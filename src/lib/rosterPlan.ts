import type { SupabaseClient } from "@supabase/supabase-js";
import type { RosterField } from "./pasteRoster";
import { assignClass, loadClasses } from "./classAssign";

/**
 * 붙여넣은/시트에서 받은 줄이 명부에 **무엇을 바꾸는지** 계산합니다.
 *
 * 붙여넣기 화면과 구글시트 자동 수신이 각자 계산하면 같은 줄을 두고 두 화면이 다른 답을
 * 냅니다. 어느 쪽이 맞는지 아무도 모르게 되므로 판단은 여기 한 곳에서만 합니다.
 */

export type PlanKind = "새로 등록" | "바뀜" | "그대로" | "확인 필요";

export type RosterRow = { rowNo: number; values: Partial<Record<RosterField, string>> };

export type StudentLite = {
  id: string;
  name: string;
  birth_date: string | null;
  name_en: string | null;
  grade: string | null;
  class_name: string | null;
  student_no: string | null;
  status: string | null;
  mother_phone?: string | null;
  father_phone?: string | null;
  parent_phone?: string | null;
};

export type RosterPlan = {
  rowNo: number;
  name: string;
  kind: PlanKind;
  /** 어느 칸이 어떻게 바뀌는지. 「무엇이 달라지는가」를 못 보여주면 사람이 못 판단합니다. */
  changes: { field: string; from: string; to: string }[];
  reason?: string;
  studentId?: string;
};

/** 명부에 옮겨 적는 칸. 이름은 짝을 찾는 열쇠라 여기 없습니다. */
export const PLAN_FIELDS: [RosterField, string, keyof StudentLite][] = [
  ["name_en", "영문 이름", "name_en"],
  ["grade", "학년", "grade"],
  ["class_name", "반", "class_name"],
  ["birth_date", "생년월일", "birth_date"],
  ["student_no", "학번", "student_no"],
  ["mother_phone", "어머니 연락처", "mother_phone"],
  ["father_phone", "아버지 연락처", "father_phone"],
  ["parent_phone", "보호자 연락처", "parent_phone"],
];

const norm = (s: string | null | undefined) => (s ?? "").normalize("NFC").trim().toLowerCase().replace(/\s+/g, "");

export function planRoster(existing: StudentLite[], rows: RosterRow[]): RosterPlan[] {
  const plans: RosterPlan[] = [];

  for (const r of rows) {
    const v = r.values ?? {};
    const name = (v.name ?? "").trim();
    if (!name) continue;

    // 짝 찾기: 생년월일이 있으면 **이름+생일**이 가장 확실합니다. 없으면 이름으로만 찾되,
    // 같은 이름이 둘 이상이면 **고르지 않습니다** - 잘못 고르면 남의 기록에 붙습니다.
    const byBirth = v.birth_date
      ? existing.filter((s) => norm(s.name) === norm(name) && s.birth_date === v.birth_date)
      : [];
    const byName = existing.filter((s) => norm(s.name) === norm(name));
    const hit = byBirth[0] ?? (byName.length === 1 ? byName[0] : null);

    if (!hit && byName.length > 1) {
      plans.push({
        rowNo: r.rowNo,
        name,
        kind: "확인 필요",
        changes: [],
        reason: `명부에 「${name}」이(가) ${byName.length}명 있습니다. 생년월일 칸을 함께 붙여넣으면 자동으로 갈립니다.`,
      });
      continue;
    }

    if (!hit) {
      plans.push({
        rowNo: r.rowNo,
        name,
        kind: "새로 등록",
        changes: PLAN_FIELDS.filter(([f]) => v[f]).map(([f, label]) => ({ field: label, from: "", to: v[f]! })),
      });
      continue;
    }

    // **비어 있는 칸만 채우지 않습니다** - 시트가 최신이므로 값이 다르면 시트를 따릅니다.
    // 다만 무엇이 덮이는지 전부 보여주고, 시트가 비어 있으면 기존 값을 지우지 않습니다.
    const changes = PLAN_FIELDS.filter(([f, , col]) => {
      const to = v[f];
      if (!to) return false;
      return String(hit[col] ?? "") !== to;
    }).map(([f, label, col]) => ({ field: label, from: String(hit[col] ?? ""), to: v[f]! }));

    plans.push({
      rowNo: r.rowNo,
      name,
      kind: changes.length > 0 ? "바뀜" : "그대로",
      changes,
      studentId: hit.id,
      reason: hit.status && hit.status !== "active" ? `지금 「${hit.status}」 상태입니다 — 넣으면 재학으로 돌아옵니다.` : undefined,
    });
  }

  return plans;
}

const WRITE_COLS = [
  "name_en", "grade", "class_name", "birth_date", "student_no",
  "mother_phone", "father_phone", "parent_phone",
] as const;

/**
 * 계산된 계획대로 실제로 넣습니다.
 *
 * 한 명이 실패해도 나머지는 넣되, **누가 왜 실패했는지 돌려줍니다.** 전부 되돌리면 어디까지
 * 됐는지 알 수 없고, 실패를 삼키면 안 들어간 학생이 조용히 사라집니다.
 */
export async function applyRosterPlans(
  supabase: SupabaseClient,
  plans: RosterPlan[],
  valueOf: (p: RosterPlan) => Partial<Record<RosterField, string>>,
): Promise<{ inserted: number; updated: number; failed: string[] }> {
  const failed: string[] = [];
  let inserted = 0;
  let updated = 0;

  // 반 이름을 **연결까지** 붙이려면 지금 있는 반 목록이 필요합니다. 한 번만 읽습니다.
  //
  // 예전에는 이름만 넣었습니다. 그래서 시트에 반이 적혀 있어도 반 배정 화면에서는 그 아이가
  // 「미배정」에 있었고, 화면에는 반 이름이 잘 보이니 아무도 이상하다고 느끼지 못했습니다.
  const classes = await loadClasses(supabase);

  for (const p of plans) {
    const v = valueOf(p);
    const cls = assignClass(v.class_name, classes, v.grade);
    if (p.kind === "새로 등록") {
      const { error } = await supabase.from("wr_students").insert({
        name: p.name,
        name_en: v.name_en ?? null,
        grade: v.grade ?? cls.grade ?? null,
        ...cls,
        birth_date: v.birth_date ?? null,
        student_no: v.student_no ?? null,
        mother_phone: v.mother_phone ?? null,
        father_phone: v.father_phone ?? null,
        parent_phone: v.parent_phone ?? null,
        status: "active",
        // 값으로 못박습니다. 필터가 아니라 값이어야 데모 학생과 절대 안 섞입니다.
        is_demo: false,
      });
      if (error) failed.push(`${p.name}(${error.message})`);
      else inserted++;
    } else if (p.kind === "바뀜" && p.studentId) {
      const patch: Record<string, string | null> = { status: "active" };
      for (const k of WRITE_COLS) if (v[k]) patch[k] = v[k]!;
      // 반이 바뀌었으면 **연결도 함께** 바꿉니다. 이름만 바꾸면 그 아이는 화면상 새 반인데
      // 실제로는 옛 반에 매달린 채로 남습니다.
      if (v.class_name) Object.assign(patch, cls);
      const { error } = await supabase.from("wr_students").update(patch).eq("id", p.studentId);
      if (error) failed.push(`${p.name}(${error.message})`);
      else updated++;
    }
  }

  return { inserted, updated, failed };
}
