"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { createClient } from "@/lib/supabase/client";
import type { DepartmentMemo, GoogleChatMirrorMessage } from "@/lib/types";
import AttendanceTeachModal from "./AttendanceTeachModal";
import AttendanceRulesModal from "./AttendanceRulesModal";
import { notifyOpsBoardRefresh } from "@/lib/opsRefresh";
import { classHintFromMentions, type TeacherClass } from "@/lib/mentionHints";
import {
  ATTENDANCE_CATEGORIES,
  categorize,
  dateChipLabel,
  dedupeEntries,
  extractTargetDate,
  extractTargetRange,
  guessKoreanName,
  matchRosterStudents,
  categoryForStudent,
  surfacesFor,
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

// attendance_entries 한 줄(등록 상태).
type RegRow = {
  id: string;
  source_message_id: string | null;
  student_name: string;
  status: string;
  state: "등록" | "확인필요" | "무시";
  date_from: string;
  date_to: string;
  reason: string | null;
};

// 기간을 짧게: 하루면 생략하고, 여러 날이면 "~8/28"처럼 마지막 날만 보여줍니다.
// 칸이 좁아서 "2026-08-26 ~ 2026-08-28"을 그대로 쓰면 이름이 밀립니다.
function rangeChip(from: string, to: string): string | null {
  if (from === to) return null;
  const [, m, d] = to.split("-");
  return `~${Number(m)}/${Number(d)}`;
}

// 한 줄의 등록 상태를 보여주고, 눌러서 바로 등록·해제합니다.
//
//   ✅ 초록 체크 : 이미 등록됨(대시보드에 떠 있음). 누르면 내립니다.
//   ❓ 물음표   : 자동 판단이 애매해 대기 중. 누르면 확인하고 등록합니다.
//   ⬜ 빈 네모   : 아직 등록 대상이 아님(스캔 전이거나 학생 대조 실패).
//
// 담당자가 셔틀 화면까지 왔다 갔다 하지 않아도 여기서 끝나야 한다는 것이 요점입니다.
function RegBadge({
  entry,
  regs,
  busyKey,
  onSet,
}: {
  entry: AttendanceEntry;
  regs: Map<string, RegRow>;
  busyKey: string | null;
  onSet: (e: AttendanceEntry, next: "등록" | "무시") => void;
}) {
  const key = `${entry.messageId}|${entry.studentName}|${entry.category}`;
  const row = regs.get(key);
  const busy = busyKey === key;

  if (!row) {
    return (
      <span className="flex shrink-0 items-center gap-0.5">
        {/* 빈 네모(⬜)를 없앴습니다.
            담당자: "출결내역 이름 옆에 아직도 네모칸 있어, 이거 거슬려."
            맞는 말입니다. ⬜는 "아직 등록 대상이 아니다"라는 **없음**을 그린 것인데,
            없는 것을 굳이 칸을 잡아 보여주면 이름이 밀리고 눈만 어지럽습니다.
            정말 필요한 건 "내릴 수 있다"뿐이라 ✕만 남깁니다. */}
        {/* 등록은 못 해도 내릴 수는 있어야 합니다. 아닌 것이 계속 목록에 남는 게 더 나쁩니다. */}
        <button
          type="button"
          disabled={busy}
          onClick={() => onSet(entry, "무시")}
          className="rounded px-0.5 text-[11px] leading-none text-slate-300 transition hover:bg-slate-100 hover:text-slate-600 disabled:opacity-40"
          title="출결이 아닙니다 - 목록과 집계에서 내립니다"
        >
          ✕
        </button>
      </span>
    );
  }

  const span = rangeChip(row.date_from, row.date_to);
  const registered = row.state === "등록";

  return (
    <span className="flex shrink-0 items-center gap-0.5">
      {span && (
        <span className="rounded bg-slate-100 px-1 text-[9px] font-semibold text-slate-500" title={`${row.date_from} ~ ${row.date_to}`}>
          {span}
        </span>
      )}
      <button
        type="button"
        disabled={busy}
        onClick={() => onSet(entry, registered ? "무시" : "등록")}
        className={
          "rounded px-0.5 text-[11px] leading-none transition disabled:opacity-40 " +
          (registered ? "hover:bg-emerald-50" : "hover:bg-amber-50")
        }
        title={
          registered
            ? `등록됨 (${row.date_from}${span ? ` ~ ${row.date_to}` : ""}) - 누르면 내립니다`
            : `확인 필요: ${row.reason ?? "확인 후 등록해주세요"} - 누르면 등록합니다`
        }
      >
        {busy ? "…" : registered ? "✅" : "❓"}
      </button>
      {/* 출결이 아닌 것을 내리는 자리.
          담당자: "기존의 픽업에 관한 채팅인데 그냥 '픽업'이 들어가 있어서 가져온 경우,
                   픽업에 관한 글이 아닌데 계속 픽업으로 집계돼."
          맞는 지적입니다. 지금까지 ❓에서 할 수 있는 일은 **등록뿐**이었습니다. '무시' 상태는
          이미 있었는데 그리로 갈 버튼이 없어서, 아닌 것도 계속 물음표로 남아 세어졌습니다.
          "픽업"이라는 낱말이 스쳐 지나간 문장까지 기계가 가려낼 수는 없으니, 사람이 한 번
          내려주면 다시 안 묻는 자리가 필요합니다. */}
      {!registered && (
        <button
          type="button"
          disabled={busy}
          onClick={() => onSet(entry, "무시")}
          className="rounded px-0.5 text-[11px] leading-none text-slate-300 transition hover:bg-slate-100 hover:text-slate-600 disabled:opacity-40"
          title="출결이 아닙니다 - 목록과 집계에서 내립니다"
        >
          ✕
        </button>
      )}
    </span>
  );
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
type ToddleRow = {
  id: string;
  kind: string | null;
  service_date: string | null;
  raw_text: string | null;
  summary: string | null;
  matched_name: string | null;
  ai_student_name: string | null;
  student_id: string | null;
  source: string | null;
  channel_label: string | null;
  received_at: string | null;
  status: string | null;
  is_demo?: boolean;
};

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
  // 🔎·⚠️ 를 눌렀을 때 뜨는 창. **어느 건인지**를 함께 들고 갑니다 - 그게 있어야
  // "이 건만 이 아이로"가 됩니다. 예전에는 원문과 이름만 넘겨서 가르치기(= 앞으로 전부)
  // 밖에 할 수 없었습니다.
  const [teach, setTeach] = useState<
    { rawText: string; guessedName: string; entry: { messageId: string; status: string; dateFrom: string; dateTo: string } | null } | null
  >(null);
  // 가르친 규칙을 다시 꺼내 보는 창. 넣기만 되고 꺼내 볼 수 없으면 잘못 가르친 것을 고칠 방법이 없습니다.
  const [showRules, setShowRules] = useState(false);

  // 등록 상태(attendance_entries). 담당자 요청: "출결의 경우 등록이 되었는지 여부를 알 수 있고
  // 업무보드에서 등록이 가능하도록 만들어줘 (지금 매번 확인을 하고 지워야 해서 왔다갔다 엄청
  // 해서 힘들어)."
  //
  // 키는 "메시지id|학생이름|종류"입니다. 한 메시지에 두 학생이 있으면 각각 따로 등록됩니다.
  const [regs, setRegs] = useState<Map<string, RegRow>>(new Map());
  // 사람이 "출결 아님"으로 내린 것들. 목록에서 아예 빼야 다시 안 묻습니다.
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  // 멘션(@…)을 지울 때 쓰는 교직원 성함. 서버가 계정 명단에서 실어 보냅니다.
  // 담당자: "@Carina Ann John까지가 이름인데 carina ann까지만 읽어서 john이 요한이로 매칭돼."
  const [staffNames, setStaffNames] = useState<string[]>([]);
  // 담임 ↔ 반. 멘션에서 행정실을 빼고 남은 사람이 담임이면 그 반으로 후보를 좁힙니다.
  const [teachers, setTeachers] = useState<TeacherClass[]>([]);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  // 저장이 실패하면 그 사실을 보여줍니다(예전엔 눌러도 아무 일이 없어 보였습니다).
  const [error, setError] = useState<string | null>(null);
  // 원문 전체 보기. 한 줄로 잘린 미리보기만으로는 "이게 정말 픽업 얘기인지" 판단할 수 없어,
  // 담당자가 매번 다른 화면으로 넘어가 확인해야 했습니다.
  const [detail, setDetail] = useState<AttendanceEntry | null>(null);

  const loadRegs = useCallback(async () => {
    try {
      const res = await fetch("/api/attendance/entries", { cache: "no-store" });
      const json = (await res.json()) as { entries?: RegRow[]; dismissed?: string[]; staffNames?: string[]; teachers?: TeacherClass[] };
      const m = new Map<string, RegRow>();
      for (const e of json.entries ?? []) {
        if (e.source_message_id) m.set(`${e.source_message_id}|${e.student_name}|${e.status}`, e);
      }
      setRegs(m);
      setDismissed(new Set(json.dismissed ?? []));
      setStaffNames(json.staffNames ?? []);
      setTeachers(json.teachers ?? []);
    } catch {
      /* 못 불러와도 목록 자체는 보여야 합니다 - 배지만 안 뜰 뿐입니다. */
    }
  }, []);

  useEffect(() => {
    void loadRegs();
  }, [loadRegs, messages.length]);

  // 등록 / 해제. 해제는 '무시'로 남깁니다 - 지운 것이 다시 살아나지 않게 하려면 "없음"이
  // 아니라 "아니라고 판단했음"이 기록으로 남아야 합니다.
  async function setState(entry: AttendanceEntry, next: "등록" | "무시") {
    const key = `${entry.messageId}|${entry.studentName}|${entry.category}`;
    const row = regs.get(key);
    // 등록 대상으로 잡히지 않은 항목(⬜)은 고칠 줄이 없습니다. 내리는 것만은 되어야 하므로
    // 키를 보내 줄을 만들면서 곧바로 '무시'로 둡니다.
    if (!row && next !== "무시") return;
    setBusyKey(key);
    const res = await fetch("/api/attendance/entries", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        row
          ? { id: row.id, state: next }
          : {
              dismissKey: {
                messageId: entry.messageId ?? "",
                studentName: entry.studentName,
                status: entry.category,
                date: entry.targetDate,
              },
            }
      ),
    });
    setBusyKey(null);
    if (!res.ok) {
      // 조용히 실패하지 않습니다. ✕를 눌러도 아무 일이 없던 동안, 서버는 매번 오류를
      // 돌려주고 있었는데 화면이 그걸 버렸습니다. 눌렀는데 아무 반응이 없으면 사람은
      // 자기가 잘못 눌렀다고 생각합니다.
      const msg = await res.json().catch(() => ({ error: "" }));
      setError((msg as { error?: string }).error || "저장하지 못했습니다.");
      return;
    }
    if (next === "무시") {
      // 서버가 받아준 즉시 화면에서 내립니다. 다시 불러오기를 기다리지 않습니다.
      setDismissed((prev) => new Set(prev).add(key));
    }
    setError(null);
    await loadRegs();
    // 사무실 벽면 대시보드도 곧바로 따라오도록 신호를 보냅니다.
    void notifyOpsBoardRefresh();
  }

  // ── 토들도 함께 읽습니다 ──────────────────────────────────────────────────
  //
  // 이 목록은 구글챗(미러링)만 훑고 있었습니다. 토들로 들어온 픽업·결석은 픽업 인박스에만
  // 쌓이고 **출결내역에는 아예 뜨지 않았습니다.** 그래서 「학부모 문의사항에는 픽업이라고
  // 떠 있는데 출결에는 없다」가 됩니다. 두 통로가 있는데 한쪽만 보는 화면을 출결의 전체
  // 목록이라고 부를 수는 없습니다.
  //
  // 겹치는 건은 dedupeEntries 가 걸러냅니다(같은 날 · 같은 분류 · 같은 학생이면 한 건).
  // 구글챗 것을 먼저 넣어서, 겹치면 원문이 더 온전한 쪽이 남습니다.
  const [toddle, setToddle] = useState<ToddleRow[]>([]);
  const loadToddle = useCallback(async () => {
    const supabase = createClient();
    const { data, error } = await supabase
      .from("pickup_requests")
      .select("id, kind, service_date, raw_text, summary, matched_name, ai_student_name, student_id, source, channel_label, received_at, status, is_demo")
      .gte("service_date", todayKey(new Date()))
      .neq("status", "무시")
      .order("received_at", { ascending: false })
      .limit(200);
    // 조용히 넘기면 "토들 것도 본다"고 해놓고 아무것도 안 보이게 됩니다.
    if (error) console.error("[출결내역] 토들 연락을 읽지 못했습니다:", error.message);
    setToddle(((data as ToddleRow[] | null) ?? []).filter((r) => !r.is_demo));
  }, []);

  useEffect(() => {
    void loadToddle();
    const supabase = createClient();
    const ch = supabase
      .channel("attendance-digest-toddle")
      .on("postgres_changes", { event: "*", schema: "public", table: "pickup_requests" }, () => void loadToddle())
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [loadToddle]);

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
      //
      // "수요일까지"처럼 기간으로 적힌 경우 시작일과 마지막일을 모두 잡습니다(요청). 하루로만
      // 읽으면 나머지 날은 아무 데도 안 남아, 그 며칠 동안 아이를 찾게 됩니다.
      const range = extractTargetRange(m.content, sentAt);
      const targetDate = range?.from ?? extractTargetDate(m.content, sentAt) ?? todayKey(sentAt);
      const targetDateTo = range?.to ?? targetDate;
      const students = matchRosterStudents(m.content, roster, rules, staffNames, m.mentions, classHintFromMentions((m.mentions ?? []).map((x) => x.name), teachers));
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
          targetDateTo,
          messageId: String(m.id),
        });
        continue;
      }
      for (const s of students) {
        // 한 글 안에서도 아이마다 이야기가 다릅니다. 이름이 있는 절만 보고 정합니다.
        const others = students.filter((o) => o.name !== s.name).flatMap((o) => surfacesFor(o.name, roster));
        const mine = categoryForStudent(m.content, surfacesFor(s.name, roster), category, rules, others);
        if (!mine) continue;
        out.push({
          key: `chat-${m.id}-${s.studentKey}`,
          category: mine,
          studentName: s.displayName,
          studentKey: s.studentKey,
          ambiguous: s.ambiguous,
          unmatched: false,
          rawText: m.content,
          time: m.created_at_google,
          sourceLabel: "구글챗",
          targetDate,
          targetDateTo,
          messageId: String(m.id),
        });
      }
    }

    // ── 토들 ──────────────────────────────────────────────────────────────
    //
    // 픽업 인박스에 쌓인 연락을 같은 목록에 얹습니다. 구글챗 뒤에 넣는 이유는, 아래
    // dedupeEntries 가 **먼저 온 것을 남기기** 때문입니다 - 같은 일이 두 통로로 들어왔다면
    // 원문이 온전한 구글챗 쪽을 보여주는 편이 낫습니다.
    for (const r of toddle) {
      const text = ((r.raw_text ?? r.summary) ?? "").toString();
      const name = ((r.matched_name ?? r.ai_student_name) ?? "").trim();
      if (!name) continue;
      // 분류: 수집기가 이미 픽업으로 갈라둔 것은 그대로 믿고, 나머지는 본문으로 읽습니다.
      // 픽업 인박스가 '문의'로 담아둔 글에도 픽업·결석 이야기가 섞여 있습니다.
      const category = r.kind === "픽업" ? "픽업" : categorize(text, rules);
      if (!category) continue;
      const day = r.service_date ?? todayKey(r.received_at ? new Date(r.received_at) : now);
      // 명부에 있는 이름인지 확인합니다. 못 찾으면 🔎 로 표시해 사람이 골라줄 수 있게 합니다.
      const hit = roster.find(
        (s) => s.name === name || (s.nameEn ?? "").toLowerCase() === name.toLowerCase(),
      );
      out.push({
        key: `toddle-${r.id}`,
        category,
        studentName: hit?.name ?? name,
        studentKey: hit?.name ?? name,
        ambiguous: false,
        unmatched: !hit,
        rawText: text || `${name} ${category} (토들)`,
        time: r.received_at,
        sourceLabel: r.source ?? "토들",
        targetDate: day,
        targetDateTo: day,
        // 등록 상태(초록 체크)를 짝지으려면 서버 스캔과 **같은 열쇠**를 써야 합니다.
        // 서버는 토들 건의 source_message_id 에 pickup_requests.id 를 그대로 넣습니다.
        messageId: String(r.id),
      });
    }

    // 같은 메시지가 겹쳐 올라온 경우 학생이 두 번 뜨지 않도록 정리합니다. 지난 날짜는 이미
    // 끝난 일이라 화면에서 뺍니다.
    // 기간의 마지막 날이 오늘 이후면 아직 살아 있는 건입니다("월요일부터 수요일까지"를
    // 화요일에 봐도 남아 있어야 합니다).
    return dedupeEntries(out).filter((e) => (e.targetDateTo ?? e.targetDate) >= today);
  }, [messages, roster, rules, staffNames, toddle, teachers]);

  const today = todayKey();
  // 오늘 것만 위쪽 픽업/결석/지각 칸에 넣고, 앞으로 예정된 건은 아래 "예정" 칸으로 따로 뺍니다.
  // 기간이 오늘을 품으면 "오늘"입니다 - 시작일이 지났어도 아직 결석 중이니까요.
  // 내린 것은 목록에서 뺍니다.
  //
  // 담당자: "'픽업'이 들어갔지만 픽업에 관한 글이 아닌 것 - 계속 픽업으로 집계돼."
  // 낱말이 스쳐 지나간 문장까지 기계가 가려낼 수는 없으니, 한 번 내리면 다시 안 묻습니다.
  const liveEntries = useMemo(
    () => allEntries.filter((e) => !dismissed.has(`${e.messageId ?? ""}|${e.studentName}|${e.category}`)),
    [allEntries, dismissed]
  );
  const entries = useMemo(
    () => liveEntries.filter((e) => e.targetDate <= today && (e.targetDateTo ?? e.targetDate) >= today),
    [liveEntries, today]
  );
  const upcoming = useMemo(
    () => liveEntries.filter((e) => e.targetDate > today).sort((a, b) => a.targetDate.localeCompare(b.targetDate)),
    [liveEntries, today]
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
        <button
          type="button"
          onClick={() => setShowRules(true)}
          className="rounded px-1 text-[10px] font-medium text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
          title="🔎·⚠️ 로 가르친 규칙을 보고 고치거나 지웁니다"
        >
          가르친 규칙
        </button>
        {/* 이 위젯만 다시 읽습니다.
            가르친 뒤 화면이 안 바뀌면 사람은 "안 배웠나" 하고 또 가르칩니다. 페이지 전체를
            새로고침하면 하던 체크가 날아가므로, 이 칸만 다시 읽습니다. */}
        <button
          type="button"
          onClick={() => {
            void loadRules();
            void loadRegs();
          }}
          className="rounded px-1 text-[10px] font-medium text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
          title="가르친 규칙을 다시 읽어 이 칸만 새로 그립니다(페이지는 그대로)"
        >
          ↻ 새로고침
        </button>
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

      {error && (
        <p className="mb-1 rounded bg-red-50 px-2 py-1 text-[10px] leading-snug text-red-600">
          저장 실패: {error}
        </p>
      )}

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
                              onClick={() =>
                                setTeach({
                                  rawText: e.rawText,
                                  guessedName: e.studentName,
                                  entry: e.messageId
                                    ? {
                                        messageId: e.messageId,
                                        status: e.category,
                                        dateFrom: e.targetDate,
                                        dateTo: e.targetDateTo ?? e.targetDate,
                                      }
                                    : null,
                                })
                              }
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
                          <RegBadge entry={e} regs={regs} busyKey={busyKey} onSet={setState} />
                          <span className="shrink-0 text-[9px] text-slate-400">
                            {e.time ? timeStr(e.time) : e.sourceLabel}
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={() => setDetail(e)}
                          className="block w-full truncate text-left text-[10px] text-slate-500 hover:text-blue-600 hover:underline"
                          title="눌러서 원문 전체 보기"
                        >
                          {e.rawText}
                        </button>
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
                              onClick={() =>
                                setTeach({
                                  rawText: e.rawText,
                                  guessedName: e.studentName,
                                  entry: e.messageId
                                    ? {
                                        messageId: e.messageId,
                                        status: e.category,
                                        dateFrom: e.targetDate,
                                        dateTo: e.targetDateTo ?? e.targetDate,
                                      }
                                    : null,
                                })
                              }
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
                        <RegBadge entry={e} regs={regs} busyKey={busyKey} onSet={setState} />
                        <span className="shrink-0 rounded-full bg-slate-100 px-1.5 text-[9px] font-semibold text-slate-500">
                          {dateChipLabel(e.targetDate)}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => setDetail(e)}
                        className="block w-full truncate text-left text-[10px] text-slate-500 hover:text-blue-600 hover:underline"
                        title="눌러서 원문 전체 보기"
                      >
                        {e.rawText}
                      </button>
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

      {/* 원문 전체 보기. 한 줄 미리보기로는 "정말 픽업 얘기인지" 알 수 없어, 담당자가 매번
          다른 화면으로 넘어가 확인해야 했습니다. */}
      {detail &&
        createPortal(
          <div
            className="fixed inset-0 z-[999] flex items-center justify-center bg-black/40 p-4"
            onClick={() => setDetail(null)}
          >
            <div
              className="max-h-[80vh] w-full max-w-lg overflow-y-auto rounded-xl bg-white p-4 shadow-xl"
              onClick={(ev) => ev.stopPropagation()}
            >
              <div className="mb-2 flex items-center gap-2">
                <span className="text-sm font-bold text-slate-800">{detail.studentName}</span>
                <span
                  className={
                    "rounded-full px-1.5 py-0.5 text-[10px] font-semibold " +
                    (ATTENDANCE_CATEGORIES.find((c) => c.key === detail.category)?.chipClass ?? "")
                  }
                >
                  {detail.category}
                </span>
                <span className="ml-auto text-[10px] text-slate-400">
                  {detail.sourceLabel}
                  {detail.time ? ` · ${timeStr(detail.time)}` : ""}
                </span>
              </div>
              <p className="whitespace-pre-wrap break-words rounded-lg bg-slate-50 p-3 text-[12px] leading-relaxed text-slate-700">
                {detail.rawText}
              </p>
              <div className="mt-3 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    void setState(detail, "무시");
                    setDetail(null);
                  }}
                  className="rounded-lg border border-slate-200 px-3 py-1.5 text-[11px] font-semibold text-slate-600 hover:bg-slate-50"
                >
                  ✕ 출결 아님
                </button>
                <button
                  type="button"
                  onClick={() => setDetail(null)}
                  className="ml-auto rounded-lg bg-slate-800 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-slate-700"
                >
                  닫기
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}

      {/* 🔎·⚠️를 누르면 뜨는 가르치기 창. 한 번 알려준 것은 규칙으로 저장되어 다음부터 자동 적용됩니다. */}
      {showRules && <AttendanceRulesModal onClose={() => setShowRules(false)} />}
      {teach && (
        <AttendanceTeachModal
          rawText={teach.rawText}
          guessedName={teach.guessedName}
          entry={teach.entry}
          roster={roster}
          rules={rules}
          currentUserEmail={currentUserEmail}
          onClose={() => setTeach(null)}
          // 규칙만 다시 읽으면 화면이 그대로입니다. 이미 '확인 필요'로 **등록해 둔 줄**이
          // 남아 있어서, 새 규칙으로 다시 읽어도 그 줄이 그대로 보입니다.
          // 규칙과 등록 상태를 함께 다시 읽어야 가르친 대로 바뀝니다.
          onSaved={async () => {
            await loadRules();
            await loadRegs();
          }}
        />
      )}
    </div>
  );
}
