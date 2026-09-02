import type { SupabaseClient } from "@supabase/supabase-js";

// 학기별 반·담임·과목 세팅 보관본을 뜨고 읽는 곳.
//
// 담당자: "반/담임 배정관리와 과목도 정규학기 안에 포함되도록 해서, 학기를 바꾸면 이전 학기
//         반 세팅이 나오도록."
//
// 지금 세팅(wr_classes / wr_subjects)은 한 벌뿐이고, 학기가 바뀌면 그 위에 덮어씁니다.
// 그래서 "작년 2학기에 3학년이 몇 반이었고 담임이 누구였는지"는 지금 아무 데도 남지 않습니다.
//
// 보관본은 **값**으로 적습니다(참조가 아니라). 반이 없어지거나 교사가 그만두어도 그 학기의
// 모습은 그대로 남아야 하기 때문입니다. 참조로 두면 원본이 지워질 때 기록도 같이 사라집니다.

export type SnapshotStudent = {
  name: string;
  student_no: string | null;
  grade: string | null;
};

export type SnapshotClass = {
  grade: string | null;
  class_name: string | null;
  teacher_name: string | null;
  sub_teacher_name: string | null;
  student_count: number;
  students: SnapshotStudent[];
};

export type SnapshotSubject = {
  name: string;
  teacher_name: string | null;
  class_name: string | null;
  color: string | null;
  student_count: number;
  students: string[];
};

export type TermClassSnapshot = {
  id: string;
  term_id: string;
  taken_at: string;
  taken_by: string | null;
  classes: SnapshotClass[];
  subjects: SnapshotSubject[];
  source: string;
  note: string | null;
};

/** 교사 이름을 정합니다. 계정이 있으면 계정 이름이 먼저입니다(이름만 적어둔 임시 배정보다 정확). */
function teacherLabel(
  email: string | null,
  fallbackName: string | null,
  nameByEmail: Map<string, string>
): string | null {
  if (email && nameByEmail.get(email)) return nameByEmail.get(email)!;
  return fallbackName ?? email ?? null;
}

/**
 * 지금의 반·담임·과목 세팅을 통째로 읽어 보관본 모양으로 만듭니다.
 * 저장은 하지 않습니다 - 만들기와 쓰기를 나눠두면 "저장 전에 보여주기"가 가능합니다.
 */
export async function buildTermSnapshot(
  supabase: SupabaseClient
): Promise<{ classes: SnapshotClass[]; subjects: SnapshotSubject[] }> {
  const [classesRes, subjectsRes, studentsRes, usersRes] = await Promise.all([
    supabase.from("wr_classes").select("*").order("grade").order("class_name"),
    supabase.from("wr_subjects").select("*").order("name"),
    // 재학생만. 퇴원한 아이까지 담으면 그 학기 반 인원이 부풀려집니다.
    supabase.from("wr_students").select("id, name, student_no, grade, class_id").eq("is_demo", false).eq("status", "active"),
    supabase.from("app_users").select("email, name").eq("status", "approved"),
  ]);

  const nameByEmail = new Map<string, string>(
    ((usersRes.data ?? []) as { email: string; name: string | null }[])
      .filter((u) => u.name)
      .map((u) => [u.email, u.name as string])
  );

  const students = (studentsRes.data ?? []) as {
    id: string;
    name: string;
    student_no: string | null;
    grade: string | null;
    class_id: string | null;
  }[];
  const studentById = new Map(students.map((s) => [s.id, s]));

  const byClass = new Map<string, SnapshotStudent[]>();
  for (const s of students) {
    if (!s.class_id) continue;
    const list = byClass.get(s.class_id) ?? [];
    list.push({ name: s.name, student_no: s.student_no, grade: s.grade });
    byClass.set(s.class_id, list);
  }
  for (const list of byClass.values()) list.sort((a, b) => a.name.localeCompare(b.name, "ko"));

  const classRows = (classesRes.data ?? []) as {
    id: string;
    grade: string | null;
    class_name: string | null;
    teacher_email: string | null;
    sub_teacher_email: string | null;
    teacher_name: string | null;
    sub_teacher_name: string | null;
  }[];

  const classes: SnapshotClass[] = classRows.map((c) => {
    const list = byClass.get(c.id) ?? [];
    return {
      grade: c.grade,
      class_name: c.class_name,
      teacher_name: teacherLabel(c.teacher_email, c.teacher_name, nameByEmail),
      sub_teacher_name: teacherLabel(c.sub_teacher_email, c.sub_teacher_name, nameByEmail),
      student_count: list.length,
      students: list,
    };
  });

  const classLabel = new Map(
    classRows.map((c) => [c.id, `${c.grade ?? ""} ${c.class_name ?? ""}`.trim() || "반 없음"])
  );

  const subjectRows = (subjectsRes.data ?? []) as {
    name: string;
    teacher_email: string | null;
    teacher_name: string | null;
    class_id: string | null;
    color: string | null;
    student_ids: string[] | null;
  }[];

  const subjects: SnapshotSubject[] = subjectRows.map((s) => {
    const ids = s.student_ids ?? [];
    const names = ids
      .map((id) => studentById.get(id)?.name)
      .filter((n): n is string => !!n)
      .sort((a, b) => a.localeCompare(b, "ko"));
    return {
      name: s.name,
      teacher_name: teacherLabel(s.teacher_email, s.teacher_name, nameByEmail),
      class_name: s.class_id ? (classLabel.get(s.class_id) ?? null) : null,
      color: s.color,
      // 이름을 못 찾은 학생(이미 퇴원)도 인원에는 셉니다. 그래야 그때 몇 명이었는지가 맞습니다.
      student_count: ids.length,
      students: names,
    };
  });

  return { classes, subjects };
}

/**
 * 보관본을 저장합니다. 학기당 한 벌이라 이미 있으면 덮어씁니다 -
 * 학기 중에 반이 바뀌면 **마지막 모습**이 남아야 맞습니다.
 */
export async function saveTermSnapshot(
  supabase: SupabaseClient,
  termId: string,
  opts: { takenBy?: string | null; source?: "자동" | "수동"; note?: string | null } = {}
): Promise<{ ok: boolean; classes: number; subjects: number; error?: string }> {
  const { classes, subjects } = await buildTermSnapshot(supabase);
  // 빈 세팅을 덮어쓰면 멀쩡한 기록이 날아갑니다. 반이 하나도 없으면 저장하지 않습니다.
  if (classes.length === 0 && subjects.length === 0) {
    return { ok: false, classes: 0, subjects: 0, error: "지금 저장할 반·과목 세팅이 없습니다." };
  }
  const { error } = await supabase.from("wr_term_class_snapshots").upsert(
    {
      term_id: termId,
      classes,
      subjects,
      taken_at: new Date().toISOString(),
      taken_by: opts.takenBy ?? null,
      source: opts.source ?? "수동",
      note: opts.note ?? null,
    },
    { onConflict: "term_id" }
  );
  if (error) return { ok: false, classes: classes.length, subjects: subjects.length, error: error.message };
  return { ok: true, classes: classes.length, subjects: subjects.length };
}
