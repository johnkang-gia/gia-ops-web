"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { todayKst } from "@/lib/kst";
import { useToast } from "@/components/common/ToastProvider";
import UpcomingPickups, { type ScheduleRow } from "@/components/pickup/UpcomingPickups";
import PickupTriage from "@/components/pickup/PickupTriage";
import { createClient } from "@/lib/supabase/client";
import { parseChannelLabel, type RosterEntry } from "@/lib/pickupParse";
import { buildAliasIndex, resolveStudent, type AliasRule } from "@/lib/studentMatch";
import { buildWhereMaps, RowStudentName } from "@/lib/studentLabel";
import { nameSurfaces, readSiblings } from "@/lib/attendanceIntent";
import { extractTargetRange, todayKey } from "@/lib/attendanceDigest";
import { extractRecurringWeekdays, hasRecurringPhrase, weekdayLabel } from "@/lib/parentRecurrence";
import { guessNote, isClockTime, KIND_LOOK, NOTE_KINDS, type NoteKind } from "@/lib/studentDayNotes";
import { readsShuttleRequest } from "@/lib/shuttleRequest";

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

  /** 아직 판단이 안 난 줄. 판단은 `PickupTriage` 한 곳에서만 합니다. */
  const pending = useMemo(() => rows.filter((r) => r.status === "확인대기"), [rows]);
  /** 특이사항 폼이 열려 있는 줄. 한 번에 하나만 엽니다 - 여럿 열리면 어느 칸에 적는지 헷갈립니다. */
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

  // 이름 옆에 반을 붙이는 표. 김재이가 셋이라 이름만으로는 어느 아이인지 알 수 없습니다.
  const whereMaps = useMemo(() => buildWhereMaps(rosterForMatch), [rosterForMatch]);

  /**
   * 출결 처리를 **되돌립니다**(「예정」). 확인이 필요한 줄의 결석·지각은
   * `PickupTriage` 가 처리하고, 여기 남은 것은 이미 내려간 줄을 되살리는 길뿐입니다 -
   * 같은 일을 두 화면이 각자 적어두면 한쪽만 고쳐지는 날이 옵니다.
   */
  async function markAttendance(row: PickupRow, dates: string[], action: "결석" | "지각" | "조퇴" | "예정") {
    if (!row.matched_name) return;
    setBusy(true);
    let ok = 0;
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
          reasonText: row.raw_text ?? "",
          reasonFrom: row.channel_label ?? row.sender_name ?? "",
        }),
      });
      const json = (await res.json().catch(() => null)) as { ok?: boolean; message?: string } | null;
      if (res.ok && json?.ok !== false) ok += 1;
      // 창구가 한 줄로 무엇이 됐는지 알려줍니다. 마지막 답을 그대로 사람에게 보여줍니다.
      else if (json?.message) lastNote = json.message;
    }
    // 한 건도 못 했으면 인박스에서 내리지 않습니다 - 내리면 아무도 다시 안 봅니다.
    // 되돌리기(예정)는 이미 내려가 있는 줄에서 누르므로 또 내리지 않습니다.
    if (ok > 0 && action !== "예정") await call({ action: "ignore", id: row.id });
    setBusy(false);
    if (ok === 0) notify(lastNote ?? "처리하지 못했습니다.", "error");
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
    // 특이사항으로 잘못 넘겼던 것을 되돌린 경우, **무엇이 내려갔는지 말해줍니다.** 안 말하면
    // 담당자는 보드에 남아 있는 줄 알고 학생 하루 보드를 다시 열어 확인해야 합니다.
    const dropped = (json as { notesDropped?: number }).notesDropped ?? 0;
    notify(
      (json.applied > 0 ? "픽업으로 체크했습니다." : "확정했습니다(셔틀 배정이 없는 학생입니다).") +
        (dropped > 0 ? ` 특이사항 ${dropped}건은 함께 내렸습니다.` : ""),
      "success",
    );
    for (const p of ((json as { problems?: string[] }).problems ?? []).filter(Boolean)) notify(p, "error");
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
      {/* 확인이 필요한 건. **판단하는 자리는 한 곳입니다**(PickupTriage) - 업무보드 인박스도
          같은 덩어리를 씁니다. 단추가 여섯이고 그 중 넷이 되돌릴 수 없는 일이라, 화면을
          두 벌 두면 한쪽에만 고친 단추가 생기고 그건 오류가 아니라 다른 답으로 보입니다. */}
      <section className="g-panel-solid p-4 shadow-sm">
        <div className="mb-1 flex flex-wrap items-center gap-2">
          <h2 className="text-sm font-bold text-slate-800">확인이 필요한 픽업</h2>
          {pending.length > 0 ? (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-700">{pending.length}건</span>
          ) : (
            <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-bold text-emerald-700">없음</span>
          )}
        </div>
        <p className="mb-3 text-[11px] leading-relaxed text-slate-400">
          AI가 픽업으로 봤지만 확신이 부족하거나, 학생을 명부에서 하나로 특정하지 못한 건입니다. 형제 자매 방에서 누구인지
          안 적혀 있으면 여기로 옵니다.
        </p>
        <PickupTriage
          rows={pending}
          students={students}
          onChanged={async () => {
            await refresh();
            router.refresh();
          }}
        />
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

/**
 * **특이사항으로 확정하는 칸.**
 *
 * ── 왜 AI가 채워두고 사람이 고치나 ─────────────────────────────────────────
 *
 * 종류와 시각을 빈칸으로 두면, 바쁜 하원 시간에 담당자는 세 칸을 채우느니 「픽업 아님」을
 * 누릅니다. 그러면 이 칸은 있으나 마나입니다.
 *
 * 그렇다고 짐작한 값을 바로 저장하지도 않습니다 - 이 저장소에서 짐작해 붙인 자리는 매번
 * 사고가 났습니다(CLAUDE.md §2-4-1). **미리 채워두되 저장은 사람이 누를 때** 일어나고,
 * 무엇을 짐작했는지 화면에 적어 고칠 거리를 사람이 알아보게 합니다.
 *
 * 내용은 원문 그대로 시작합니다. 요약하면 「왜 이 줄이 있는가」가 사라지고, 며칠 뒤
 * 되짚을 때 남는 것은 우리가 줄인 문장뿐입니다.
 */