"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { subjectColor, SUBJECT_PALETTE } from "@/lib/subjectColor";

export type TtPeriod = { id: string; department: string; periodNo: number; label: string; start: string; end: string };
export type TtClass = { id: string; grade: string; className: string; department: string; students: number };
export type TtCell = { classId: string; grade: string; className: string; department: string; weekday: number; periodId: string; subject: string; teacher: string | null; room: string | null };
export type RoomStatus = { name: string; inUse: boolean; by: string | null; subject: string | null; teacher: string | null };
export type TeacherHours = { teacher: string; hours: number; busyNow: boolean };

const WD = [
  { d: 1, label: "월" },
  { d: 2, label: "화" },
  { d: 3, label: "수" },
  { d: 4, label: "목" },
  { d: 5, label: "금" },
];
const DEPTS = ["유치부", "초등부", "중고등부"];

export default function TimetableClient({
  periods,
  cells,
  classes,
  rooms,
  teacherHours,
  freeNow,
  nowInfo,
  subjectColors,
}: {
  periods: TtPeriod[];
  cells: TtCell[];
  classes: TtClass[];
  rooms: RoomStatus[];
  teacherHours: TeacherHours[];
  freeNow: string[];
  nowInfo: { weekdayLabel: string; periodLabel: string | null; inSession: boolean };
  /** 과목 이름 → 색(팔레트 번호). 비어 있으면 이름을 섞어 자동으로 정합니다. */
  subjectColors: Record<string, string>;
}) {
  const router = useRouter();
  // 과목 색(요청 ③). 화면에서 바로 바꾸고 곧장 반영되도록 여기서 들고 있습니다.
  const [colors, setColors] = useState<Record<string, string>>(subjectColors);
  const [paletteFor, setPaletteFor] = useState<string | null>(null);
  const [showColors, setShowColors] = useState(false);

  async function setSubjectColor(name: string, idx: number | null) {
    // 되돌리기(자동으로): 적어둔 값을 지웁니다. 지우면 hash로 정한 색으로 돌아갑니다.
    setColors((prev) => {
      const next = { ...prev };
      if (idx == null) delete next[name];
      else next[name] = String(idx);
      return next;
    });
    setPaletteFor(null);
    const supabase = createClient();
    if (idx == null) await supabase.from("wr_subject_colors").delete().eq("name", name);
    else await supabase.from("wr_subject_colors").upsert({ name, color: String(idx), updated_at: new Date().toISOString() }, { onConflict: "name" });
  }
  const deptsWithData = DEPTS.filter((d) => classes.some((c) => c.department === d) || periods.some((p) => p.department === d));
  const [dept, setDept] = useState(deptsWithData.includes("초등부") ? "초등부" : deptsWithData[0] ?? "초등부");
  const todayWd = (() => {
    const map: Record<string, number> = { 일: 0, 월: 1, 화: 2, 수: 3, 목: 4, 금: 5, 토: 6 };
    return map[nowInfo.weekdayLabel] ?? 1;
  })();
  const [weekday, setWeekday] = useState(todayWd >= 1 && todayWd <= 5 ? todayWd : 1);
  // 색을 바꿀 수 있는 과목 목록. 시간표에 실제로 쓰인 이름만 모읍니다 - 과목반 세팅에만
  // 있고 시간표에 안 들어간 과목은 색을 정해봐야 보일 데가 없습니다.
  const subjectNames = useMemo(
    () => [...new Set(cells.map((c) => c.subject).filter(Boolean))].sort((a, b) => a.localeCompare(b, "ko")),
    [cells]
  );

  const deptPeriods = useMemo(() => periods.filter((p) => p.department === dept).sort((a, b) => a.periodNo - b.periodNo), [periods, dept]);
  const deptClasses = useMemo(
    () => classes.filter((c) => c.department === dept).sort((a, b) => (a.grade + a.className).localeCompare(b.grade + b.className, "ko", { numeric: true })),
    [classes, dept]
  );
  const cellMap = useMemo(() => {
    const m = new Map<string, TtCell>();
    for (const c of cells) if (c.department === dept && c.weekday === weekday) m.set(`${c.classId}|${c.periodId}`, c);
    return m;
  }, [cells, dept, weekday]);

  const inUseRooms = rooms.filter((r) => r.inUse);
  const freeRooms = rooms.filter((r) => !r.inUse);

  // 선택 부서의 학년별/전체 학생 수(요청 ③: 학년별 몇 명, 각 반 몇 명 뱃지).
  const gradeTotals = useMemo(() => {
    const g = new Map<string, number>();
    for (const c of deptClasses) g.set(c.grade || "미지정", (g.get(c.grade || "미지정") ?? 0) + c.students);
    return [...g.entries()].sort((a, b) => a[0].localeCompare(b[0], "ko", { numeric: true }));
  }, [deptClasses]);
  const deptTotal = deptClasses.reduce((s, c) => s + c.students, 0);

  return (
    <div className="mx-auto max-w-6xl">

      {/* 지금 상황 + 공간 사용 현황 */}
      <div className="mb-3 g-panel-solid p-4">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <b className="text-sm">🏫 공간 사용 현황</b>
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">
            지금 {nowInfo.weekdayLabel}요일 {nowInfo.inSession ? nowInfo.periodLabel ?? "수업 중" : "수업 시간 아님"}
          </span>
          <span className="ml-auto text-[11px] text-slate-400">사용 중 {inUseRooms.length} · 비어 있음 {freeRooms.length}</span>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
          {rooms.map((r) => (
            <div
              key={r.name}
              className={"rounded-xl border p-2.5 " + (r.inUse ? "border-red-200 bg-red-50" : "border-emerald-200 bg-emerald-50")}
            >
              <div className="flex items-center justify-between">
                <span className="text-sm font-bold text-slate-700">{r.name}</span>
                <span className={"h-2 w-2 rounded-full " + (r.inUse ? "bg-red-500" : "bg-emerald-500")} />
              </div>
              {r.inUse ? (
                <div className="mt-0.5 text-[11px] text-red-700">
                  {r.by} · {r.subject}
                  {r.teacher ? ` · ${r.teacher}` : ""}
                </div>
              ) : (
                <div className="mt-0.5 text-[11px] text-emerald-700">비어 있음</div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* 부서 · 요일 선택 + 시간표 그리드 */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex gap-1 rounded-xl bg-slate-100 p-1">
          {deptsWithData.map((d) => (
            <button key={d} type="button" onClick={() => setDept(d)} className={"rounded-lg px-3 py-1.5 text-sm font-semibold transition " + (dept === d ? "bg-white text-purple-700 shadow-sm" : "text-slate-500 hover:text-slate-700")}>
              {d}
            </button>
          ))}
        </div>
        <div className="flex gap-1 rounded-xl bg-slate-100 p-1">
          {WD.map((w) => (
            <button key={w.d} type="button" onClick={() => setWeekday(w.d)} className={"h-8 w-8 rounded-lg text-sm font-bold transition " + (weekday === w.d ? "bg-white text-purple-700 shadow-sm" : "text-slate-500 hover:text-slate-700")}>
              {w.label}
            </button>
          ))}
        </div>
        <button type="button" onClick={() => router.push("/weekly-report/admin/classes")} className="ml-auto rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50">
          👤 담임 배정
        </button>
        <button type="button" onClick={() => router.push("/weekly-report/admin/subjects")} className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50">
          📘 과목 관리
        </button>
        <button
          type="button"
          onClick={() => setShowColors((v) => !v)}
          className={
            "rounded-lg border px-2.5 py-1.5 text-xs font-semibold " +
            (showColors ? "border-purple-300 bg-purple-50 text-purple-700" : "border-slate-200 text-slate-600 hover:bg-slate-50")
          }
        >
          🎨 과목 색
        </button>
      </div>

      {/* 과목 색 바꾸기(요청 ③).
          색은 이름을 섞어 자동으로 정해집니다 - 아무것도 안 해도 과목마다 다른 색이 나오고,
          같은 과목은 어느 요일·어느 반에서든 늘 같은 색입니다. 여기는 그 자동 색이 마음에
          안 들 때만 씁니다. */}
      {showColors && (
        <div className="mb-3 g-panel-solid p-3">
          <p className="mb-2 text-[11px] leading-relaxed text-slate-400">
            색은 과목 이름으로 저절로 정해집니다. 마음에 안 드는 과목만 눌러서 바꾸세요 —
            바꾼 색은 <b>모든 부서·요일</b>에 함께 적용됩니다.
          </p>
          <div className="flex flex-wrap gap-1.5">
            {subjectNames.map((name) => {
              const c = subjectColor(name, colors);
              const open = paletteFor === name;
              return (
                <div key={name} className="relative">
                  <button
                    type="button"
                    onClick={() => setPaletteFor(open ? null : name)}
                    className="rounded-lg border px-2 py-1 text-xs font-semibold"
                    style={{ background: c.bg, color: c.fg, borderColor: c.dot }}
                  >
                    {name}
                    {colors[name] != null && <span className="ml-1 text-[10px] opacity-60">✎</span>}
                  </button>
                  {open && (
                    <div className="absolute left-0 top-full z-20 mt-1 w-44 g-panel-solid p-2 shadow-lg">
                      <div className="grid grid-cols-6 gap-1">
                        {SUBJECT_PALETTE.map((p, i) => (
                          <button
                            key={i}
                            type="button"
                            title={`색 ${i + 1}`}
                            onClick={() => void setSubjectColor(name, i)}
                            className="h-6 rounded-md border border-slate-200 hover:scale-110"
                            style={{ background: p.dot }}
                          />
                        ))}
                      </div>
                      <button
                        type="button"
                        onClick={() => void setSubjectColor(name, null)}
                        className="mt-1.5 w-full rounded-md px-1 py-1 text-[11px] font-semibold text-slate-500 hover:bg-slate-50"
                      >
                        자동으로 되돌리기
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
            {subjectNames.length === 0 && <span className="text-xs text-slate-400">시간표에 과목이 아직 없습니다.</span>}
          </div>
        </div>
      )}

      {/* 학년별 학생 수(선택 부서) */}
      <div className="mb-3 flex flex-wrap items-center gap-2 g-panel-solid px-3 py-2">
        <span className="text-xs font-bold text-slate-600">{dept} 재학생 {deptTotal}명</span>
        <span className="text-slate-300">·</span>
        {gradeTotals.length === 0 ? (
          <span className="text-xs text-slate-400">학년 정보 없음</span>
        ) : (
          gradeTotals.map(([g, n]) => (
            <span key={g} className="rounded-full bg-purple-50 px-2 py-0.5 text-[11px] font-semibold text-purple-700">
              {g} {n}명
            </span>
          ))
        )}
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1fr_260px]">
        <div className="overflow-x-auto g-panel-solid">
          {deptPeriods.length === 0 || deptClasses.length === 0 ? (
            <p className="p-8 text-center text-sm text-slate-400">이 부서의 시간표(교시·반)가 아직 없습니다.</p>
          ) : (
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr className="bg-slate-50 text-slate-500">
                  <th className="sticky left-0 z-10 border-b border-r border-slate-200 bg-slate-50 px-2 py-2 text-left font-semibold">교시</th>
                  {deptClasses.map((c) => (
                    <th key={c.id} className="border-b border-slate-200 px-2 py-2 font-semibold">
                      <div>{c.grade} {c.className}</div>
                      <div className="mt-0.5 inline-block rounded-full bg-slate-100 px-1.5 text-[10px] font-bold text-slate-500">{c.students}명</div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {deptPeriods.map((p) => (
                  <tr key={p.id} className="border-b border-slate-100 last:border-0">
                    <th className="sticky left-0 z-10 border-r border-slate-200 bg-white px-2 py-1.5 text-left">
                      <div className="font-bold text-slate-700">{p.label}</div>
                      <div className="text-[10px] text-slate-400">{p.start.slice(0, 5)}~{p.end.slice(0, 5)}</div>
                    </th>
                    {deptClasses.map((c) => {
                      const cell = cellMap.get(`${c.id}|${p.id}`);
                      return (
                        <td key={c.id} className="border-l border-slate-100 px-1.5 py-1 align-top">
                          {cell ? (
                            // 과목마다 다른 색(요청 ③). 예전에는 모든 칸이 같은 보라색이라
                            // 가로로 훑을 때 "이 줄에 같은 과목이 몇 개인지"가 눈에 안 들어왔습니다.
                            (() => {
                              const c = subjectColor(cell.subject, colors);
                              return (
                                <div className="rounded-md px-1.5 py-1" style={{ background: c.bg }}>
                                  <div className="font-semibold" style={{ color: c.fg }}>{cell.subject}</div>
                                  <div className="text-[10px]" style={{ color: c.sub }}>
                                    {cell.teacher ?? ""}
                                    {cell.room ? ` · ${cell.room}` : ""}
                                  </div>
                                </div>
                              );
                            })()
                          ) : (
                            <div className="px-1 py-1 text-center text-slate-200">·</div>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* 선생님 시수 + 지금 빈 선생님 */}
        <div className="flex flex-col gap-3">
          <div className="g-panel-solid p-4">
            <b className="text-sm">🟢 지금 수업 없는 선생님 {freeNow.length}</b>
            {freeNow.length === 0 ? (
              <p className="mt-1 text-xs text-slate-400">모두 수업 중이거나 수업 시간이 아닙니다.</p>
            ) : (
              <div className="mt-2 flex flex-wrap gap-1">
                {freeNow.map((t) => (
                  <span key={t} className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">{t}</span>
                ))}
              </div>
            )}
          </div>
          <div className="g-panel-solid p-4">
            <div className="mb-2 flex items-center justify-between">
              <b className="text-sm">선생님별 주간 시수</b>
              <span className="text-[11px] text-slate-400">{teacherHours.length}명</span>
            </div>
            {teacherHours.length === 0 ? (
              <p className="text-xs text-slate-400">시간표에 담당 선생님이 없습니다.</p>
            ) : (
              <div className="flex max-h-72 flex-col gap-1 overflow-y-auto">
                {teacherHours.map((t) => (
                  <div key={t.teacher} className="flex items-center gap-2 text-sm">
                    <span className="min-w-0 flex-1 truncate text-slate-700">
                      {t.busyNow && <span className="mr-1 text-red-500">●</span>}
                      {t.teacher}
                    </span>
                    <span className="shrink-0 tabular-nums font-bold text-slate-800">{t.hours}</span>
                    <span className="shrink-0 text-[10px] text-slate-400">시간</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
