"use client";

import { useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { TeamMember, WrClass, WrStudent, WrSubject } from "@/lib/types";
import Pagination from "@/components/Pagination";
import { useConfirm } from "@/components/common/ConfirmProvider";

const COLORS = ["#3B82F6", "#10B981", "#8B5CF6", "#F59E0B", "#EF4444", "#EC4899", "#06B6D4"];
const PAGE_SIZE = 10;

export default function SubjectManageClient({
  initialSubjects,
  team,
  classes,
  students,
}: {
  initialSubjects: WrSubject[];
  team: TeamMember[];
  classes: WrClass[];
  students: WrStudent[];
}) {
  const confirmAction = useConfirm();
  const [subjects, setSubjects] = useState<WrSubject[]>(initialSubjects);
  const [name, setName] = useState("");
  const [teacherEmail, setTeacherEmail] = useState("");
  const [classId, setClassId] = useState("");
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  async function addSubject(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    const supabase = createClient();
    const color = COLORS[Math.floor(Math.random() * COLORS.length)];
    const { data } = await supabase
      .from("wr_subjects")
      .insert({ name: name.trim(), teacher_email: teacherEmail || null, class_id: classId || null, color, student_ids: [] })
      .select()
      .single();
    setSaving(false);
    if (data) {
      setSubjects((prev) => [...prev, data as WrSubject]);
      setName("");
      setTeacherEmail("");
      setClassId("");
    }
  }

  async function updateSubject(id: string, fields: Partial<WrSubject>) {
    setSubjects((prev) => prev.map((s) => (s.id === id ? { ...s, ...fields } : s)));
    const supabase = createClient();
    await supabase.from("wr_subjects").update(fields).eq("id", id);
  }

  async function removeSubject(id: string) {
    if (!(await confirmAction("이 과목을 삭제할까요?", { danger: true }))) return;
    setSubjects((prev) => prev.filter((s) => s.id !== id));
    const supabase = createClient();
    await supabase.from("wr_subjects").delete().eq("id", id);
  }

  function toggleStudent(subject: WrSubject, studentId: string) {
    const has = subject.student_ids.includes(studentId);
    const next = has ? subject.student_ids.filter((id) => id !== studentId) : [...subject.student_ids, studentId];
    updateSubject(subject.id, { student_ids: next });
  }

  const [page, setPage] = useState(1);
  const pageItems = useMemo(
    () => subjects.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [subjects, page]
  );
  const totalPages = Math.max(1, Math.ceil(subjects.length / PAGE_SIZE));

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <form onSubmit={addSubject} className="mb-4 flex shrink-0 flex-wrap items-end gap-2 rounded-xl border border-slate-200 bg-white p-3">
        <div>
          <label className="mb-1 block text-[11px] text-slate-400">과목명</label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="예: 영어" className="w-32 rounded-lg border border-slate-300 px-2 py-1.5 text-sm" />
        </div>
        <div>
          <label className="mb-1 block text-[11px] text-slate-400">담당 교사</label>
          <select value={teacherEmail} onChange={(e) => setTeacherEmail(e.target.value)} className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm">
            <option value="">선택 안 함</option>
            {team.map((t) => (
              <option key={t.email} value={t.email}>
                {t.name || t.email}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-[11px] text-slate-400">연결 반 (선택)</label>
          <select value={classId} onChange={(e) => setClassId(e.target.value)} className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm">
            <option value="">없음</option>
            {classes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.grade}학년 {c.class_name}
              </option>
            ))}
          </select>
        </div>
        <button disabled={saving} className="rounded-lg bg-wr-primary px-3 py-1.5 text-sm font-semibold text-white hover:bg-wr-primary-2 disabled:opacity-50">
          과목 추가
        </button>
      </form>

      <div className="flex-1 overflow-y-auto">
        <div className="flex flex-col gap-2">
        {pageItems.map((s) => (
          <div key={s.id} className="rounded-xl border border-slate-200 bg-white p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: s.color ?? "#3B82F6" }} />
                <span className="font-semibold">{s.name}</span>
                <select
                  value={s.teacher_email ?? ""}
                  onChange={(e) => updateSubject(s.id, { teacher_email: e.target.value || null })}
                  className="rounded-lg border border-slate-200 px-2 py-1 text-xs"
                >
                  <option value="">미배정</option>
                  {team.map((t) => (
                    <option key={t.email} value={t.email}>
                      {t.name || t.email}
                    </option>
                  ))}
                </select>
                {!s.teacher_email && (
                  <input
                    key={s.id + (s.teacher_name ?? "")}
                    defaultValue={s.teacher_name ?? ""}
                    onBlur={(e) => updateSubject(s.id, { teacher_name: e.target.value || null })}
                    placeholder="계정 없을 때 이름만"
                    title="아직 계정이 없는 과목 선생님의 이름만 임시로 적어둘 수 있습니다. 계정이 생기면 위 선택으로 바꿔주세요."
                    className="w-32 rounded-lg border border-slate-200 px-2 py-1 text-xs text-slate-500"
                  />
                )}
                <span className="text-xs text-slate-400">학생 {s.student_ids.length}명</span>
              </div>
              <div className="flex gap-2">
                <button onClick={() => setEditingId(editingId === s.id ? null : s.id)} className="text-xs text-blue-500 hover:underline">
                  {editingId === s.id ? "학생 배정 닫기" : "학생 배정"}
                </button>
                <button onClick={() => removeSubject(s.id)} className="text-xs text-red-400 hover:text-red-600">
                  삭제
                </button>
              </div>
            </div>
            {editingId === s.id && (
              <div className="mt-3 grid max-h-56 grid-cols-2 gap-1 overflow-y-auto rounded-lg bg-slate-50 p-2 sm:grid-cols-3">
                {students.map((st) => (
                  <label key={st.id} className="flex items-center gap-1.5 text-xs text-slate-600">
                    <input type="checkbox" checked={s.student_ids.includes(st.id)} onChange={() => toggleStudent(s, st.id)} />
                    {st.grade}학년 {st.class_name} {st.name}
                  </label>
                ))}
              </div>
            )}
          </div>
        ))}
        {subjects.length === 0 && (
          <p className="rounded-xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-400">등록된 과목이 없습니다.</p>
        )}
        </div>
      </div>
      <div className="shrink-0">
        <Pagination page={page} totalPages={totalPages} onChange={setPage} />
      </div>
    </div>
  );
}
