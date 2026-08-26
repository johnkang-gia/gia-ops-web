"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { DepartmentMemo, GoogleChatMirrorMessage } from "@/lib/types";
import AttendanceTeachModal from "./AttendanceTeachModal";
import {
  ATTENDANCE_CATEGORIES,
  categorize,
  dateChipLabel,
  dedupeEntries,
  extractTargetDate,
  guessKoreanName,
  matchRosterStudents,
  stripLeadingMention,
  todayKey,
  type AttendanceCategory,
  type AttendanceEntry,
  type LearningRule,
  type RosterStudent,
} from "@/lib/attendanceDigest";

function timeStr(iso: string) {
  return new Date(iso).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });
}

const MEMO_SAVE_DELAY = 800;

// 출결 전용 메모칸 - 부서 메모(ActivityLog의 MemoPanel)와는 별개의 순수 자유 메모입니다. 절대
// 자동으로 파싱되어 위 출결내역에 올라가지 않습니다(요청: "부서 메모는 그냥 반영하지 말고").
// 용도: 오늘 픽업·결석·퇴소 아동을 손으로 정리하거나, 구글챗에 "금요일 권수호 픽업입니다"처럼
// 오늘이 아닌 날짜 얘기가 오면 "권수호 금요일 픽업"처럼 짧게 옮겨 적어 놓치지 않게 합니다
// (요청: "혹여나 구글챗에 오늘이 아닌 다른날의 출결상황을 적어주면 그것을 여기에 적어서
// 파악할 수 있도록"). department_memos에 이 패널 전용 칼럼(attendance_memo)을 추가로 써서,
// 부서 메모(content)와 완전히 독립된 값으로 관리합니다.
function AttendanceMemoPanel({ department, currentUserEmail }: { department: string; currentUserEmail: string }) {
  const [content, setContent] = useState("");
  const [updatedBy, setUpdatedBy] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const skipNextRealtimeRef = useRef(false);

  useEffect(() => {
    if (department === "전체") return;
    const supabase = createClient();
    let cancelled = false;

    supabase
      .from("department_memos")
      .select("attendance_memo, attendance_memo_updated_by")
      .eq("department", department)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled) return;
        const row = data as Pick<DepartmentMemo, "attendance_memo" | "attendance_memo_updated_by"> | null;
        setContent(row?.attendance_memo ?? "");
        setUpdatedBy(row?.attendance_memo_updated_by ?? null);
      });

    const channel = supabase
      .channel(`attendance-memo-${department}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "department_memos", filter: `department=eq.${department}` },
        (payload) => {
          if (skipNextRealtimeRef.current) {
            skipNextRealtimeRef.current = false;
            return;
          }
          const row = payload.new as DepartmentMemo | undefined;
          if (!row) return;
          setContent(row.attendance_memo ?? "");
          setUpdatedBy(row.attendance_memo_updated_by ?? null);
        }
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [department]);

  function handleChange(next: string) {
    setContent(next);
    setSaving(true);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      const supabase = createClient();
      skipNextRealtimeRef.current = true;
      const { error } = await supabase
        .from("department_memos")
        .upsert(
          {
            department,
            attendance_memo: next,
            attendance_memo_updated_by: currentUserEmail,
            attendance_memo_updated_at: new Date().toISOString(),
          },
          { onConflict: "department" }
        );
      setSaving(false);
      if (error) {
        skipNextRealtimeRef.current = false;
      } else {
        setUpdatedBy(currentUserEmail);
      }
    }, MEMO_SAVE_DELAY);
  }

  return (
    <div className="flex h-full min-w-0 flex-col">
      <div className="mb-1.5 flex shrink-0 items-center justify-between text-[12px] font-bold text-slate-600">
        <span>📝 출결 메모</span>
        <span className="text-[9px] font-medium text-slate-400">{saving ? "저장 중…" : updatedBy ? `${updatedBy} 수정` : ""}</span>
      </div>
      <textarea
        value={content}
        onChange={(e) => handleChange(e.target.value)}
        placeholder={"오늘 픽업·결석·퇴소 아동을 자유롭게 메모하세요.\n예: 권수호 금요일 픽업"}
        className="min-h-0 w-full flex-1 resize-none rounded-lg border border-black/5 bg-white/60 px-2 py-1.5 text-[11px] text-slate-700 outline-none focus:border-blue-300"
      />
    </div>
  );
}

// 출결알림 방(구글챗)에서 결석·픽업·지각·조퇴를 뽑아 학생별로 정리해 보여줍니다. 왼쪽
// 출결알림 패널이 원문 로그라면, 여기는 그 원문에서 추려낸 요약본입니다.
//
// 예전에는 부서 메모(department_memos.content)도 함께 훑어서 결석/픽업 문구가 있으면 이
// 요약에 자동으로 올렸는데, 그러면 부서 메모에 아무 말이나 자유롭게 적을 수가 없어졌습니다
// (요청: "부서메모에 출결사항을 메모하고 반영하니까 사실상 메모기능으로 쓸 수가 없어서"). 그래서
// 부서 메모 자동 반영은 걷어내고, 대신 이 패널 오른쪽에 출결 전용 메모칸(AttendanceMemoPanel)을
// 따로 뒀습니다 - 여기는 절대 자동으로 파싱되지 않는 순수 메모장입니다.
export default function AttendanceDigestPanel({
  messages,
  department,
  roster,
  currentUserEmail,
}: {
  messages: GoogleChatMirrorMessage[];
  department: string;
  // 학생 명부 - 문장에서 이름을 "추측"하지 않고 실제 명부와 대조하기 위해 씁니다(정서안/정서안만
  // 오탐 방지). 동명이인은 문장의 학년 힌트로 구분합니다.
  roster: RosterStudent[];
  currentUserEmail: string;
}) {
  // 사람이 가르친 규칙(별칭·분류·제외). 규칙이 바뀌면 화면이 바로 따라오도록 실시간 구독합니다.
  const [rules, setRules] = useState<LearningRule[]>([]);
  const [teach, setTeach] = useState<{ rawText: string; guessedName: string } | null>(null);

  const loadRules = useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase.from("attendance_learning_rules").select("kind, pattern, student_name, category");
    setRules((data as LearningRule[] | null) ?? []);
  }, []);

  useEffect(() => {
    loadRules();
    const supabase = createClient();
    const channel = supabase
      .channel("attendance-learning-rules")
      .on("postgres_changes", { event: "*", schema: "public", table: "attendance_learning_rules" }, () => loadRules())
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [loadRules]);

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
      const category = categorize(m.content, rules);
      if (!category) continue;
      // 날짜 언급이 없으면 그 메시지가 온 날의 출결로 봅니다.
      const targetDate = extractTargetDate(m.content, sentAt) ?? todayKey(sentAt);
      const students = matchRosterStudents(m.content, roster, rules);
      if (students.length === 0) {
        // 명부에서 이름을 못 찾아도 버리지 않고 보여줍니다(전학생·오탈자 등으로 대조가 실패해도
        // 놓치지 않도록). 그냥 원문을 잘라 보여주면 아무 단어나 이름처럼 뜨는 문제가 있어서
        // (요청: "대조하고 없으니까 그냥 아무거나 표시하는거 같아"), 먼저 문장에서 그나마 이름일
        // 법한 한글 단어를 추정해보고(guessKoreanName), 그마저 없을 때만 원문 앞부분을 씁니다.
        // "@멘션"은 태그일 뿐 학생 이름이 아니므로 둘 다 건너뜁니다.
        const stripped = stripLeadingMention(m.content);
        const guess = guessKoreanName(m.content, category) ?? stripped.slice(0, 12);
        out.push({
          key: `chat-${m.id}-raw`,
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
          key: `chat-${m.id}-${s.studentKey}`,
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

    // 같은 메시지가 겹쳐 올라온 경우 학생이 두 번 뜨지 않도록 정리합니다. 지난 날짜는 이미
    // 끝난 일이라 화면에서 뺍니다.
    return dedupeEntries(out).filter((e) => e.targetDate >= today);
  }, [messages, roster, rules]);

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
    // 출결내역 칸이 넓어서 좌:우 = 7:3으로 나눕니다(요청). 왼쪽은 기존 출결내역 그대로,
    // 오른쪽은 절대 자동 반영되지 않는 순수 출결 메모입니다.
    <div className="glass flex h-full gap-2.5 overflow-hidden p-2.5">
      <div className="flex h-full min-w-0 flex-[7] flex-col overflow-hidden">
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
                          {/* 🔎(대조 실패)·⚠️(동명이인 미확정)은 눌러서 한 번 가르치면 규칙으로
                              저장되어 다음부터 자동 적용됩니다(요청: "내가 판별 기준을 적으면
                              학습해서 더 정확하게"). 정상 대조된 이름은 누를 것이 없으므로 그대로 둡니다. */}
                          {e.unmatched || e.ambiguous ? (
                            <button
                              type="button"
                              onClick={() => setTeach({ rawText: e.rawText, guessedName: e.studentName })}
                              className={
                                "truncate text-left text-[11px] font-semibold underline decoration-dotted underline-offset-2 " +
                                (e.unmatched ? "text-slate-400 hover:text-blue-600" : "text-amber-600 hover:text-amber-700")
                              }
                              title={
                                e.unmatched
                                  ? "명부와 대조되지 않아 추정한 이름입니다 - 눌러서 어느 학생인지 알려주면 다음부터 자동으로 연결됩니다"
                                  : "같은 이름의 학생이 여러 명입니다 - 눌러서 어느 학생인지 알려주거나, 원문에 학년·생일을 함께 적어주세요"
                              }
                            >
                              {e.unmatched ? "🔎 " : "⚠️ "}
                              {e.studentName}
                            </button>
                          ) : (
                            <span className="truncate text-[11px] font-semibold text-slate-700">{e.studentName}</span>
                          )}
                          <span className="shrink-0 text-[9px] text-slate-400">
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
                          {/* 🔎(대조 실패)·⚠️(동명이인 미확정)은 눌러서 한 번 가르치면 규칙으로
                              저장되어 다음부터 자동 적용됩니다(요청: "내가 판별 기준을 적으면
                              학습해서 더 정확하게"). 정상 대조된 이름은 누를 것이 없으므로 그대로 둡니다. */}
                          {e.unmatched || e.ambiguous ? (
                            <button
                              type="button"
                              onClick={() => setTeach({ rawText: e.rawText, guessedName: e.studentName })}
                              className={
                                "truncate text-left text-[11px] font-semibold underline decoration-dotted underline-offset-2 " +
                                (e.unmatched ? "text-slate-400 hover:text-blue-600" : "text-amber-600 hover:text-amber-700")
                              }
                              title={
                                e.unmatched
                                  ? "명부와 대조되지 않아 추정한 이름입니다 - 눌러서 어느 학생인지 알려주면 다음부터 자동으로 연결됩니다"
                                  : "같은 이름의 학생이 여러 명입니다 - 눌러서 어느 학생인지 알려주거나, 원문에 학년·생일을 함께 적어주세요"
                              }
                            >
                              {e.unmatched ? "🔎 " : "⚠️ "}
                              {e.studentName}
                            </button>
                          ) : (
                            <span className="truncate text-[11px] font-semibold text-slate-700">{e.studentName}</span>
                          )}
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

      <div className="min-w-0 flex-[3] border-l border-black/5 pl-2.5">
        <AttendanceMemoPanel department={department} currentUserEmail={currentUserEmail} />
      </div>

      {/* 🔎·⚠️를 누르면 뜨는 가르치기 창. 한 번 알려준 것은 규칙으로 저장되어 다음부터 자동 적용됩니다. */}
      {teach && (
        <AttendanceTeachModal
          rawText={teach.rawText}
          guessedName={teach.guessedName}
          roster={roster}
          rules={rules}
          currentUserEmail={currentUserEmail}
          onClose={() => setTeach(null)}
          onSaved={loadRules}
        />
      )}
    </div>
  );
}
