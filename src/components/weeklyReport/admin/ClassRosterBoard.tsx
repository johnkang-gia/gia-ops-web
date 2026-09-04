"use client";

import { useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/common/ToastProvider";
import { gradeSortKey } from "@/lib/department";
import type { WrClass } from "@/lib/types";

/**
 * 반 배정판 — 이름표를 옮겨 반을 바꿉니다.
 *
 * 지금까지 반을 고치려면 명부 관리 표에서 아이를 찾아 반 칸을 하나씩 고쳐야 했습니다.
 * 한 반을 통째로 다시 짜는 일(학기 초, 반 편성이 잘못됐을 때)에는 그 방식이 맞지 않습니다 -
 * **누가 어느 반에 몇 명 있는지가 안 보이니까** 옮기면서도 균형을 알 수 없습니다.
 *
 * 반을 칸으로 세우고 아이를 이름표로 두면, 옮기는 일과 보는 일이 같은 화면에서 됩니다.
 *
 * 옮기는 방법을 둘 둡니다.
 *   · 끌어다 놓기 — 마우스에서 가장 빠릅니다
 *   · 눌러서 고르고 반 누르기 — **화면을 만지는 기기에서는 끌기가 안 됩니다.** 태블릿으로
 *     여는 일이 많아서, 이 길이 없으면 그 기기에서는 아예 못 씁니다.
 */

export type BoardStudent = {
  id: string;
  name: string;
  nameEn: string | null;
  grade: string | null;
  className: string | null;
  classId: string | null;
  gender: "남" | "여" | null;
};

export default function ClassRosterBoard({
  classes,
  initialStudents,
  canEdit,
}: {
  classes: WrClass[];
  initialStudents: BoardStudent[];
  canEdit: boolean;
}) {
  const notify = useToast();
  const [students, setStudents] = useState(initialStudents);
  const [grade, setGrade] = useState<string>("전체");
  /** 눌러서 고른 아이. 화면을 만지는 기기에서 끌기 대신 쓰는 길입니다. */
  const [picked, setPicked] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const grades = useMemo(
    () => [...new Set(students.map((s) => (s.grade ?? "").trim()).filter(Boolean))].sort((a, b) => gradeSortKey(a) - gradeSortKey(b)),
    [students],
  );

  /** 이 학년의 반. 학년을 고르면 그 학년 반만 세웁니다 - 전교 반을 다 세우면 화면이 넘칩니다. */
  const shownClasses = useMemo(() => {
    const list = grade === "전체" ? classes : classes.filter((c) => (c.grade ?? "").trim() === grade);
    return [...list].sort((a, b) => gradeSortKey(a.grade ?? "") - gradeSortKey(b.grade ?? "") || (a.class_name ?? "").localeCompare(b.class_name ?? "", "ko"));
  }, [classes, grade]);

  const inGrade = useMemo(
    () => students.filter((s) => grade === "전체" || (s.grade ?? "").trim() === grade),
    [students, grade],
  );

  /** 반 → 그 반 아이들. 반이 없는 아이는 '미배정' 으로 따로 모읍니다. */
  const byClass = useMemo(() => {
    const m = new Map<string, BoardStudent[]>();
    for (const s of inGrade) {
      const key = s.classId && classes.some((c) => c.id === s.classId) ? s.classId : "none";
      (m.get(key) ?? m.set(key, []).get(key)!).push(s);
    }
    for (const list of m.values()) list.sort((a, b) => a.name.localeCompare(b.name, "ko"));
    return m;
  }, [inGrade, classes]);

  /**
   * 반을 옮깁니다.
   *
   * `class_id` 와 `class_name` 을 **함께** 바꿉니다. 둘 중 하나만 바꾸면 화면마다 다른 반이
   * 나옵니다 - 어떤 화면은 id 로, 어떤 화면은 이름으로 반을 읽기 때문입니다.
   * 학년도 함께 맞춥니다. 4학년 아이를 5학년 반에 넣으면 학년과 반이 어긋난 채 남습니다.
   */
  async function move(studentId: string, target: WrClass | null) {
    if (!canEdit) {
      notify("반을 옮기는 것은 행정직원 이상만 할 수 있습니다.", "error");
      return;
    }
    const before = students.find((s) => s.id === studentId);
    if (!before) return;
    if ((before.classId ?? null) === (target?.id ?? null)) return;

    const next: BoardStudent = {
      ...before,
      classId: target?.id ?? null,
      className: target?.class_name ?? null,
      grade: target?.grade ?? before.grade,
    };
    // 화면을 먼저 바꿉니다. 여러 명을 잇달아 옮기는 자리라 왕복을 기다리면 손이 앞서갑니다.
    setStudents((p) => p.map((s) => (s.id === studentId ? next : s)));
    setPicked(null);
    setBusy(true);
    const { error } = await createClient()
      .from("wr_students")
      .update({
        class_id: target?.id ?? null,
        class_name: target?.class_name ?? null,
        ...(target?.grade ? { grade: target.grade } : {}),
      })
      .eq("id", studentId);
    setBusy(false);
    if (error) {
      // 조용히 넘기면 화면에는 옮겨진 것처럼 보이는데 명부는 그대로입니다.
      notify("반을 옮기지 못했습니다: " + error.message, "error");
      setStudents((p) => p.map((s) => (s.id === studentId ? before : s)));
      return;
    }
    notify(`${before.name} → ${target ? `${target.grade}학년 ${target.class_name}` : "미배정"}`, "success");
  }

  const Badge = ({ s }: { s: BoardStudent }) => (
    <button
      type="button"
      draggable={canEdit}
      onDragStart={(e) => {
        e.dataTransfer.setData("text/plain", s.id);
        e.dataTransfer.effectAllowed = "move";
        setPicked(s.id);
      }}
      onDragEnd={() => setPicked(null)}
      onClick={() => setPicked((p) => (p === s.id ? null : s.id))}
      disabled={busy}
      title={canEdit ? `${s.name}${s.nameEn ? ` (${s.nameEn})` : ""} — 끌어서 옮기거나, 눌러서 고른 뒤 반을 누르세요` : s.name}
      className={
        "rounded-lg border px-2 py-1 text-[12px] font-semibold transition disabled:opacity-50 " +
        (picked === s.id
          ? "border-teal-500 bg-teal-600 text-white shadow"
          : s.gender === "여"
            ? "border-rose-200 bg-rose-50 text-rose-800 hover:border-rose-400"
            : "border-sky-200 bg-sky-50 text-sky-800 hover:border-sky-400") +
        (canEdit ? " cursor-grab active:cursor-grabbing" : " cursor-default")
      }
    >
      {s.name}
    </button>
  );

  /** 반 한 칸. 끌어온 이름표를 받고, 고른 아이가 있으면 눌러서도 받습니다. */
  const Zone = ({ cls, list }: { cls: WrClass | null; list: BoardStudent[] }) => {
    const key = cls?.id ?? "none";
    const isOver = over === key;
    return (
      <div
        onDragOver={(e) => {
          if (!canEdit) return;
          e.preventDefault();
          setOver(key);
        }}
        onDragLeave={() => setOver((v) => (v === key ? null : v))}
        onDrop={(e) => {
          e.preventDefault();
          setOver(null);
          const id = e.dataTransfer.getData("text/plain");
          if (id) void move(id, cls);
        }}
        onClick={() => {
          // 고른 아이가 있을 때만 반응합니다. 아니면 카드를 누를 때마다 아무 일이나 생깁니다.
          if (picked) void move(picked, cls);
        }}
        className={
          "min-h-[92px] rounded-xl border-2 p-2 transition " +
          (isOver
            ? "border-teal-500 bg-teal-50"
            : picked
              ? "border-dashed border-teal-300 bg-white hover:border-teal-500 hover:bg-teal-50/50"
              : cls
                ? "border-slate-200 bg-white"
                : "border-dashed border-slate-300 bg-slate-50")
        }
      >
        <p className="mb-1.5 flex items-baseline gap-1.5">
          <b className="text-[13px] text-slate-800">{cls ? cls.class_name : "미배정"}</b>
          {cls?.grade && <span className="text-[11px] text-slate-400">{cls.grade}학년</span>}
          <span className="ml-auto text-[11px] font-semibold text-slate-500">{list.length}명</span>
        </p>
        {cls?.teacher_name && <p className="mb-1 text-[10px] text-slate-400">담임 {cls.teacher_name}</p>}
        <div className="flex flex-wrap gap-1">
          {list.map((s) => (
            <Badge key={s.id} s={s} />
          ))}
          {list.length === 0 && (
            <span className="text-[11px] text-slate-300">{picked ? "여기를 눌러 옮기기" : "비어 있습니다"}</span>
          )}
        </div>
      </div>
    );
  };

  const unassigned = byClass.get("none") ?? [];

  return (
    <div className="mt-6">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h2 className="text-[15px] font-bold text-slate-800">🧩 반 배정판</h2>
        <span className="text-[11px] text-slate-400">이름표를 끌어다 놓거나, 눌러서 고른 뒤 반을 누릅니다</span>
        <span className="ml-auto flex flex-wrap gap-1">
          {["전체", ...grades].map((g) => (
            <button
              key={g}
              onClick={() => setGrade(g)}
              className={
                "rounded-lg px-2.5 py-1 text-xs font-semibold " +
                (grade === g ? "bg-slate-800 text-white" : "border border-slate-200 text-slate-600 hover:bg-slate-50")
              }
            >
              {g === "전체" ? "전체" : `${g}학년`}
            </button>
          ))}
        </span>
      </div>

      {!canEdit && (
        <p className="mb-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] text-slate-500">
          보기만 됩니다. 반을 옮기는 것은 행정직원 이상입니다.
        </p>
      )}
      {picked && (
        <p className="mb-2 rounded-lg border border-teal-300 bg-teal-50 px-3 py-2 text-[12px] font-semibold text-teal-800">
          {students.find((s) => s.id === picked)?.name} 을(를) 골랐습니다 — <b>옮길 반을 누르세요.</b>
          <button onClick={() => setPicked(null)} className="ml-2 text-[11px] font-semibold text-teal-600 underline">
            그만두기
          </button>
        </p>
      )}

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {shownClasses.map((c) => (
          <Zone key={c.id} cls={c} list={byClass.get(c.id) ?? []} />
        ))}
        {/* 미배정은 늘 보여줍니다. 비어 있어도 자리가 있어야 반에서 빼낼 수 있습니다. */}
        <Zone cls={null} list={unassigned} />
      </div>

      <p className="mt-2 text-[11px] leading-relaxed text-slate-400">
        옮기면 <b>명부에 바로 반영됩니다</b> — 반 이름과 반 번호를 함께 바꿉니다. 둘 중 하나만 바뀌면 화면마다 다른 반이 나옵니다.
        학년도 옮긴 반의 학년으로 맞춥니다.
      </p>
    </div>
  );
}
