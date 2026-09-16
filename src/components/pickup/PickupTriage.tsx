"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { todayKst } from "@/lib/kst";
import { useToast } from "@/components/common/ToastProvider";
import StudentPicker from "@/components/pickup/StudentPicker";
import { createClient } from "@/lib/supabase/client";
import { parseChannelLabel, type RosterEntry } from "@/lib/pickupParse";
import { buildAliasIndex, resolveStudent, type AliasRule } from "@/lib/studentMatch";
import { buildWhereMaps, RowStudentName } from "@/lib/studentLabel";
import { nameSurfaces, readSiblings } from "@/lib/attendanceIntent";
import { extractTargetRange, todayKey } from "@/lib/attendanceDigest";
import { extractRecurringWeekdays, hasRecurringPhrase, weekdayLabel } from "@/lib/parentRecurrence";
import { isClockTime, KIND_LOOK, NOTE_KINDS, type NoteKind } from "@/lib/studentDayNotes";
import { splitNotes, type NoteDraft } from "@/lib/splitNotes";
import { readsShuttleRequest } from "@/lib/shuttleRequest";

/**
 * **확인이 필요한 픽업 — 판단을 내리는 자리.**
 *
 * 이 덩어리는 두 화면이 씁니다.
 *
 * | 어디 | 왜 |
 * |---|---|
 * | 픽업 인박스(`/pickup/inbox`) | 원래 자리. 하원 준비를 하며 몰아서 봅니다 |
 * | 업무보드 인박스 칸 | 하루 종일 열어두는 화면. 여기 없으면 **셔틀 메뉴로 건너가야** 합니다 |
 *
 * **두 벌로 만들지 않습니다.** 단추가 여섯 개이고 그 중 넷이 되돌릴 수 없는 일(픽업 확정·
 * 결석·지각·오늘 셔틀)입니다. 화면을 두 벌 두면 한쪽에만 고친 단추가 생기고, 그건 오류가
 * 아니라 **다른 답**으로 보입니다 - 이 저장소에서 반복해서 난 사고입니다.
 *
 * 좁은 칸(업무보드)에서는 `compact` 로 글자와 여백만 줄입니다. 고를 수 있는 것은 같습니다.
 */

export type PickupRow = {
  id: string;
  service_date: string;
  source: string;
  channel_label: string | null;
  sender_name: string | null;
  received_at: string;
  raw_text: string | null;
  ai_student_name: string | null;
  ai_pickup_time: string | null;
  ai_confidence: number | null;
  ai_note: string | null;
  student_id: string | null;
  matched_name: string | null;
  status: "확인대기" | "확정" | "무시";
  resolved_by: string | null;
};

export type StudentOption = {
  id: string;
  name: string;
  grade: string | null;
  class_name?: string | null;
  name_en?: string | null;
  student_no?: string | null;
  /** 동명이인 판정에 씁니다("jay kim(190828)"의 괄호). 없으면 아무도 못 고릅니다. */
  birth_date?: string | null;
};

const SOURCE_STYLE: Record<string, string> = {
  토들: "bg-rose-50 text-rose-600",
  전화: "bg-sky-50 text-sky-600",
  교사: "bg-violet-50 text-violet-600",
  구글챗: "bg-emerald-50 text-emerald-600",
  직접입력: "bg-slate-100 text-slate-600",
  학부모링크: "bg-amber-50 text-amber-700",
};

function hhmm(iso: string): string {
  return new Date(iso).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });
}

