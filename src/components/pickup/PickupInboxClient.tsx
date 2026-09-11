"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { todayKst } from "@/lib/kst";
import { useToast } from "@/components/common/ToastProvider";
import UpcomingPickups, { type ScheduleRow } from "@/components/pickup/UpcomingPickups";
import StudentPicker from "@/components/pickup/StudentPicker";
import { createClient } from "@/lib/supabase/client";
import { parseChannelLabel, type RosterEntry } from "@/lib/pickupParse";
import { buildAliasIndex, resolveStudent, type AliasRule } from "@/lib/studentMatch";
import { buildWhereMaps, RowStudentName } from "@/lib/studentLabel";
import { nameSurfaces, readSiblings } from "@/lib/attendanceIntent";
import { extractTargetRange, todayKey } from "@/lib/attendanceDigest";
import { extractRecurringWeekdays, hasRecurringPhrase, weekdayLabel } from "@/lib/parentRecurrence";

// 픽업 인박스. 토들·전화·교사·직접입력 어디로 들어왔든 여기 한 곳에 모입니다.
//
// 화면 설계의 원칙: 담당자가 하원 준비를 하면서 휴대폰으로 볼 화면이라, 지금 손댈 것(확인 대기)만
// 크게 보이고 나머지는 아래로 밀어둡니다. 이미 처리된 건을 스크롤로 지나쳐야 대기 건에 닿는
// 구조면 바쁠 때 안 쓰게 됩니다.

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

