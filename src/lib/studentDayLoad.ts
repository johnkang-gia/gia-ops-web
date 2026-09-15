import type { SupabaseClient } from "@supabase/supabase-js";
import { buildBoard, type BoardInput, type DayBoard, type DayItem, type DayItemKind } from "./studentDay";
import { isNoteKind } from "./studentDayNotes";
import { loadTodayPickups } from "./pickups";
import { loadActiveEntries, loadUpcomingEntries } from "./attendanceEntries";
import { departmentOf } from "./department";
import { kstDateOffset } from "./kst";

/**
 * **여러 표에서 읽어 학생 하루 보드로 조립합니다.**
 *
 * 조립 규칙 자체는 `studentDay.ts` 의 순수 함수에 있습니다(시험 20개). 이 파일은
 * **읽어오는 일만** 합니다 - 둘을 섞으면 규칙을 시험할 수 없습니다.
 *
 * ── 지금 읽는 갈래 ─────────────────────────────────────────────────────────
 *
 *   ① 픽업        `loadTodayPickups` — 체크표·출결내역·학부모연락 세 갈래가 이미 한 곳에서
 *                 합쳐집니다. 여기서 다시 세지 않습니다.
 *   ② 결석·지각   `loadActiveEntries`(오늘) + `loadUpcomingEntries`(앞날)
 *   ③ 특이사항    `student_day_notes` — 약·결제·준비물
 *   ④ 학부모 문의 `pickup_requests` 중 아직 답 안 한 것
 *   ⑤ 확인대기    `pickup_requests` 중 누구인지 아직 못 가린 것 → 「모름」 칸으로
 *
 * 하원수단(학원차)은 ①에 이미 섞여 들어옵니다 - 아침 크론이 체크표에 픽업으로 걸고,
 * `loadTodayPickups` 가 `via: "하원수단"` 으로 표시합니다. 여기서 또 읽으면 한 아이가
 * 두 줄이 됩니다(`pickups.ts` 의 백서아·황이안 중복이 그 자리였습니다).
 *
 * 셔틀 탑승은 **읽지 않습니다.** 늘 타던 차를 오늘도 타는 것은 소식이 아니고, 넣으면
 * 보드가 첫날부터 139줄이 됩니다.
 */

export type LoadOptions = {
  /** 기준 날짜(한국). */
  date: string;
  /** 이 부서의 아이만. `null` 이면 전부(최고관리자·개발자). */
  department: string | null;
  /** 앞날 며칠까지. 0 이면 오늘만. */
  aheadDays?: number;
};

const DEFAULT_AHEAD = 7;

