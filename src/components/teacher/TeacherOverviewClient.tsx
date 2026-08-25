"use client";

import { useT } from "@/components/common/LanguageProvider";
import TeacherTabs from "./TeacherTabs";

export type TtPeriod = { id: string; department: string; periodNo: number; label: string; start: string; end: string };
export type TtCell = { weekday: number; periodId: string; subject: string; teacher: string | null; classLabel: string | null; room: string | null };
export type TeacherClass = {
  grade: string;
  className: string;
  department: string;
  room: string | null;
  teacher: string | null;
  subTeacher: string | null;
  students: string[];
  cells: TtCell[];
};
export type MyLesson = { weekday: number; periodId: string; subject: string; classLabel: string; room: string | null };
export type TermRaw = { termType: string | null; year: string | null; start: string | null; end: string | null; dday: number | null };

const WEEKDAYS = [1, 2, 3, 4, 5];
function toMin(t: string) {
  const [h, m] = (t || "0:0").split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}
function fmtDate(d: string | null) {
  return d ? d.slice(2).replace(/-/g, ".") : "-";
}

export default function TeacherOverviewClient({
  isHomeroom,
  teacherName,
  demo,
  term,
  periods,
  classes,
  myLessons,
  now,
}: {
  isHomeroom: boolean;
  teacherName: string | null;
  demo: boolean;
  term: TermRaw | null;
  periods: TtPeriod[];
  classes: TeacherClass[];
  myLessons: MyLesson[];
  now: { weekday: number; minutes: number };
}) {
  const t = useT();
  const periodById = new Map(periods.map((p) => [p.id, p]));
  const wdLabel = (wd: number) => t(["일", "월", "화", "수", "목", "금", "토"][wd], ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][wd]);

  // 학기 배너 라벨(한/영). term_type/year는 한글로 저장돼 있어 영어일 때만 매핑합니다.
  const termLabel = (() => {
    if (!term) return t("학기 정보 없음", "No term info");
    const ty = term.termType ?? "";
    const en =
      ty.includes("여름") ? "Summer Camp" : ty.includes("겨울") ? "Winter Camp" : ty.replace("학기", "").trim() ? `Semester ${ty.replace("학기", "").trim()}` : ty;
    const label = t(ty, en);
    return `${term.year ?? ""} ${label}`.trim();
  })();

  // 지금 교시(부서별로 시간이 달라 department별로 판정)
  const nowPeriodIdsByDept = new Map<string, string>();
  for (const p of periods) {
    if (p.start && p.end && toMin(p.start) <= now.minutes && now.minutes < toMin(p.end)) {
      nowPeriodIdsByDept.set(p.department, p.id);
    }
  }

  return (
    <div className="mx-auto max-w-5xl">
      <TeacherTabs isHomeroom={isHomeroom} />

      {/* 학기 배너 */}
      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-2xl border border-teal-200 bg-teal-50/50 px-4 py-2.5">
        <span className="text-sm font-extrabold text-teal-800">📚 {termLabel}</span>
        {term?.start && (
          <span className="text-xs text-teal-700">{fmtDate(term.start)} ~ {fmtDate(term.end)}</span>
        )}
        {term?.dday != null && (
          <span className="rounded-full bg-teal-600 px-2 py-0.5 text-[11px] font-bold text-white">
            {term.dday > 0 ? t(`학기말 D-${term.dday}`, `D-${term.dday} to term end`) : term.dday === 0 ? t("오늘 학기말", "Term ends today") : t("학기 종료", "Term ended")}
          </span>
        )}
        <span className="ml-auto text-xs text-slate-400">
          {teacherName ? `${teacherName} ${t("선생님", "")}`.trim() : ""}
          {demo ? t(" · (데모)", " · (Demo)") : ""}
        </span>
      </div>

      {isHomeroom ? (
        <HomeroomView classes={classes} periodById={periodById} nowPeriodIdsByDept={nowPeriodIdsByDept} now={now} wdLabel={wdLabel} t={t} />
      ) : (
        <SubjectView myLessons={myLessons} periods={periods} periodById={periodById} nowPeriodIdsByDept={nowPeriodIdsByDept} now={now} wdLabel={wdLabel} t={t} />
      )}
    </div>
  );
}

