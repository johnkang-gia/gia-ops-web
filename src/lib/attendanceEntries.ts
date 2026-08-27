import type { SupabaseClient } from "@supabase/supabase-js";
import {
  categorize,
  extractTargetRange,
  looksLikePronounReply,
  matchRosterStudents,
  todayKey,
  type LearningRule,
  type RosterStudent,
} from "./attendanceDigest";

// 구글챗·토들 메시지를 훑어 attendance_entries를 채웁니다.
//
// 설계의 핵심은 **자동 판단이 사람 판단을 이기지 않는다**는 것입니다.
//   - 확실한 건(학생 한 명 + 종류 분명 + 날짜 있음) 바로 '등록'해 둡니다 → 인박스에 초록 체크.
//   - 애매하면 '확인필요'로 만들어 두고 대시보드에는 올리지 않습니다 → 인박스에 물음표.
//   - 사람이 손댄 줄(touched_by_human)은 **다시 건드리지 않습니다.** 지운 것이 되살아나던
//     문제가 바로 이 자리가 없어서 생겼습니다.

export type EntryState = "등록" | "확인필요" | "무시";

export type ScanSource = {
  source: "googlechat" | "toddle";
  messageId: string;
  text: string;
  sentAt: Date;
  /** 토들 문의가 AI로 이미 학생을 특정해 둔 경우(가장 정확). */
  studentId?: string | null;
};

export type ScanResult = { created: number; skipped: number; needsReview: number; failed?: string | null };

type RosterFull = RosterStudent & { id?: string | null; className?: string | null };

/**
 * 메시지 묶음을 훑어 없는 항목만 새로 만듭니다.
 *
 * "없는 것만"이 중요합니다 - 이미 있는 줄은 사람이 상태를 바꿔놨을 수 있으므로 절대 덮어쓰지
 * 않습니다. 그래서 이 함수를 몇 번 돌려도 결과가 같습니다.
 */
