"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { DepartmentMemo, GoogleChatMirrorMessage } from "@/lib/types";
import {
  categorize,
  dedupeEntries,
  extractTargetDate,
  guessKoreanName,
  matchRosterStudents,
  stripLeadingMention,
  todayKey,
  type AttendanceEntry,
  type RosterStudent,
} from "@/lib/attendanceDigest";

const POLL_MS = 15000;

// 사이드바 세 번째 위젯("오늘 차량 변경")에 쓰는 항목 - 값은 부모(ShuttleChecklistClient)가
// 실시간 items 상태에서 계산해 내려줍니다(이 컴포넌트는 shuttle_boardings/assignments를
// 직접 구독하지 않습니다 - 이미 부모가 구독 중인 값을 그대로 받아씁니다).
export type ChangedRouteEntry = {
  key: string;
  studentName: string;
  fromRouteNo: string;
  toRouteNo: string;
  mode: "today" | "permanent";
};

// 뱃지 코너 메모로 적은 학생별 특이사항입니다(요청: "특이사항있는 아이들 아이들별로 뱃지
// 코너에 메모적을 수 있게... 학생이름: 메모 이렇게 정리되도록").
export type SpecialNoteEntry = { key: string; studentName: string; note: string };

// 업무 메뉴까지 가지 않아도 오늘 픽업·결석 학생과 출결 메모를 바로 볼 수 있게 하는 좁은
// 사이드바입니다(요청: "하원체크표에는 업무메뉴에있는 결석과 픽업아이들이 목록으로 떴으면
// 좋겠어... 업무쪽으로 가지 않아도 알수 있도록"). 위쪽 위젯은 구글챗 출결알림방을
// AttendanceDigestPanel과 같은 규칙(명부 대조 우선, 실패 시 한글이름 추정)으로 다시 집계하고,
// 가운데 위젯은 오늘 노선이 바뀐 학생 목록(요청: "요일별로 따로타는 아이들을... 픽업과 결석외에
// 하나더 표시해서"), 아래쪽 위젯은 출결 메모(department_memos.attendance_memo)를 읽기
// 전용으로 보여줍니다 - 이 메모는 절대 자동 파싱되지 않는 자유 메모라서(요청) 여기서도
// 손대지 않고 그대로 보여주기만 합니다.
export default function ShuttleChecklistSidebar({
  roster,
  initialMessages,
  changedToday = [],
  specialNotes = [],
  department = "초등부",
  className = "",
  onSelectStudentName,
}: {
  roster: RosterStudent[];
  initialMessages: GoogleChatMirrorMessage[];
  changedToday?: ChangedRouteEntry[];
  specialNotes?: SpecialNoteEntry[];
  department?: string;
  className?: string;
  // 이름을 누르면 오른쪽 체크표에서 같은 이름을 바로 찾아 하이라이트합니다(요청: "왼쪽
  // 위젯에 이름을 누르면 체크표에 있는 같은 이름으로 자동으로 이동하도록... 빠르게 체크할
  // 수 있도록"). 검색창에 입력한 것과 똑같은 방식이라, 여기서는 검색어만 채워주면 됩니다.
  onSelectStudentName?: (name: string) => void;
}) {
  const [messages, setMessages] = useState(initialMessages);
  const [memoContent, setMemoContent] = useState<string | null>(null);
  const [memoUpdatedBy, setMemoUpdatedBy] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;

    async function loadMemo() {
      const { data } = await supabase
        .from("department_memos")
        .select("attendance_memo, attendance_memo_updated_by")
        .eq("department", department)
        .maybeSingle();
      if (cancelled) return;
      const row = data as Pick<DepartmentMemo, "attendance_memo" | "attendance_memo_updated_by"> | null;
      setMemoContent(row?.attendance_memo ?? "");
      setMemoUpdatedBy(row?.attendance_memo_updated_by ?? null);
    }
    loadMemo();

    // 출결 메모는 업무탭에서 실시간으로 바뀔 수 있어서(요청 원문의 취지: 업무쪽에 안 가도
    // 알 수 있도록), 여기도 realtime 구독으로 즉시 반영합니다.
    const channel = supabase
      .channel(`checklist-attendance-memo-${department}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "department_memos", filter: `department=eq.${department}` },
        (payload) => {
          const row = payload.new as DepartmentMemo | undefined;
          if (!row) return;
          setMemoContent(row.attendance_memo ?? "");
          setMemoUpdatedBy(row.attendance_memo_updated_by ?? null);
        }
      )
      .subscribe();

    async function pollMessages() {
      const { data } = await supabase
        .from("google_chat_mirror_messages")
        .select("*")
        .order("created_at_google", { ascending: false })
        .limit(200);
      if (!cancelled && data) setMessages(data as GoogleChatMirrorMessage[]);
    }
    const t = setInterval(pollMessages, POLL_MS);

    return () => {
      cancelled = true;
      clearInterval(t);
      supabase.removeChannel(channel);
    };
  }, [department]);

  // AttendanceDigestPanel과 동일한 규칙: 명부와 대조해 이름을 뽑고, 실패하면 아무거나 보여주지
  // 않고 문장에서 한글이름을 추정합니다(요청: "한글이름을 메인으로 뽑아줘").
  const { pickup, absent } = useMemo(() => {
    const now = new Date();
    const today = todayKey(now);
    const scanFrom = new Date(now);
    scanFrom.setDate(scanFrom.getDate() - 14);
    const out: AttendanceEntry[] = [];

    for (const m of messages) {
      if (m.source_key !== "attendance") continue;
      const sentAt = new Date(m.created_at_google);
      if (sentAt < scanFrom) continue;
      const category = categorize(m.content);
      if (category !== "픽업" && category !== "결석") continue;
      const targetDate = extractTargetDate(m.content, sentAt) ?? todayKey(sentAt);
      if (targetDate !== today) continue;
      const students = matchRosterStudents(m.content, roster);
      if (students.length === 0) {
        const guess = guessKoreanName(m.content, category) ?? stripLeadingMention(m.content).slice(0, 12);
        out.push({
          key: `sc-${m.id}-raw`,
          category,
          studentName: guess,
          studentKey: guess,
          ambiguous: false,
          unmatched: true,
          rawText: m.content,
          time: m.created_at_google,
          sourceLabel: "구글챗",
          targetDate,
        });
        continue;
      }
      for (const s of students) {
        out.push({
          key: `sc-${m.id}-${s.studentKey}`,
          category,
          studentName: s.displayName,
          studentKey: s.studentKey,
          ambiguous: s.ambiguous,
          unmatched: false,
          rawText: m.content,
          time: m.created_at_google,
          sourceLabel: "구글챗",
          targetDate,
        });
      }
    }

    const deduped = dedupeEntries(out);
    return {
      pickup: deduped.filter((e) => e.category === "픽업"),
      absent: deduped.filter((e) => e.category === "결석"),
    };
  }, [messages, roster]);

  function nameChip(e: AttendanceEntry, tone: "blue" | "red") {
    const toneClass = e.unmatched
      ? "bg-slate-100 text-slate-400"
      : e.ambiguous
        ? "bg-amber-50 text-amber-600"
        : tone === "blue"
          ? "bg-blue-50 text-blue-600"
          : "bg-red-50 text-red-600";
    // 동명이인 표시("김재이(2학년)")나 영어이름 병기("김재이(Jane)")가 붙어 있으면 체크표의
    // 원본 이름(student_name_raw)과 안 맞을 수 있어, 괄호 앞부분만 검색어로 씁니다.
    const coreName = e.studentName.replace(/\(.*$/, "").trim() || e.studentName;
    return (
      <button
        key={e.key}
        type="button"
        onClick={() => onSelectStudentName?.(coreName)}
        className={"rounded-full px-1.5 py-0.5 text-[10px] font-semibold transition hover:ring-2 hover:ring-offset-1 " + toneClass}
        title={(e.unmatched ? "명부와 대조되지 않아 추정한 이름입니다" : e.rawText) + " · 누르면 체크표에서 찾습니다"}
      >
        {e.unmatched ? "🔎 " : e.ambiguous ? "⚠️ " : ""}
        {e.studentName}
      </button>
    );
  }

  return (
    <div className={"flex w-full shrink-0 flex-col gap-3 lg:w-52 " + className}>
      <div className="rounded-xl border border-slate-200 bg-white p-3">
        <p className="mb-2 text-[11px] font-bold text-slate-600">📊 오늘 픽업·결석 (업무 출결내역)</p>
        <div className="mb-2">
          <p className="mb-1 text-[10px] font-bold text-blue-600">🚗 픽업 {pickup.length}</p>
          {pickup.length === 0 ? (
            <p className="text-[10px] text-slate-300">없음</p>
          ) : (
            <div className="flex flex-wrap gap-1">{pickup.map((e) => nameChip(e, "blue"))}</div>
          )}
        </div>
        <div>
          <p className="mb-1 text-[10px] font-bold text-red-600">🚫 결석 {absent.length}</p>
          {absent.length === 0 ? (
            <p className="text-[10px] text-slate-300">없음</p>
          ) : (
            <div className="flex flex-wrap gap-1">{absent.map((e) => nameChip(e, "red"))}</div>
          )}
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-3">
        <p className="mb-2 text-[11px] font-bold text-slate-600">🚌 오늘 차량 변경 {changedToday.length > 0 && `(${changedToday.length})`}</p>
        {changedToday.length === 0 ? (
          <p className="text-[10px] text-slate-300">없음</p>
        ) : (
          <div className="flex flex-col gap-1">
            {changedToday.map((c) => (
              <div key={c.key} className="flex items-center justify-between gap-1 rounded-lg bg-slate-50 px-1.5 py-1 text-[10px]">
                <span className="min-w-0 truncate font-semibold text-slate-700">{c.studentName}</span>
                <span className="flex shrink-0 items-center gap-1">
                  <span className="text-slate-400">
                    {c.fromRouteNo}호→{c.toRouteNo}호
                  </span>
                  <span
                    className={
                      "rounded-full px-1.5 py-0.5 font-bold " +
                      (c.mode === "today" ? "bg-amber-100 text-amber-700" : "bg-purple-100 text-purple-700")
                    }
                  >
                    {c.mode === "today" ? "오늘만" : "계속"}
                  </span>
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-3">
        <p className="mb-2 text-[11px] font-bold text-slate-600">⚠️ 특이사항 {specialNotes.length > 0 && `(${specialNotes.length})`}</p>
        {specialNotes.length === 0 ? (
          <p className="text-[10px] text-slate-300">없음</p>
        ) : (
          <div className="flex flex-col gap-1">
            {specialNotes.map((n) => (
              <p key={n.key} className="rounded-lg bg-orange-50 px-1.5 py-1 text-[10px] leading-relaxed text-orange-800">
                <span className="font-bold">{n.studentName}</span>: {n.note}
              </p>
            ))}
          </div>
        )}
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-3">
        <p className="mb-1.5 text-[11px] font-bold text-slate-600">📝 출결 메모</p>
        {memoContent ? (
          <p className="whitespace-pre-wrap text-[11px] leading-relaxed text-slate-700">{memoContent}</p>
        ) : (
          <p className="text-[10px] text-slate-300">작성된 메모가 없습니다.</p>
        )}
        {memoUpdatedBy && <p className="mt-1 text-[9px] text-slate-400">{memoUpdatedBy} 수정</p>}
      </div>
    </div>
  );
}
