"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useRealtimeTable } from "@/lib/useRealtimeTable";
import { useToast } from "@/components/common/ToastProvider";
import GuideButton from "@/components/common/GuideButton";
import type { AttendanceRecord, AttendanceStatus, WrClass, WrStudent } from "@/lib/types";

const GUIDE_SECTIONS = [
  {
    title: "🗒️ 출석부란? / What is this?",
    lines: [
      "학생별로 오늘 출결 상태(출석/지각/결석/조퇴/기타)를 눌러서 체크합니다. 누가 언제 체크했는지 자동으로 기록되고, 다른 교직원 화면에도 실시간으로 바로 반영됩니다. / Tap a student's attendance status — it's recorded with your name and time, and instantly visible to every other staff member's screen.",
      "결석 또는 조퇴로 표시된 학생은 보호자 연락처(전화/이메일)가 함께 나타납니다. 연락 후 '연락완료'를 체크하면 누가 언제 연락했는지 남습니다. / Absent or early-leave students show the guardian's phone/email right there. After contacting them, check 'Contacted' to log who reached out and when.",
      "상단 날짜를 바꾸면 지난 날짜의 출결 기록도 조회할 수 있습니다. / Change the date at the top to look up attendance from a previous day.",
    ],
  },
];

const STATUS_LIST: AttendanceStatus[] = ["출석", "지각", "결석", "조퇴", "기타"];
const STATUS_META: Record<AttendanceStatus, { emoji: string; active: string; en: string }> = {
  출석: { emoji: "✅", active: "border-emerald-500 bg-emerald-500 text-white", en: "Present" },
  지각: { emoji: "⏰", active: "border-amber-500 bg-amber-500 text-white", en: "Late" },
  결석: { emoji: "🚫", active: "border-red-500 bg-red-500 text-white", en: "Absent" },
  조퇴: { emoji: "🚪", active: "border-orange-500 bg-orange-500 text-white", en: "Early Leave" },
  기타: { emoji: "❔", active: "border-slate-500 bg-slate-500 text-white", en: "Other" },
};
const NEEDS_CONTACT: AttendanceStatus[] = ["결석", "조퇴"];

function timeOnly(iso: string) {
  return new Date(iso).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });
}

