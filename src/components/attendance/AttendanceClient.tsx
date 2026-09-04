"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useRealtimeTable } from "@/lib/useRealtimeTable";
import { useToast } from "@/components/common/ToastProvider";
import GuideButton from "@/components/common/GuideButton";
import type { AttendanceRecord, AttendanceStatus, WrClass, WrStudent } from "@/lib/types";
import type { ReasonType } from "@/lib/attendanceRegister";
import AttendanceSummaryPanel, { type SummaryRow } from "./AttendanceSummaryPanel";
import { useLang, useT } from "@/components/common/LanguageProvider";
import { classLabel } from "@/lib/i18nLabels";
import type { Lang, T } from "@/lib/lang";

function guideSections(t: T) {
  return [
    {
      title: t("🗒️ 출석부란?", "🗒️ What is this page?"),
      lines: [
        t(
          "학생별로 오늘 출결 상태(출석/지각/결석/조퇴/기타)를 눌러서 체크합니다. 누가 언제 체크했는지 자동으로 기록되고, 다른 교직원 화면에도 실시간으로 바로 반영됩니다.",
          "Tap a student's attendance status. It is saved with your name and the time, and appears instantly on every other staff member's screen."
        ),
        t(
          "결석 또는 조퇴로 표시된 학생은 보호자 연락처(전화/이메일)가 함께 나타납니다. 연락 후 '연락완료'를 체크하면 누가 언제 연락했는지 남습니다.",
          "Students marked absent or early-leave show the guardian's phone and email. After contacting them, tick 'Contacted' to record who called and when."
        ),
        t(
          "상단 날짜를 바꾸면 지난 날짜의 출결 기록도 조회할 수 있습니다.",
          "Change the date at the top to look up attendance from a previous day."
        ),
      ],
    },
  ];
}

const STATUS_LIST: AttendanceStatus[] = ["출석", "지각", "결석", "조퇴", "기타"];
const STATUS_META: Record<AttendanceStatus, { emoji: string; active: string; en: string }> = {
  출석: { emoji: "✅", active: "border-emerald-500 bg-emerald-500 text-white", en: "Present" },
  지각: { emoji: "⏰", active: "border-amber-500 bg-amber-500 text-white", en: "Late" },
  결석: { emoji: "🚫", active: "border-red-500 bg-red-500 text-white", en: "Absent" },
  조퇴: { emoji: "🚪", active: "border-orange-500 bg-orange-500 text-white", en: "Early Leave" },
  기타: { emoji: "❔", active: "border-slate-500 bg-slate-500 text-white", en: "Other" },
};
const NEEDS_CONTACT: AttendanceStatus[] = ["결석", "조퇴"];

/**
 * 결석 사유.
 *
 * 상급학교 서류와 체류 증빙에서 묻는 것은 "며칠 결석" 이 아니라 대개 **"무단결석 몇 회"**
 * 입니다. 사유 칸이 없으면 아파서 쉰 아이와 연락 없이 안 온 아이가 같은 줄로 남고, 나중에
 * 나누려면 지난 기록을 사람이 다시 훑어야 합니다.
 *
 * 자동으로 고르지 않습니다 - 연락 글만 보고 질병인지 인정인지 가릴 수 없고, 미리 찍어두면
 * 아무도 다시 안 봅니다.
 */
const REASONS: { key: ReasonType; label: string; en: string; hint: string }[] = [
  { key: "질병", label: "질병", en: "Illness", hint: "아파서 (학부모 연락·진단서)" },
  { key: "인정", label: "인정", en: "Excused", hint: "학교가 인정하는 사유 (경조사·학교 행사·법정 감염병)" },
  { key: "기타", label: "기타", en: "Other", hint: "위에 안 들어가는데 사유는 있는 경우" },
  { key: "무단", label: "무단", en: "Unexcused", hint: "연락 없이 오지 않음 - 서류에서 실제로 묻는 숫자입니다" },
];

