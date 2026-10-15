import type { SupabaseClient } from "@supabase/supabase-js";
import { assignClass, loadClasses, type ClassRow } from "@/lib/classAssign";
import { loadStudents, type Student } from "@/lib/students";
import { normName } from "@/lib/studentDuplicates";

/**
 * **학생을 새로 만드는 곳은 여기 하나입니다.**
 *
 * 학생 관리(한 명·붙여넣기)·학교 가져오기·구글시트 명부 반영이 각자 `insert` 를 했습니다. 셋 다 같은 이름이
 * 이미 있는지 보지 않았고, 붙여넣기는 반 연결도 안 붙이고 실패도 삼켰습니다. 그래서 같은 아이가 두 줄로 생겼고,
 * 명부 점검에 가서야 «중복 의심»으로 발견됐습니다 - 그때는 이미 두 줄에 출결·청구가 나뉘어 쌓인 뒤입니다.
 *
 * 규칙:
 *   1. 같은 이름(공백·가운뎃점 무시)이 명부에 있으면 **넣지 않고 돌려줍니다**(`needsConfirm`). 기존 학생의 반·생일·
 *      상태를 함께 줘서, 화면이 «같은 학생 / 다른 학생»을 사람에게 묻습니다. 퇴소생도 비교합니다 - 다시 들어온 아이가
 *      새 줄로 생기는 것이 가장 흔한 중복입니다.
 *   2. 사람이 «다른 학생»을 고른 줄만 `homonym_ok` 를 달고 넣습니다. 데이터베이스 문지기
 *      (`guard_student_same_name`)가 이 표시 없이 같은 이름을 넣는 줄을 거절합니다 - 이 함수를 안 거친 새 길이
 *      생겨도 거기서 막힙니다.
 *   3. 반은 `assignClass` 로 이름과 연결을 함께 넣고, `is_demo: false` 를 값으로 못박습니다.
 *   4. 실패는 이름과 이유를 모아 돌려줍니다. 삼키지 않습니다.
 */

export type NewStudentInput = {
  name: string;
  name_en?: string | null;
  grade?: string | null;
  class_name?: string | null;
  birth_date?: string | null;
  student_no?: string | null;
  mother_phone?: string | null;
  father_phone?: string | null;
  parent_phone?: string | null;
  /** 그 밖의 칸(성별·주소·알레르기 …). 반·데모·상태는 여기서 덮어씁니다. */
  extra?: Record<string, unknown>;
  /** 사람이 «이름은 같지만 다른 학생»으로 확인했습니다. */
  homonymOk?: boolean;
};

export type SameNameHit = Pick<Student, "id" | "name" | "grade" | "class_name" | "birth_date" | "status"> & {
  /** 명부가 아니라 같은 붙여넣기 안의 다른 줄입니다. */
  inBatch?: boolean;
};

export type NeedsConfirm = { row: NewStudentInput; index: number; hits: SameNameHit[] };

/**
 * 순수 함수 — 어떤 줄이 사람의 확인을 기다려야 하나.
 *
 * 같은 붙여넣기 안에서 같은 이름이 두 번 나와도 묻습니다. 한 줄을 실수로 두 번 붙여넣은 경우가 대부분입니다.
 */
export function checkSameNames(existing: readonly SameNameHit[], rows: readonly NewStudentInput[]): { ready: number[]; needsConfirm: NeedsConfirm[] } {
  const byKey = new Map<string, SameNameHit[]>();
  for (const s of existing) {
    const k = normName(s.name);
    if (k) (byKey.get(k) ?? byKey.set(k, []).get(k)!).push(s);
  }
  const ready: number[] = [];
  const needsConfirm: NeedsConfirm[] = [];
  const seen = new Map<string, NewStudentInput>();
  rows.forEach((row, index) => {
    const k = normName(row.name);
    const hits: SameNameHit[] = [...(byKey.get(k) ?? [])];
    const prev = seen.get(k);
    if (prev) hits.push({ id: "", name: prev.name, grade: prev.grade ?? null, class_name: prev.class_name ?? null, birth_date: prev.birth_date ?? null, status: "이번 붙여넣기", inBatch: true });
    seen.set(k, row);
    if (hits.length > 0 && !row.homonymOk) needsConfirm.push({ row, index, hits });
    else ready.push(index);
  });
  return { ready, needsConfirm };
}

/** 묶음 열쇠 — 명부 점검의 「다른 아이로 확인」과 같은 모양(번호를 정렬해 이음). */
const groupKeyOf = (ids: string[]) => ids.slice().sort().join("|");