function StudentRow({
  student,
  record,
  myEmail,
  myName,
  staffNames,
  onSetStatus,
  onContact,
  busy,
}: {
  student: WrStudent;
  record: AttendanceRecord | undefined;
  myEmail: string;
  myName: string | null;
  staffNames: Record<string, string>;
  onSetStatus: (student: WrStudent, status: AttendanceStatus) => void;
  onContact: (student: WrStudent, record: AttendanceRecord, contacted: boolean, note: string) => void;
  busy: boolean;
}) {
  const [noteDraft, setNoteDraft] = useState(record?.contact_note ?? "");
  const needsContact = record && NEEDS_CONTACT.includes(record.status);

  // 5열 그리드 안에 들어가는 카드라 가로 폭이 좁아질 수 있어서(요청: "출석부 공간 넓으니까
  // 페이지 다섯열로 나눠서"), 이름/상태버튼을 좌우로 나란히 두지 않고 위아래로 쌓아 좁은
  // 칸에서도 버튼이 잘리지 않게 했습니다.
  return (
    <div className="flex h-full flex-col gap-1.5 rounded-lg border border-slate-100 bg-white px-3 py-2.5 shadow-sm">
      <div className="min-w-0">
        <div className="truncate text-sm font-semibold text-slate-700">{student.name}</div>
        {student.name_en && <div className="truncate text-[11px] text-slate-400">{student.name_en}</div>}
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
              title={STATUS_META[s].en}
              className={
                "rounded-full border px-2 py-1 text-xs font-semibold transition disabled:opacity-50 " +
                (active ? STATUS_META[s].active : "border-slate-200 text-slate-500 hover:bg-slate-50")
              }
            >
              {STATUS_META[s].emoji} {s}
            </button>
          );
        })}
      </div>

      {record?.checked_by && (
        <div className="mt-1 text-[11px] text-slate-400">
          체크: {record.checked_by_name || staffNames[record.checked_by] || record.checked_by}
          {record.checked_at && <> · {timeOnly(record.checked_at)}</>}
        </div>
      )}

      {needsContact && (
        <div className="mt-2 rounded-lg border border-red-100 bg-red-50/60 p-2.5">
          <div className="mb-1.5 flex flex-wrap items-center gap-2 text-xs text-red-700">
            <span className="font-semibold">📞 보호자 연락</span>
            {student.parent_phone ? (
              <a href={`tel:${student.parent_phone}`} className="rounded-full bg-white px-2 py-0.5 font-semibold text-red-700 shadow-sm hover:bg-red-100">
                {student.parent_phone}
              </a>
            ) : (
              <span className="text-red-300">연락처 없음</span>
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
              <span className="font-semibold">연락완료</span>
              {record!.contacted_guardian && record!.contacted_by && (
                <span className="ml-1 text-red-500">
                  ({record!.contacted_by_name || staffNames[record!.contacted_by] || record!.contacted_by}
                  {record!.contacted_at && ` · ${timeOnly(record!.contacted_at)}`})
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
            placeholder="연락 메모 (예: 감기로 결석, 내일 등원 예정) · Contact note"
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
}: {
  date: string;
  classes: WrClass[];
  students: WrStudent[];
  initialRecords: AttendanceRecord[];
  myEmail: string;
  myName: string | null;
  isTeacher: boolean;
  staffNames: Record<string, string>;
}) {
  const router = useRouter();
  const notify = useToast();
  const [records, setRecords] = useRealtimeTable<AttendanceRecord>("attendance_records", initialRecords);
  const [busyId, setBusyId] = useState<string | null>(null);

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
      notify("출결 상태를 저장하지 못했습니다. · Failed to save.", "error");
      return;
    }
    const row = data as AttendanceRecord;
    setRecords((prev) => {
      const exists = prev.some((r) => r.id === row.id);
      return exists ? prev.map((r) => (r.id === row.id ? row : r)) : [row, ...prev];
    });
    void existing;
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
      notify("연락 상태를 저장하지 못했습니다. · Failed to save.", "error");
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

  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-2">
        <h1 className="text-lg font-bold">🗒️ 출석부</h1>
        <GuideButton title="출석부 사용 가이드 · Guide" sections={GUIDE_SECTIONS} />
      </div>
      <p className="mb-4 text-xs text-slate-500">
        {isTeacher
          ? "내 담임/부담임 반 학생들의 출결을 실시간으로 체크합니다. · Check attendance for your homeroom class in real time."
          : "전체 반 학생들의 출결 현황을 실시간으로 보고, 결석 학생 보호자에게 연락할 수 있습니다. · View attendance for all classes in real time and contact guardians of absent students."}
      </p>

      <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white p-2.5 shadow-sm">
        <button type="button" onClick={() => shiftDate(-1)} className="rounded-lg border border-slate-200 px-2 py-1 text-xs font-semibold text-slate-500 hover:bg-slate-50">
          ‹ 이전
        </button>
        <input
          type="date"
          value={date}
          onChange={(e) => e.target.value && changeDate(e.target.value)}
          className="rounded-lg border border-slate-300 px-2 py-1 text-sm"
        />
        <button type="button" onClick={() => shiftDate(1)} className="rounded-lg border border-slate-200 px-2 py-1 text-xs font-semibold text-slate-500 hover:bg-slate-50">
          다음 ›
        </button>
        {!isToday && (
          <button
            type="button"
            onClick={() => changeDate(new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" }))}
            className="rounded-lg bg-gia-navy px-2 py-1 text-xs font-semibold text-white hover:bg-gia-navy-2"
          >
            오늘로
          </button>
        )}
        <div className="ml-auto flex flex-wrap items-center gap-2 text-xs text-slate-500">
          <span>전체 {totalStudents}명</span>
          {absentCount > 0 && <span className="rounded-full bg-red-100 px-2 py-0.5 font-semibold text-red-700">결석 {absentCount}</span>}
          {uncontactedAbsent > 0 && (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 font-semibold text-amber-700">📞 미연락 {uncontactedAbsent}</span>
          )}
        </div>
      </div>

      {groups.length === 0 && (
        <div className="rounded-xl border border-dashed border-slate-200 p-8 text-center text-sm text-slate-400">
          {isTeacher ? "배정된 담임반이 없습니다." : "재학중인 학생이 없습니다."}
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
                  {cls ? `${cls.grade ?? ""}학년 ${cls.class_name ?? ""}` : "미배정"}
                  {teacherLabel && <span className="ml-1 font-normal text-slate-400">(담임: {teacherLabel})</span>}
                </h2>
                <span className="text-[11px] text-slate-400">
                  {STATUS_LIST.map((s) => `${STATUS_META[s].emoji}${counts[s]}`).join(" ")} · 미체크 {counts.미체크}
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
  );
}