export async function loadStudentDay(supabase: SupabaseClient, opts: LoadOptions): Promise<DayBoard> {
  const { date, department } = opts;
  const aheadDays = opts.aheadDays ?? DEFAULT_AHEAD;
  const until = kstDateOffset(aheadDays);
  const problems: string[] = [];

  // ── 명부를 한 번만 읽습니다 ──────────────────────────────────────────────
  //
  // 여러 갈래가 각자 명부를 읽으면 같은 139명을 대여섯 벌씩 실어 나릅니다.
  const { data: stuRows, error: stuErr } = await supabase
    .from("wr_students")
    .select("id, name, grade, class_name, department")
    .eq("status", "active")
    .eq("is_demo", false);
  if (stuErr) {
    // 명부를 못 읽으면 아무것도 못 묶습니다. 빈 보드를 조용히 띄우지 않습니다.
    return { date, days: [], unknown: [], problems: [`명부를 읽지 못했습니다: ${stuErr.message}`] };
  }

  type Row = { id: string; name: string; grade: string | null; class_name: string | null; department: string | null };
  const all = (stuRows as Row[] | null) ?? [];
  const mine = department ? all.filter((s) => departmentOf(s) === department) : all;
  const roster = mine.map((s) => ({ id: s.id, name: s.name, grade: s.grade, className: s.class_name }));
  const nameById = new Map(all.map((s) => [s.id, s.name]));

  const items: BoardInput["items"] = [];
  const push = (studentId: string | null, hint: string | null, item: DayItem) => items.push({ studentId, hint, item });

  const [pickups, active, upcoming, noteRes, inquiryRes] = await Promise.all([
    loadTodayPickups(supabase, date, (id) => nameById.get(id) ?? null),
    loadActiveEntries(supabase, date),
    loadUpcomingEntries(supabase, date, aheadDays),
    supabase
      .from("student_day_notes")
      .select("id, student_id, on_date, at_time, kind, content")
      .is("deleted_at", null)
      .gte("on_date", date)
      .lte("on_date", until)
      .limit(200),
    // 학부모 문의 + 아직 누구인지 못 가린 연락. 한 표라 한 번에 읽습니다.
    supabase
      .from("pickup_requests")
      .select("id, kind, status, student_id, service_date, pickup_time, channel_label, ai_student_name, matched_name, summary, raw_text, answered_at, is_demo")
      .gte("service_date", date)
      .lte("service_date", until)
      .limit(300),
  ]);

  // ── ① 픽업 ───────────────────────────────────────────────────────────────
  //
  // 시각을 모르는 픽업도 올립니다 - 연락은 왔는데 시각만 모르는 것이고, 그건 오히려
  // 물어봐야 할 건입니다.
  for (const p of pickups) {
    push(p.studentId, p.name, {
      id: `pickup:${p.studentId ?? p.name}:${p.time ?? "?"}`,
      kind: "픽업",
      at: p.time,
      // 어디서 온 픽업인지 한 마디. 「왜 이 아이가 떴지」에 답하는 값입니다.
      text: p.via === "하원수단" ? "하원수단" : p.via === "사람" ? "픽업(사람이 지정)" : "픽업",
      onDate: date,
      from: { table: "shuttle_boardings·attendance_entries·pickup_requests", screen: "/shuttle/checklist" },
      pending: false,
    });
  }

  // ── ② 결석·지각 (오늘) ───────────────────────────────────────────────────
  type Entry = {
    student_id: string | null;
    student_name: string;
    status: string;
    note: string | null;
    pickup_time?: string | null;
    date_from: string;
    date_to: string;
  };
  for (const e of (active as Entry[])) {
    // 픽업은 ①에서 이미 셌습니다. 여기서 또 올리면 한 아이가 두 줄이 됩니다.
    if (e.status === "픽업") continue;
    push(e.student_id, e.student_name, {
      id: `entry:${e.student_id ?? e.student_name}:${e.date_from}:${e.status}`,
      kind: entryKind(e.status),
      at: null,
      text: [e.note?.trim(), spanLabel(e.date_from, e.date_to)].filter(Boolean).join(" · ") || e.status,
      onDate: date,
      from: { table: "attendance_entries", screen: "/work" },
      pending: false,
    });
  }

  // ── ②-b 앞날 예정 ────────────────────────────────────────────────────────
  for (const e of (upcoming as (Entry & { id: string })[])) {
    if (e.status === "픽업") continue;
    push(e.student_id, e.student_name, {
      id: `upcoming:${e.id}`,
      kind: entryKind(e.status),
      at: null,
      text: [e.note?.trim(), spanLabel(e.date_from, e.date_to)].filter(Boolean).join(" · ") || e.status,
      onDate: e.date_from,
      from: { table: "attendance_entries", screen: "/work" },
      pending: false,
    });
  }

  // ── ③ 학생 특이사항 ──────────────────────────────────────────────────────
  if (noteRes.error) problems.push(`학생 특이사항을 읽지 못했습니다: ${noteRes.error.message}`);
  for (const n of ((noteRes.data as { id: string; student_id: string; on_date: string; at_time: string | null; kind: string; content: string }[] | null) ?? [])) {
    push(n.student_id, null, {
      id: `note:${n.id}`,
      kind: isNoteKind(n.kind) ? n.kind : "기타",
      at: n.at_time ? n.at_time.slice(0, 5) : null,
      text: n.content,
      onDate: n.on_date,
      from: { table: "student_day_notes", screen: "/work" },
      pending: false,
    });
  }

  // ── ④⑤ 학부모 문의 · 누구인지 모르는 연락 ────────────────────────────────
  if (inquiryRes.error) problems.push(`학부모 연락을 읽지 못했습니다: ${inquiryRes.error.message}`);
  type Req = {
    id: string; kind: string | null; status: string; student_id: string | null;
    service_date: string; pickup_time: string | null; channel_label: string | null;
    ai_student_name: string | null; matched_name: string | null; summary: string | null;
    raw_text: string | null; answered_at: string | null; is_demo?: boolean | null;
  };
  for (const r of ((inquiryRes.data as Req[] | null) ?? [])) {
    if (r.is_demo) continue;
    if (r.status === "무시") continue;

    // 아직 사람이 한 번 봐야 하는 건. **누구인지 모르면 「모름」 칸으로** 갑니다 -
    // 「재이」를 셋 중 하나에 붙이면 나머지 둘의 보호자는 아무 소식도 못 받습니다.
    if (r.status === "확인대기") {
      push(r.student_id, r.channel_label ?? r.ai_student_name, {
        id: `pending:${r.id}`,
        kind: r.kind === "문의" ? "문의" : "픽업",
        at: r.pickup_time,
        text: cut(r.summary ?? r.raw_text ?? "확인이 필요한 연락"),
        onDate: r.service_date,
        from: { table: "pickup_requests", screen: "/pickup/inbox" },
        pending: true,
      });
      continue;
    }

    // 확정된 픽업은 ①에 이미 있습니다. 문의만 올립니다.
    if (r.kind !== "문의") continue;
    if (r.answered_at) continue; // 답한 것은 할 일이 아닙니다
    push(r.student_id, r.channel_label ?? r.matched_name, {
      id: `inquiry:${r.id}`,
      kind: "문의",
      at: null,
      text: cut(r.summary ?? r.raw_text ?? "학부모 문의"),
      onDate: r.service_date,
      from: { table: "pickup_requests", screen: "/work" },
      pending: true,
    });
  }

  return buildBoard({ date, roster, items }, problems);
}

function entryKind(status: string): DayItemKind {
  if (status === "결석") return "결석";
  if (status === "지각") return "지각";
  if (status === "조퇴") return "조퇴";
  return "기타";
}

/** 하루짜리면 안 적습니다 - 「09/15 ~ 09/15」는 읽는 사람에게 아무것도 안 알려줍니다. */
function spanLabel(from: string, to: string): string {
  if (from === to) return "";
  return `${from.slice(5).replace("-", "/")}~${to.slice(5).replace("-", "/")}`;
}

/** 한 줄에 들어갈 만큼만. 보드는 훑는 곳이고, 원문은 눌러서 봅니다. */
function cut(s: string, n = 60): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n)}…` : t;
}
