"use client";

import { useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { TeamMember, WrClass } from "@/lib/types";
import Pagination from "@/components/Pagination";
import { useConfirm } from "@/components/common/ConfirmProvider";
import { useToast } from "@/components/common/ToastProvider";

const PAGE_SIZE = 15;

export default function ClassManageClient({ initialClasses, team }: { initialClasses: WrClass[]; team: TeamMember[] }) {
  const confirmAction = useConfirm();
  const notify = useToast();
  const [classes, setClasses] = useState<WrClass[]>(initialClasses);
  const [grade, setGrade] = useState("");
  const [className, setClassName] = useState("");
  const [teacherEmail, setTeacherEmail] = useState("");
  const [subTeacherEmail, setSubTeacherEmail] = useState("");
  const [saving, setSaving] = useState(false);
  // 담임 미배정 반 정리(요청 ⑦). 미배정만 모아 보고, 삭제 전 목록으로 확인합니다.
  const [onlyNoTeacher, setOnlyNoTeacher] = useState(false);

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
        // 이 화면에서 만드는 반은 언제나 실제 반입니다.
        is_demo: false,
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

  async function updateAssignment(
    id: string,
    field: "teacher_email" | "sub_teacher_email" | "teacher_name" | "sub_teacher_name" | "room",
    value: string
  ) {
    setClasses((prev) => prev.map((c) => (c.id === id ? { ...c, [field]: value || null } : c)));
    const supabase = createClient();
    const { error } = await supabase.from("wr_classes").update({ [field]: value || null }).eq("id", id);
    // 조용히 넘기면 화면에는 적힌 것처럼 보이는데 다음에 열면 비어 있습니다.
    if (error) notify("저장하지 못했습니다: " + error.message, "error");
  }

  async function removeClass(id: string) {
    if (!(await confirmAction("이 반을 삭제할까요?", { danger: true }))) return;
    setClasses((prev) => prev.filter((c) => c.id !== id));
    const supabase = createClient();
    await supabase.from("wr_classes").delete().eq("id", id);
  }

  const noTeacher = useMemo(() => classes.filter((c) => !c.teacher_email && !c.teacher_name), [classes]);
  const displayList = onlyNoTeacher ? noTeacher : classes;

  async function deleteAllNoTeacher() {
    if (noTeacher.length === 0) return;
    const listStr = noTeacher.map((c) => `${c.grade ?? ""}학년 ${c.class_name ?? ""}`).join(", ");
    if (!(await confirmAction(`담임 미배정 반 ${noTeacher.length}개를 모두 삭제할까요?\n${listStr}`, { danger: true }))) return;
    const ids = noTeacher.map((c) => c.id);
    setClasses((prev) => prev.filter((c) => !ids.includes(c.id)));
    const supabase = createClient();
    await supabase.from("wr_classes").delete().in("id", ids);
  }

  const [page, setPage] = useState(1);
  const pageItems = useMemo(
    () => displayList.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [displayList, page]
  );
  const totalPages = Math.max(1, Math.ceil(displayList.length / PAGE_SIZE));

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <form onSubmit={addClass} className="mb-4 flex shrink-0 flex-wrap items-end gap-2 g-panel-solid p-3">
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

      {/* 담임 미배정 반 정리(요청 ⑦) */}
      <div className="mb-2 flex shrink-0 flex-wrap items-center gap-2 text-xs">
        <span className="text-slate-500">전체 {classes.length}개 · 담임 미배정 <b className={noTeacher.length ? "text-red-600" : "text-slate-600"}>{noTeacher.length}</b>개</span>
        {noTeacher.length > 0 && (
          <>
            <button
              type="button"
              onClick={() => setOnlyNoTeacher((v) => !v)}
              className={"rounded-lg px-2.5 py-1 font-semibold " + (onlyNoTeacher ? "bg-purple-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200")}
            >
              {onlyNoTeacher ? "전체 보기" : "미배정만 보기"}
            </button>
            <button
              type="button"
              onClick={deleteAllNoTeacher}
              className="rounded-lg border border-red-200 bg-red-50 px-2.5 py-1 font-semibold text-red-600 hover:bg-red-100"
            >
              미배정 반 모두 삭제
            </button>
          </>
        )}
      </div>

      <div className="flex-1 overflow-y-auto g-panel-solid">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs text-slate-400">
            <tr>
              <th className="px-3 py-2">학년/반</th>
              <th className="px-3 py-2">담임</th>
              <th className="px-3 py-2">부담임</th>
              {/* 하원 픽업 때 보호자를 어디로 안내할지. 반 이름만으로는 새로 온 직원이
                  답할 수 없습니다. */}
              <th className="px-3 py-2">교실</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {pageItems.map((c) => {
              const missing = !c.teacher_email && !c.teacher_name;
              return (
              <tr key={c.id} className={"border-t border-slate-100 " + (missing ? "bg-red-50/50" : "")}>
                <td className="px-3 py-2 font-medium">
                  {c.grade}학년 {c.class_name}
                  {missing && <span className="ml-1 rounded-full bg-red-100 px-1.5 py-0.5 text-[10px] font-bold text-red-600">담임 미배정</span>}
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
                  {!c.teacher_email && (
                    <input
                      key={c.id + (c.teacher_name ?? "")}
                      defaultValue={c.teacher_name ?? ""}
                      onBlur={(e) => updateAssignment(c.id, "teacher_name", e.target.value)}
                      placeholder="계정 없을 때 이름만"
                      title="아직 계정이 없는 담임의 이름만 임시로 적어둘 수 있습니다. 계정이 생기면 위 선택으로 바꿔주세요."
                      className="mt-1 w-32 rounded-lg border border-slate-200 px-2 py-1 text-xs text-slate-500"
                    />
                  )}
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
                  {!c.sub_teacher_email && (
                    <input
                      key={c.id + (c.sub_teacher_name ?? "")}
                      defaultValue={c.sub_teacher_name ?? ""}
                      onBlur={(e) => updateAssignment(c.id, "sub_teacher_name", e.target.value)}
                      placeholder="계정 없을 때 이름만"
                      title="아직 계정이 없는 부담임의 이름만 임시로 적어둘 수 있습니다. 계정이 생기면 위 선택으로 바꿔주세요."
                      className="mt-1 w-32 rounded-lg border border-slate-200 px-2 py-1 text-xs text-slate-500"
                    />
                  )}
                </td>
                {/* 교실은 손으로 적지 않습니다. 학교 명부·시간표에 이미 각 반 위치가
                    적혀 있어서, 사람이 또 채우게 하면 두 곳이 어긋납니다. */}
                <td className="px-3 py-2 text-[11px] text-slate-400">{c.room ?? "—"}</td>
                <td className="px-3 py-2 text-right">
                  <button onClick={() => removeClass(c.id)} className="text-xs text-red-400 hover:text-red-600">
                    삭제
                  </button>
                </td>
              </tr>
              );
            })}
            {classes.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-slate-400">
                  등록된 반이 없습니다.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="shrink-0">
        <Pagination page={page} totalPages={totalPages} onChange={setPage} />
      </div>
    </div>
  );
}
