import type { SupabaseClient } from "@supabase/supabase-js";
import { buildBoard, type BoardInput, type DayBoard, type DayItem, type DayItemKind } from "./studentDay";
import { isNoteKind } from "./studentDayNotes";
import { loadTodayPickups, setterLabel } from "./pickups";
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
 *   ⑥ 업무        `task_students` 로 이어진 업무 중 **마감이 오늘~앞날**인 것
 *
 * 업무는 **이어진 것만** 올립니다. 제목에 이름이 적혀 있어도 이어지지 않았으면 안 뜹니다 -
 * 제목의 「김재이」로는 셋 중 누구인지 가릴 수 없고, 짐작해서 붙이면 엉뚱한 아이에게
 * 붙습니다(CLAUDE.md §2-4-1).
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
  const push = (studentId: string | null, hint: string | null, item: DayItem, house?: { id: string; name: string }[]) =>
    items.push({ studentId, hint, item, house });

  const [pickups, active, upcoming, noteRes, inquiryRes, taskRes] = await Promise.all([
    loadTodayPickups(supabase, date, (id) => nameById.get(id) ?? null),
    loadActiveEntries(supabase, date),
    loadUpcomingEntries(supabase, date, aheadDays),
    supabase
      .from("student_day_notes")
      .select("id, student_id, on_date, at_time, kind, content, source_inquiry_id")
      .is("deleted_at", null)
      .gte("on_date", date)
      .lte("on_date", until)
      .limit(200),
    // 학부모 문의 + 아직 누구인지 못 가린 연락. 한 표라 한 번에 읽습니다.
    supabase
      .from("pickup_requests")
      // 시각 칸은 `ai_pickup_time` 입니다 - 이 표에 `pickup_time` 은 없습니다.
      .select("id, kind, status, student_id, service_date, ai_pickup_time, channel_label, ai_student_name, matched_name, summary, raw_text, ai_note, answered_at, is_demo, source, channel_id")
      .gte("service_date", date)
      .lte("service_date", until)
      .limit(300),
    // 학생에 이어진 업무. **이어진 것만** 읽습니다 - 이름으로 찾으면 김재이 셋이 한꺼번에
    // 걸립니다. `!inner` 는 이음이 있는 줄만 남깁니다.
    supabase
      .from("tasks")
      .select("id, title, status, due_at, task_students!inner(student_id)")
      .is("archived_at", null)
      .is("deleted_at", null)
      .neq("status", "완료")
      .not("due_at", "is", null)
      .gte("due_at", `${date}T00:00:00`)
      .lte("due_at", `${until}T23:59:59`)
      .limit(200),
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
      // **누가 지정했는지 이름으로 적습니다.** 「사람이 지정」이라고만 하면 하원 시간에
      // 「이거 누가 바꿨어요?」가 나왔을 때 아무도 답을 못 합니다 - 자료에는 처음부터
      // 이름이 있었고 화면만 뭉뚱그리고 있었습니다. 이름을 못 읽은 옛 줄만 예전 표기입니다.
      text:
        p.via === "하원수단"
          ? "하원수단"
          : p.via === "사람"
            ? `픽업(${setterLabel(p.by) ?? "사람"}이 지정)`
            : "픽업",
      onDate: date,
      from: { table: "shuttle_boardings·attendance_entries·pickup_requests", screen: "/shuttle/checklist" },
      pending: false,
      evidence: {
        label:
          p.via === "하원수단"
            ? "하원수단 설정 — 이 아이는 오늘 요일에 셔틀을 타지 않습니다"
            : p.via === "사람"
              ? `${setterLabel(p.by) ?? "담당자"}이 체크표에서 직접 픽업으로 지정`
              : "학부모 연락(토들·전화)으로 들어온 픽업",
        raw: null,
      },
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
      evidence: {
        // 사유 칸이 곧 근거입니다. 비어 있으면 사람이 손으로 등록한 것이라 그렇다고 적습니다.
        label: e.note?.trim() ? "학부모 연락에서 읽은 사유" : "사람이 출결로 등록",
        raw: e.note?.trim() || null,
      },
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
      evidence: {
        label: e.note?.trim() ? "학부모 연락에서 읽은 사유" : "사람이 출결로 등록",
        raw: e.note?.trim() || null,
      },
    });
  }

  // ── ③ 학생 특이사항 ──────────────────────────────────────────────────────
  if (noteRes.error) problems.push(`학생 특이사항을 읽지 못했습니다: ${noteRes.error.message}`);
  // 특이사항이 어느 연락에서 나왔는지. 같은 날짜 범위의 연락을 이미 읽었으므로 여기서
  // 이어 붙입니다 - 줄마다 또 읽으면 스무 줄에 스무 번 왕복합니다.
  const rawById = new Map<string, { raw: string | null; channel: string | null; source: string | null }>();
  for (const r of ((inquiryRes.data as { id: string; raw_text: string | null; channel_label: string | null; source?: string | null }[] | null) ?? []))
    rawById.set(r.id, { raw: r.raw_text, channel: r.channel_label, source: r.source ?? null });

  for (const n of ((noteRes.data as { id: string; student_id: string; on_date: string; at_time: string | null; kind: string; content: string; source_inquiry_id: string | null }[] | null) ?? [])) {
    const src = n.source_inquiry_id ? rawById.get(n.source_inquiry_id) : undefined;
    push(n.student_id, null, {
      id: `note:${n.id}`,
      kind: isNoteKind(n.kind) ? n.kind : "기타",
      at: n.at_time ? n.at_time.slice(0, 5) : null,
      text: n.content,
      onDate: n.on_date,
      from: { table: "student_day_notes", screen: "/work" },
      pending: false,
      evidence: src
        ? { label: `${src.source ?? "토들"}${src.channel ? ` · ${src.channel}` : ""}`, raw: src.raw, sourceId: n.id }
        : { label: "사람이 직접 적은 특이사항", raw: null, sourceId: n.id },
    });
  }

  // ── ④⑤ 학부모 문의 · 누구인지 모르는 연락 ────────────────────────────────
  if (inquiryRes.error) problems.push(`학부모 연락을 읽지 못했습니다: ${inquiryRes.error.message}`);

  // ── 이어 둔 집의 아이들 ────────────────────────────────────────────────
  //
  // **형제방은 「미연결」이 아닙니다.** 학기 초에 사람이 황라원·황라윤을 그 방에 이어
  // 두었습니다. 본문이 둘 중 누구인지 안 가른 것뿐인데, 화면은 그냥 「누구인지 모릅니다」로
  // 띄웠습니다 - 이어 둔 것이 있는데도 없는 것처럼 보이면, 사람은 처음부터 다시 찾습니다.
  //
  // 그래서 방에 이어진 아이들을 함께 들고 갑니다. 화면은 **그 집 아이 전부를 기본**으로
  // 보여주고, 한 명만 해당하면 그 자리에서 좁힙니다.
  const houseIds = [
    ...new Set(
      ((inquiryRes.data as { channel_id?: string | null; student_id: string | null }[] | null) ?? [])
        .filter((r) => !r.student_id && r.channel_id)
        .map((r) => r.channel_id as string),
    ),
  ];
  const houseOf = new Map<string, { id: string; name: string }[]>();
  if (houseIds.length > 0) {
    const { data: linkRows, error: linkErr } = await supabase
      .from("toddle_channel_students")
      .select("channel_id, student_id, seq")
      .in("channel_id", houseIds);
    // 못 읽으면 조용히 넘기지 않습니다. 이어 둔 것이 안 보이는 것과 이어 둔 것이 없는 것은
    // 다른 말이고, 화면만 보고는 구별할 수 없습니다(§5).
    if (linkErr) problems.push(`이어 둔 방의 아이를 읽지 못했습니다: ${linkErr.message}`);
    for (const l of ((linkRows as { channel_id: string; student_id: string; seq: number }[] | null) ?? []).sort(
      (a, b) => a.seq - b.seq,
    )) {
      // **번호로** 명부를 찾습니다. 이름으로 찾으면 김재이 셋이 한 줄을 나눠 씁니다(§2-4).
      const st = roster.find((x) => x.id === l.student_id);
      if (!st) continue; // 졸업·전학으로 빠진 아이. 없는 아이를 고르게 두지 않습니다.
      houseOf.set(l.channel_id, [...(houseOf.get(l.channel_id) ?? []), { id: st.id, name: st.name }]);
    }
  }
  type Req = {
    id: string; kind: string | null; status: string; student_id: string | null;
    service_date: string; ai_pickup_time: string | null; channel_label: string | null;
    ai_student_name: string | null; matched_name: string | null; summary: string | null;
    raw_text: string | null; ai_note?: string | null; answered_at: string | null; is_demo?: boolean | null;
    /** 사람이 이어 둔 집(토들 방). 형제방이면 이것만으로도 「누구 집인지」는 확실합니다. */
    channel_id?: string | null;
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
        at: r.ai_pickup_time,
        text: cut(r.summary ?? r.raw_text ?? "확인이 필요한 연락"),
        onDate: r.service_date,
        from: { table: "pickup_requests", screen: "/pickup/inbox" },
        pending: true,
        evidence: {
          label: `${r.channel_label ?? "학부모 연락"}${r.ai_note ? ` · AI: ${cut(r.ai_note, 60)}` : ""}`,
          raw: r.raw_text,
          sourceId: r.id,
        },
      }, r.channel_id ? houseOf.get(r.channel_id) : undefined);
      continue;
    }

    // **확정된 줄은 사람이 픽업으로 정한 것입니다.** ①이 이미 픽업으로 세웠으므로 여기서
    // 다시 세우지 않습니다. 갈래(`kind`)로만 갈랐더니, AI가 「문의」로 읽은 글은 사람이 픽업
    // 확정을 눌러도 특이사항 칸에 **문의로 남아 있었습니다** - 홍선우가 그랬습니다. 판단의
    // 근거는 AI의 첫인상이 아니라 사람이 내린 결정입니다.
    if (r.status === "확정") continue;
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
      evidence: {
        label: `${r.channel_label ?? "학부모 문의"}${r.ai_note ? ` · AI: ${cut(r.ai_note, 60)}` : ""}`,
        raw: r.raw_text,
        sourceId: r.id,
      },
    });
  }

  // ── ⑥ 이어진 업무 ────────────────────────────────────────────────────────
  //
  // **완료된 것은 올리지 않습니다** - 보드는 「오늘 해야 할 것」이지 기록이 아닙니다.
  if (taskRes.error) problems.push(`업무를 읽지 못했습니다: ${taskRes.error.message}`);
  for (const t of ((taskRes.data as { id: string; title: string; status: string; due_at: string; task_students: { student_id: string }[] }[] | null) ?? [])) {
    // 한 업무가 여러 아이에 걸립니다(「G2 교재 배부」는 스무 명). 아이마다 한 줄씩 섭니다.
    for (const link of t.task_students ?? []) {
      push(link.student_id, null, {
        id: `task:${t.id}:${link.student_id}`,
        kind: "기타",
        // 마감 시각이 23:59 면 「오늘 중에」라는 뜻입니다 - 그걸 시각으로 띄우면 모든 업무가
        // 밤 11시 59분에 몰린 것처럼 보입니다.
        at: dueClock(t.due_at),
        text: `업무 · ${cut(t.title, 40)}`,
        onDate: t.due_at.slice(0, 10),
        from: { table: "tasks", screen: "/work" },
        pending: false,
      });
    }
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

/**
 * 마감 시각. **23:59 는 시각이 아니라 「그날 중에」입니다** - 날짜만 고른 업무가 그렇게
 * 저장됩니다. 그걸 시각으로 띄우면 보드에서 모든 업무가 밤 11시 59분에 몰린 것처럼
 * 보이고, 정작 시각이 있는 약·픽업이 그 아래로 밀립니다.
 */
function dueClock(dueAt: string): string | null {
  const hhmm = new Date(dueAt).toLocaleTimeString("en-GB", { timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit" });
  return hhmm === "23:59" || hhmm === "00:00" ? null : hhmm;
}

/** 한 줄에 들어갈 만큼만. 보드는 훑는 곳이고, 원문은 눌러서 봅니다. */
function cut(s: string, n = 60): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n)}…` : t;
}
