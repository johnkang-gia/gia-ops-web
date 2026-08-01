"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { TeamMember, WrClass } from "@/lib/types";

export default function ClassManageClient({ initialClasses, team }: { initialClasses: WrClass[]; team: TeamMember[] }) {
  const [classes, setClasses] = useState<WrClass[]>(initialClasses);
  const [grade, setGrade] = useState("");
  const [className, setClassName] = useState("");
  const [teacherEmail, setTeacherEmail] = useState("");
  const [subTeacherEmail, setSubTeacherEmail] = useState("");
  const [saving, setSaving] = useState(false);

  async function addClass(e: React.FormEvent) {
    e.preventDefault();
    if (!grade.trim() || !className.trim()) return;
    setSaving(true);
    const supabase = createClient();
    const { data } = await supabase
      .from("wr_classes")
      .insert({
        grade: grade.trim(),
        class_name: className.trim(),
        teacher_email: teacherEmail || null,
        sub_teacher_email: subTeacherEmail || null,
      })
      .select()
      .single();
    setSaving(false);
    if (data) {
      setClasses((prev) => [...prev, data as WrClass]);
      setGrade("");
      setClassName("");
      setTeacherEmail("");
      setSubTeacherEmail("");
    }
  }

  async function updateAssignment(id: string, field: "teacher_email" | "sub_teacher_email", value: string) {
    setClasses((prev) => prev.map((c) => (c.id === id ? { ...c, [field]: value || null } : c)));
    const supabase = createClient();
    await supabase.from("wr_classes").update({ [field]: value || null }).eq("id", id);
  }

  async function removeClass(id: string) {
    if (!confirm("이 반을 삭제할까요?")) return;
    setClasses((prev) => prev.filter((c) => c.id !== id));
    const supabase = createClient();
    await supabase.from("wr_classes").delete().eq("id", id);
  }

  return (
    <div>
      <form onSubmit={addClass} className="mb-4 flex flex-wrap items-end gap-2 rounded-xl border border-slate-200 bg-white p-3">
        <div>
          <label className="mb-1 block text-[11px] text-slate-400">학년</label>
          <input value={grade} onChange={(e) => setGrade(e.target.value)} placeholder="예: 3" className="w-20 rounded-lg border border-slate-300 px-2 py-1.5 text-sm" />
        </div>
        <div>
          <label className="mb-1 block text-[11px] text-slate-400">반</label>
          <input value={className} onChange={(e) => setClassName(e.target.value)} placeholder="예: 1반" className="w-24 rounded-lg border border-slate-300 px-2 py-1.5 text-sm" />
        </div>
        <div>
          <label className="mb-1 block text-[11px] text-slate-400">담임</label>
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
          <label className="mb-1 block text-[11px] text-slate-400">부담임</label>
          <select value={subTeacherEmail} onChange={(e) => setSubTeacherEmail(e.target.value)} className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm">
            <option value="">선택 안 함</option>
            {team.map((t) => (
              <option key={t.email} value={t.email}>
                {t.name || t.email}
              </option>
            ))}
          </select>
        </div>
        <button disabled={saving} className="rounded-lg bg-wr-primary px-3 py-1.5 text-sm font-semibold text-white hover:bg-wr-primary-2 disabled:opacity-50">
          반 추가
        </button>
      </form>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs text-slate-400">
            <tr>
              <th className="px-3 py-2">학년/반</th>
              <th className="px-3 py-2">담임</th>
              <th className="px-3 py-2">부담임</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {classes.map((c) => (
              <tr key={c.id} className="border-t border-slate-100">
                <td className="px-3 py-2 font-medium">
                  {c.grade}학년 {c.class_name}
                </td>
                <td className="px-3 py-2">
                  <select
                    value={c.teacher_email ?? ""}
                    onChange={(e) => updateAssignment(c.id, "teacher_email", e.target.value)}
                    className="rounded-lg border border-slate-200 px-2 py-1 text-xs"
                  >
                    <option value="">미배정</option>
                    {team.map((t) => (
                      <option key={t.email} value={t.email}>
                        {t.name || t.email}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="px-3 py-2">
                  <select
                    value={c.sub_teacher_email ?? ""}
                    onChange={(e) => updateAssignment(c.id, "sub_teacher_email", e.target.value)}
                    className="rounded-lg border border-slate-200 px-2 py-1 text-xs"
                  >
                    <option value="">미배정</option>
                    {team.map((t) => (
                      <option key={t.email} value={t.email}>
                        {t.name || t.email}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="px-3 py-2 text-right">
                  <button onClick={() => removeClass(c.id)} className="text-xs text-red-400 hover:text-red-600">
                    삭제
                  </button>
                </td>
              </tr>
            ))}
            {classes.length === 0 && (
              <tr>
                <td colSpan={4} className="px-3 py-6 text-center text-slate-400">
                  등록된 반이 없습니다.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
