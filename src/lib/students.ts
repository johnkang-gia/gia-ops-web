import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * **명부를 읽는 함수 하나.**
 *
 * ── 무엇이 문제였나 ──────────────────────────────────────────────────
 *
 * `wr_students` 를 79 파일이 16가지 칸 조합으로 읽었습니다. 8곳은 `id, name, grade, class_name`
 * 만, 4곳은 `*`, 어떤 곳은 `birth_date` 를 빼고, 어떤 곳은 `status` 를 안 걸었습니다. 그래서
 *
 *   · 동명이인(김재이 셋)을 가르는 칸(`class_name` · `birth_date`)을 안 읽어 와서 규칙이
 *     멀쩡해도 「김재이」 하나로 뜨는 사고가 네 번 났고,
 *   · `is_demo` 를 빠뜨려 연습용 학생이 실제 명단에 섞일 뻔했고,
 *   · `status` 조건이 화면마다 달라 어떤 명단에는 퇴소한 아이가 나왔습니다.
 *
 * 전부 빌드 검사로 막고 있었습니다(check-roster-columns · check-demo-isolation). 검사가 잡는
 * 것은 「빠뜨린 자리」인데, 빠뜨릴 수 있는 구조 자체가 문제였습니다.
 *
 * ── 그래서 ───────────────────────────────────────────────────────────
 *
 * 읽는 칸은 **늘 같고**(`STUDENT_COLUMNS`), `is_demo` 와 `status` 는 여기서 겁니다. 화면은
 * 범위만 말합니다. 명부에 칸이 하나 늘면 여기 한 줄만 고칩니다.
 *
 *   demo      연습용 명부인가. 교사 화면은 `isDemoAccount(me.email)`, 나머지는 false(기본).
 *   status    "active"(기본) · "all"(퇴소 포함 - 이력·프로필 화면만)
 *   ids       이 번호들만. 빈 배열이면 빈 결과(한 번도 묻지 않습니다).
 *   classId   이 반만(담임 화면).
 *   phones    보호자·결제 번호까지. 행정실 이상에게만 보여야 하는 칸이라 따로 켭니다.
 *
 * 한 명만 읽을 때는 `loadStudent` 를 씁니다. 넣고 고치는 자리는 이 파일의 일이 아닙니다.
 */
export const STUDENT_COLUMNS =
  "id, name, name_en, grade, class_name, class_id, department, birth_date, status, student_no, sibling_group_id, photo_path";

const PHONE_COLUMNS = "mother_phone, father_phone, parent_phone, billing_phone, billing_phone_role";

export type Student = {
  id: string;
  name: string;
  name_en: string | null;
  grade: string | null;
  class_name: string | null;
  class_id: string | null;
  department: string | null;
  birth_date: string | null;
  status: string;
  student_no: string | null;
  sibling_group_id: string | null;
  photo_path: string | null;
};

export type StudentWithPhones = Student & {
  mother_phone: string | null;
  father_phone: string | null;
  parent_phone: string | null;
  billing_phone: string | null;
  billing_phone_role: string | null;
};

export type LoadStudentsOpts = {
  demo?: boolean;
  status?: "active" | "all";
  ids?: readonly string[];
  classId?: string;
  /** "name"(기본) · "grade"(학년 → 반 → 이름) */
  order?: "name" | "grade";
};

export type StudentsResult<T> = { rows: T[]; error: string | null };

function build(supabase: SupabaseClient, columns: string, opts: LoadStudentsOpts) {
  // demo-ok: 이 파일이 is_demo 를 거는 유일한 자리입니다. 화면은 demo 값만 넘깁니다.
  let q = supabase.from("wr_students").select(columns).eq("is_demo", opts.demo ?? false);
  if ((opts.status ?? "active") === "active") q = q.eq("status", "active");
  if (opts.ids) q = q.in("id", opts.ids.length > 0 ? [...opts.ids] : ["00000000-0000-0000-0000-000000000000"]);
  if (opts.classId) q = q.eq("class_id", opts.classId);
  if (opts.order === "grade") q = q.order("grade").order("class_name").order("name");
  else q = q.order("name");
  return q;
}

export async function loadStudents(supabase: SupabaseClient, opts: LoadStudentsOpts = {}): Promise<StudentsResult<Student>> {
  if (opts.ids && opts.ids.length === 0) return { rows: [], error: null };
  const { data, error } = await build(supabase, STUDENT_COLUMNS, opts);
  return { rows: ((data as unknown as Student[] | null) ?? []), error: error?.message ?? null };
}

/** 보호자·결제 번호까지. 행정실 이상 화면과 서버 작업에서만 씁니다. */
export async function loadStudentsWithPhones(
  supabase: SupabaseClient,
  opts: LoadStudentsOpts = {},
): Promise<StudentsResult<StudentWithPhones>> {
  if (opts.ids && opts.ids.length === 0) return { rows: [], error: null };
  const { data, error } = await build(supabase, `${STUDENT_COLUMNS}, ${PHONE_COLUMNS}`, opts);
  return { rows: ((data as unknown as StudentWithPhones[] | null) ?? []), error: error?.message ?? null };
}

/**
 * **칸 전부.** 학생 관리·프로필처럼 주소·알레르기·메모까지 고치는 화면만 씁니다. 목록을 그리는
 * 자리에서 쓰면 보호자 연락처가 브라우저까지 실려 갑니다 - 그런 자리는 `loadStudents` 입니다.
 */
export async function loadStudentsFull<T = StudentWithPhones & Record<string, unknown>>(
  supabase: SupabaseClient,
  opts: LoadStudentsOpts = {},
): Promise<StudentsResult<T>> {
  if (opts.ids && opts.ids.length === 0) return { rows: [], error: null };
  const { data, error } = await build(supabase, "*", opts);
  return { rows: ((data as unknown as T[] | null) ?? []), error: error?.message ?? null };
}

/** 한 명. 없으면 null. 퇴소한 아이도 돌려줍니다 - 번호로 찍어 찾는 자리는 이력을 보는 자리입니다. */
export async function loadStudent(
  supabase: SupabaseClient,
  id: string,
  opts: { demo?: boolean; phones?: boolean } = {},
): Promise<{ row: Student | StudentWithPhones | null; error: string | null }> {
  const cols = opts.phones ? `${STUDENT_COLUMNS}, ${PHONE_COLUMNS}` : STUDENT_COLUMNS;
  // demo-ok: 위 build 와 같은 이유 - 이 파일이 is_demo 를 거는 자리입니다.
  const { data, error } = await supabase.from("wr_students").select(cols).eq("is_demo", opts.demo ?? false).eq("id", id).maybeSingle();
  return { row: (data as unknown as Student | null) ?? null, error: error?.message ?? null };
}

/** 번호 → 학생. 화면이 이름으로 찾지 않게 하려는 것입니다(CLAUDE.md 2-4-1). */
export function byId<T extends { id: string }>(rows: readonly T[]): Map<string, T> {
  return new Map(rows.map((r) => [r.id, r]));
}