export default function PickupInboxClient({
  initialRows,
  students,
  collector,
  schedules,
}: {
  initialRows: PickupRow[];
  students: StudentOption[];
  collector: { last_seen_at: string; status: string | null; detail: string | null } | null;
  schedules: ScheduleRow[];
}) {
  const notify = useToast();
  const router = useRouter();
  const [rows, setRows] = useState(initialRows);
  const [busy, setBusy] = useState(false);
  const [manual, setManual] = useState("");
  const [manualSource, setManualSource] = useState<"전화" | "교사" | "직접입력">("전화");
  const [showDone, setShowDone] = useState(false);

  const pending = useMemo(() => rows.filter((r) => r.status === "확인대기"), [rows]);
  /** AI가 못 읽어서 요약·시각이 비어 있는 줄. 원문은 남아 있어 다시 읽을 수 있습니다. */
  const unread = useMemo(() => rows.filter((r) => (r.ai_note ?? "").startsWith("AI 판단에 실패")), [rows]);

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
  // ── 오늘 픽업: 한 아이는 한 칸 ────────────────────────────────────────────
  //
  // 같은 아이의 연락이 여러 번 오면(어머님이 한 번, 아버님이 한 번, 또 정정 한 번) 확정 줄도
  // 여러 개가 됩니다. 그대로 그리면 「오늘 픽업 12명」인데 실제로는 8명이고, **차에 몇
  // 자리가 비는지 세는 숫자가 틀립니다.**
  //
  // **묶는 열쇠는 학생 번호입니다.** 이름으로 묶으면 김재이·심재이·유재이가 한 칸이 되어,
  // 셋 중 둘이 화면에서 사라집니다 - 지우려고 만든 기능이 아이를 지우게 됩니다. 번호가
  // 아직 없는 줄(학생을 못 이은 연락)은 저마다 따로 둡니다. 누구인지 모르는 것끼리 묶을
  // 수는 없습니다.
  const confirmed = useMemo(() => {
    const groups = new Map<string, PickupRow[]>();
    for (const r of rows) {
      if (r.status !== "확정") continue;
      const key = r.student_id ?? `미연결:${r.id}`;
      (groups.get(key) ?? groups.set(key, []).get(key)!).push(r);
    }
    return [...groups.values()]
      .map((list) => {
        // 시각은 적힌 것 중 가장 이른 것을 대표로 하고, 서로 다르면 함께 보여줍니다.
        // 하나만 보여주면 「4시라고 했는데 3시에 오셨다」가 됩니다.
        const times = [...new Set(list.map((r) => r.ai_pickup_time).filter((t): t is string => !!t))].sort();
        return { head: list[0], all: list, times };
      })
      .sort((a, b) => (a.times[0] ?? "99").localeCompare(b.times[0] ?? "99"));
  }, [rows]);
  const ignored = useMemo(() => rows.filter((r) => r.status === "무시" && r.raw_text), [rows]);

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
    const json = await call({ action: "list" });
    if (json?.rows) setRows(json.rows as PickupRow[]);
  }

  // ── 규칙으로 다시 맞춰보기 ──────────────────────────────────────────────
  //
  // 담당자: "픽업 인박스에서 아직도 jay kim(190828) 연결 못해."
  //
  // 매칭 규칙은 고쳤는데 **이미 저장된 줄에는 소용이 없습니다.** 학생 연결은 들어오는 순간
  // 한 번만 하고 그 결과가 남기 때문입니다. 규칙을 고칠 때마다 사람이 손으로 다시 이어주는
  // 것은 말이 안 되니, 지금 규칙으로 다시 훑는 단추를 둡니다.
  //
  // 대조는 화면에서 합니다(명부가 이미 여기 있습니다). 한 명으로 확정된 것만 저장하고,
  // 애매한 것은 그대로 둡니다 - 조용히 엉뚱한 아이에게 붙는 것이 가장 나쁩니다.
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

  async function confirm(row: PickupRow, studentId?: string) {
    const json = await call({ action: "confirm", id: row.id, studentId: studentId ?? row.student_id });
    if (!json) return;
    notify(json.applied > 0 ? "픽업으로 체크했습니다." : "확정했습니다(셔틀 배정이 없는 학생입니다).", "success");
    await refresh();
  }

  async function ignore(row: PickupRow) {
    const json = await call({ action: "ignore", id: row.id });
    if (!json) return;
    setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, status: "무시" } : r)));
    // 체크표·출결·업무에서도 함께 내려갑니다. **무엇이 내려갔는지 말해줍니다** - 안 말하면
    // 담당자는 다른 화면을 다시 열어 확인해야 하고, 대개 확인 안 하고 넘어갑니다.
    const note = (json as { undoNote?: string }).undoNote;
    const problems = ((json as { undo?: { problems?: string[] } }).undo?.problems ?? []).filter(Boolean);
    if (problems.length > 0) notify(problems.join(" / "), "error");
    else if (note) notify(note, "success");
  }

  async function submitManual() {
    if (!manual.trim()) return;
    const json = await call({ action: "manual", text: manual, source: manualSource });
    if (!json) return;
    const found = (json.results as { isPickup: boolean }[]).filter((r) => r.isPickup).length;
    notify(found > 0 ? `픽업 ${found}건을 찾았습니다.` : "픽업으로 볼 내용이 없었습니다.", found > 0 ? "success" : "error");
    setManual("");
    await refresh();
  }

  // 수집기가 10분 넘게 조용하면 경고합니다. 조용히 멈춰서 그날 픽업을 통째로 놓치는 것이
  // 이 시스템의 가장 나쁜 실패입니다.
  const collectorStale =
    !collector || Date.now() - new Date(collector.last_seen_at).getTime() > 10 * 60 * 1000 || collector.status !== "ok";

  return (
    <div className="flex flex-col gap-4">
      {/* 수집기 상태 */}
      <div
        className={
          "rounded-xl border p-3 text-xs " +
          (collectorStale ? "border-red-200 bg-red-50 text-red-700" : "border-emerald-200 bg-emerald-50 text-emerald-700")
        }
      >
        {collectorStale ? (
          <>
            <b>⚠️ 토들 수집기가 멈춰 있습니다.</b>{" "}
            {collector?.status === "login_required"
              ? "사무실 PC에서 토들에 다시 로그인해주세요."
              : collector
              ? `마지막 신호 ${new Date(collector.last_seen_at).toLocaleString("ko-KR")}`
              : "아직 한 번도 연결된 적이 없습니다."}
            <div className="mt-1 leading-relaxed text-red-600">
              지금은 토들 메시지가 자동으로 들어오지 않습니다. 고칠 때까지는 토들을 직접 확인하시고, 아래 [손으로 접수]에
              붙여넣어 주세요.
            </div>
          </>
        ) : (
          <>✓ 토들 수집기 정상 · 마지막 신호 {hhmm(collector.last_seen_at)}</>
        )}
      </div>

      {/* 담당자: "픽업 인박스가 화면을 너무 좁게 써. 넓게 써서 한눈에 볼 수 있게."
          넓은 화면에서는 왼쪽에 **손이 가는 것**(확인이 필요한 픽업), 오른쪽에 **눈으로
          보는 것**(예정·오늘 확정·손접수)을 둡니다. 예전에는 이 다섯 덩어리가 한 줄로
          쌓여 있어서, 확인할 건을 처리하다 오늘 확정 명단을 보려면 스크롤을 내렸다
          올렸다 해야 했습니다. 좁은 화면(폰)에서는 원래대로 위아래로 쌓입니다. */}
      <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
      <div className="flex flex-col gap-4">
      {/* 확인이 필요한 건 */}
      <section className="g-panel-solid p-4 shadow-sm">
        <div className="mb-1 flex flex-wrap items-center gap-2">
          <h2 className="text-sm font-bold text-slate-800">확인이 필요한 픽업</h2>
          {pending.length > 0 ? (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-700">{pending.length}건</span>
          ) : (
            <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-bold text-emerald-700">없음</span>
          )}
          {/* AI가 못 읽은 건이 있으면 그것부터 알려줍니다.
              결제가 막히거나 연결이 끊기면 그 사이 연락이 **전부** 안 읽힌 채로 쌓입니다.
              요약도 없이 원문만 있는 줄이라 사람이 하나씩 열어봐야 하는데, 바쁜 하원 시간에
              그걸 다 읽는 사람은 없습니다. 안 읽은 것은 없는 것과 같습니다. */}
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
        <p className="mb-3 text-[11px] leading-relaxed text-slate-400">
          AI가 픽업으로 봤지만 확신이 부족하거나, 학생을 명부에서 하나로 특정하지 못한 건입니다. 형제 자매 방에서 누구인지
          안 적혀 있으면 여기로 옵니다.
        </p>

        {pending.length === 0 ? (
          <p className="py-4 text-center text-xs text-slate-400">확인할 건이 없습니다.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {pending.map((r) => (
              <div key={r.id} className="rounded-xl border border-amber-200 bg-amber-50/50 p-3">
                <div className="mb-1 flex flex-wrap items-center gap-2">
                  <span className={"rounded px-1.5 py-0.5 text-[11px] font-bold " + (SOURCE_STYLE[r.source] ?? "bg-slate-100")}>
                    {r.source}
                  </span>
                  {r.channel_label && <span className="text-[11px] font-semibold text-slate-600">{r.channel_label}</span>}
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

                {r.raw_text && <p className="mb-2 rounded-lg bg-white p-2 text-xs leading-relaxed text-slate-700">{r.raw_text}</p>}

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
                      <button
                        onClick={() => confirm(r)}
                        disabled={busy}
                        className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50"
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
                        className="rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50"
                        title="그날 결석으로 처리합니다. 셔틀 체크표와 출석부에 함께 남습니다."
                      >
                        결석
                      </button>
                      <button
                        onClick={() => markAttendance(r, [r.service_date || todayKey(new Date())], "지각")}
                        disabled={busy}
                        className="rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50"
                        title="그날 지각으로 출석부에 남깁니다. 하원 셔틀은 그대로 탑니다."
                      >
                        지각
                      </button>
                    </>
                  )}
                  <button
                    onClick={() => ignore(r)}
                    disabled={busy}
                    className="ml-auto rounded-lg border border-slate-300 px-2 py-1.5 text-[11px] font-semibold text-slate-500"
                  >
                    픽업 아님
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* 픽업이 아니라고 판단한 건 - 접어둡니다. 확인이 필요한 건 바로 아래가 제자리입니다
          ("사실은 픽업"으로 되돌리는 곳이라 같은 손놀림에 속합니다). */}
      {ignored.length > 0 && (
        <section className="g-panel-solid p-4 shadow-sm">
          <button onClick={() => setShowDone((v) => !v)} className="text-xs font-bold text-slate-500">
            {showDone ? "▾" : "▸"} 픽업이 아니라고 본 건 · 출결로 처리한 건 {ignored.length}개
          </button>
          {showDone && (
            <div className="mt-2 flex flex-col gap-1.5">
              {ignored.map((r) => (
                <div key={r.id} className="flex flex-wrap items-center gap-2 rounded-lg bg-slate-50 p-2 text-[11px] text-slate-500">
                  <span>
                    <span className="font-semibold">{r.channel_label ?? r.source}</span> · {r.raw_text}
                  </span>
                  <button onClick={() => confirm(r)} className="font-bold text-blue-600">
                    사실은 픽업
                  </button>
                  {/* **잘못 누른 것을 되돌리는 자리.**
                      결석·지각으로 처리한 건은 여기로 내려옵니다. 그런데 되돌릴 길이 없으면
                      사람은 셔틀 체크표와 출석부를 각각 찾아가 지워야 하고, 한쪽만 지우면
                      다른 화면에 그대로 살아 있습니다. 자동으로 넣은 줄만 지웁니다 - 담임이
                      직접 찍은 줄은 건드리지 않습니다. */}
                  {r.student_id && (
                    <button
                      onClick={() => markAttendance(r, [r.service_date || todayKey(new Date())], "예정")}
                      disabled={busy}
                      className="font-bold text-rose-600 disabled:opacity-40"
                      title="이 건으로 넣은 셔틀 체크와 출석부 기록을 지웁니다. 담임이 직접 찍은 기록은 그대로 둡니다."
                    >
                      출결 되돌리기
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
      )}
      </div>

      {/* 오른쪽: 눈으로 보는 것 */}
      <div className="flex flex-col gap-4">
      {/* 앞으로 예정된 픽업 - 오늘 것만 보면 "이번주 목금" 같은 예약을 놓칩니다 */}
      <UpcomingPickups initialRows={schedules} />

      {/* 오늘 확정된 픽업 */}
      <section className="g-panel-solid p-4 shadow-sm">
        <h2 className="mb-2 text-sm font-bold text-slate-800">오늘 픽업 {confirmed.length}명</h2>
        {confirmed.length === 0 ? (
          <p className="py-3 text-center text-xs text-slate-400">아직 없습니다.</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {confirmed.map(({ head: r, all, times }) => (
              <span
                key={r.id}
                title={`${all.map((x) => `${x.source} · ${x.resolved_by === "AI" ? "자동" : x.resolved_by ?? ""}`).join("\n")}`}
                className="inline-flex items-center gap-1.5 rounded-lg border-l-4 border-sky-500 bg-slate-50 py-1.5 pl-2.5 pr-1.5 text-sm font-bold text-slate-800"
              >
                <RowStudentName maps={whereMaps} studentId={r.student_id} name={r.matched_name ?? r.ai_student_name} />
                {times.length > 0 && <span className="text-[11px] font-semibold text-sky-600">{times.join("·")}</span>}
                {/* 연락이 여러 번 온 아이. 몇 번인지 적어두면 「왜 하나로 보이지」를 묻지
                    않아도 되고, 시각이 서로 다르면 위에 둘 다 떠 있습니다. */}
                {all.length > 1 && (
                  <span className="rounded-full bg-slate-200 px-1.5 text-[10px] font-bold text-slate-600" title={`연락 ${all.length}건이 같은 아이입니다`}>
                    연락 {all.length}
                  </span>
                )}
                {all.every((x) => x.resolved_by === "AI") && <span className="text-[10px] font-semibold text-emerald-600">자동</span>}
                {/* ── 확정된 것도 내릴 수 있어야 합니다 ────────────────────────
                    이 목록은 지금까지 **보기만** 하는 자리였습니다. 그런데 자동으로 확정된
                    건이 틀리는 일이 실제로 있고(강하라), 틀린 줄 하나 때문에 인박스 위쪽
                    「확인 대기」로 되돌아가 찾을 수가 없었습니다 - 확정된 건은 거기 없습니다.
                    내리면 체크표·출결·업무의 자국도 함께 내려갑니다(undoPickupTraces). */}
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    // **되묻지 않습니다.** 자료가 여러 표에 걸쳐 있는 것은 시스템 사정이지
                    // 누르는 사람의 사정이 아닙니다. 무엇이 함께 내려갔는지는 누른 뒤에
                    // 알림 한 줄로 알려줍니다(`undoNote`) - 묻는 것보다 알려주는 편이 낫습니다.
                    // 묶어서 보여준 것은 묶어서 내립니다. 한 줄만 내리면 화면에서는 사라졌는데
                    // 남은 줄이 그대로 살아 있어, 새로고침하면 다시 나타납니다.
                    void (async () => {
                      for (const x of all) await ignore(x);
                    })();
                  }}
                  className="rounded px-1 text-[12px] font-bold text-slate-300 hover:bg-red-50 hover:text-red-500 disabled:opacity-40"
                  aria-label="픽업 내리기"
                  title="픽업이 아니었습니다 — 체크표·출결·업무에서 함께 내립니다"
                >
                  ✕
                </button>
              </span>
            ))}
          </div>
        )}
      </section>

      {/* 손으로 접수 */}
      <section className="g-panel-solid p-4 shadow-sm">
        <h2 className="mb-1 text-sm font-bold text-slate-800">손으로 접수</h2>
        <p className="mb-2 text-[11px] leading-relaxed text-slate-400">
          전화로 받은 내용, 선생님이 전달해주신 내용을 그대로 붙여넣으면 AI가 학생과 시각을 찾아냅니다. 여러 건이면 사이를 한
          줄 띄워주세요.
        </p>
        <div className="mb-2 flex gap-1.5">
          {(["전화", "교사", "직접입력"] as const).map((s) => (
            <button
              key={s}
              onClick={() => setManualSource(s)}
              className={
                "rounded-lg px-2.5 py-1 text-[11px] font-bold " +
                (manualSource === s ? "bg-slate-800 text-white" : "bg-slate-100 text-slate-500")
              }
            >
              {s}
            </button>
          ))}
        </div>
        <textarea
          value={manual}
          onChange={(e) => setManual(e.target.value)}
          rows={4}
          placeholder="예) 김서준 어머니 전화, 오늘 3시 반에 데리러 오신다고 하심"
          className="w-full rounded-lg border border-slate-300 p-2.5 text-sm"
        />
        <button
          onClick={submitManual}
          disabled={busy || !manual.trim()}
          className="mt-2 w-full rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50"
        >
          접수하기
        </button>
      </section>
      </div>
      </div>
    </div>
  );
}
