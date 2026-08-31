"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { DepartmentMemo, GoogleChatMirrorMessage } from "@/lib/types";
import {
  categorize,
  dedupeEntries,
  extractTargetDate,
  guessKoreanName,
  buildStaffNames,
  matchRosterStudents,
  stripLeadingMention,
  todayKey,
  type AttendanceEntry,
  type LearningRule,
  type RosterStudent,
} from "@/lib/attendanceDigest";
import AttendanceTeachModal from "@/components/work/AttendanceTeachModal";
import AttendanceRulesModal from "@/components/work/AttendanceRulesModal";

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
// 왼쪽 "지속 특이사항 입력" 창구가 부모에게 넘기는 값입니다(요청: 지속 반영사항을 적는 창구).
export type PersistentNoteInput = {
  /** 여러 명을 한 번에. 형제나 같이 여행 가는 아이들을 한 명씩 넣는 것은 일입니다. */
  studentNames: string[];
  routeNo: string | null;
  content: string;
  effectKind: "none" | "skip_days" | "no_shuttle" | "absent" | "pickup";
  effectDays: number[];
  /** 결석·픽업처럼 **날짜로 걸리는** 효과의 기간. 하루면 from만 넣습니다. */
  effectFrom: string | null;
  effectTo: string | null;
};