export async function scanIntoEntries(
  supabase: SupabaseClient,
  messages: ScanSource[],
  roster: RosterFull[],
  rules?: LearningRule[],
  // 멘션(@…)을 지울 때 쓰는 교직원 성함. 세 낱말짜리 성함(@Carina Ann John)을
  // 두 낱말로 자르면 남은 낱말이 학생 영문명과 겹쳐 엉뚱한 아이가 잡힙니다.
  staffNames?: string[],
): Promise<ScanResult> {
  if (messages.length === 0) return { created: 0, skipped: 0, needsReview: 0, failed: null };

  // 이미 만들어 둔 것들을 한 번에 읽어옵니다(메시지마다 조회하면 왕복이 수백 번이 됩니다).
  const ids = messages.map((m) => m.messageId);
  const existing = new Set<string>();
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await supabase
      .from("attendance_entries")
      .select("source, source_message_id, student_name, status")
      .in("source_message_id", ids.slice(i, i + 200));
    for (const r of data ?? []) {
      existing.add(`${r.source}|${r.source_message_id}|${r.student_name}|${r.status}`);
    }
  }

  const rows: Record<string, unknown>[] = [];
  let skipped = 0;
  let needsReview = 0;

  for (const m of messages) {
    // "he will be late"처럼 대명사로 시작하는 답글은 다른 통보에 대한 답이라 새 결석이 아닙니다.
    if (looksLikePronounReply(m.text)) {
      skipped += 1;
      continue;
    }
    const category = categorize(m.text, rules);
    if (!category) {
      skipped += 1;
      continue;
    }

    const range = extractTargetRange(m.text, m.sentAt);

    // 학생 특정: AI가 연결해 둔 student_id가 가장 정확하고, 없으면 본문을 명부와 대조합니다.
    //
    // 여기서 **명부의 id를 반드시 같이 들고 나옵니다.** 이름만 들고 가면 저장할 때 다시 찾아야
    // 하는데, 그때 못 찾으면 학생 없는 줄이 만들어집니다. student_id는 NOT NULL로 잠겨 있어
    // (20260827090000_lock_student_fk.sql) 그런 줄은 애초에 저장되지 않아야 합니다.
    let matched = matchRosterStudents(m.text, roster, rules, staffNames)
      .map((s) => {
        const full = roster.find((r) => r.name === s.name);
        return { id: full?.id ?? null, name: s.name, display: s.displayName, grade: s.grade, className: full?.className ?? null };
      })
      .filter((s): s is { id: string; name: string; display: string; grade: string | null; className: string | null } => !!s.id);

    if (matched.length === 0 && m.studentId) {
      const s = roster.find((r) => r.id === m.studentId);
      if (s?.id) matched = [{ id: s.id, name: s.name, display: s.name, grade: s.grade, className: s.className ?? null }];
    }

    // 애매한 이유를 남깁니다. 화면의 물음표를 눌렀을 때 "왜 확인이 필요한지"가 보여야
    // 사람이 1초 만에 판단할 수 있습니다.
    const reason =
      matched.length === 0
        ? "명부에서 학생을 찾지 못했습니다"
        : matched.length > 1
          ? `이름이 ${matched.length}명과 겹칩니다`
          : !range
            ? "날짜가 적혀 있지 않습니다"
            : null;

    // 학생을 못 찾으면 누구 것인지 모르니 줄을 만들 수도 없습니다. 인박스에는 원본이 그대로
    // 남아 있으므로, 사람이 보고 직접 등록하면 됩니다.
    if (matched.length === 0) {
      needsReview += 1;
      continue;
    }

    // 날짜가 없으면 "적힌 날 하루"로 봅니다 - 다만 자동 등록은 하지 않고 확인을 받습니다.
    const from = range?.from ?? todayKey(m.sentAt);
    let to = range?.to ?? from;

    // 기간이 터무니없이 길면 자동으로 밀지 않습니다.
    //
    // 담당자: "출결과 픽업이 하루마다 갱신되지 않고 축적되는 것 같아."
    //
    // 대시보드는 "기간이 오늘을 품는 것"을 올립니다. 그래서 한 글에서 뽑은 기간이 잘못
    // 길어지면(예: "9월까지"를 통째로 읽으면 한 달 내내) 그 아이가 **매일** 목록에 남습니다.
    // 지운 적도 없는데 계속 쌓이는 것처럼 보이는 자리입니다.
    //
    // 사람이 진짜 한 달을 쉰다고 알려온 것일 수도 있으니 버리지는 않고, 하루로 줄인 뒤
    // '확인필요'로 돌려 사람이 보고 기간을 직접 늘리게 합니다. 자동 판단이 길게 미는 것보다
    // 사람이 짧게 시작하는 편이 되돌리기 쉽습니다.
    const MAX_SPAN_DAYS = 21;
    let spanTooLong = false;
    if (to > from) {
      const days = Math.round((new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime()) / 86400000);
      if (days > MAX_SPAN_DAYS) {
        to = from;
        spanTooLong = true;
      }
    }

    const state: EntryState = reason || spanTooLong ? "확인필요" : "등록";

    for (const st of matched) {
      const key = `${m.source}|${m.messageId}|${st.display}|${category}`;
      if (existing.has(key)) {
        skipped += 1;
        continue;
      }
      existing.add(key);
      if (state === "확인필요") needsReview += 1;
      rows.push({
        source: m.source,
        source_message_id: m.messageId,
        student_id: st.id, // 위에서 id 없는 건 걸러냈으므로 항상 값이 있습니다.
        student_name: st.display,
        grade: st.grade,
        class_name: st.className,
        status: category,
        date_from: from,
        date_to: to,
        state,
        reason: reason ?? (spanTooLong ? `기간이 ${MAX_SPAN_DAYS}일보다 길게 읽혔습니다 - 하루로 줄였으니 맞는지 확인해주세요` : null),
        raw_text: m.text.slice(0, 500),
        registered_at: state === "등록" ? new Date().toISOString() : null,
        registered_by: state === "등록" ? "자동" : null,
      });
    }
  }

  let created = 0;
  let failed: string | null = null;
  for (let i = 0; i < rows.length; i += 100) {
    const chunk = rows.slice(i, i + 100);
    // ignoreDuplicates: 이미 있는 줄은 조용히 넘어갑니다(사람이 바꿔둔 값을 지키기 위함).
    const { error } = await supabase
      .from("attendance_entries")
      .upsert(chunk, { onConflict: "source,source_message_id,student_name,status", ignoreDuplicates: true });
    if (!error) created += chunk.length;
    // 오류를 삼키지 않습니다. 여기서 조용히 넘어가는 바람에, 유일 인덱스에 조건이 붙어 있어
    // upsert가 매번 42P10으로 실패하는데도 화면은 "그냥 등록될 게 없나 보다"로 보였습니다.
    // 출결내역이 전부 ⬜였던 진짜 이유입니다.
    else if (!failed) failed = error.message;
  }

  return { created, skipped, needsReview, failed };
}

/** 오늘 대시보드에 올릴 출결(등록된 것만, 기간이 오늘을 품는 것만). */
export async function loadActiveEntries(supabase: SupabaseClient, dateKey: string) {
  const { data } = await supabase
    .from("attendance_entries")
    .select("student_id, student_name, grade, class_name, status, note, date_from, date_to")
    .eq("state", "등록")
    .lte("date_from", dateKey)
    .gte("date_to", dateKey);
  return data ?? [];
}