// ── 담임 선생님 화면 ──────────────────────────────────────────────────────────
function HomeroomView({
  classes,
  periodById,
  nowPeriodIdsByDept,
  now,
  wdLabel,
  t,
}: {
  classes: TeacherClass[];
  periodById: Map<string, TtPeriod>;
  nowPeriodIdsByDept: Map<string, string>;
  now: { weekday: number; minutes: number };
  wdLabel: (wd: number) => string;
  t: (ko: string, en?: string) => string;
}) {
  if (classes.length === 0) {
    return <p className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-8 text-center text-sm text-slate-400">{t("배정된 담임반이 없습니다.", "No homeroom class assigned.")}</p>;
  }
  return (
    <div className="flex flex-col gap-4">
      {classes.map((c, ci) => {
        // 이 반의 시간표 격자(부서 교시만, 시작시간순)
        const deptPeriods = [...periodById.values()].filter((p) => p.department === c.department).sort((a, b) => toMin(a.start) - toMin(b.start));
        const cellAt = new Map<string, TtCell>();
        for (const cell of c.cells) cellAt.set(`${cell.weekday}:${cell.periodId}`, cell);
        const nowPid = nowPeriodIdsByDept.get(c.department);
        const nowCell = nowPid ? c.cells.find((x) => x.weekday === now.weekday && x.periodId === nowPid) : undefined;
        return (
          <div key={ci} className="rounded-2xl border border-slate-200 bg-white p-4">
            <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1">
              <b className="text-lg text-slate-800">{c.grade} {c.className}</b>
              {c.room && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-500">🚪 {c.room}</span>}
              {c.teacher && <span className="text-xs text-slate-500">👤 {t("담임", "Homeroom")} {c.teacher}</span>}
              {c.subTeacher && <span className="text-xs text-slate-400">· {t("부담임", "Co")} {c.subTeacher}</span>}
              <span className="ml-auto rounded-full bg-teal-50 px-2 py-0.5 text-[11px] font-bold text-teal-700">{t("학생", "Students")} {c.students.length}</span>
            </div>

            {/* 지금 수업 */}
            {now.weekday >= 1 && now.weekday <= 5 && (
              <div className="mb-3 rounded-xl border border-teal-100 bg-teal-50/40 px-3 py-2 text-sm">
                {nowCell ? (
                  <span className="font-semibold text-teal-800">🔔 {t("지금", "Now")}: {nowCell.subject}{nowCell.room ? ` · ${nowCell.room}` : ""}{nowCell.teacher ? ` · ${nowCell.teacher}` : ""}</span>
                ) : (
                  <span className="text-slate-400">{t("지금은 수업 시간이 아닙니다.", "Not in a class period right now.")}</span>
                )}
              </div>
            )}

            {/* 학생 명단 위젯 */}
            <div className="mb-3">
              <div className="mb-1.5 text-xs font-bold text-slate-600">🧒 {t("우리 반 학생", "Class Roster")}</div>
              {c.students.length === 0 ? (
                <span className="text-xs text-slate-300">{t("학생 정보가 없습니다.", "No students.")}</span>
              ) : (
                <div className="flex flex-wrap gap-1">
                  {c.students.map((n, j) => (
                    <span key={j} className="rounded-md bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600">{n}</span>
                  ))}
                </div>
              )}
            </div>

            {/* 우리 반 주간 시간표 */}
            <div className="mb-1 text-xs font-bold text-slate-600">🗓️ {t("우리 반 주간 시간표", "Weekly Timetable")}</div>
            <Timetable
              rowPeriods={deptPeriods}
              cellAt={cellAt}
              nowWeekday={now.weekday}
              nowPeriodId={nowPid ?? null}
              wdLabel={wdLabel}
              render={(cell) => (
                <>
                  <div className="font-semibold text-slate-700">{cell.subject}</div>
                  {cell.room && <div className="text-[9px] text-slate-400">{cell.room}</div>}
                </>
              )}
              emptyLabel={t("등록된 시간표가 없습니다.", "No timetable yet.")}
            />
          </div>
        );
      })}
    </div>
  );
}

// ── 과목 선생님 화면 ──────────────────────────────────────────────────────────
function SubjectView({
  myLessons,
  periods,
  periodById,
  nowPeriodIdsByDept,
  now,
  wdLabel,
  t,
}: {
  myLessons: MyLesson[];
  periods: TtPeriod[];
  periodById: Map<string, TtPeriod>;
  nowPeriodIdsByDept: Map<string, string>;
  now: { weekday: number; minutes: number };
  wdLabel: (wd: number) => string;
  t: (ko: string, en?: string) => string;
}) {
  // 내 수업이 쓰는 교시들을 시작시간순으로(부서가 섞여도 시간순으로 한 격자에).
  const usedPeriodIds = new Set(myLessons.map((l) => l.periodId));
  const rowPeriods = [...periodById.values()].filter((p) => usedPeriodIds.has(p.id)).sort((a, b) => toMin(a.start) - toMin(b.start) || a.periodNo - b.periodNo);
  const cellAt = new Map<string, TtCell>();
  for (const l of myLessons) cellAt.set(`${l.weekday}:${l.periodId}`, { weekday: l.weekday, periodId: l.periodId, subject: l.subject, teacher: null, classLabel: l.classLabel, room: l.room });

  // 지금 상태: 내 수업 중이면 수업+장소, 아니면 프랩/대기.
  const nowLesson = myLessons.find((l) => l.weekday === now.weekday && nowPeriodIdsByDept.get(periodById.get(l.periodId)?.department ?? "") === l.periodId);
  const isSchoolTime = now.weekday >= 1 && now.weekday <= 5;

  return (
    <div className="flex flex-col gap-4">
      {/* 지금 무슨 시간 */}
      <div className={"rounded-2xl border p-4 " + (nowLesson ? "border-teal-300 bg-teal-50" : "border-slate-200 bg-white")}>
        <div className="text-xs font-medium text-slate-500">🕘 {t("지금", "Right now")} · {wdLabel(now.weekday)}</div>
        {!isSchoolTime ? (
          <div className="mt-1 text-lg font-bold text-slate-400">{t("주말입니다.", "Weekend.")}</div>
        ) : nowLesson ? (
          <div className="mt-1">
            <div className="text-2xl font-extrabold text-teal-800">{t("수업 중", "In class")} · {nowLesson.subject}</div>
            <div className="mt-0.5 text-sm text-teal-700">{nowLesson.classLabel}{nowLesson.room ? ` · 🚪 ${nowLesson.room}` : ""}</div>
          </div>
        ) : (
          <div className="mt-1 text-2xl font-extrabold text-slate-500">{t("프랩 / 대기 시간", "Prep / Free")}</div>
        )}
      </div>

      {/* 시수 요약 */}
      <div className="flex flex-wrap gap-2">
        <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-sm">{t("주간 총 시수", "Weekly hours")} <b className="text-teal-700">{myLessons.length}</b></span>
        <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-sm">{t("담당 반", "Classes")} <b className="text-teal-700">{new Set(myLessons.map((l) => l.classLabel)).size}</b></span>
        <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-sm">{t("과목", "Subjects")} <b className="text-teal-700">{new Set(myLessons.map((l) => l.subject)).size}</b></span>
      </div>

      {/* 내 주간 시간표 */}
      <div className="rounded-2xl border border-slate-200 bg-white p-4">
        <div className="mb-2 text-xs font-bold text-slate-600">🗓️ {t("내 주간 시간표", "My Weekly Schedule")}</div>
        <Timetable
          rowPeriods={rowPeriods}
          cellAt={cellAt}
          nowWeekday={now.weekday}
          nowPeriodId={nowLesson?.periodId ?? null}
          wdLabel={wdLabel}
          render={(cell) => (
            <>
              <div className="font-semibold text-slate-700">{cell.subject}</div>
              <div className="text-[9px] text-slate-500">{cell.classLabel}</div>
              {cell.room && <div className="text-[9px] text-slate-400">{cell.room}</div>}
            </>
          )}
          emptyLabel={t("등록된 시간표가 없습니다. 관리자에게 시간표 입력을 요청하세요.", "No timetable found. Ask an admin to enter your schedule.")}
        />
        {periods.length === 0 && <p className="mt-2 text-[11px] text-amber-600">{t("교시 정보가 없습니다.", "No period info.")}</p>}
      </div>
    </div>
  );
}

// 공통 주간 시간표 격자(행=교시, 열=월~금). 지금 교시/요일 칸을 강조합니다.
function Timetable({
  rowPeriods,
  cellAt,
  nowWeekday,
  nowPeriodId,
  wdLabel,
  render,
  emptyLabel,
}: {
  rowPeriods: TtPeriod[];
  cellAt: Map<string, TtCell>;
  nowWeekday: number;
  nowPeriodId: string | null;
  wdLabel: (wd: number) => string;
  render: (cell: TtCell) => React.ReactNode;
  emptyLabel: string;
}) {
  if (rowPeriods.length === 0) {
    return <p className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-3 py-4 text-center text-xs text-slate-400">{emptyLabel}</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[560px] border-collapse text-center text-[11px]">
        <thead>
          <tr className="text-slate-400">
            <th className="w-24 border border-slate-100 bg-slate-50 px-1 py-1 font-semibold">{" "}</th>
            {WEEKDAYS.map((wd) => (
              <th key={wd} className={"border border-slate-100 px-1 py-1 font-semibold " + (wd === nowWeekday ? "bg-teal-100 text-teal-700" : "bg-slate-50")}>{wdLabel(wd)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rowPeriods.map((p) => (
            <tr key={p.id}>
              <td className="border border-slate-100 bg-slate-50 px-1 py-1 text-left">
                <div className="font-semibold text-slate-600">{p.label}</div>
                <div className="text-[9px] text-slate-400">{p.start}~{p.end}</div>
              </td>
              {WEEKDAYS.map((wd) => {
                const cell = cellAt.get(`${wd}:${p.id}`);
                const isNow = wd === nowWeekday && p.id === nowPeriodId;
                return (
                  <td key={wd} className={"border border-slate-100 px-1 py-1 align-top " + (isNow ? "bg-teal-50 ring-1 ring-inset ring-teal-300" : cell ? "bg-white" : "bg-slate-50/40")}>
                    {cell ? render(cell) : <span className="text-slate-200">·</span>}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