export type AddResult = {
  inserted: (Student & Record<string, unknown>)[];
  needsConfirm: NeedsConfirm[];
  failed: string[];
  /** 반 이름이 명부의 반과 안 맞아 연결을 비운 학생. 화면이 알려야 합니다(CLAUDE.md 2-5). */
  classMissing: string[];
};

export async function addStudents(
  supabase: SupabaseClient,
  rows: readonly NewStudentInput[],
  opts: { classes?: ClassRow[]; by?: string | null } = {},
): Promise<AddResult> {
  const result: AddResult = { inserted: [], needsConfirm: [], failed: [], classMissing: [] };
  const clean = rows.map((r) => ({ ...r, name: (r.name ?? "").trim() })).filter((r) => r.name);
  if (clean.length === 0) return result;

  // 퇴소생까지 봅니다. 데모 학생은 따로 사는 명단이라 비교하지 않습니다.
  const { rows: existing, error } = await loadStudents(supabase, { status: "all" });
  if (error) return { ...result, failed: [`명부를 읽지 못해 같은 이름을 확인할 수 없습니다: ${error}`] };
  const { ready, needsConfirm } = checkSameNames(existing, clean);
  result.needsConfirm = needsConfirm;

  const classes = opts.classes ?? (await loadClasses(supabase));
  for (const i of ready) {
    const r = clean[i];
    const cls = assignClass(r.class_name, classes, r.grade);
    const { data, error: insErr } = await supabase
      .from("wr_students")
      .insert({
        ...(r.extra ?? {}),
        name: r.name,
        name_en: r.name_en || null,
        grade: r.grade || cls.grade || null,
        ...cls,
        birth_date: r.birth_date || null,
        student_no: r.student_no || null,
        mother_phone: r.mother_phone || null,
        father_phone: r.father_phone || null,
        parent_phone: r.parent_phone || null,
        status: "active",
        // 값으로 못박습니다. 필터가 아니라 값이어야 데모 학생과 절대 안 섞입니다.
        is_demo: false,
        // 칸이 아직 없는 데이터베이스(코드가 몇 분 먼저 배포되는 사이)에서도 평범한 추가는 되도록, 확인한 줄에만 답니다.
        ...(r.homonymOk ? { homonym_ok: true } : {}),
      })
      .select()
      .single();
    if (insErr || !data) {
      result.failed.push(`${r.name}(${insErr?.message ?? "알 수 없는 이유"})`);
      continue;
    }
    const made = data as Student & Record<string, unknown>;
    result.inserted.push(made);
    if (r.class_name?.trim() && !cls.class_id) result.classMissing.push(r.name);

    // 사람이 «다른 학생»으로 확인한 묶음은 명부 점검에서도 내려 둡니다. 같은 판단을 두 번 하게 하면, 두 번째에는
    // 아무도 꼼꼼히 안 봅니다. 줄이 하나라도 늘면 열쇠가 달라져 다시 올라옵니다.
    if (r.homonymOk) {
      const k = normName(r.name);
      const same = [...existing.filter((s) => (s.status === "active" || s.status === "보류") && normName(s.name) === k).map((s) => s.id), made.id];
      for (const x of result.inserted) if (x.id !== made.id && normName(x.name) === k) same.push(x.id);
      const ids = [...new Set(same)];
      if (ids.length > 1) {
        const { error: dErr } = await supabase.from("student_dup_dismissals").upsert(
          {
            group_key: groupKeyOf(ids),
            label: `${r.name} ${ids.length}명`,
            reason: `학생을 추가할 때 다른 학생으로 확인${opts.by ? ` (${opts.by})` : ""}`,
            dismissed_by: opts.by ?? null,
          },
          { onConflict: "group_key" },
        );
        if (dErr) result.failed.push(`${r.name}은(는) 추가했지만 «다른 학생» 확인을 명부 점검에 남기지 못했습니다(${dErr.message})`);
      }
    }
  }
  return result;
}

/** 확인 창에 띄우는 기존 학생 한 줄. */
export function hitLabel(h: SameNameHit): string {
  if (h.inBatch) return "이번에 함께 붙여넣은 다른 줄";
  const parts = [h.grade ? `${h.grade}학년` : null, h.class_name, h.birth_date ? `생일 ${h.birth_date}` : "생일 없음"];
  const st = h.status && h.status !== "active" ? ` · ${h.status === "inactive" ? "퇴소" : h.status}` : "";
  return parts.filter(Boolean).join(" · ") + st;
}