function timeOnly(iso: string, lang: Lang) {
  return new Date(iso).toLocaleTimeString(lang === "en" ? "en-US" : "ko-KR", { hour: "2-digit", minute: "2-digit" });
}

function StudentRow({
  student,
  record,
  myEmail,
  myName,
  staffNames,
  onSetStatus,
  onSetReason,
  onContact,
  busy,
}: {
  student: WrStudent;
  record: AttendanceRecord | undefined;
  myEmail: string;
  myName: string | null;
  staffNames: Record<string, string>;
  onSetStatus: (student: WrStudent, status: AttendanceStatus) => void;
  onSetReason: (record: AttendanceRecord, reason: ReasonType) => void;
  onContact: (student: WrStudent, record: AttendanceRecord, contacted: boolean, note: string) => void;
  busy: boolean;
}) {
  const t = useT();
  const { lang } = useLang();
  const [noteDraft, setNoteDraft] = useState(record?.contact_note ?? "");
  const needsContact = record && NEEDS_CONTACT.includes(record.status);

  // 5열 그리드 안에 들어가는 카드라 가로 폭이 좁아질 수 있어서(요청: "출석부 공간 넓으니까
  // 페이지 다섯열로 나눠서"), 이름/상태버튼을 좌우로 나란히 두지 않고 위아래로 쌓아 좁은
  // 칸에서도 버튼이 잘리지 않게 했습니다.
  return (
    <div className="flex h-full flex-col gap-1.5 rounded-lg border border-slate-100 bg-white px-3 py-2.5 shadow-sm">
      <div className="min-w-0">
        <div className="truncate text-sm font-semibold text-slate-700">
          {lang === "en" && student.name_en ? student.name_en : student.name}
        </div>
        {student.name_en && (
          <div className="truncate text-[11px] text-slate-400">{lang === "en" ? student.name : student.name_en}</div>
        )}
      </div>
      <div className="flex flex-wrap gap-1">
        {STATUS_LIST.map((s) => {
          const active = record?.status === s;
          return (
            <button
              key={s}
              type="button"
              disabled={busy}
              onClick={() => onSetStatus(student, s)}
              title={t(s, STATUS_META[s].en)}
              className={
                "rounded-full border px-2 py-1 text-xs font-semibold transition disabled:opacity-50 " +
                (active ? STATUS_META[s].active : "border-slate-200 text-slate-500 hover:bg-slate-50")
              }
            >
              {STATUS_META[s].emoji} {t(s, STATUS_META[s].en)}
            </button>
          );
        })}
      </div>

      {/* 연락에서 저절로 들어온 줄.
          담임이 찍은 것과 토들에서 자동으로 온 것은 믿는 정도가 다른데, 표시가 없으면 화면에서
          똑같아 보입니다. 노란 줄로 띄우고, 상태 버튼을 한 번 누르면 사람이 확인한 것이 됩니다. */}
      {record && record.confirmed_by_human === false && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] leading-relaxed text-amber-800">
          <b>{record.source ?? "자동"}</b> 연락에서 저절로 들어왔습니다 — 맞으면 위 버튼을 한 번 눌러 확인해주세요.
        </div>
      )}

      {/* 결석일 때만 사유를 묻습니다. 지각·조퇴까지 물으면 매일 누를 것이 늘어나고,
          늘어난 만큼 아무도 안 누르게 됩니다. */}
      {record?.status === "결석" && (
        <div className="flex flex-wrap items-center gap-1">
          <span className="text-[11px] font-semibold text-slate-500">{t("사유", "Reason")}</span>
          {REASONS.map((r) => {
            const on = record.reason_type === r.key;
            return (
              <button
                key={r.key}
                type="button"
                disabled={busy}
                title={r.hint}
                onClick={() => onSetReason(record, r.key)}
                className={
                  "rounded-full border px-2 py-0.5 text-[11px] font-semibold transition disabled:opacity-50 " +
                  (on ? "border-slate-700 bg-slate-700 text-white" : "border-slate-200 text-slate-500 hover:bg-slate-50")
                }
              >
                {t(r.label, r.en)}
              </button>
            );
          })}
          {!record.reason_type && <span className="text-[11px] text-amber-700">{t("아직 안 골랐습니다", "Not chosen yet")}</span>}
        </div>
      )}

      {record?.checked_by && (
        <div className="mt-1 text-[11px] text-slate-400">
          {t("체크", "Checked by")}: {record.checked_by_name || staffNames[record.checked_by] || record.checked_by}
          {record.checked_at && <> · {timeOnly(record.checked_at, lang)}</>}
        </div>
      )}

      {needsContact && (
        <div className="mt-2 rounded-lg border border-red-100 bg-red-50/60 p-2.5">
          <div className="mb-1.5 flex flex-wrap items-center gap-2 text-xs text-red-700">
            <span className="font-semibold">📞 {t("보호자 연락", "Contact guardian")}</span>
            {student.parent_phone ? (
              <a href={`tel:${student.parent_phone}`} className="rounded-full bg-white px-2 py-0.5 font-semibold text-red-700 shadow-sm hover:bg-red-100">
                {student.parent_phone}
              </a>
            ) : (
              <span className="text-red-300">{t("연락처 없음", "No phone number")}</span>
            )}
            {student.parent_email && (
              <a href={`mailto:${student.parent_email}`} className="rounded-full bg-white px-2 py-0.5 font-semibold text-red-700 shadow-sm hover:bg-red-100">
                ✉️ {student.parent_email}
              </a>
            )}
          </div>
          <label className="flex items-start gap-2 text-xs text-red-800">
            <input
              type="checkbox"
              checked={record!.contacted_guardian}
              disabled={busy}
              onChange={(e) => onContact(student, record!, e.target.checked, noteDraft)}
              className="mt-0.5"
            />
            <span className="flex-1">
              <span className="font-semibold">{t("연락완료", "Contacted")}</span>
              {record!.contacted_guardian && record!.contacted_by && (
                <span className="ml-1 text-red-500">
                  ({record!.contacted_by_name || staffNames[record!.contacted_by] || record!.contacted_by}
                  {record!.contacted_at && ` · ${timeOnly(record!.contacted_at, lang)}`})
                </span>
              )}
            </span>
          </label>
          <input
            type="text"
            value={noteDraft}
            onChange={(e) => setNoteDraft(e.target.value)}
            onBlur={() => {
              if (record!.contacted_guardian && noteDraft !== (record!.contact_note ?? "")) {
                onContact(student, record!, true, noteDraft);
              }
            }}
            placeholder={t(
              "연락 메모 (예: 감기로 결석, 내일 등원 예정)",
              "Contact note (e.g. off sick with a cold, back tomorrow)"
            )}
            className="mt-1.5 w-full rounded-lg border border-red-200 bg-white px-2 py-1 text-xs"
          />
        </div>
      )}
    </div>
  );
}

