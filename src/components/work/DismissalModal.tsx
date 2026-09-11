"use client";

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/common/ToastProvider";
import { todayKst, kstWeekday } from "@/lib/kst";
import { StudentPicker, KINDS, WEEK, type StudentPick } from "@/components/work/QuickEntryModals";
import {
  DISMISSAL_REPEATS,
  REPEAT_HINT,
  addDays,
  describeWeek,
  nextWeekStart,
  weekStartFor,
  weekStartOf,
  type DismissalRepeat,
} from "@/lib/dismissalWeek";
import { DISMISSAL_SELECT, isMissingWeekStart, WEEK_START_NOTICE, type DismissalRow } from "@/lib/dismissalToday";

/**
 * **하원수단 팝업** — 업무보드에서 화면을 떠나지 않고 오늘·앞날 하원을 관리합니다.
 *
 * ── 왜 팝업인가 ──────────────────────────────────────────────────────
 *
 * 예전에는 「하원수단 넣기·고치기」가 다른 화면으로 가는 링크였습니다. 업무보드는 하루 종일
 * 켜놓고 보는 화면인데, 여기서 나갔다 돌아오면 보고 있던 자리를 잃습니다. **나갔다 와야 하는
 * 일은 대개 나중으로 미뤄지고, 미룬 하원 변경은 그날 아무 데도 안 뜹니다.**
 *
 * ── 넣으면 그 자리에서 셔틀에 걸립니다 ───────────────────────────────
 *
 * 오늘 요일이고 셔틀이 아니면 `/api/work/dismissal` 이 `shuttle_boardings` 까지 겁니다.
 * 그래야 체크표뿐 아니라 안내보드·도착체크·사무실 대시보드가 같은 답을 합니다 - 화면마다
 * 다른 답이 나오면 결국 아무도 안 믿습니다.
 */

type Plan = DismissalRow & { name: string; className: string };

const KIND_TONE: Record<string, string> = {
  셔틀: "border-sky-300 bg-sky-50 text-sky-800",
  외부버스: "border-lime-300 bg-lime-50 text-lime-800",
  보호자픽업: "border-violet-300 bg-violet-50 text-violet-800",
  도보: "border-slate-300 bg-slate-50 text-slate-700",
  기타: "border-slate-300 bg-slate-50 text-slate-700",
};

const DOW = ["일", "월", "화", "수", "목", "금", "토"];
function dayLabel(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const days = Math.floor(Date.UTC(y, m - 1, d) / 86_400_000);
  return `${m}/${d}(${DOW[(days + 4) % 7]})`;
}

