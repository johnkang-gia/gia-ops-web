"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { DepartmentMemo, GoogleChatMirrorMessage } from "@/lib/types";
import {
  ATTENDANCE_CATEGORIES,
  categorize,
  dateChipLabel,
  dedupeEntries,
  extractTargetDate,
  matchRosterStudents,
  todayKey,
  type AttendanceCategory,
  type AttendanceEntry,
  type RosterStudent,
} from "@/lib/attendanceDigest";

function timeStr(iso: string) {
  return new Date(iso).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });
}

// 출결알림 방(구글챗)과 부서 메모에서 결석·픽업·지각·조퇴를 뽑아 학생별로 정리해 보여줍니다.
// 왼쪽 출결알림 패널이 원문 로그라면, 여기는 그 원문에서 추려낸 요약본입니다.
export default function AttendanceDigestPanel({
  messages,
  department,
  roster,
}: {
  messages: GoogleChatMirrorMessage[];
  department: string;
  // 학생 명부 - 문장에서 이름을 "추측"하지 않고 실제 명부와 대조하기 위해 씁니다(정서안/정서안만
  // 오탐 방지). 동명이인은 문장의 학년 힌트로 구분합니다.
  roster: RosterStudent[];
}) {
  // 부서 메모도 함께 훑습니다(요청: "부서메모에서도, 결석, 픽업이 있다면, 출결내역으로 올려주고").
  // 메모는 부서당 한 장이라 내용만 실시간으로 따라가면 됩니다.
  const [memo, setMemo] = useState("");

  useEffect(() => {
    if (department === "전체") return;
    const supabase = createClient();
    let cancelled = false;

    supabase
      .from("department_memos")
      .select("content")
      .eq("department", department)
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelled) setMemo((data as DepartmentMemo | null)?.content ?? "");
      });

    const channel = supabase
      .channel(`attendance-digest-memo-${department}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "department_memos", filter: `department=eq.${department}` },
        (payload) => {
          const row = payload.new as DepartmentMemo | undefined;
          if (row) setMemo(row.content ?? "");
        }
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [department]);

  const allEntries = useMemo(() => {
    const now = new Date();
    const today = todayKey(now);
    const out: AttendanceEntry[] = [];

    // 1) 구글챗 출결알림
    //    "조영윤 금요일 결석입니다"처럼 오늘이 아닌 날을 미리 알리는 경우가 많아서, 오늘 온
    //    메시지만 보면 안 됩니다(며칠 전에 미리 알려준 오늘 결석을 놓칩니다). 최근 2주치를
    //    훑고, 각 메시지에 적힌 날짜/요일로 "언제의 출결인지"를 계산해 분류합니다.
    const scanFrom = new Date(now);
    scanFrom.setDate(scanFrom.getDate() - 14);

    for (const m of messages) {
      if (m.source_key !== "attendance") continue;
      const sentAt = new Date(m.created_at_google);
      if (sentAt < scanFrom) continue;
      const category = categorize(m.content);
      if (!category) continue;
      // 날짜 언급이 없으면 그 메시지가 온 날의 출결로 봅니다.
      const targetDate = extractTargetDate(m.content, sentAt) ?? todayKey(sentAt);
      const students = matchRosterStudents(m.content, roster);
      if (students.length === 0) {
        // 명부에서 이름을 못 찾아도 버리지 않고 원문 앞부분을 그대로 보여줍니다(전학생·오탈자
        // 등으로 대조가 실패해도 놓치지 않도록).
        const fallback = m.content.slice(0, 12);
        out.push({
          key: `chat-${m.id}-raw`,
          category,
          studentName: fallback,
          studentKey: fallback,
          ambiguous: false,
          rawText: m.content,
          time: m.created_at_google,
          sourceLabel: "구글챗",
          targetDate,
        });
        continue;
      }
      for (const s of students) {
        out.push({
          key: `chat-${m.id}-${s.studentKey}`,
          category,
          studentName: s.displayName,
          studentKey: s.studentKey,
          ambiguous: s.ambiguous,
          rawText: m.content,
          time: m.created_at_google,
          sourceLabel: "구글챗",
          targetDate,
        });
      }
    }

    // 2) 부서 메모 - 줄 단위로 훑습니다(한 줄에 한 건씩 적는 게 보통이라).
    for (const [i, line] of memo.split("\n").entries()) {
      const text = line.trim();
      if (!text) continue;
      const category = categorize(text);
      if (!category) continue;
      const targetDate = extractTargetDate(text, now) ?? today;
      // 메모는 자유 서술이라 명부에 없는 이름을 넣으면 오탐이 많아, 명부에서 찾은 경우만 올립니다.
      for (const s of matchRosterStudents(text, roster)) {
        out.push({
          key: `memo-${i}-${s.studentKey}`,
          category,
          studentName: s.displayName,
          studentKey: s.studentKey,
          ambiguous: s.ambiguous,
          rawText: text,
          time: null,
          sourceLabel: "부서메모",
          targetDate,
        });
      }
    }

    // 구글챗과 부서메모에 같은 내용이 겹쳐 적힌 경우 학생이 두 번 뜨지 않도록 정리합니다.
    // 지난 날짜는 이미 끝난 일이라 화면에서 뺍니다.
    return dedupeEntries(out).filter((e) => e.targetDate >= today);
  }, [messages, memo, roster]);

  const today = todayKey();
  // 오늘 것만 위쪽 픽업/결석/지각 칸에 넣고, 앞으로 예정된 건은 아래 "예정" 칸으로 따로 뺍니다.
  const entries = useMemo(() => allEntries.filter((e) => e.targetDate === today), [allEntries, today]);
  const upcoming = useMemo(
    () => allEntries.filter((e) => e.targetDate > today).sort((a, b) => a.targetDate.localeCompare(b.targetDate)),
    [allEntries, today]
  );

  const grouped = useMemo(() => {
    const map = new Map<AttendanceCategory, AttendanceEntry[]>();
    for (const e of entries) {
      const arr = map.get(e.category) ?? [];
      arr.push(e);
      map.set(e.category, arr);
    }
    return map;
  }, [entries]);

  return (
    <div className="glass flex h-full flex-col overflow-hidden p-2.5">
      {/* 제목 옆에 픽업/결석/지각 순서로 건수를 요약합니다(요청 1). */}
      <div className="mb-1.5 flex shrink-0 flex-wrap items-center gap-1 text-[12px] font-bold text-emerald-600">
        <span>📊 출결내역</span>
        <div className="ml-auto flex items-center gap-1">
          {ATTENDANCE_CATEGORIES.map((c) => {
            const n = grouped.get(c.key)?.length ?? 0;
            if (c.key === "조퇴" && n === 0) return null; // 조퇴는 있을 때만 표시(요약이 길어지지 않도록)
            return (
              <span key={c.key} className={"rounded-full px-1.5 py-0.5 text-[10px] font-semibold " + c.chipClass}>
                {c.icon} {n}
              </span>
            );
          })}
        </div>
      </div>

      {entries.length === 0 && upcoming.length === 0 ? (
        <div className="flex flex-1 items-center justify-center px-2 text-center text-[11px] leading-relaxed opacity-40">
          오늘 결석·픽업 관련 내용이 아직 없습니다.
        </div>
      ) : (
        /* 픽업 / 결석 / 지각(+조퇴)을 위에서부터 각각의 칸으로 나눠 보여줍니다(요청 2). */
        <div className="flex flex-1 flex-col gap-1.5 overflow-y-auto pr-1">
          {ATTENDANCE_CATEGORIES.map((c) => {
            const list = grouped.get(c.key) ?? [];
            if (c.key === "조퇴" && list.length === 0) return null;
            return (
              <div key={c.key} className="rounded-lg border border-black/5">
                <div className={"flex items-center gap-1 rounded-t-lg px-2 py-1 text-[11px] font-bold " + c.chipClass}>
                  <span>{c.icon}</span>
                  <span>{c.label}</span>
                  <span className="ml-auto rounded-full bg-white/70 px-1.5 text-[9px] font-semibold">{list.length}</span>
                </div>
                {list.length === 0 ? (
                  <p className="px-2 py-1 text-[10px] text-slate-300">없음</p>
                ) : (
                  <div className="flex flex-col divide-y divide-black/[0.03]">
                    {list.map((e) => (
                      <div key={e.key} className="px-2 py-1">
                        <div className="flex items-center justify-between gap-1">
                          <span
                            className={
                              "truncate text-[11px] font-semibold " + (e.ambiguous ? "text-amber-600" : "text-slate-700")
                            }
                            title={e.ambiguous ? "같은 이름의 학생이 여러 명입니다 - 학년을 함께 적어주세요(예: 2학년 김재이)" : undefined}
                          >
                            {e.ambiguous ? "⚠️ " : ""}
                            {e.studentName}
                          </span>
                          <span className="shrink-0 text-[9px] text-slate-400">
                            {e.sourceLabel === "부서메모" ? "📝" : ""}
                            {e.time ? timeStr(e.time) : e.sourceLabel}
                          </span>
                        </div>
                        <p className="truncate text-[10px] text-slate-500" title={e.rawText}>
                          {e.rawText}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}

          {/* 앞으로 예정된 건("조영윤 금요일 결석입니다" 등)은 오늘 집계에 섞이지 않도록
              아래에 날짜와 함께 따로 모아 보여줍니다. */}
          {upcoming.length > 0 && (
            <div className="rounded-lg border border-dashed border-slate-300">
              <div className="flex items-center gap-1 rounded-t-lg bg-slate-50 px-2 py-1 text-[11px] font-bold text-slate-500">
                <span>📅</span>
                <span>예정</span>
                <span className="ml-auto rounded-full bg-white px-1.5 text-[9px] font-semibold">{upcoming.length}</span>
              </div>
              <div className="flex flex-col divide-y divide-black/[0.03]">
                {upcoming.map((e) => {
                  const cat = ATTENDANCE_CATEGORIES.find((c) => c.key === e.category);
                  return (
                    <div key={e.key} className="px-2 py-1">
                      <div className="flex items-center justify-between gap-1">
                        <span className="flex min-w-0 items-center gap-1">
                          <span className={"shrink-0 rounded-full px-1.5 text-[9px] font-semibold " + (cat?.chipClass ?? "")}>
                            {cat?.icon} {cat?.label}
                          </span>
                          <span
                            className={
                              "truncate text-[11px] font-semibold " + (e.ambiguous ? "text-amber-600" : "text-slate-700")
                            }
                            title={e.ambiguous ? "같은 이름의 학생이 여러 명입니다 - 학년을 함께 적어주세요(예: 2학년 김재이)" : undefined}
                          >
                            {e.ambiguous ? "⚠️ " : ""}
                            {e.studentName}
                          </span>
                        </span>
                        <span className="shrink-0 rounded-full bg-slate-100 px-1.5 text-[9px] font-semibold text-slate-500">
                          {dateChipLabel(e.targetDate)}
                        </span>
                      </div>
                      <p className="truncate text-[10px] text-slate-500" title={e.rawText}>
                        {e.rawText}
                      </p>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