export default function ShuttleChecklistSidebar({
  roster,
  initialMessages,
  changedToday = [],
  specialNotes = [],
  department = "초등부",
  className = "",
  onSelectStudentName,
  onAddPersistentNote,
  persistNoteBusy = false,
  onStatusReverted,
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
  // 지속 특이사항 창구에서 새 항목을 저장할 때 부모(ShuttleChecklistClient)로 넘깁니다.
  onAddPersistentNote?: (input: PersistentNoteInput) => Promise<boolean>;
  persistNoteBusy?: boolean;
  // 위젯에서 ✕로 내렸을 때, 오른쪽 체크표도 다시 읽어 사선을 지우도록 알립니다.
  onStatusReverted?: () => void;
}) {
  // 지속 특이사항 입력 창구 상태(요청: 왼쪽에 지속 반영사항을 적는 창구, 예: "이라엘 수요일
  // 수영학원", "4호 김재이 개별하원"). 효과를 고르면 셔틀이 자동으로 바뀝니다.
  const WD = [
    { d: 1, label: "월" },
    { d: 2, label: "화" },
    { d: 3, label: "수" },
    { d: 4, label: "목" },
    { d: 5, label: "금" },
  ];
  // 이름을 여러 개 담습니다(요청: "한명씩 등록해야하고"). 형제·같이 여행 가는 아이들을
  // 한 줄씩 따로 넣는 것은 같은 일을 두 번 하는 것입니다.
  const [pnNames, setPnNames] = useState<string[]>([]);
  const [pnName, setPnName] = useState("");
  const [pnRoute, setPnRoute] = useState("");
  const [pnContent, setPnContent] = useState("");
  const [pnEffect, setPnEffect] = useState<PersistentNoteInput["effectKind"]>("none");
  const [pnDays, setPnDays] = useState<number[]>([]);
  // 날짜로 걸리는 효과(결석·픽업)의 기간(요청: "셔틀 결석때문에 안타는데 미리 설정할 수도 없어").
  const [pnFrom, setPnFrom] = useState("");
  const [pnTo, setPnTo] = useState("");
  const [pnOpen, setPnOpen] = useState(false);

  // ── 가르치기 ──────────────────────────────────────────────────────────────
  // 담당자: "하원체크표의 오늘 픽업·결석에서도 돋보기 눌러서 학습시킬 수 있도록 해주고,
  //          학습시킨 거 목록을 보고 수정·삭제할 수 있도록 해줘."
  //
  // 잘못 읽힌 이름을 발견하는 자리는 업무 인박스가 아니라 **여기**입니다. 하원 직전에 체크표를
  // 보다가 "이 아이 이름이 왜 이렇게 나오지?" 하고 알아채니까요. 그때 업무 메뉴까지 건너가야
  // 고칠 수 있으면 대부분 그냥 넘어갑니다. 발견한 자리에서 바로 고칠 수 있어야 합니다.
  //
  // 규칙과 로그인 계정은 여기서 직접 읽습니다 - 부모(ShuttleChecklistClient)에 새 prop을
  // 요구하면 이 화면을 쓰는 다른 곳까지 다 손봐야 해서, 자기 것만 챙기게 두었습니다.
  const [rules, setRules] = useState<LearningRule[]>([]);
  const [myEmail, setMyEmail] = useState("");
  const [teachTarget, setTeachTarget] = useState<AttendanceEntry | null>(null);
  const [rulesOpen, setRulesOpen] = useState(false);

  // 사람이 "출결 아님"으로 내린 것들.
  //
  // 담당자: "픽업에 관한 글이 아닌데 계속 픽업으로 집계돼."
  //
  // 업무 인박스에서 내려도 이 위젯에는 그대로 남아 있었습니다. **이 위젯이 등록 상태를 아예
  // 안 보고, 메시지를 매번 직접 세고 있었기 때문입니다.** 운영 대시보드는 등록된 것만 읽도록
  // 이미 고쳤는데 여기만 옛 방식으로 남아 있었습니다 - 같은 판단을 두 곳이 다르게 하고
  // 있었던 셈입니다.
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [removing, setRemoving] = useState<string | null>(null);
  // 멘션에서 지울 교직원 성함. 못 읽으면 빈 배열이고, 그때는 예전처럼 두 낱말까지만 지웁니다.
  const [staffNames, setStaffNames] = useState<string[]>([]);
  const [removeError, setRemoveError] = useState<string | null>(null);

  const loadDismissed = useCallback(async () => {
    const supabase = createClient();
    const from = new Date();
    from.setDate(from.getDate() - 14);
    const { data } = await supabase
      .from("attendance_entries")
      .select("source_message_id, student_name, status")
      .eq("state", "무시")
      .gte("date_from", from.toISOString().slice(0, 10));
    setDismissed(
      new Set(
        ((data as { source_message_id: string | null; student_name: string; status: string }[] | null) ?? [])
          .filter((r) => r.source_message_id)
          .map((r) => `${r.source_message_id}|${r.student_name}|${r.status}`)
      )
    );
  }, []);

  const loadRules = useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase.from("attendance_learning_rules").select("*");
    setRules((data as LearningRule[] | null) ?? []);
  }, []);

  useEffect(() => {
    void loadRules();
    void loadDismissed();
    void (async () => {
      const { data } = await createClient().from("app_users").select("name, email").limit(500);
      setStaffNames(buildStaffNames((data as { name: string | null; email: string | null }[] | null) ?? []));
    })();
    void (async () => {
      const { data } = await createClient().auth.getUser();
      setMyEmail(data.user?.email ?? "");
    })();
  }, [loadRules, loadDismissed]);

  /** 칸에 남아 있는 이름도 함께 담습니다 - 엔터를 안 치고 [추가]를 눌러도 빠지지 않도록. */
  function collectedNames(): string[] {
    const typed = pnName.trim();
    return [...new Set([...pnNames, ...(typed ? [typed] : [])])];
  }

  function addName() {
    const v = pnName.trim();
    if (!v) return;
    setPnNames((prev) => (prev.includes(v) ? prev : [...prev, v]));
    setPnName("");
  }

  async function submitPersistentNote() {
    if (!onAddPersistentNote) return;
    const ok = await onAddPersistentNote({
      studentNames: collectedNames(),
      routeNo: pnRoute.trim() || null,
      content: pnContent,
      effectKind: pnEffect,
      effectDays: pnDays,
      effectFrom: pnFrom || null,
      effectTo: pnTo || null,
    });
    if (ok) {
      setPnNames([]);
      setPnName("");
      setPnRoute("");
      setPnContent("");
      setPnEffect("none");
      setPnDays([]);
      setPnFrom("");
      setPnTo("");
      setPnOpen(false);
    }
  }
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
    const t = setInterval(() => {
      if (typeof document === "undefined" || document.visibilityState === "visible") {
        void pollMessages();
        // 업무 인박스에서 방금 내린 것이 여기에도 바로 반영되도록 함께 다시 읽습니다.
        void loadDismissed();
      }
    }, POLL_MS);

    return () => {
      cancelled = true;
      clearInterval(t);
      supabase.removeChannel(channel);
    };
  }, [department, loadDismissed]);

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
      // 가르친 규칙을 함께 넘깁니다. 업무 인박스는 이미 이렇게 하는데 여기만 빠져 있어서,
      // 같은 문장이 두 화면에서 다르게 읽히고 있었습니다.
      const category = categorize(m.content, rules);
      if (category !== "픽업" && category !== "결석") continue;
      const targetDate = extractTargetDate(m.content, sentAt) ?? todayKey(sentAt);
      if (targetDate !== today) continue;
      const students = matchRosterStudents(m.content, roster, rules, staffNames);
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
          messageId: m.id,
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
          messageId: m.id,
        });
      }
    }

    // 사람이 "출결 아님"으로 내린 것은 빼고 셉니다. 등록 상태와 이 위젯의 판단이 갈리면
    // 업무 인박스에서 내려도 여기서는 계속 세어지는데, 그게 담당자가 겪은 일입니다.
    const deduped = dedupeEntries(out).filter(
      (e) => !dismissed.has(`${e.messageId ?? ""}|${e.studentName}|${e.category}`)
    );
    return {
      pickup: deduped.filter((e) => e.category === "픽업"),
      absent: deduped.filter((e) => e.category === "결석"),
    };
  }, [messages, roster, rules, dismissed, staffNames]);

  // 잘못 잡힌 픽업·결석 하나를 내립니다. 목록에서만 지우면 체크표에는 사선이 남으니,
  // 셔틀 표시까지 함께 되돌립니다.
  async function removeEntry(e: AttendanceEntry, coreName: string) {
    setRemoving(e.key);
    const key = `${e.messageId ?? ""}|${e.studentName}|${e.category}`;
    try {
      // ① 출결 등록표에 '무시'로 남깁니다(다시 안 묻도록).
      const res = await fetch("/api/attendance/entries", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dismissKey: {
            messageId: e.messageId ?? "",
            studentName: e.studentName,
            status: e.category,
            date: e.targetDate,
          },
        }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        setRemoveError(j.error || "내리지 못했습니다.");
        return;
      }
      // ② 그 아이의 오늘 셔틀 표시를 '예정'으로 되돌립니다. 배정이 없으면 조용히 넘어갑니다
      //    (도보·자차 하원이면 되돌릴 것도 없습니다).
      await fetch("/api/work/attendance-action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ studentName: coreName, action: "예정" }),
      }).catch(() => null);

      setDismissed((prev) => new Set(prev).add(key));
      setRemoveError(null);
      onStatusReverted?.();
    } finally {
      setRemoving(null);
    }
  }

  function nameChip(e: AttendanceEntry, tone: "blue" | "red") {
    const toneClass = e.unmatched
      ? "bg-slate-100 text-slate-400"
      : e.ambiguous
        ? "bg-amber-50 text-amber-600"
        : tone === "blue"
          ? "bg-blue-50 text-blue-600"
          : "bg-red-50 text-red-600";
    // 동명이인 표시("김재이(G3JA)")나 영어이름 병기("김재이(Jane)")가 붙어 있으면 체크표의
    // 원본 이름(student_name_raw)과 안 맞을 수 있어, 괄호 앞부분만 검색어로 씁니다.
    const coreName = e.studentName.replace(/\(.*$/, "").trim() || e.studentName;
    return (
      <span key={e.key} className={"inline-flex items-center gap-0.5 rounded-full pr-0.5 " + toneClass}>
        <button
          type="button"
          onClick={() => onSelectStudentName?.(coreName)}
          className="rounded-full px-1.5 py-0.5 text-[10px] font-semibold transition hover:ring-2 hover:ring-offset-1"
          title={(e.unmatched ? "명부와 대조되지 않아 추정한 이름입니다" : e.rawText) + " · 누르면 체크표에서 찾습니다"}
        >
          {e.ambiguous ? "⚠️ " : ""}
          {e.studentName}
        </button>
        {/* 돋보기 = 가르치기. 이름이 틀리게 읽힌 걸 여기서 발견하므로 여기서 바로 고칩니다. */}
        <button
          type="button"
          onClick={() => setTeachTarget(e)}
          className="rounded-full px-0.5 text-[10px] leading-none opacity-60 transition hover:opacity-100"
          title="이 표기가 누구인지 가르치기"
          aria-label="가르치기"
        >
          🔎
        </button>
        {/* 잘못 잡힌 아이를 지우는 자리.
            담당자: "오늘 픽업·결석에도 지울 수 있게 해주고, 지우면 전부 반영되게 만들어줘."
            그래서 여기서 지우면 **두 곳을 함께** 되돌립니다.
              ① 출결 등록표에 '무시'로 남김 → 이 위젯·업무보드·운영 대시보드에서 사라짐
              ② 그 아이의 오늘 셔틀 표시를 '예정'으로 → 체크표·안내보드·도착체크 원복
            ①만 하면 표에는 결석 사선이 그대로 남아 기사님이 아이를 안 태웁니다. */}
        <button
          type="button"
          disabled={removing === e.key}
          onClick={() => removeEntry(e, coreName)}
          className="rounded-full px-0.5 text-[10px] leading-none opacity-50 transition hover:opacity-100 disabled:opacity-20"
          title="이 아이는 오늘 픽업·결석이 아닙니다 - 목록에서 내리고 체크표 표시도 되돌립니다"
          aria-label="지우기"
        >
          {removing === e.key ? "…" : "✕"}
        </button>
      </span>
    );
  }

  return (
    <div className={"flex w-full shrink-0 flex-col gap-3 lg:w-52 " + className}>
      {onAddPersistentNote && (
        <div className="rounded-xl border border-orange-200 bg-white p-3">
          <button
            type="button"
            onClick={() => setPnOpen((v) => !v)}
            className="flex w-full items-center justify-between text-[11px] font-bold text-orange-700"
          >
            <span>📌 지속 특이사항 입력</span>
            <span className="text-orange-400">{pnOpen ? "▾" : "＋"}</span>
          </button>
          {pnOpen && (
            <div className="mt-2 flex flex-col gap-1.5">
              <p className="text-[9px] leading-relaxed text-slate-400">
                계속 반영할 사항을 적으면 오른쪽에 요약으로 뜨고 셔틀이 자동으로 바뀝니다. 나중에 요약에서 지우면 원래
                셔틀로 돌아옵니다. <b>여러 명</b>을 한 번에 넣을 수 있고, 결석·픽업은 <b>날짜를 미리</b> 정해둘 수 있습니다.
              </p>
              {/* 이름을 여러 개 담습니다. 고르면 칩으로 쌓이고, ×로 뺍니다. */}
              {pnNames.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {pnNames.map((n) => (
                    <span
                      key={n}
                      className="inline-flex items-center gap-0.5 rounded-full bg-orange-100 px-1.5 py-0.5 text-[10px] font-bold text-orange-700"
                    >
                      {n}
                      <button
                        type="button"
                        onClick={() => setPnNames((prev) => prev.filter((x) => x !== n))}
                        className="text-orange-400 hover:text-orange-700"
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              )}
              <div className="flex gap-1">
                <input
                  list="pn-roster"
                  value={pnName}
                  onChange={(e) => {
                    const v = e.target.value;
                    // 명부에서 고르면(datalist) 곧바로 칩으로 만듭니다 - 한 번 더 누르게
                    // 하면 그게 "한 명씩 등록"의 번거로움 그대로입니다.
                    if (roster.some((r) => r.name === v)) {
                      setPnNames((prev) => (prev.includes(v) ? prev : [...prev, v]));
                      setPnName("");
                    } else {
                      setPnName(v);
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === ",") {
                      e.preventDefault();
                      addName();
                    }
                  }}
                  placeholder={pnNames.length ? "이름 더 넣기" : "학생 이름 (여러 명 가능)"}
                  className="min-w-0 flex-1 rounded-lg border border-slate-300 px-2 py-1 text-[11px] outline-none focus:border-orange-400"
                />
                <button
                  type="button"
                  onClick={addName}
                  disabled={!pnName.trim()}
                  className="shrink-0 rounded-lg border border-orange-300 px-1.5 text-[11px] font-bold text-orange-600 disabled:opacity-30"
                  title="이름 담기"
                >
                  ＋
                </button>
              </div>
              <datalist id="pn-roster">
                {roster.map((s) => (
                  <option key={s.name} value={s.name} />
                ))}
              </datalist>
              <input
                value={pnRoute}
                onChange={(e) => setPnRoute(e.target.value)}
                placeholder="호차 (동명이인일 때만, 예: 4호)"
                className="rounded-lg border border-slate-300 px-2 py-1 text-[11px] outline-none focus:border-orange-400"
              />
              <textarea
                value={pnContent}
                onChange={(e) => setPnContent(e.target.value)}
                rows={2}
                placeholder="내용 (예: 수요일 수영학원 / 당분간 개별하원)"
                className="resize-none rounded-lg border border-slate-300 px-2 py-1 text-[11px] outline-none focus:border-orange-400"
              />
              <select
                value={pnEffect}
                onChange={(e) => setPnEffect(e.target.value as typeof pnEffect)}
                className="rounded-lg border border-slate-300 px-2 py-1 text-[11px] outline-none focus:border-orange-400"
              >
                <option value="none">셔틀 그대로 (메모만)</option>
                <option value="absent">결석 (그 날짜에 셔틀 제외)</option>
                <option value="pickup">픽업 (그 날짜에 보호자가 데려감)</option>
                <option value="skip_days">특정 요일 셔틀 제외</option>
                <option value="no_shuttle">개별하원 (셔틀 전면 제외)</option>
              </select>
              {/* 날짜로 걸리는 효과. 미리 넣어두면 그 날이 왔을 때만 듣습니다 -
                  오늘 넣어도 오늘 셔틀이 바뀌지 않습니다. */}
              {(pnEffect === "absent" || pnEffect === "pickup") && (
                <div className="flex flex-col gap-1 rounded-lg bg-orange-50 p-1.5">
                  <div className="flex items-center gap-1">
                    <input
                      type="date"
                      value={pnFrom}
                      onChange={(e) => setPnFrom(e.target.value)}
                      className="min-w-0 flex-1 rounded border border-slate-300 px-1 py-0.5 text-[10px]"
                    />
                    <span className="text-[10px] text-slate-400">~</span>
                    <input
                      type="date"
                      value={pnTo}
                      min={pnFrom || undefined}
                      onChange={(e) => setPnTo(e.target.value)}
                      className="min-w-0 flex-1 rounded border border-slate-300 px-1 py-0.5 text-[10px]"
                    />
                  </div>
                  <p className="text-[9px] leading-relaxed text-orange-700">
                    하루만이면 <b>앞칸만</b> 넣으세요. 미리 넣어둬도 그 날이 와야 셔틀에서 빠집니다.
                  </p>
                </div>
              )}
              {pnEffect === "skip_days" && (
                <div className="flex gap-1">
                  {WD.map((w) => {
                    const on = pnDays.includes(w.d);
                    return (
                      <button
                        key={w.d}
                        type="button"
                        onClick={() => setPnDays((prev) => (on ? prev.filter((x) => x !== w.d) : [...prev, w.d]))}
                        className={
                          "h-6 w-6 rounded-full text-[11px] font-bold " +
                          (on ? "bg-orange-500 text-white" : "bg-slate-100 text-slate-400 hover:bg-orange-100")
                        }
                      >
                        {w.label}
                      </button>
                    );
                  })}
                </div>
              )}
              <button
                type="button"
                disabled={persistNoteBusy}
                onClick={submitPersistentNote}
                className="rounded-lg bg-orange-500 px-2 py-1.5 text-[11px] font-bold text-white disabled:opacity-50"
              >
                {pnNames.length + (pnName.trim() ? 1 : 0) > 1
                  ? `${pnNames.length + (pnName.trim() ? 1 : 0)}명에게 추가`
                  : "추가"}
              </button>
            </div>
          )}
        </div>
      )}
      <div className="g-panel-solid p-3">
        <div className="mb-2 flex items-center justify-between gap-1">
          <p className="text-[11px] font-bold text-slate-600">📊 오늘 픽업·결석</p>
          <div className="flex shrink-0 items-center gap-1">
            {/* 원문을 보거나 새 픽업을 넣으려면 메뉴로 돌아가야 했습니다. 여기서 바로 갑니다. */}
            <a
              href="/pickup/inbox"
              className="rounded px-1 text-[10px] text-slate-400 transition hover:text-slate-700"
              title="픽업 인박스 열기"
            >
              인박스 ↗
            </a>
            {/* 가르친 것을 되돌릴 자리. 학습 기능에는 반드시 함께 있어야 합니다. */}
            <button
              type="button"
              onClick={() => setRulesOpen(true)}
              className="rounded px-1 text-[10px] text-slate-400 transition hover:text-slate-700"
              title="가르친 규칙 목록 보기·고치기·지우기"
            >
              가르친 목록
            </button>
          </div>
        </div>
        {removeError && (
          <p className="mb-1 rounded bg-red-50 px-1.5 py-1 text-[9px] leading-snug text-red-600">내리지 못했습니다: {removeError}</p>
        )}
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

      <div className="g-panel-solid p-3">
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

      <div className="g-panel-solid p-3">
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

      <div className="g-panel-solid p-3">
        <p className="mb-1.5 text-[11px] font-bold text-slate-600">📝 출결 메모</p>
        {memoContent ? (
          <p className="whitespace-pre-wrap text-[11px] leading-relaxed text-slate-700">{memoContent}</p>
        ) : (
          <p className="text-[10px] text-slate-300">작성된 메모가 없습니다.</p>
        )}
        {memoUpdatedBy && <p className="mt-1 text-[9px] text-slate-400">{memoUpdatedBy} 수정</p>}
      </div>

      {teachTarget && (
        <AttendanceTeachModal
          rawText={teachTarget.rawText}
          guessedName={teachTarget.studentName.replace(/\(.*$/, "").trim() || teachTarget.studentName}
          roster={roster}
          rules={rules}
          currentUserEmail={myEmail}
          onClose={() => setTeachTarget(null)}
          onSaved={() => {
            setTeachTarget(null);
            // 가르친 즉시 목록이 다시 읽히도록 - 고쳤는데 화면이 그대로면 안 된 줄 압니다.
            void loadRules();
          }}
        />
      )}
      {rulesOpen && (
        <AttendanceRulesModal
          onClose={() => {
            setRulesOpen(false);
            void loadRules();
          }}
        />
      )}
    </div>
  );
}