export default function AttendanceClient({
  date,
  classes,
  students,
  initialRecords,
  myEmail,
  myName,
  isTeacher,
  staffNames,
  summaryRows,
  termLabel,
  schoolDayCount,
  coverageStart,
  isSchoolDay,
  closedLabel,
  autoAdded,
}: {
  date: string;
  classes: WrClass[];
  students: WrStudent[];
  initialRecords: AttendanceRecord[];
  myEmail: string;
  myName: string | null;
  isTeacher: boolean;
  staffNames: Record<string, string>;
  /** 학기 전체 집계. 오늘을 찍는 사람과 학기를 보는 사람이 같아서 한 화면에 둡니다. */
  summaryRows: SummaryRow[];
  termLabel: string;
  schoolDayCount: number;
  coverageStart: string | null;
  /** 오늘이 수업일인가. 쉬는 날이면 체크할 것이 없습니다. */
  isSchoolDay: boolean;
  closedLabel: string | null;
  /** 연락에서 저절로 채워진 줄 수. 0이면 아무것도 안 뜹니다. */
  autoAdded: number;
}) {
  const router = useRouter();
  const notify = useToast();
  const t = useT();
  const { lang } = useLang();
  const [records, setRecords] = useRealtimeTable<AttendanceRecord>("attendance_records", initialRecords);
  const [busyId, setBusyId] = useState<string | null>(null);
  /**
   * 오늘 찍기 / 쌓인 현황.
   *
   * 한 화면에 둡니다 - 나누면 오늘만 찍고 현황은 아무도 안 봅니다. 기본은 '오늘' 입니다.
   * 매일 여는 이유가 오늘을 찍기 위해서지, 학기 통계를 보기 위해서가 아닙니다.
   */
  const [view, setView] = useState<"오늘" | "현황">("오늘");

  // useRealtimeTable은 테이블 전체를 구독하므로(과거 다른 날짜 이벤트까지 함께 들어올 수 있음),
  // 화면에 보여줄 때는 항상 지금 조회 중인 날짜 것만 걸러서 씁니다.
  const recordsByStudent = useMemo(() => {
    const map = new Map<string, AttendanceRecord>();
    for (const r of records) {
      if (r.date === date) map.set(r.student_id, r);
    }
    return map;
  }, [records, date]);

  const classById = useMemo(() => new Map(classes.map((c) => [c.id, c])), [classes]);

  const groups = useMemo(() => {
    const g = new Map<string, { cls: WrClass | null; students: WrStudent[] }>();
    for (const s of students) {
      const key = s.class_id && classById.has(s.class_id) ? s.class_id : "unassigned";
      const cls = key === "unassigned" ? null : classById.get(key)!;
      if (!g.has(key)) g.set(key, { cls, students: [] });
      g.get(key)!.students.push(s);
    }
    // 학년/반 이름 순 정렬, 미배정은 맨 뒤로.
    return Array.from(g.entries()).sort(([aKey, a], [bKey, b]) => {
      if (aKey === "unassigned") return 1;
      if (bKey === "unassigned") return -1;
      const ag = a.cls?.grade ?? "", bg = b.cls?.grade ?? "";
      if (ag !== bg) return ag.localeCompare(bg);
      return (a.cls?.class_name ?? "").localeCompare(b.cls?.class_name ?? "");
    });
  }, [students, classById]);

  function changeDate(next: string) {
    router.push(`/attendance?date=${next}`);
  }

  function shiftDate(days: number) {
    const d = new Date(date + "T00:00:00");
    d.setDate(d.getDate() + days);
    changeDate(d.toISOString().slice(0, 10));
  }

  async function setStatus(student: WrStudent, status: AttendanceStatus) {
    setBusyId(student.id);
    const supabase = createClient();
    const existing = recordsByStudent.get(student.id);
    const payload = {
      student_id: student.id,
      class_id: student.class_id,
      date,
      status,
      checked_by: myEmail,
      checked_by_name: myName,
      checked_at: new Date().toISOString(),
      // 사람이 눌렀으므로 이 줄은 이제 사람의 판단입니다. 자동으로 들어와 있던 줄이라면
      // 이 순간 확인된 것으로 바뀌고 노란 표시가 사라집니다.
      source: isTeacher ? "담임" : "행정",
      confirmed_by_human: true,
      // 결석이 아니게 되면 사유도 함께 지웁니다 - 출석인데 '질병' 이 남아 있으면 집계가 틀립니다.
      ...(status === "결석" ? {} : { reason_type: null }),
      // 이미 결석/조퇴 처리+연락이 끝난 뒤 상태를 출석 등으로 되돌리면 연락 플래그도 함께
      // 정리합니다 - 더 이상 결석이 아닌데 "연락완료" 표시가 남아있으면 헷갈립니다.
      ...(NEEDS_CONTACT.includes(status)
        ? {}
        : { contacted_guardian: false, contact_note: null, contacted_by: null, contacted_by_name: null, contacted_at: null }),
    };
    const { data, error } = await supabase
      .from("attendance_records")
      .upsert(payload, { onConflict: "student_id,date" })
      .select()
      .single();
    setBusyId(null);
    if (error) {
      notify(t("출결 상태를 저장하지 못했습니다.", "Could not save the attendance status."), "error");
      return;
    }
    const row = data as AttendanceRecord;
    setRecords((prev) => {
      const exists = prev.some((r) => r.id === row.id);
      return exists ? prev.map((r) => (r.id === row.id ? row : r)) : [row, ...prev];
    });
    void existing;
  }

  async function setReason(record: AttendanceRecord, reason: ReasonType) {
    setBusyId(record.student_id);
    const { data, error } = await createClient()
      .from("attendance_records")
      .update({ reason_type: reason, confirmed_by_human: true })
      .eq("id", record.id)
      .select()
      .single();
    setBusyId(null);
    if (error) {
      // 조용히 넘기면 화면에는 골라진 것처럼 보이는데 다음에 열면 비어 있습니다.
      notify(t("사유를 저장하지 못했습니다.", "Could not save the reason."), "error");
      return;
    }
    const row = data as AttendanceRecord;
    setRecords((prev) => prev.map((r) => (r.id === row.id ? row : r)));
  }

  async function contact(student: WrStudent, record: AttendanceRecord, contacted: boolean, note: string) {
    setBusyId(student.id);
    const supabase = createClient();
    const { data, error } = await supabase
      .from("attendance_records")
      .update({
        contacted_guardian: contacted,
        contact_note: note || null,
        contacted_by: contacted ? myEmail : null,
        contacted_by_name: contacted ? myName : null,
        contacted_at: contacted ? new Date().toISOString() : null,
      })
      .eq("id", record.id)
      .select()
      .single();
    setBusyId(null);
    if (error) {
      notify(t("연락 상태를 저장하지 못했습니다.", "Could not save the contact status."), "error");
      return;
    }
    const row = data as AttendanceRecord;
    setRecords((prev) => prev.map((r) => (r.id === row.id ? row : r)));
  }

  const isToday = date === new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });
  const totalStudents = students.length;
  const absentCount = Array.from(recordsByStudent.values()).filter((r) => r.date === date && r.status === "결석").length;
  const uncontactedAbsent = Array.from(recordsByStudent.values()).filter(
    (r) => r.date === date && NEEDS_CONTACT.includes(r.status) && !r.contacted_guardian
  ).length;
  // 오늘 아직 확인 안 된 자동 줄. 담임이 한 번 눌러줘야 집계를 믿을 수 있습니다.
  const unconfirmedToday = Array.from(recordsByStudent.values()).filter((r) => r.confirmed_by_human === false).length;
  const missingReason = Array.from(recordsByStudent.values()).filter((r) => r.status === "결석" && !r.reason_type).length;
  const summaryMissing = summaryRows.reduce((n, r) => n + r.summary.missing, 0);
  const summaryUnconfirmed = summaryRows.reduce((n, r) => n + r.summary.unconfirmed, 0);

  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-2">
        <h1 className="text-lg font-bold">🗒️ {t("출석부", "Attendance")}</h1>
        <div className="flex items-center gap-2">
          <Link
            href={`/attendance/register?date=${date}`}
            className="rounded-lg border border-slate-200 px-2 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-50"
            title="종이 출석부 모양으로 학생 × 날짜 격자표를 봅니다"
          >
            📋 {t("반별 출석부", "Class register")}
          </Link>
          <GuideButton title={t("출석부 사용 가이드", "Attendance guide")} sections={guideSections(t)} />
        </div>
      </div>

      {/* 오늘 / 현황.
          같은 화면에 두되 한 번에 하나만 보여줍니다 - 둘을 위아래로 쌓으면 오늘 찍을 칸이
          화면 아래로 밀려나고, 매일 스크롤하게 됩니다. */}
      <div className="mb-3 flex items-center gap-1.5">
        {(["오늘", "현황"] as const).map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => setView(v)}
            className={
              "rounded-lg px-3 py-1.5 text-[13px] font-bold transition " +
              (view === v ? "bg-gia-navy text-white" : "border border-slate-200 text-slate-500 hover:bg-slate-50")
            }
          >
            {v === "오늘" ? t("오늘 찍기", "Today") : t("현황 (전체·학년·반)", "Summary")}
          </button>
        ))}
        {view === "오늘" && unconfirmedToday > 0 && (
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-800">
            연락에서 들어온 것 {unconfirmedToday}건 확인 필요
          </span>
        )}
        {view === "오늘" && missingReason > 0 && (
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">
            사유 안 고른 결석 {missingReason}건
          </span>
        )}
      </div>

      {view === "현황" && (
        <AttendanceSummaryPanel
          rows={summaryRows}
          termLabel={termLabel}
          schoolDays={schoolDayCount}
          coverageStart={coverageStart}
          missingTotal={summaryMissing}
          unconfirmedTotal={summaryUnconfirmed}
        />
      )}

      {/* 오늘 찍는 자리는 감추기만 합니다(지우지 않습니다).
          현황을 보고 돌아왔을 때 스크롤 위치와 열어둔 연락 메모가 그대로 남아야 합니다. */}
      <div className={view === "오늘" ? "" : "hidden"}>
      <p className="mb-4 text-xs text-slate-500">
        {isTeacher
          ? t(
              "내 담임/부담임 반 학생들의 출결을 실시간으로 체크합니다.",
              "Check attendance for your homeroom class in real time."
            )
          : t(
              "전체 반 학생들의 출결 현황을 실시간으로 보고, 결석 학생 보호자에게 연락할 수 있습니다.",
              "See attendance for every class in real time, and contact the guardians of absent students."
            )}
      </p>

      <div className="mb-3 flex flex-wrap items-center gap-2 g-panel-solid p-2.5 shadow-sm">
        <button type="button" onClick={() => shiftDate(-1)} className="rounded-lg border border-slate-200 px-2 py-1 text-xs font-semibold text-slate-500 hover:bg-slate-50">
          ‹ {t("이전", "Previous")}
        </button>
        <input
          type="date"
          value={date}
          onChange={(e) => e.target.value && changeDate(e.target.value)}
          className="rounded-lg border border-slate-300 px-2 py-1 text-sm"
        />
        <button type="button" onClick={() => shiftDate(1)} className="rounded-lg border border-slate-200 px-2 py-1 text-xs font-semibold text-slate-500 hover:bg-slate-50">
          {t("다음", "Next")} ›
        </button>
        {!isToday && (
          <button
            type="button"
            onClick={() => changeDate(new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" }))}
            className="rounded-lg bg-gia-navy px-2 py-1 text-xs font-semibold text-white hover:bg-gia-navy-2"
          >
            {t("오늘로", "Today")}
          </button>
        )}
        <div className="ml-auto flex flex-wrap items-center gap-2 text-xs text-slate-500">
          <span>{t(`전체 ${totalStudents}명`, `${totalStudents} students`)}</span>
          {absentCount > 0 && (
            <span className="rounded-full bg-red-100 px-2 py-0.5 font-semibold text-red-700">
              {t("결석", "Absent")} {absentCount}
            </span>
          )}
          {uncontactedAbsent > 0 && (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 font-semibold text-amber-700">
              📞 {t("미연락", "Not contacted")} {uncontactedAbsent}
            </span>
          )}
        </div>
      </div>

      {/* 쉬는 날.
          달력에서 뺀 날인데 출석부가 평소처럼 뜨면, 방학에 전교생 미체크가 쌓입니다. */}
      {!isSchoolDay && (
        <div className="mb-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-[12px] text-slate-600">
          이 날은 <b>수업일이 아닙니다</b>
          {closedLabel ? ` — ${closedLabel}` : ""}. 출결을 찍지 않아도 되고, 집계에서도 빠집니다.{" "}
          <Link href="/attendance/calendar" className="font-semibold underline">
            달력 고치기
          </Link>
        </div>
      )}

      {/* 연락에서 저절로 채워진 줄이 있으면 알립니다.
          말없이 채워두면 담임은 자기가 찍지 않은 줄을 자기가 찍은 것으로 여기게 됩니다. */}
      {autoAdded > 0 && (
        <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-[12px] text-amber-900">
          토들·구글챗 연락에서 <b>{autoAdded}명</b>의 출결을 미리 채웠습니다. 노란 줄로 표시된 학생을 한 번씩 확인해주세요 —
          맞으면 상태 버튼을 그대로 누르면 됩니다.
        </div>
      )}

      {groups.length === 0 && (
        <div className="rounded-xl border border-dashed border-slate-200 p-8 text-center text-sm text-slate-400">
          {isTeacher
            ? t("배정된 담임반이 없습니다.", "No homeroom class is assigned to you.")
            : t("재학중인 학생이 없습니다.", "There are no enrolled students.")}
        </div>
      )}

      <div className="flex flex-col gap-5">
        {groups.map(([key, { cls, students: groupStudents }]) => {
          const counts: Record<AttendanceStatus | "미체크", number> = {
            출석: 0, 지각: 0, 결석: 0, 조퇴: 0, 기타: 0, 미체크: 0,
          };
          for (const s of groupStudents) {
            const r = recordsByStudent.get(s.id);
            if (r && r.date === date) counts[r.status] += 1;
            else counts.미체크 += 1;
          }
          const teacherLabel = cls ? staffNames[cls.teacher_email ?? ""] || cls.teacher_name || cls.teacher_email : null;
          return (
            <div key={key}>
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <h2 className="text-sm font-bold text-slate-700">
                  {cls ? classLabel(cls.grade, cls.class_name, lang) : t("미배정", "Unassigned")}
                  {teacherLabel && (
                    <span className="ml-1 font-normal text-slate-400">
                      ({t("담임", "Homeroom")}: {teacherLabel})
                    </span>
                  )}
                </h2>
                <span className="text-[11px] text-slate-400">
                  {STATUS_LIST.map((s) => `${STATUS_META[s].emoji}${counts[s]}`).join(" ")} ·{" "}
                  {t("미체크", "Not checked")} {counts.미체크}
                </span>
              </div>
              {/* 요청: "출석부 공간 넓으니까 페이지 다섯열로 나눠서" - 화면이 넓을 때는 한 줄에
                  학생 5명씩 보이는 그리드로 배치합니다. 보호자 연락이 필요한(결석/조퇴) 카드는
                  연락처·연락완료 체크박스가 잘리지 않도록 그 줄 전체 폭을 씁니다. */}
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
                {groupStudents.map((s) => {
                  const rec = recordsByStudent.get(s.id);
                  const wide = !!rec && NEEDS_CONTACT.includes(rec.status);
                  return (
                    <div key={s.id} className={wide ? "sm:col-span-2 lg:col-span-3 xl:col-span-5" : ""}>
                      <StudentRow
                        student={s}
                        record={rec}
                        myEmail={myEmail}
                        myName={myName}
                        staffNames={staffNames}
                        onSetStatus={setStatus}
                        onSetReason={setReason}
                        onContact={contact}
                        busy={busyId === s.id}
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
      </div>
    </div>
  );
}