export default function PickupTriage({
  rows,
  students,
  onChanged,
  compact = false,
}: {
  /** 확인이 필요한 줄만. 가르는 일은 부르는 쪽이 합니다 - 여기서 또 거르면 두 곳이 어긋납니다. */
  rows: PickupRow[];
  students: StudentOption[];
  /** 무언가 처리한 뒤. 부르는 화면이 제 목록을 다시 읽습니다. */
  onChanged: () => void | Promise<void>;
  /** 업무보드처럼 좁은 칸. 글자·여백만 줄이고 고를 수 있는 것은 같습니다. */
  compact?: boolean;
}) {
  const notify = useToast();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  /** 특이사항 폼이 열려 있는 줄. 한 번에 하나만 엽니다 - 여럿 열리면 어느 칸에 적는지 헷갈립니다. */
  const [noteFor, setNoteFor] = useState<string | null>(null);
  /**
   * 줄마다 고친 픽업 시각. 기본값은 AI가 읽은 값이고, 사람이 그 자리에서 고칩니다.
   *
   * **시각이 곧 사람이 움직이는 시점입니다.** 「하교시간보다 10분 늦어 2시 30분 도착」 같은
   * 글은 AI가 시각을 못 뽑거나 엉뚱하게 뽑는데, 고칠 자리가 없어서 보드에 「미정」으로
   * 떴습니다 - 행정실은 언제 아이를 내보낼지 모릅니다.
   */
  const [timeFor, setTimeFor] = useState<Record<string, string>>({});

  const pending = rows;
  /**
   * 좁은 칸에서 줄이는 것은 **글자와 여백뿐**입니다. 단추를 빼면 그 화면에서만 못 하는 일이
   * 생기고, 사람은 결국 넓은 화면을 다시 엽니다 - 왕복을 없애려고 만든 자리인데 왕복이
   * 남습니다.
   */
  const btn = compact ? "px-2 py-1 text-[11px]" : "px-3 py-1.5 text-xs";
  /** AI가 못 읽어서 요약·시각이 비어 있는 줄. 원문은 남아 있어 다시 읽을 수 있습니다. */
  const unread = useMemo(() => rows.filter((r) => (r.ai_note ?? "").startsWith("AI 판단에 실패")), [rows]);

  async function call(body: Record<string, unknown>) {
    setBusy(true);
    try {
      const res = await fetch("/api/pickup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) {
        notify(json.error ?? "처리하지 못했습니다.", "error");
        return null;
      }
      return json;
    } finally {
      setBusy(false);
    }
  }

  async function refresh() {
    await onChanged();
  }

  /**
   * 못 읽은 연락을 처음과 **같은 판단**에 다시 태웁니다.
   *
   * **셔틀에는 자동으로 반영하지 않습니다.** 며칠 전 「오늘 3시 픽업」을 오늘 자동으로 걸면
   * 엉뚱한 날 아이가 명단에서 빠집니다. 채워 넣기만 하고, 거는 것은 여기서 사람이 합니다.
   */
  async function rereadFailed() {
    setBusy(true);
    try {
      const res = await fetch("/api/pickup/reread", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ days: 14 }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        reread?: number;
        stillFailed?: number;
        failures?: string[];
        error?: string;
      };
      if (!res.ok) return notify(body.error ?? "다시 읽지 못했습니다.", "error");
      // 또 실패했으면 원인이 아직 안 고쳐진 것입니다. 「0건」만 뜨면 왜 안 됐는지 모릅니다.
      if (body.stillFailed) {
        notify(
          `${body.reread ?? 0}건을 다시 읽었고, ${body.stillFailed}건은 또 실패했습니다` +
            (body.failures?.length ? `: ${body.failures.join(" / ")}` : "."),
          "error",
        );
      } else {
        notify(`${body.reread ?? 0}건을 다시 읽었습니다. 맞는지 보고 등록해주세요.`, "success");
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  const rosterForMatch = useMemo<RosterEntry[]>(
    () =>
      students.map((s) => ({
        id: s.id,
        name: s.name,
        name_en: s.name_en ?? null,
        grade: s.grade,
        class_name: s.class_name ?? null,
        birth_date: s.birth_date ?? null,
      })),
    [students]
  );

  // 사람이 가르쳐 둔 별칭(🔎). 서버가 받을 때 쓰는 것과 **같은 표**입니다 - 다시 훑기가
  // 서버보다 덜 알아보면, 사람은 「가르쳤는데 왜 안 붙지」를 겪습니다.
  const [aliasRules, setAliasRules] = useState<AliasRule[]>([]);
  useEffect(() => {
    void (async () => {
      const { data, error } = await createClient()
        .from("attendance_learning_rules")
        .select("pattern, student_id")
        .eq("kind", "alias");
      if (error) {
        // 없으면 덜 붙을 뿐이라 화면을 막지는 않습니다. 다만 조용히 넘기지 않습니다.
        console.error("[인박스] 가르쳐 둔 별칭을 읽지 못했습니다:", error.message);
        return;
      }
      setAliasRules((data as AliasRule[] | null) ?? []);
    })();
  }, []);
  // 이름 옆에 반을 붙이는 표. 김재이가 셋이라 이름만으로는 어느 아이인지 알 수 없습니다.
  const whereMaps = useMemo(() => buildWhereMaps(rosterForMatch), [rosterForMatch]);
  const aliases = useMemo(() => buildAliasIndex(aliasRules, rosterForMatch), [aliasRules, rosterForMatch]);

  async function rematchAll() {
    setBusy(true);
    let fixed = 0;
    for (const r of pending) {
      if (r.student_id) continue;
      const candidate = (r.ai_student_name ?? r.channel_label ?? "").trim();
      if (!candidate) continue;
      const hit = resolveStudent(candidate, rosterForMatch, { context: r.raw_text ?? "", aliases }).student;
      if (!hit) continue;
      await call({ action: "confirm", id: r.id, studentId: hit.id });
      fixed += 1;
    }
    setBusy(false);
    notify(fixed > 0 ? `${fixed}건을 학생과 이었습니다.` : "지금 규칙으로도 확정되는 건이 없습니다. 직접 골라주세요.", fixed > 0 ? "success" : "error");
    void refresh();
  }

  // ── 형제방: 한 아이는 쉬고 한 아이는 가는 글 ─────────────────────────────
  //
  // 실제로 틀렸던 문장입니다.
  //   "오늘 여명인 괜찮은데, 이제는 여전히 열나고 아파 하루 더 쉬도록 하겠습니다.
  //    여명이는 정상등원 합니다!"
  // 쉬는 아이는 이제인데 여명이가 결석으로 들어갔습니다.
  //
  // 수집할 때도 같은 판정을 하지만, **이미 쌓여 있는 줄**에는 그 판정이 안 붙어 있습니다.
  // 여기서 다시 읽어, 오늘 화면을 보는 사람이 바로 알아챌 수 있게 합니다.
  const siblingOf = useCallback(
    (r: PickupRow) => {
      const text = r.raw_text ?? "";
      const ch = parseChannelLabel(r.channel_label);
      if (!text || !ch || !ch.isSibling) return null;
      const sibs = ch.names
        .map((n) => {
          const hit = resolveStudent(n, rosterForMatch, { grade: ch.grades[0] ?? null, context: text, aliases }).student;
          return hit ? { key: hit.name, surfaces: nameSurfaces(hit.name, hit.name_en) } : null;
        })
        .filter((x): x is { key: string; surfaces: string[] } => !!x);
      if (sibs.length < 2) return null;
      const read = readSiblings(text, sibs);
      if (!read.conflict && read.attending.length === 0) return null;
      return read;
    },
    [rosterForMatch]
  );

  // ── 반복 판정 ────────────────────────────────────────────────────────────
  //
  // 담당자: "Theo is pick up everyfriday 3:10! 이걸 킴태오 픽업으로 만들었더라고.
  //          everyfriday 매주 금요일인데 이 부분을 무시하고 그냥 태오 픽업으로 넣어버렸어."
  //
  // 수집할 때(pickupIngest) 이미 같은 판단을 하지만, 화면에서도 다시 봅니다 - **이미 쌓여
  // 있는 줄**에는 그 판단이 안 붙어 있기 때문입니다. 고친 규칙이 어제 들어온 연락에는
  // 소용없다면, 담당자는 여전히 손으로 찾아야 합니다.
  const recurrenceOf = useCallback((r: PickupRow) => {
    const text = r.raw_text ?? "";
    if (!text) return null;
    const days = extractRecurringWeekdays(text);
    if (days.length > 0) return { days };
    return hasRecurringPhrase(text) ? { days: [] as number[] } : null;
  }, []);

  // ── 결석 판정 ────────────────────────────────────────────────────────────
  //
  // 담당자: "AI가 결석으로 체크한 부분인데도 픽업이냐 아니냐밖에 선택을 못해. AI의 분석을
  //          기반으로 언제까지 결석인지, 언제 픽업인지를 분류할 수 있도록 만들어줘."
  //
  // 결석 여부와 기간은 이미 출결 인박스가 쓰는 도구(categorize / extractTargetRange)로
  // 읽어낼 수 있습니다. 같은 문장을 두 화면이 다르게 읽으면 안 되므로 그 도구를 그대로
  // 씁니다 - 여기서 새 규칙을 만들면 언젠가 두 화면의 답이 달라집니다.
  //
  // "오늘부터 금요일까지"처럼 기간으로 온 것은 그 사이 평일을 모두 만들어 하루씩 처리합니다.
  const absenceOf = useCallback((r: PickupRow) => {
    const text = r.raw_text ?? "";
    if (!text) return null;
    // 결석·조퇴·병결 같은 말이 있어야 결석으로 봅니다. 픽업 연락에 "아파서"만 있는 경우까지
    // 결석으로 밀면 오히려 잘못됩니다.
    if (!/(결석|안\s*가|못\s*가|등원\s*안|쉬(어|겠|려)|병결|absent|not\s+com)/i.test(text)) return null;

    const base = new Date(r.received_at);
    const range = extractTargetRange(text, base);
    const dates: string[] = [];
    if (range) {
      const from = new Date(`${range.from}T12:00:00+09:00`);
      const to = new Date(`${range.to}T12:00:00+09:00`);
      for (let d = new Date(from); d <= to; d.setDate(d.getDate() + 1)) {
        const wd = d.getDay();
        if (wd === 0 || wd === 6) continue; // 주말은 어차피 셔틀이 없습니다.
        dates.push(d.toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" }));
      }
    }
    if (dates.length === 0) dates.push(r.service_date || todayKey(base));
    const label = dates.length === 1 ? `${dates[0].slice(5)} 하루` : `${dates[0].slice(5)} ~ ${dates[dates.length - 1].slice(5)}`;
    return { dates, label };
  }, []);

  /**
   * 결석·지각·조퇴 처리.
   *
   * 예전에는 결석만, 그것도 **AI가 결석으로 읽은 줄에서만** 누를 수 있었습니다. 토들에서
   * 오는 연락은 픽업만이 아닌데 이 화면의 선택지는 「픽업 확정」과 「픽업 아님」뿐이라,
   * 지각 연락을 받으면 여기서 할 수 있는 일이 없었습니다.
   *
   * 창구가 셔틀 체크표와 출석부를 **한 짝으로** 처리합니다 - 셔틀을 안 타는 아이도 출석부에
   * 남습니다(임주한이 「셔틀 배정이 없습니다」로 거절당하던 자리).
   */
  async function markAttendance(row: PickupRow, dates: string[], action: "결석" | "지각" | "조퇴" | "예정") {
    if (!row.matched_name) return;
    setBusy(true);
    let ok = 0;
    let refused: string | null = null;
    let lastNote: string | null = null;
    for (const d of dates) {
      const res = await fetch("/api/work/attendance-action", {
        method: "POST",
        headers: { "content-type": "application/json" },
        // **학생 번호를 함께 보냅니다.** 이름만 보내면 창구가 이름으로 배정을 찾는데,
        // 김재이가 셋이라 셋의 배정이 모두 걸려 한 번의 결석이 세 아이를 결석으로 만듭니다.
        body: JSON.stringify({
          studentId: row.student_id,
          studentName: row.matched_name,
          action,
          serviceDate: d,
          inquiryId: row.id,
          source: row.source === "googlechat" ? "구글챗" : "토들",
          // 화면이 이미 들고 있는 원문을 그대로 넘깁니다. 이 글이 곧 「왜 결석인가」이고,
          // 이 줄이 나중에 정리되면 그때는 서버도 못 찾습니다.
          reasonText: row.raw_text ?? "",
          reasonFrom: row.channel_label ?? row.sender_name ?? "",
        }),
      });
      const json = (await res.json().catch(() => null)) as { ok?: boolean; message?: string } | null;
      if (res.ok && json?.ok !== false) ok += 1;
      // 창구가 한 줄로 무엇이 됐는지 알려줍니다. 마지막 답을 그대로 사람에게 보여줍니다.
      else if (json?.message) lastNote = json.message;
      // 창구가 「누구인지 모르겠다」로 되돌려 보낸 경우. 조용히 0건으로 두면 처리된 줄 압니다.
      else if (json?.message) refused = json.message;
    }
    // 한 건도 못 했으면 인박스에서 내리지 않습니다 - 내리면 아무도 다시 안 봅니다.
    // 되돌리기(예정)는 이미 내려가 있는 줄에서 누르므로 또 내리지 않습니다.
    if (ok > 0 && action !== "예정") await call({ action: "ignore", id: row.id });
    setBusy(false);
    if (ok === 0) notify(refused ?? lastNote ?? "처리하지 못했습니다.", "error");
    else
      notify(
        ok === dates.length
          ? action === "예정"
            ? `${row.matched_name} 출결 처리를 되돌렸습니다.`
            : `${row.matched_name} ${action} ${ok}일 처리했습니다(출석부에도 남습니다).`
          : `${ok}/${dates.length}일만 처리됐습니다. ${lastNote ?? ""}`,
        ok === dates.length ? "success" : "error",
      );
    void refresh();
  }


  /**
   * **픽업도 결석도 아닌 연락을 특이사항으로 남깁니다.**
   *
   * 전에는 이런 글에 대해 「픽업 아님」밖에 없었고, 누르면 그 부탁은 어디에도 안 남았습니다.
   * 창구 한 번에 인박스에서 내리는 일과 특이사항으로 적는 일이 **함께** 일어납니다 -
   * 화면이 둘로 나눠 부르면 한쪽만 되고 다른 쪽이 실패하는 날이 옵니다.
   */
  /**
   * **한 글에 부탁이 여럿일 수 있습니다.**
   *
   * 「점심 뒤 약 먹여주세요, 그리고 갈색 후디 찾아주세요」는 할 일이 둘입니다. 한 건으로
   * 뭉쳐 적으면 종류가 하나로 정해지고(약), 후디는 약 옆에 붙은 딸린 말이 되어 아무도
   * 안 찾습니다. 시각도 하나뿐이라 약 시각에 맞추면 후디는 시각이 없는 것이 됩니다.
   *
   * **전부 저장되거나 아무것도 저장되지 않습니다.** 셋 중 둘만 들어간 채로 인박스에서
   * 내려가면, 빠진 하나는 어디에도 안 남는데 화면에는 처리된 것으로 보입니다.
   */
  async function saveNotes(row: PickupRow, forms: { kind: NoteKind; atTime: string; content: string }[]) {
    const json = await call({
      action: "note",
      id: row.id,
      studentId: row.student_id,
      notes: forms.map((f) => ({ kind: f.kind, atTime: f.atTime, content: f.content })),
      onDate: row.service_date,
    });
    if (!json) return;
    setNoteFor(null);
    const name = json.name ?? row.matched_name ?? "학생";
    notify(
      forms.length === 1
        ? `${name} · ${forms[0].kind}${forms[0].atTime ? ` ${forms[0].atTime}` : ""} 특이사항으로 남겼습니다.`
        : `${name} · 특이사항 ${forms.length}건으로 나눠 남겼습니다 (${forms.map((f) => f.kind).join("·")}).`,
      "success",
    );
    const undoNote = (json as { undoNote?: string }).undoNote;
    if (undoNote) notify(undoNote, "success");
    await refresh();
    // 학생 하루 보드(업무보드·중앙 대시보드)가 바로 받아보게 합니다.
    router.refresh();
  }

  /**
   * **오늘만 셔틀 탑승 — 픽업의 반대.**
   *
   * 평소 셔틀을 안 타는 아이가 「오늘은 셔틀로 보내주세요」라고 한 경우입니다. 지금까지는
   * 이 글이 문의로만 남고 체크표는 하원수단대로 **픽업**이었습니다 - 화면에 적힌 답이
   * 정반대라, 그대로 두면 아이가 셔틀을 못 탑니다.
   */
  async function rideShuttle(row: PickupRow) {
    const json = await call({ action: "ride-shuttle", id: row.id, studentId: row.student_id });
    if (!json) return;
    notify(
      `${json.name ?? row.matched_name ?? "학생"} — 오늘만 셔틀 탑승으로 바꿨습니다. 체크표·명단·도착체크가 함께 바뀝니다.`,
      "success",
    );
    const undoNote = (json as { undoNote?: string }).undoNote;
    if (undoNote) notify(undoNote, "success");
    await refresh();
    router.refresh();
  }

  async function confirm(row: PickupRow, studentId?: string) {
    // **시각을 함께 보냅니다.** 「하교시간보다 10분 늦어 2시 30분 도착」 같은 글은 AI가
    // 시각을 못 뽑거나 엉뚱하게 뽑습니다. 픽업에서 시각은 곧 사람이 움직이는 시점이라,
    // 없으면 보드에 「미정」으로 떠서 언제 아이를 내보낼지 모릅니다.
    const t = (timeFor[row.id] ?? "").trim();
    if (t && !isClockTime(t)) {
      notify("시각은 14:30 처럼 적어주세요.", "error");
      return;
    }
    const json = await call({ action: "confirm", id: row.id, studentId: studentId ?? row.student_id, pickupTime: t || null });
    if (!json) return;
    // 특이사항으로 잘못 넘겼던 것을 되돌린 경우, **무엇이 내려갔는지 말해줍니다.** 안 말하면
    // 담당자는 보드에 남아 있는 줄 알고 학생 하루 보드를 다시 열어 확인해야 합니다.
    const dropped = (json as { notesDropped?: number }).notesDropped ?? 0;
    notify(
      (json.applied > 0
        ? "픽업으로 체크했습니다."
        : // 셔틀을 안 타는 아이는 체크표에 줄이 안 생기는 것이 정상입니다. 그래도 **어디서
          // 봐야 하는지**를 말해줘야 체크표에서 그 아이를 찾다가 헤매지 않습니다.
          "픽업으로 확정했습니다. 셔틀 배정이 없는 학생이라 체크표에는 줄이 없고, 업무보드 [오늘 학생]에 뜹니다.") +
        (t ? ` ${t}` : "") +
        (dropped > 0 ? ` 특이사항 ${dropped}건은 함께 내렸습니다.` : ""),
      "success",
    );
    for (const p of ((json as { problems?: string[] }).problems ?? []).filter(Boolean)) notify(p, "error");
    await refresh();
  }

  async function ignore(row: PickupRow) {
    const json = await call({ action: "ignore", id: row.id });
    if (!json) return;
    await refresh();
    // 체크표·출결·업무에서도 함께 내려갑니다. **무엇이 내려갔는지 말해줍니다** - 안 말하면
    // 담당자는 다른 화면을 다시 열어 확인해야 하고, 대개 확인 안 하고 넘어갑니다.
    const note = (json as { undoNote?: string }).undoNote;
    const problems = ((json as { undo?: { problems?: string[] } }).undo?.problems ?? []).filter(Boolean);
    if (problems.length > 0) notify(problems.join(" / "), "error");
    else if (note) notify(note, "success");
  }

  return (
    <div className={compact ? "flex flex-col gap-1.5 text-[11px]" : "flex flex-col gap-2"}>
      <div className="flex flex-wrap items-center gap-1.5">
        {unread.length > 0 && (
          <button
            onClick={rereadFailed}
            disabled={busy}
            title="AI가 못 읽어서 요약·시각이 비어 있는 연락을 다시 읽습니다. 셔틀에는 자동으로 반영하지 않고, 채워 넣기만 합니다."
            className="rounded-full bg-rose-600 px-2.5 py-1 text-[11px] font-bold text-white hover:bg-rose-700 disabled:opacity-40"
          >
            🔄 AI가 못 읽은 {unread.length}건 다시 읽기
          </button>
        )}
        <button
          onClick={rematchAll}
          disabled={busy}
          title="규칙을 고친 뒤, 이미 들어와 있는 건에도 그 규칙을 적용해 다시 맞춰봅니다."
          className="ml-auto rounded-lg border border-slate-300 px-2 py-1 text-[11px] font-semibold text-slate-600 disabled:opacity-50"
        >
          🔁 규칙으로 다시 맞추기
        </button>
        <button onClick={refresh} disabled={busy} className="text-[11px] font-semibold text-slate-400">
          새로고침
        </button>
      </div>

      {pending.length === 0 ? (
        <p className="py-4 text-center text-xs text-slate-400">확인할 건이 없습니다.</p>
      ) : (
        <div className="flex flex-col gap-2">
            {pending.map((r) => (
              <div key={r.id} className={"rounded-xl border border-amber-200 bg-amber-50/50 " + (compact ? "p-2" : "p-3")}>
                <div className="mb-1 flex flex-wrap items-center gap-2">
                  <span className={"rounded px-1.5 py-0.5 text-[11px] font-bold " + (SOURCE_STYLE[r.source] ?? "bg-slate-100")}>
                    {r.source}
                  </span>
                  {r.channel_label && <span className="text-[11px] font-semibold text-slate-600">{r.channel_label}</span>}
                  {/* **이 글이 누구 것인가.** 방 이름(G3_Grace Lim_Office)만으로는 우리 명부의
                      어느 아이인지 알 수 없습니다 - 영문 이름이고, 형제가 쓰는 방도 있습니다.
                      단추에 붙은 이름은 누르기 직전에야 읽게 되므로, 줄 맨 위에 먼저 답니다. */}
                  {r.student_id ? (
                    <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[11px] font-bold text-blue-800">
                      <RowStudentName maps={whereMaps} studentId={r.student_id} name={r.matched_name} />
                    </span>
                  ) : (
                    <span
                      className="rounded-full bg-rose-100 px-2 py-0.5 text-[11px] font-bold text-rose-700"
                      title="이 글이 어느 아이 것인지 아직 정하지 않았습니다. 아래에서 학생을 연결해주세요."
                    >
                      학생 미연결
                    </span>
                  )}
                  <span className="text-[11px] text-slate-400">{hhmm(r.received_at)} 수신</span>
                  {r.ai_pickup_time && (
                    <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[11px] font-bold text-white">
                      {r.ai_pickup_time} 픽업
                    </span>
                  )}
                  {r.service_date !== todayKst() && (
                    <span className="rounded bg-violet-100 px-1.5 py-0.5 text-[11px] font-bold text-violet-700">
                      {r.service_date}
                    </span>
                  )}
                </div>

                {r.raw_text && (
                  <p className={"mb-2 rounded-lg bg-white p-2 text-xs leading-relaxed text-slate-700 " + (compact ? "line-clamp-5" : "")}>
                    {r.raw_text}
                  </p>
                )}

                {/* 반복되는 약속인지 그 자리에서 보여줍니다.
                    담당자: "Theo is pick up everyfriday 3:10! 이걸 킴태오 픽업으로 만들었더라고.
                             everyfriday 매주 금요일인데 이 부분을 무시하고 그냥 태오 픽업으로
                             넣어버렸어."
                    이건 오늘 하루짜리가 아니라 **셔틀 배정을 바꿔야 하는 일**입니다. 한 번짜리로
                    확정해버리면 다음 주 같은 요일에 아이가 그냥 차를 탑니다. */}
                {/* 형제 구분. 오는 아이를 결석으로 찍으면 그 아이가 셔틀을 못 탑니다. */}
                {siblingOf(r) && (
                  <div className="mb-2 rounded-lg border border-indigo-300 bg-indigo-50 p-2 text-[11px] leading-relaxed text-indigo-900">
                    <b>👧🧒 형제가 서로 다릅니다.</b>{" "}
                    {siblingOf(r)!.attending.length > 0 && (
                      <>
                        <b>{siblingOf(r)!.attending.join("·")}</b>은(는) <b>정상등원</b>이라고 적혀 있습니다.
                      </>
                    )}
                    {siblingOf(r)!.pick && (
                      <>
                        {" "}
                        쉬거나 데려가는 아이는 <b>{siblingOf(r)!.pick!.key}</b>({siblingOf(r)!.pick!.intent})입니다.
                      </>
                    )}{" "}
                    AI 요약이 다른 아이를 가리키고 있으면 그건 잘못 읽은 것입니다 — 원문을 보고 직접 골라주세요.
                  </div>
                )}

                {recurrenceOf(r) && (
                  <div className="mb-2 rounded-lg border border-amber-300 bg-amber-50 p-2 text-[11px] leading-relaxed text-amber-900">
                    {recurrenceOf(r)!.days.length > 0 ? (
                      <>
                        <b>🔁 매주 {weekdayLabel(recurrenceOf(r)!.days)}요일</b> 반복되는 약속으로 읽힙니다.
                        오늘 하루만 처리하면 다음 주 같은 요일에 아이가 그대로 차를 탑니다 —
                        <b> 셔틀 &gt; 탑승배정</b>에서 그 요일 체크를 풀어주세요.
                      </>
                    ) : (
                      <>
                        <b>🔁 반복되는 약속</b>으로 보이는데 요일을 읽지 못했습니다. 원문을 읽고
                        직접 정해주세요 — 하루짜리로 처리하면 다음부터는 아무 표시도 남지 않습니다.
                      </>
                    )}
                  </div>
                )}
                {/* **셔틀로 보내달라는 요청**은 규칙으로 먼저 읽습니다. AI 는 이 글을 「문의」로만
                    분류했고, 그러면 체크표는 하원수단대로 픽업으로 남습니다 - 정반대입니다. */}
                {readsShuttleRequest(r.raw_text ?? "").yes && (
                  <p className="mb-2 rounded-lg border border-lime-300 bg-lime-50 p-2 text-[11px] leading-relaxed text-lime-900">
                    <b>🚌 오늘 셔틀로 보내달라는 요청</b>으로 읽힙니다. 이 아이가 평소 셔틀을 안 타는 날이면 지금 체크표에는
                    <b> 픽업</b>으로 적혀 있습니다 — 아래 [🚌 오늘 셔틀]을 누르면 오늘 하루만 탑승으로 바뀝니다.
                  </p>
                )}
                {r.ai_note && <p className="mb-2 text-[11px] text-slate-500">AI: {r.ai_note}</p>}

                {/* 결석으로 읽히는 연락. 담당자: "AI가 결석으로 체크한 부분인데도 픽업이냐
                    아니냐밖에 선택을 못해."
                    맞는 지적입니다. 학부모 연락은 픽업만 오는 게 아닌데 이 화면의 선택지는
                    둘뿐이었습니다. 결석이면 결석으로, 며칠짜리면 그 기간만큼 처리해야 합니다. */}
                {absenceOf(r) && (
                  <div className="mb-2 rounded-lg border border-rose-200 bg-rose-50 p-2">
                    <p className="mb-1.5 text-[11px] font-bold text-rose-700">
                      🚫 결석으로 읽힙니다 — {absenceOf(r)!.label}
                    </p>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {absenceOf(r)!.dates.map((d) => (
                        <span key={d} className="rounded bg-white px-1.5 py-0.5 text-[10px] font-semibold text-rose-700">
                          {d.slice(5)}
                        </span>
                      ))}
                      <button
                        onClick={() => markAttendance(r, absenceOf(r)!.dates, "결석")}
                        disabled={busy || !r.matched_name}
                        title={r.matched_name ? undefined : "먼저 학생을 연결해주세요."}
                        className="ml-auto rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-40"
                      >
                        결석 {absenceOf(r)!.dates.length}일 처리
                      </button>
                    </div>
                  </div>
                )}

                <div className="flex flex-wrap items-center gap-1.5">
                  {/* 137명 목록을 눈으로 훑는 대신 검색합니다(담당자 요청). AI가 읽은 이름을
                      미리 넣어두므로 대개 열자마자 좁혀져 있습니다. */}
                  <StudentPicker
                    students={students}
                    disabled={busy}
                    label={r.student_id ? "학생 바꾸기" : "학생 연결"}
                    autoFocusQuery={(r.ai_student_name ?? "").replace(/\(.*$/, "").trim()}
                    onPick={(s) => confirm(r, s.id)}
                  />
                  {r.student_id && (
                    <>
                      {/* **시각을 여기서 넣습니다.** 확정과 같은 줄에 두어야 「몇 시?」를
                          떠올린 그 자리에서 적습니다 - 다른 화면으로 건너가게 하면 대개
                          안 적고 넘어가고, 그 아이는 「미정」으로 남습니다. */}
                      <input
                        value={timeFor[r.id] ?? r.ai_pickup_time ?? ""}
                        onChange={(e) => setTimeFor((v) => ({ ...v, [r.id]: e.target.value }))}
                        placeholder="14:30"
                        title="몇 시에 데리러 오는지. 비워두면 「미정」으로 뜹니다."
                        className={
                          "w-16 shrink-0 rounded-lg border text-center tabular-nums " +
                          btn +
                          " " +
                          ((timeFor[r.id] ?? "").trim() !== "" && !isClockTime((timeFor[r.id] ?? "").trim())
                            ? "border-rose-400 bg-rose-50"
                            : "border-slate-300")
                        }
                      />
                      <button
                        onClick={() => confirm(r)}
                        disabled={busy}
                        className={"rounded-lg bg-blue-600 font-bold text-white disabled:opacity-50 " + btn}
                      >
                        <RowStudentName maps={whereMaps} studentId={r.student_id} name={r.matched_name} markClassName="!bg-white/25 !text-white" />{" "}
                        픽업 확정
                      </button>
                      {/* **픽업만 고를 수 있으면 안 됩니다.** 토들에서 오는 연락은 결석·지각일
                          수도 있는데, 이 화면에는 픽업이냐 아니냐밖에 없었습니다. AI가 결석으로
                          읽어준 줄에는 위에 기간까지 붙은 단추가 따로 뜨고, 여기 둘은 **못 읽었을
                          때도** 사람이 직접 고를 수 있게 둡니다. */}
                      <button
                        onClick={() => markAttendance(r, [r.service_date || todayKey(new Date())], "결석")}
                        disabled={busy}
                        className={"rounded-lg bg-rose-600 font-bold text-white disabled:opacity-50 " + btn}
                        title="그날 결석으로 처리합니다. 셔틀 체크표와 출석부에 함께 남습니다."
                      >
                        결석
                      </button>
                      <button
                        onClick={() => markAttendance(r, [r.service_date || todayKey(new Date())], "지각")}
                        disabled={busy}
                        className={"rounded-lg bg-amber-500 font-bold text-white disabled:opacity-50 " + btn}
                        title="그날 지각으로 출석부에 남깁니다. 하원 셔틀은 그대로 탑니다."
                      >
                        지각
                      </button>
                      {/* **픽업·결석·지각 어디에도 안 들어가는 연락이 많습니다.**
                          「약 좀 챙겨주세요」·「오늘 결제할게요」에 대해 이 화면이 할 수 있는
                          일은 「픽업 아님」뿐이었고, 그러면 그 부탁은 아무 데도 안 남았습니다. */}
                      {/* **픽업의 반대 갈래.** 하원수단이 셔틀이 아닌 아이에게 「오늘은
                          셔틀로」가 오면, 픽업으로 찍힌 오늘 줄을 탑승으로 되돌려야 합니다. */}
                      <button
                        onClick={() => rideShuttle(r)}
                        disabled={busy}
                        className={"rounded-lg bg-lime-600 font-bold text-white disabled:opacity-50 " + btn}
                        title="오늘만 셔틀을 타게 합니다. 하원수단(학원차 등)은 이번 주 오늘만 셔틀로 덮이고, 다음 주에는 원래대로 돌아갑니다."
                      >
                        🚌 오늘 셔틀
                      </button>
                      <button
                        onClick={() => setNoteFor((v) => (v === r.id ? null : r.id))}
                        disabled={busy}
                        className={
                          "rounded-lg font-bold disabled:opacity-50 " + btn + " " +
                          (noteFor === r.id ? "bg-slate-800 text-white" : "bg-violet-600 text-white")
                        }
                        title="픽업이 아니라 약·결제·준비물 같은 부탁입니다. 학생 하루 보드에 남깁니다."
                      >
                        📌 특이사항
                      </button>
                    </>
                  )}
                  {/* **「픽업 아님」은 하는 일보다 좁게 말했습니다.** 이 단추는 픽업이
                      아니라고만 하는 것이 아니라 그 글을 **아무 일도 아닌 것으로 내립니다** -
                      인사·광고·잘못 온 글입니다. 이름이 좁으면 약·준비물 부탁까지 여기로
                      내려보내게 됩니다. */}
                  <button
                    onClick={() => ignore(r)}
                    disabled={busy}
                    title="인사·광고처럼 처리할 일이 없는 글입니다. 잘못 눌렀으면 아래 접힌 목록에서 되돌립니다."
                    className="ml-auto rounded-lg border border-slate-300 px-2 py-1.5 text-[11px] font-semibold text-slate-500"
                  >
                    문의사항이 아님
                  </button>
                </div>

                {noteFor === r.id && r.student_id && (
                  <NotesBox row={r} busy={busy} onCancel={() => setNoteFor(null)} onSave={(fs) => saveNotes(r, fs)} />
                )}
              </div>
            ))}
        </div>
      )}
    </div>
  );
}

/**
 * **특이사항 적는 칸 — 한 글에서 여러 건.**
 *
 * 원문을 규칙으로 나눠 미리 채웁니다(`splitNotes`). 나눈 결과가 틀릴 수 있으므로 줄마다
 * 지우기가 있고, 놓친 것이 있으면 [+ 한 건 더]로 더합니다. **저장은 사람이 누를 때만**
 * 일어납니다 - 짐작한 값을 그대로 저장하는 자리는 이 저장소에서 매번 사고가 났습니다.
 */
function NotesBox({
  row,
  busy,
  onCancel,
  onSave,
}: {
  row: PickupRow;
  busy: boolean;
  onCancel: () => void;
  onSave: (forms: { kind: NoteKind; atTime: string; content: string }[]) => void;
}) {
  const guessed = useMemo<NoteDraft[]>(() => splitNotes(row.raw_text ?? ""), [row.raw_text]);
  const [items, setItems] = useState<{ kind: NoteKind; atTime: string; content: string }[]>(() =>
    guessed.map((d, i) => ({
      kind: d.kind,
      // 픽업 시각으로 읽힌 값이 있으면 **첫 줄에만** 씁니다 - 같은 문장을 AI가 이미 한 번
      // 읽었고, 두 번째 부탁까지 그 시각으로 채우면 엉뚱한 시각에 알람이 울립니다.
      atTime: d.atTime || (i === 0 ? row.ai_pickup_time?.slice(0, 5) || "" : ""),
      content: d.content,
    })),
  );

  function edit(i: number, patch: Partial<{ kind: NoteKind; atTime: string; content: string }>) {
    setItems((prev) => prev.map((it, n) => (n === i ? { ...it, ...patch } : it)));
  }

  const bad = items.some((it) => it.atTime.trim() !== "" && !isClockTime(it.atTime.trim()));
  const ready = items.filter((it) => it.content.trim());

  return (
    <div className="mt-2 rounded-lg border border-violet-300 bg-violet-50 p-2.5">
      <p className="mb-1.5 text-[11px] font-bold text-violet-800">
        📌 {row.service_date} · 특이사항으로 남기기
        <span className="ml-1 font-normal text-violet-500">
          {guessed.length > 1
            ? `— 한 글에 부탁이 ${guessed.length}가지로 읽혀 나눠 담았습니다. 맞는지 보고 고쳐주세요.`
            : "— 종류와 시각은 원문에서 짐작해 채웠습니다. 맞는지 보고 고쳐주세요."}
        </span>
      </p>

      <div className="flex flex-col gap-2">
        {items.map((it, i) => (
          <div key={i} className="rounded-lg bg-white/70 p-2 ring-1 ring-violet-200">
            <div className="mb-1.5 flex flex-wrap items-center gap-1">
              {items.length > 1 && (
                <span className="rounded bg-violet-700 px-1.5 py-0.5 text-[10px] font-bold text-white">{i + 1}</span>
              )}
              {NOTE_KINDS.map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => edit(i, { kind: k })}
                  className={
                    "rounded-full px-2 py-1 text-[11px] font-bold " +
                    (it.kind === k ? "bg-violet-700 text-white" : "bg-white text-slate-600 ring-1 ring-slate-300")
                  }
                >
                  {KIND_LOOK[k].icon} {k}
                </button>
              ))}
              <input
                value={it.atTime}
                onChange={(e) => edit(i, { atTime: e.target.value })}
                placeholder="14:30"
                inputMode="numeric"
                className={
                  "ml-1 w-[72px] rounded-lg border px-2 py-1 text-[12px] " +
                  (it.atTime.trim() !== "" && !isClockTime(it.atTime.trim())
                    ? "border-red-400 bg-red-50 text-red-700"
                    : "border-slate-300")
                }
                title="시각은 없어도 됩니다. 적으면 그 시각에 중앙 대시보드가 알립니다."
              />
              <span className="text-[10px] text-violet-500">{it.atTime ? "그 시각에 알립니다" : "시각 없음 = 오늘 중에"}</span>
              {/* 나눈 결과가 틀릴 수 있으므로 **그 자리에서 지웁니다.** 지우려고 창을 닫았다
                  다시 열게 하면, 사람은 그냥 한 건으로 몰아 적습니다. */}
              {items.length > 1 && (
                <button
                  type="button"
                  onClick={() => setItems((prev) => prev.filter((_, n) => n !== i))}
                  className="ml-auto rounded-lg border border-slate-300 px-2 py-1 text-[11px] font-semibold text-slate-500"
                  title="이 줄은 특이사항으로 남기지 않습니다."
                >
                  이 줄 빼기
                </button>
              )}
            </div>
            <textarea
              value={it.content}
              onChange={(e) => edit(i, { content: e.target.value.slice(0, 300) })}
              rows={2}
              placeholder="예) 점심 뒤 감기약 한 봉 먹여주세요"
              className="w-full rounded-lg border border-slate-300 p-2 text-xs"
            />
          </div>
        ))}
      </div>

      <div className="mt-1.5 flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => setItems((prev) => [...prev, { kind: "기타", atTime: "", content: "" }])}
          className="rounded-lg border border-violet-300 px-2 py-1.5 text-[11px] font-semibold text-violet-700"
          title="규칙이 못 나눈 부탁이 더 있으면 여기에 적습니다."
        >
          + 한 건 더
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="ml-auto rounded-lg border border-slate-300 px-2.5 py-1.5 text-[11px] font-semibold text-slate-500"
        >
          취소
        </button>
        <button
          type="button"
          disabled={busy || ready.length === 0 || bad}
          onClick={() => onSave(ready.map((it) => ({ ...it, atTime: it.atTime.trim(), content: it.content.trim() })))}
          className="rounded-lg bg-violet-700 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-40"
          title={bad ? "시각은 14:30 처럼 적어주세요." : "학생 하루 보드에 남기고 인박스에서 내립니다."}
        >
          {ready.length > 1 ? `특이사항 ${ready.length}건으로 남기기` : "특이사항으로 남기기"}
        </button>
      </div>
    </div>
  );
}
