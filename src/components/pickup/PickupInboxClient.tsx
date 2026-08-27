"use client";

import { useCallback, useMemo, useState } from "react";
import { useToast } from "@/components/common/ToastProvider";
import UpcomingPickups, { type ScheduleRow } from "@/components/pickup/UpcomingPickups";
import StudentPicker from "@/components/pickup/StudentPicker";
import { matchStudent, type RosterEntry } from "@/lib/pickupParse";
import { extractTargetRange, todayKey } from "@/lib/attendanceDigest";

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
  const [rows, setRows] = useState(initialRows);
  const [busy, setBusy] = useState(false);
  const [manual, setManual] = useState("");
  const [manualSource, setManualSource] = useState<"전화" | "교사" | "직접입력">("전화");
  const [showDone, setShowDone] = useState(false);

  const pending = useMemo(() => rows.filter((r) => r.status === "확인대기"), [rows]);
  const confirmed = useMemo(
    () => rows.filter((r) => r.status === "확정").sort((a, b) => (a.ai_pickup_time ?? "99").localeCompare(b.ai_pickup_time ?? "99")),
    [rows]
  );
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
      })),
    [students]
  );

  async function rematchAll() {
    setBusy(true);
    let fixed = 0;
    for (const r of pending) {
      if (r.student_id) continue;
      const candidate = (r.ai_student_name ?? r.channel_label ?? "").trim();
      if (!candidate) continue;
      const hit = matchStudent(candidate, rosterForMatch);
      if (!hit) continue;
      await call({ action: "confirm", id: r.id, studentId: hit.id });
      fixed += 1;
    }
    setBusy(false);
    notify(fixed > 0 ? `${fixed}건을 학생과 이었습니다.` : "지금 규칙으로도 확정되는 건이 없습니다. 직접 골라주세요.", fixed > 0 ? "success" : "error");
    void refresh();
  }

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

  // 결석 처리. 하원 체크표와 같은 칸(shuttle_boardings)을 쓰는 기존 API를 그대로 부릅니다.
  async function markAbsent(row: PickupRow, dates: string[]) {
    if (!row.matched_name) return;
    setBusy(true);
    let ok = 0;
    for (const d of dates) {
      const res = await fetch("/api/work/attendance-action", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ studentName: row.matched_name, action: "결석", serviceDate: d, inquiryId: row.id }),
      });
      if (res.ok) ok += 1;
    }
    // 결석으로 처리했으면 이 건은 픽업 목록에서 내려갑니다 - 두 번 보이면 또 누르게 됩니다.
    await call({ action: "ignore", id: row.id });
    setBusy(false);
    notify(ok === dates.length ? `${row.matched_name} 결석 ${ok}일 처리했습니다.` : `${ok}/${dates.length}일만 처리됐습니다. 그날 셔틀 배정이 없는 날은 건너뜁니다.`, ok === dates.length ? "success" : "error");
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

      {/* 앞으로 예정된 픽업 - 오늘 것만 보면 "이번주 목금" 같은 예약을 놓칩니다 */}
      <UpcomingPickups initialRows={schedules} />

      {/* 확인이 필요한 건 */}
      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-1 flex flex-wrap items-center gap-2">
          <h2 className="text-sm font-bold text-slate-800">확인이 필요한 픽업</h2>
          {pending.length > 0 ? (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-700">{pending.length}건</span>
          ) : (
            <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-bold text-emerald-700">없음</span>
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
                  {r.service_date !== new Date().toISOString().slice(0, 10) && (
                    <span className="rounded bg-violet-100 px-1.5 py-0.5 text-[11px] font-bold text-violet-700">
                      {r.service_date}
                    </span>
                  )}
                </div>

                {r.raw_text && <p className="mb-2 rounded-lg bg-white p-2 text-xs leading-relaxed text-slate-700">{r.raw_text}</p>}
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
                        onClick={() => markAbsent(r, absenceOf(r)!.dates)}
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
                    <button
                      onClick={() => confirm(r)}
                      disabled={busy}
                      className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50"
                    >
                      {r.matched_name} 픽업 확정
                    </button>
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

      {/* 오늘 확정된 픽업 */}
      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="mb-2 text-sm font-bold text-slate-800">오늘 픽업 {confirmed.length}명</h2>
        {confirmed.length === 0 ? (
          <p className="py-3 text-center text-xs text-slate-400">아직 없습니다.</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {confirmed.map((r) => (
              <span
                key={r.id}
                title={`${r.source} · ${r.resolved_by === "AI" ? "자동" : r.resolved_by ?? ""}`}
                className="inline-flex items-center gap-1.5 rounded-lg border-l-4 border-sky-500 bg-slate-50 px-2.5 py-1.5 text-sm font-bold text-slate-800"
              >
                {r.matched_name ?? r.ai_student_name}
                {r.ai_pickup_time && <span className="text-[11px] font-semibold text-sky-600">{r.ai_pickup_time}</span>}
                {r.resolved_by === "AI" && <span className="text-[10px] font-semibold text-emerald-600">자동</span>}
              </span>
            ))}
          </div>
        )}
      </section>

      {/* 손으로 접수 */}
      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
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

      {/* 픽업이 아니라고 판단한 건 - 접어둡니다 */}
      {ignored.length > 0 && (
        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <button onClick={() => setShowDone((v) => !v)} className="text-xs font-bold text-slate-500">
            {showDone ? "▾" : "▸"} 픽업이 아니라고 본 건 {ignored.length}개
          </button>
          {showDone && (
            <div className="mt-2 flex flex-col gap-1.5">
              {ignored.map((r) => (
                <div key={r.id} className="rounded-lg bg-slate-50 p-2 text-[11px] text-slate-500">
                  <span className="font-semibold">{r.channel_label ?? r.source}</span> · {r.raw_text}
                  <button onClick={() => confirm(r)} className="ml-2 font-bold text-blue-600">
                    사실은 픽업
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