export default function DismissalModal({ onClose }: { onClose: () => void }) {
  const notify = useToast();
  const today = todayKst();
  const todayWd = kstWeekday();

  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const [plans, setPlans] = useState<Plan[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** 지금 펼쳐둔 아이. 한 번에 하나만 폅니다 - 여럿을 펴두면 접은 뜻이 없어집니다. */
  const [openStudent, setOpenStudent] = useState<string | null>(null);

  // ── 넣기 폼 ────────────────────────────────────────────────────────
  /**
   * **여러 명을 한 번에 넣습니다.**
   *
   * 하원수단은 형제나 같은 학원 차를 타는 아이들처럼 **여럿이 똑같은 경우**가 흔합니다.
   * 한 명씩만 고를 수 있으면 같은 요일·같은 차를 네 번 다시 적게 되고, 그러다 한 명을
   * 빠뜨리면 그 아이는 그날 셔틀 명단에 그대로 남습니다 - 화면에는 오류가 아니라
   * «셔틀 타는 아이»로 보입니다.
   *
   * 고른 아이들은 칩으로 남습니다. 담긴 것이 눈에 보여야 빠진 것도 보입니다.
   */
  const [students, setStudents] = useState<StudentPick[]>([]);
  const [days, setDays] = useState<number[]>(todayWd >= 1 && todayWd <= 5 ? [todayWd] : []);
  const [repeat, setRepeat] = useState<DismissalRepeat>("이번주");
  const [kind, setKind] = useState<string>("보호자픽업");
  const [label, setLabel] = useState("");
  const [time, setTime] = useState("");
  const [note, setNote] = useState("");

  /**
   * **오늘 이미 픽업으로 잡힌 아이.**
   *
   * 하원수단(미리 등록)과 픽업(오늘 연락)은 다른 표에 있어서, 같은 아이가 양쪽에 들어가도
   * 아무 데서도 안 걸렸습니다. 그래서 「오늘 하원체크」가 백서아·황이안을 두 번 세어
   * 일곱 명을 아홉 명으로 보여줬고, 더 나쁘게는 **학원차와 부모님이 같은 아이를 각각
   * 기다리게** 됩니다.
   *
   * 판단은 이름이 아니라 **학생 번호**로 합니다 - 김재이가 셋이라 이름으로는 못 가립니다.
   * 막지는 않습니다. 오늘만 부모님이 오시고 학원차는 다음 주부터인 경우가 실제로 있어서,
   * 사람이 알고 누르면 되는 일입니다. **모르고 누르는 것만 막습니다.**
   */
  const [pickupToday, setPickupToday] = useState<Map<string, string>>(new Map());

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/dismissal/today", { cache: "no-store" });
        if (!res.ok) return;
        const j = (await res.json()) as { pickups: { studentId: string | null; name: string; source: string }[] };
        setPickupToday(
          new Map((j.pickups ?? []).filter((p) => p.studentId).map((p) => [p.studentId as string, p.source])),
        );
      } catch {
        // 못 읽어도 등록은 막지 않습니다. 안내가 없는 것이지 등록이 잘못된 것은 아닙니다.
      }
    })();
  }, []);

  /** 지금 고른 아이 중 오늘 이미 픽업인 아이. 오늘이 아닌 요일만 고른 경우는 뺍니다. */
  const pickupClash = days.includes(todayWd) ? students.filter((st) => pickupToday.has(st.id)) : [];

  /**
   * 이번 주와 다음 주에 걸리는 줄을 전부 읽습니다(매주짜리 포함).
   *
   * 지나간 주의 줄은 읽지 않습니다 - 지금 할 수 있는 일이 없는데 목록만 길어지면, 정작
   * 오늘 봐야 할 줄이 묻힙니다.
   */
  const load = useCallback(async () => {
    const supabase = createClient();
    const weeks = [weekStartOf(today), nextWeekStart(today)];
    let res = await supabase
      .from("student_dismissal_plans")
      .select(DISMISSAL_SELECT)
      .or(`week_start.is.null,week_start.in.(${weeks.join(",")})`);
    if (isMissingWeekStart(res.error)) {
      // 칸이 아직 없으면(마이그레이션 전) 전부 매주로 읽습니다. 화면이 멈추면 그날 하원을
      // 아무도 못 고칩니다.
      const retry = await supabase
        .from("student_dismissal_plans")
        .select("student_id, weekday, kind, label, depart_time, note");
      res = { ...retry, data: (retry.data ?? []).map((r) => ({ ...r, week_start: null })) } as typeof res;
      setNotice(WEEK_START_NOTICE);
    }
    if (res.error) {
      setError(res.error.message);
      setPlans([]);
      return;
    }
    const rows = (res.data as DismissalRow[] | null) ?? [];
    const ids = [...new Set(rows.map((r) => r.student_id))];
    if (ids.length === 0) {
      setPlans([]);
      return;
    }
    const { data: students } = await supabase
      .from("wr_students")
      .select("id, name, grade, class_name")
      .eq("is_demo", false)
      .in("id", ids);
    const byId = new Map(
      ((students as { id: string; name: string; grade: string | null; class_name: string | null }[] | null) ?? []).map((s) => [s.id, s]),
    );
    setPlans(
      rows
        .map((r) => {
          const st = byId.get(r.student_id);
          // 졸업·전학으로 명부에 없는 아이. 이름을 모르면 아무 판단도 할 수 없으므로 뺍니다.
          if (!st) return null;
          return {
            ...r,
            name: st.name,
            className: [st.grade ? `${st.grade}학년` : null, st.class_name].filter(Boolean).join(" "),
          };
        })
        .filter((x): x is Plan => !!x),
    );
  }, [today]);

  useEffect(() => {
    void load();
  }, [load]);

  async function save() {
    if (students.length === 0) return notify("학생을 골라주세요.", "error");
    if (days.length === 0) return notify("요일을 하나 이상 골라주세요.", "error");
    setBusy(true);
    try {
      let ok = 0;
      let todaySeats = 0;
      // **한 명이 실패해도 나머지는 넣습니다.** 중간에 멈추면 절반만 들어간 채로 끝나는데,
      // 그건 화면에 오류가 아니라 «몇 명은 됐고 몇 명은 안 된» 상태로 보입니다.
      const failed: string[] = [];
      for (const st of students) {
        const res = await fetch("/api/work/dismissal", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            studentId: st.id,
            weekdays: days,
            kind,
            label,
            time,
            note,
            weekStart: weekStartFor(repeat, today),
          }),
        });
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
          appliesToday?: boolean;
          appliedSeats?: number;
        };
        if (!res.ok) {
          failed.push(`${st.name}(${body.error ?? "저장 실패"})`);
          continue;
        }
        ok += 1;
        if (body.appliesToday && body.appliedSeats) todaySeats += body.appliedSeats;
      }

      // **무슨 일이 일어났는지 그대로 말합니다.** 「저장됨」만 뜨면 셔틀에 걸렸는지 아닌지를
      // 사람이 다시 확인하러 가야 합니다.
      const dayLabels = days.map((d) => WEEK.find((w) => w.n === d)?.ko).join("·");
      if (ok > 0) {
        notify(
          `${ok}명 · ${dayLabels} ${kind}` +
            (todaySeats > 0 ? ` — 오늘 것이라 셔틀 체크표에서 ${todaySeats}자리 뺐습니다.` : " — 그날이 되면 반영됩니다.") +
            (failed.length > 0 ? ` (${failed.length}명 실패: ${failed.join(", ")})` : ""),
          failed.length > 0 ? "error" : "success",
        );
      } else {
        notify(`저장하지 못했습니다: ${failed.join(", ")}`, "error");
      }
      if (ok > 0) setStudents([]);
      setLabel("");
      setTime("");
      setNote("");
      void load();
    } finally {
      setBusy(false);
    }
  }

  async function remove(p: Plan) {
    setBusy(true);
    try {
      const res = await fetch("/api/work/dismissal", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ studentId: p.student_id, weekday: p.weekday, weekStart: p.week_start }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) return notify(body.error ?? "지우지 못했습니다.", "error");
      notify(
        `${p.name} ${WEEK.find((w) => w.n === p.weekday)?.ko}요일 하원수단을 지웠습니다.` +
          (p.weekday === todayWd ? " 오늘 걸어둔 픽업 표시는 그대로입니다 - 체크표에서 되돌려주세요." : ""),
        "success",
      );
      void load();
    } finally {
      setBusy(false);
    }
  }

  if (!mounted) return null;

  const all = plans ?? [];
  /** 오늘 실제로 적용되는 줄. 그 주짜리가 매주짜리를 이깁니다. */
  const todayRows = (() => {
    if (todayWd < 1 || todayWd > 5) return [];
    const ws = weekStartOf(today);
    const byStudent = new Map<string, Plan>();
    for (const p of all.filter((p) => p.weekday === todayWd)) {
      const cur = byStudent.get(p.student_id);
      if (p.week_start === ws) byStudent.set(p.student_id, p);
      else if (!cur && p.week_start === null) byStudent.set(p.student_id, p);
    }
    return [...byStudent.values()].sort(
      (a, b) => (a.depart_time ?? "99:99").localeCompare(b.depart_time ?? "99:99") || a.name.localeCompare(b.name, "ko"),
    );
  })();

  /** 앞으로 예약된 것(그 주짜리만). 매주짜리는 「예약」이 아니라 평소 규칙입니다. */
  const ahead = all
    .filter((p) => p.week_start)
    .map((p) => ({ ...p, date: addDays(p.week_start as string, p.weekday - 1) }))
    .filter((p) => p.date > today)
    .sort((a, b) => a.date.localeCompare(b.date) || (a.depart_time ?? "99:99").localeCompare(b.depart_time ?? "99:99"));

  /**
   * 평소(매주) 규칙을 **아이별로** 묶습니다.
   *
   * 한 아이가 요일마다 다른 차를 타는 경우가 많아서(월 셔틀 · 화목 메타프랩 · 수금 블루웨일),
   * 줄 단위로 쭉 세우면 같은 이름이 다섯 번 나옵니다. 그러면 목록이 길어지기만 하고 「이 아이가
   * 어떻게 다니는가」는 오히려 안 보입니다 - 요일이 흩어져 있어 머릿속에서 다시 모아야 합니다.
   *
   * 이름 한 줄로 접어두고, 펴면 그 아이의 요일이 한자리에 모입니다.
   */
  const weeklyByStudent = (() => {
    const m = new Map<string, { name: string; className: string; rows: Plan[] }>();
    for (const p of all.filter((p) => !p.week_start)) {
      const cur = m.get(p.student_id);
      if (cur) cur.rows.push(p);
      else m.set(p.student_id, { name: p.name, className: p.className, rows: [p] });
    }
    return [...m.entries()]
      .map(([id, v]) => ({ id, ...v, rows: v.rows.sort((a, b) => a.weekday - b.weekday) }))
      .sort((a, b) => a.name.localeCompare(b.name, "ko"));
  })();

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto bg-black/40 p-4" onClick={onClose}>
      <div
        className="my-6 w-full max-w-2xl rounded-2xl bg-white p-4 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-2 flex items-center gap-2">
          <h3 className="text-sm font-bold text-slate-800">🎒 하원수단</h3>
          <span className="text-[11px] text-slate-400">넣으면 오늘 것은 셔틀 체크표에 바로 반영됩니다</span>
          <Link href="/work/dismissal" className="ml-auto text-[11px] font-semibold text-slate-500 underline decoration-dotted">
            여러 명 한 번에 넣기 ↗
          </Link>
          <button onClick={onClose} className="rounded px-1.5 text-slate-400 hover:bg-slate-100">
            ✕
          </button>
        </div>

        {error && (
          <p className="mb-2 rounded-lg bg-rose-50 px-2 py-1 text-[11px] font-semibold text-rose-700">
            ⚠️ 하원수단을 읽지 못했습니다: {error}
          </p>
        )}
        {notice && (
          <p className="mb-2 rounded-lg bg-amber-50 px-2 py-1 text-[11px] font-semibold text-amber-800">⚠️ {notice}</p>
        )}

        {/* ── 넣기 ───────────────────────────────────────────────────── */}
        <section className="mb-3 rounded-xl border border-slate-200 bg-slate-50/60 p-2.5">
          <p className="mb-1.5 text-[11px] font-bold text-slate-700">넣기</p>

          <div className="mb-2">
            {/* 담긴 아이들. **보이게 두는 것이 요점입니다** - 안 보이면 누가 담겼는지 몰라
                같은 아이를 또 고르거나, 고른 줄 알았던 아이가 빠집니다. */}
            {students.length > 0 && (
              <div className="mb-1.5 flex flex-wrap items-center gap-1">
                {students.map((st) => (
                  <span key={st.id} className="flex items-center gap-1 rounded-lg bg-teal-100 px-2 py-0.5 text-[11px] font-bold text-teal-900">
                    {st.name}
                    <span className="font-normal text-teal-600">{st.class_name ?? st.grade ?? ""}</span>
                    <button
                      type="button"
                      onClick={() => setStudents((prev) => prev.filter((x) => x.id !== st.id))}
                      className="text-teal-500 hover:text-red-500"
                      title="빼기"
                    >
                      ✕
                    </button>
                  </span>
                ))}
                <span className="text-[11px] font-semibold text-slate-500">{students.length}명</span>
                <button type="button" onClick={() => setStudents([])} className="text-[11px] text-slate-400 hover:text-red-500">
                  모두 지우기
                </button>
              </div>
            )}
            {/* **오늘 이미 픽업인 아이를 그 자리에서 알립니다.**
                하원수단과 픽업은 다른 표라 아무 데서도 안 걸렸고, 그래서 학원차와 부모님이
                같은 아이를 각각 기다리는 상황이 생깁니다. 막지는 않습니다 - 오늘만 부모님이
                오시는 경우가 실제로 있어서, 사람이 알고 누르면 되는 일입니다. */}
            {pickupClash.length > 0 && (
              <p className="mb-1.5 rounded-lg border border-amber-300 bg-amber-50 px-2 py-1 text-[11px] font-semibold text-amber-900">
                ⚠️ {pickupClash.map((st) => st.name).join(" · ")} — 오늘 이미 <b>픽업</b>으로 잡혀 있습니다
                {pickupClash.length === 1 && pickupToday.get(pickupClash[0].id)
                  ? `(${pickupToday.get(pickupClash[0].id)}에서 들어옴)`
                  : ""}
                . 그래도 넣으면 오늘 하원체크에 <b>둘 다</b> 뜹니다 — 어느 쪽인지 확인해주세요.
              </p>
            )}
            {/* 고르면 칩으로 담기고 검색칸은 비워집니다 - 다음 아이를 바로 칠 수 있게. */}
            <StudentPicker
              // 한 명 담을 때마다 검색칸을 새로 띄웁니다. 안 그러면 친 이름과 결과가 그대로
              // 남아, 다음 아이를 치려면 지우고 시작해야 합니다.
              key={students.length}
              value={null}
              onPick={(st) => {
                if (!st) return;
                setStudents((prev) => (prev.some((x) => x.id === st.id) ? prev : [...prev, st]));
              }}
            />
            <p className="mt-1 text-[10px] text-slate-400">
              같은 요일·같은 차를 타는 아이는 <b>여러 명을 한 번에</b> 담아 넣을 수 있습니다.
            </p>
          </div>

          <div className="mb-2 flex flex-wrap items-center gap-1">
            <span className="mr-1 text-[11px] font-semibold text-slate-500">요일</span>
            {WEEK.map((w) => (
              <button
                key={w.n}
                type="button"
                onClick={() => setDays((d) => (d.includes(w.n) ? d.filter((x) => x !== w.n) : [...d, w.n]))}
                className={
                  "h-8 w-9 rounded-lg text-xs font-bold " +
                  (days.includes(w.n) ? "bg-slate-800 text-white" : "bg-white text-slate-500 ring-1 ring-slate-200")
                }
              >
                {w.ko}
                {w.n === todayWd && <span className="block text-[8px] font-normal opacity-70">오늘</span>}
              </button>
            ))}
          </div>

          <div className="mb-2 flex flex-wrap items-center gap-1">
            <span className="mr-1 text-[11px] font-semibold text-slate-500">언제까지</span>
            {DISMISSAL_REPEATS.map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setRepeat(r)}
                title={REPEAT_HINT[r]}
                className={
                  "rounded-lg px-2.5 py-1 text-[12px] font-bold " +
                  (repeat === r ? "bg-slate-800 text-white" : "bg-white text-slate-500 ring-1 ring-slate-200")
                }
              >
                {r === "매주" ? "매주" : `${r}만`}
              </button>
            ))}
            <span className="text-[11px] text-slate-400">{REPEAT_HINT[repeat]}</span>
          </div>

          <div className="mb-2 flex flex-wrap items-center gap-1">
            <span className="mr-1 text-[11px] font-semibold text-slate-500">수단</span>
            {KINDS.map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setKind(k)}
                className={
                  "rounded-lg px-2.5 py-1 text-[12px] font-semibold " +
                  (kind === k ? "bg-slate-800 text-white" : "bg-white text-slate-600 ring-1 ring-slate-200")
                }
              >
                {k}
              </button>
            ))}
          </div>

          <div className="mb-2 grid grid-cols-1 gap-1.5 sm:grid-cols-3">
            <input
              value={time}
              onChange={(e) => setTime(e.target.value)}
              placeholder="시각 (14:40)"
              className="rounded-lg border border-slate-300 px-2 py-1.5 text-[12px]"
            />
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder={kind === "외부버스" ? "차 이름 (메타프랩버스)" : "이름(선택)"}
              className="rounded-lg border border-slate-300 px-2 py-1.5 text-[12px]"
            />
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="메모(선택)"
              className="rounded-lg border border-slate-300 px-2 py-1.5 text-[12px]"
            />
          </div>

          <button
            onClick={() => void save()}
            disabled={busy}
            className="w-full rounded-lg bg-emerald-600 py-2 text-[13px] font-bold text-white hover:bg-emerald-700 disabled:opacity-40"
          >
            {busy ? "저장 중…" : "저장"}
          </button>
          <p className="mt-1 text-[11px] text-slate-400">
            셔틀이 아닌 수단을 <b>오늘</b> 요일로 넣으면 그 자리에서 셔틀 명단에서 빠집니다. 「셔틀」로 넣으면 그대로 탑니다.
          </p>
        </section>

        {/* ── 오늘 ───────────────────────────────────────────────────── */}
        <section className="mb-3">
          <p className="mb-1 text-[11px] font-bold text-lime-800">
            🎒 오늘 하원 {todayRows.length}명
            <span className="ml-1.5 font-normal text-slate-400">
              {todayWd >= 1 && todayWd <= 5 ? `${DOW[todayWd]}요일` : "주말이라 하원 차량이 없습니다"}
            </span>
          </p>
          {todayRows.length === 0 ? (
            <p className="text-[11px] text-slate-400">오늘 따로 적힌 하원수단이 없습니다.</p>
          ) : (
            <div className="flex flex-col gap-1">
              {todayRows.map((p) => (
                <PlanRow key={`${p.student_id}-${p.weekday}-${p.week_start ?? "w"}`} p={p} today={today} busy={busy} onRemove={remove} />
              ))}
            </div>
          )}
        </section>

        {/* ── 앞으로 예약 ────────────────────────────────────────────── */}
        <section className="mb-3">
          <p className="mb-1 text-[11px] font-bold text-violet-800">📌 예약된 하원 {ahead.length}건</p>
          {ahead.length === 0 ? (
            <p className="text-[11px] text-slate-400">앞으로 예약된 것이 없습니다.</p>
          ) : (
            <div className="flex flex-col gap-1">
              {ahead.map((p) => (
                <PlanRow
                  key={`${p.student_id}-${p.weekday}-${p.week_start}`}
                  p={p}
                  today={today}
                  busy={busy}
                  onRemove={remove}
                  dateLabel={dayLabel(p.date)}
                />
              ))}
            </div>
          )}
        </section>

        {/* ── 평소(매주) ─────────────────────────────────────────────── */}
        <section>
          <p className="mb-1 text-[11px] font-bold text-slate-600">
            🔁 매주 {weeklyByStudent.length}명
            <span className="ml-1.5 font-normal text-slate-400">이름을 누르면 그 아이의 요일이 펼쳐집니다</span>
          </p>
          {weeklyByStudent.length === 0 ? (
            <p className="text-[11px] text-slate-400">매주 반복으로 적어둔 것이 없습니다.</p>
          ) : (
            <div className="flex max-h-64 flex-col gap-1 overflow-y-auto">
              {weeklyByStudent.map((s) => {
                const isOpen = openStudent === s.id;
                return (
                  <div key={s.id} className="rounded-lg border border-slate-200">
                    <button
                      type="button"
                      onClick={() => setOpenStudent(isOpen ? null : s.id)}
                      className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-[11px] hover:bg-slate-50"
                    >
                      <span className={"shrink-0 text-slate-400 transition " + (isOpen ? "rotate-90" : "")}>▶</span>
                      <b className="shrink-0 text-slate-800">{s.name}</b>
                      <span className="shrink-0 text-slate-400">{s.className}</span>
                      {/* 접힌 채로도 **어느 요일에 뭘 타는지**는 보입니다. 이름만 있으면
                          아이마다 열어봐야 하고, 그러면 접은 뜻이 없습니다. */}
                      <span className="min-w-0 truncate text-slate-500">
                        {s.rows.map((r) => `${WEEK.find((w) => w.n === r.weekday)?.ko} ${r.label || r.kind}`).join(" · ")}
                      </span>
                      <span className="ml-auto shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-500">
                        {s.rows.length}일
                      </span>
                    </button>
                    {isOpen && (
                      <div className="flex flex-col gap-1 border-t border-slate-100 p-1.5">
                        {s.rows.map((p) => (
                          <PlanRow key={`${p.student_id}-${p.weekday}-w`} p={p} today={today} busy={busy} onRemove={remove} />
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </div>,
    document.body,
  );
}

function PlanRow({
  p,
  today,
  busy,
  onRemove,
  dateLabel,
}: {
  p: Plan;
  today: string;
  busy: boolean;
  onRemove: (p: Plan) => void;
  dateLabel?: string;
}) {
  return (
    <div className={"flex items-center gap-2 rounded-lg border px-2 py-1.5 text-[11px] " + (KIND_TONE[p.kind] ?? KIND_TONE.기타)}>
      <b className="w-8 shrink-0 text-center">{WEEK.find((w) => w.n === p.weekday)?.ko}</b>
      {dateLabel && <span className="shrink-0 tabular-nums opacity-70">{dateLabel}</span>}
      <b className="shrink-0 tabular-nums">{p.depart_time ?? "시각 미정"}</b>
      <b className="shrink-0">{p.name}</b>
      <span className="shrink-0 opacity-60">{p.className}</span>
      <span className="min-w-0 truncate">{p.label || p.kind}</span>
      {p.note && <span className="min-w-0 truncate opacity-60">· {p.note}</span>}
      {/* 어느 갈래인지 적습니다. 「매주」와 「이번주만」이 겹칠 수 있어서, 무엇을 지우는지
          모르면 엉뚱한 줄을 지우게 됩니다. */}
      <span className="ml-auto shrink-0 rounded bg-white/70 px-1.5 py-0.5 text-[10px] font-bold opacity-80">
        {describeWeek(p.week_start ?? null, today)}
      </span>
      <button
        type="button"
        disabled={busy}
        onClick={() => onRemove(p)}
        title="이 줄을 지웁니다"
        className="shrink-0 rounded px-1 text-[11px] font-bold opacity-50 hover:bg-white/60 hover:opacity-100 disabled:opacity-30"
      >
        ✕
      </button>
    </div>
  );
}
