"use client";

import { useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/common/ToastProvider";
import {
  DISMISSAL_REPEATS,
  RANGE_HINT,
  REPEAT_HINT,
  addDays,
  countWeekdayInRange,
  describeRange,
  describePlan,
  describeWeek,
  weekStartFor,
  weekStartOf,
  type DismissalChoice,
} from "@/lib/dismissalWeek";
import { todayKst } from "@/lib/kst";
import { Who } from "@/components/common/HomonymProvider";

/**
 * 하원수단 한 화면에서 몰아 넣기.
 *
 * 지금까지는 학생 한 명씩 프로필을 열어야 했습니다. 학부모 연락은 «임선우·임다현 월·금
 * 2시 40분 학원 셔틀»처럼 **여러 아이 · 여러 요일이 한 번에** 옵니다. 그걸 넣으려면
 * 프로필을 두 번 열고 요일을 네 번 눌러야 했고, 그 번거로움이 곧 «나중에 하자»가 됩니다.
 * 나중에 한 것은 대개 안 한 것이 됩니다.
 *
 * 그래서 여기서는 **아이를 고르고 → 요일을 여러 개 찍고 → 한 번에 저장**합니다.
 * 형제자매처럼 여러 아이가 같은 차를 타면 아이도 여러 명 고를 수 있습니다.
 *
 * 표 자체는 새로 만들지 않았습니다(student_dismissal_plans). 같은 사실을 두 곳에 적으면
 * 언젠가 어긋나고, 어긋난 쪽이 어느 쪽인지 아무도 모릅니다.
 */

export type StudentLite = { id: string; name: string; grade: string | null; class_name: string | null };
/** 학부모 연락 한 건 — **읽기만** 합니다. 원본은 픽업 인박스에 있습니다. */
export type InquiryLite = {
  id: string;
  kind: string;
  /** 연락이 가리키는 학생 번호. 있으면 이름을 보지 않고 이걸로 고릅니다. */
  studentId: string | null;
  name: string;
  summary: string | null;
  raw: string | null;
  at: string;
  url: string | null;
};

/** 셔틀 배정 한 줄 — 역시 읽기만. 원본은 셔틀 탭에 있습니다. */
export type RideLite = {
  studentId: string | null;
  nameRaw: string;
  weekdays: number[];
  route: string | null;
  stop: string | null;
};

export type PlanRow = {
  id: string;
  student_id: string;
  weekday: number;
  kind: string;
  label: string | null;
  depart_time: string | null;
  note: string | null;
  /** 적용되는 주의 월요일. 비어 있으면 매주 — 규칙은 `src/lib/dismissalWeek.ts` 한 곳입니다. */
  week_start?: string | null;
  /** 기간으로 넣은 줄이면 묶음 번호와 기간(마이그레이션 전에는 없음). */
  range_id?: string | null;
  range_start?: string | null;
  range_end?: string | null;
};

/** 넣어둔 하원수단 한 묶음이 가리키는 실제 줄들. 고치거나 지울 때 이 줄들을 정확히 겨눕니다. */
type PlanRef = { weekday: number; rangeId: string | null; weekStart: string | null; row: PlanRow };
type RegisteredItem = { key: string; days: number[]; what: string; when: string; kind: string; refs: PlanRef[] };

const WEEKDAYS = [
  { n: 1, ko: "월" },
  { n: 2, ko: "화" },
  { n: 3, ko: "수" },
  { n: 4, ko: "목" },
  { n: 5, ko: "금" },
];

const KINDS = ["셔틀", "외부버스", "보호자픽업", "도보", "기타"] as const;

const KIND_TONE: Record<string, string> = {
  셔틀: "bg-sky-100 text-sky-800",
  외부버스: "bg-lime-100 text-lime-800",
  보호자픽업: "bg-violet-100 text-violet-800",
  도보: "bg-slate-100 text-slate-600",
  기타: "bg-slate-100 text-slate-600",
};

export default function DismissalBulkClient({
  students,
  initialPlans,
  inquiries,
  rides,
}: {
  students: StudentLite[];
  initialPlans: PlanRow[];
  /** 최근 학부모 연락. 넣을 때 «누구였더라»를 여기서 바로 봅니다. */
  inquiries: InquiryLite[];
  /** 셔틀 배정. 셔틀을 타는 날을 학원차로 덮어쓰는 실수를 막습니다. */
  rides: RideLite[];
}) {
  const notify = useToast();
  const [plans, setPlans] = useState<PlanRow[]>(initialPlans);
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [days, setDays] = useState<number[]>([]);
  const [kind, setKind] = useState<(typeof KINDS)[number]>("외부버스");
  const [label, setLabel] = useState("");
  const [time, setTime] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [onlySet, setOnlySet] = useState(false);
  const [openRaw, setOpenRaw] = useState<string | null>(null);
  // 이 화면은 「매주 이렇게 갑니다」를 몰아 넣는 자리라 매주가 기본입니다. 그 주 한 번짜리는
  // 업무보드의 빠른등록으로 들어옵니다.
  const [repeat, setRepeat] = useState<DismissalChoice>("매주");
  /**
   * **고치는 중인 묶음.** 넣어둔 하원수단을 고치려면 예전에는 같은 갈래(매주·기간)를 찾아 같은 요일에 다시 넣어야 했고,
   * 기간으로 넣은 것은 다시 넣으면 새 기간이 하나 더 생겨 두 개가 겹쳤습니다. 이제 「수정」을 누르면 그 묶음이 아래 넣기
   * 칸에 그대로 채워지고, 저장하면 **새 내용을 넣은 뒤 옛 줄을 지웁니다**(넣기가 실패하면 옛 줄은 그대로 남습니다).
   */
  const [editing, setEditing] = useState<{ studentId: string; name: string; refs: PlanRef[] } | null>(null);

  const today = todayKst();
  /** 「기간」일 때 달력으로 고르는 시작·끝 날짜. 기본은 오늘부터 4주. */
  const [rangeStart, setRangeStart] = useState<string>(today);
  const [rangeEnd, setRangeEnd] = useState<string>(addDays(today, 27));
  const isRange = repeat === "기간";
  const weekStart = isRange ? null : weekStartFor(repeat, today);

  const planKey = (studentId: string, weekday: number) => `${studentId}|${weekday}`;
  // **보고 있는 갈래의 줄만** 표에 세웁니다. 매주와 이번주만을 한 칸에 섞으면 지우기를
  // 눌렀을 때 어느 쪽이 지워지는지 아무도 모릅니다.
  const planMap = useMemo(
    () =>
      new Map(
        plans
          // 기간 보기에서는 **끝나지 않은 기간 줄을 전부** 세웁니다. 예전에는 달력에 고른 날짜와
          // 똑같은 기간만 보여서, 다시 들어오면 기본 날짜(오늘~4주)와 안 맞아 넣은 것이 하나도 안
          // 보였습니다. 같은 요일에 기간이 둘이면 먼저 시작하는 것을 세웁니다.
          .filter((p) =>
            isRange
              ? !!p.range_id && !!p.range_end && p.range_end >= today
              : weekStart
                ? // 「이번주만·다음주만」도 이제 그 주 월~금 기간으로 들어갑니다. 예전 줄(묶음 없음)도 함께.
                  p.week_start === weekStart && (!p.range_id || (p.range_start === weekStart && p.range_end === addDays(weekStart, 4)))
                : !p.range_id && !p.week_start,
          )
          .sort((a, b) => (b.range_start ?? "").localeCompare(a.range_start ?? ""))
          .map((p) => [planKey(p.student_id, p.weekday), p]),
      ),
    [plans, weekStart, isRange, today],
  );

  /**
   * **지금 넣어둔 하원수단 전부** — 갈래(매주·이번주만·기간)와 상관없이 한 목록으로.
   *
   * 아래 표는 고른 갈래의 줄만 세웁니다. 그래서 기간으로 넣고 다시 들어오면(기본은 「매주」)
   * 표에는 아무것도 없어 «저장이 안 됐다»로 보였습니다. 무엇이 걸려 있는지는 갈래를 고르기
   * 전에 보여야 합니다. 지난 주·끝난 기간은 뺍니다.
   */
  const registered = useMemo(() => {
    const thisWeek = weekStartOf(today);
    const seen = new Set<string>();
    const byStudent = new Map<string, RegisteredItem[]>();
    for (const p of plans) {
      if (p.range_id) {
        if (!p.range_end || p.range_end < today) continue;
      } else if (p.week_start && p.week_start < thisWeek) continue;
      // 기간은 주마다 한 줄씩 펼쳐져 있어 묶음·요일로 한 번만 셉니다.
      const once = p.range_id ? `${p.range_id}|${p.weekday}` : p.id;
      if (seen.has(once)) continue;
      seen.add(once);
      const what = [p.depart_time, p.label || p.kind].filter(Boolean).join(" ");
      const when = describePlan(p, today);
      const key = `${what}|${when}|${p.kind}`;
      const list = byStudent.get(p.student_id) ?? [];
      const hit = list.find((x) => x.key === key);
      const ref: PlanRef = { weekday: p.weekday, rangeId: p.range_id ?? null, weekStart: p.week_start ?? null, row: p };
      if (hit) {
        if (!hit.days.includes(p.weekday)) hit.days.push(p.weekday);
        hit.refs.push(ref);
      } else list.push({ key, days: [p.weekday], what, when, kind: p.kind, refs: [ref] });
      byStudent.set(p.student_id, list);
    }
    const nameOf = new Map(students.map((s) => [s.id, s]));
    return [...byStudent.entries()]
      .map(([id, items]) => ({ id, student: nameOf.get(id), items }))
      .filter((r) => !!r.student)
      .sort((a, b) => (a.student!.name ?? "").localeCompare(b.student!.name ?? "", "ko"));
  }, [plans, students, today]);
  // 셔틀도 하원수단이지만, 셔틀만 적힌 아이까지 다 늘어놓으면 정작 «다르게 가는 아이»가 묻힙니다.
  const [showShuttleToo, setShowShuttleToo] = useState(false);
  const registeredShown = useMemo(
    () =>
      registered
        .map((r) => ({ ...r, items: showShuttleToo ? r.items : r.items.filter((i) => i.kind !== "셔틀") }))
        .filter((r) => r.items.length > 0),
    [registered, showShuttleToo],
  );

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    let out = students;
    if (q) out = out.filter((s) => s.name.toLowerCase().includes(q) || (s.class_name ?? "").toLowerCase().includes(q));
    // 이미 넣은 아이만 보기 - 넣은 것을 확인하거나 고칠 때 씁니다.
    if (onlySet) out = out.filter((s) => WEEKDAYS.some((w) => planMap.has(planKey(s.id, w.n))));
    return out;
  }, [students, query, onlySet, planMap]);

  function toggleStudent(id: string) {
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  }

  /**
   * 연락이 가리키는 아이를 고릅니다. **번호가 먼저**이고, 번호가 없을 때만 이름을 봅니다.
   *
   * 이름이 둘 이상에 걸리면 고르지 않습니다 - 김재이가 셋이라, 첫 번째를 고르면 엉뚱한 아이의
   * 하원수단이 바뀌고 그건 오류가 아니라 «저장됨»으로 보입니다(CLAUDE.md 2-4-1).
   *
   * 못 찾으면 **검색칸에 그 이름을 넣어둡니다.** 조용히 아무 일도 안 하면 «눌렀는데 안 되네»가
   * 되는데, 이름이 명부와 다르게 적힌 경우가 실제로 많아서 사람이 직접 골라야 합니다.
   */
  function pickFromInquiry(q: InquiryLite) {
    const byId = q.studentId ? students.find((s) => s.id === q.studentId) : null;
    if (byId) {
      setPicked((p) => (p.includes(byId.id) ? p : [...p, byId.id]));
      setQuery("");
      return;
    }
    const name = q.name.replace(/\(.*$/, "").trim();
    const exact = students.filter((s) => s.name === name);
    const hits = exact.length > 0 ? exact : students.filter((s) => s.name.includes(name) || name.includes(s.name));
    if (hits.length === 1) {
      setPicked((p) => (p.includes(hits[0].id) ? p : [...p, hits[0].id]));
      setQuery("");
      return;
    }
    setQuery(name);
    notify(
      hits.length > 1
        ? `「${name}」가 ${hits.length}명입니다. 아래 목록에서 누구인지 골라주세요.`
        : `명부에서 「${name}」를 찾지 못했습니다. 아래 목록에서 직접 골라주세요.`,
      "error",
    );
  }

  // 고른 아이들의 셔틀 배정. 셔틀을 타는 요일에 학원차를 넣으려 하면 눈에 띄어야 합니다.
  const pickedRides = useMemo(
    () => rides.filter((r) => r.studentId && picked.includes(r.studentId)),
    [rides, picked]
  );

  /** 정확히 이 줄들만 지웁니다. 기간 줄은 그 요일의 기간 묶음 전체, 매주·그 주 줄은 그 갈래만. */
  async function removeRefs(studentId: string, refs: PlanRef[]): Promise<string | null> {
    const supabase = createClient();
    const doneRange = new Set<string>();
    for (const r of refs) {
      if (r.rangeId) {
        const k = `${r.rangeId}|${r.weekday}`;
        if (doneRange.has(k)) continue;
        doneRange.add(k);
        const res = await fetch("/api/work/dismissal", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ studentId, weekday: r.weekday, rangeId: r.rangeId }),
        });
        if (!res.ok) return ((await res.json().catch(() => ({}))) as { error?: string }).error ?? "지우기 실패";
        setPlans((prev) => prev.filter((x) => !(x.range_id === r.rangeId && x.weekday === r.weekday)));
      } else {
        const { error } = await supabase.rpc("clear_dismissal_plan", { p_student: studentId, p_weekday: r.weekday, p_week_start: r.weekStart });
        if (error) return error.message;
        setPlans((prev) => prev.filter((x) => !(x.student_id === studentId && x.weekday === r.weekday && !x.range_id && (x.week_start ?? null) === r.weekStart)));
      }
    }
    return null;
  }

  function startEdit(studentId: string, name: string, item: RegisteredItem) {
    const row = item.refs[0].row;
    setPicked([studentId]);
    setDays(item.days.slice().sort());
    setKind((KINDS as readonly string[]).includes(row.kind) ? (row.kind as (typeof KINDS)[number]) : "기타");
    setLabel(row.label ?? "");
    setTime(row.depart_time ?? "");
    setNote(row.note ?? "");
    if (row.range_id && row.range_start && row.range_end) {
      setRepeat("기간");
      setRangeStart(row.range_start < today ? today : row.range_start);
      setRangeEnd(row.range_end);
    } else if (row.week_start) {
      setRepeat(DISMISSAL_REPEATS.find((r) => weekStartFor(r, today) === row.week_start) ?? "이번주");
    } else setRepeat("매주");
    setEditing({ studentId, name, refs: item.refs });
    document.getElementById("dismissal-form")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function removeItem(studentId: string, name: string, item: RegisteredItem) {
    if (!window.confirm(`${name} — ${item.what} (${item.when})을(를) 지울까요?`)) return;
    setBusy(true);
    const err = await removeRefs(studentId, item.refs);
    setBusy(false);
    if (err) notify(`지우지 못했습니다: ${err}`, "error");
    else notify(`${name} 하원수단을 지웠습니다.`, "success");
  }

  /** 고치는 중이면, 새로 넣은 뒤 옛 줄 중 «새 줄이 덮어쓰지 않은 것»을 지웁니다. */
  async function finishEdit(savedOk: boolean) {
    if (!editing || !savedOk) return;
    const sameWeekly = !isRange && !weekStart;
    // 매주 → 매주로 같은 요일을 고치면 저장 함수가 그 줄을 덮어씁니다. 그 줄은 지우면 안 됩니다.
    const stale = editing.refs.filter((r) => r.rangeId || !(sameWeekly && !r.weekStart && days.includes(r.weekday)) || editing.studentId !== picked[0]);
    const err = await removeRefs(editing.studentId, stale);
    if (err) notify(`새 내용은 넣었지만 옛 하원수단을 지우지 못했습니다: ${err}. 「넣어둔 하원수단」에서 옛 줄을 지워주세요.`, "error");
    setEditing(null);
  }

  async function save() {
    if (picked.length === 0 || days.length === 0) {
      notify("아이와 요일을 고른 뒤 저장해주세요.", "error");
      return;
    }
    // 날짜가 정해진 것(기간 · 이번주만 · 다음주만)은 모두 기간으로 넣습니다 - 지속 특이사항과
    // 서로 따라 바뀌려면 기간 묶음이 있어야 합니다.
    if (isRange) {
      await finishEdit(await saveRange(rangeStart, rangeEnd));
      return;
    }
    if (weekStart) {
      await finishEdit(await saveRange(weekStart, addDays(weekStart, 4)));
      return;
    }
    setBusy(true);
    const supabase = createClient();
    // 저장은 함수 한 곳(set_dismissal_plan)에서 합니다 - 「매주」와 「그 주만」이 각각
    // 하나씩 있어야 해서 조건부 인덱스를 쓰는데, upsert 로는 어느 쪽인지 가리킬 수 없습니다.
    const saved: PlanRow[] = [];
    for (const sid of picked) {
      for (const w of days) {
        const { data, error } = await supabase.rpc("set_dismissal_plan", {
          p_student: sid,
          p_weekday: w,
          p_kind: kind,
          p_label: label.trim() || null,
          p_time: time.trim() || null,
          p_note: note.trim() || null,
          p_week_start: weekStart,
        });
        if (error) {
          setBusy(false);
          // 몇 건이 들어갔는지 함께 말합니다. 「저장 실패」만 뜨면 다시 눌러야 하는지
          // 아닌지 알 수 없고, 대개 사람은 아무것도 안 들어갔다고 생각합니다.
          setPlans((prev) => [
            ...prev.filter((p) => !saved.some((s) => s.student_id === p.student_id && s.weekday === p.weekday && (p.week_start ?? null) === weekStart)),
            ...saved,
          ]);
          notify(`${saved.length}건까지 저장하고 멈췄습니다: ${error.message}`, "error");
          return;
        }
        saved.push({
          id: (data as string | null) ?? `${sid}|${w}|${weekStart ?? ""}`,
          student_id: sid,
          weekday: w,
          kind,
          label: label.trim() || null,
          depart_time: time.trim() || null,
          note: note.trim() || null,
          week_start: weekStart,
        });
      }
    }
    setBusy(false);
    setPlans((prev) => {
      const next = prev.filter(
        (p) => !saved.some((s) => s.student_id === p.student_id && s.weekday === p.weekday && (p.week_start ?? null) === weekStart),
      );
      return [...next, ...saved];
    });
    notify(
      `${picked.length}명 × ${days.length}요일 = ${saved.length}건을 ${repeat === "매주" ? "매주" : `${repeat}만`}으로 저장했습니다.`,
      "success",
    );
    await finishEdit(true);
    setPicked([]);
    setDays([]);
  }

  /**
   * 기간으로 넣기. 주별 줄로 펼쳐 한 트랜잭션에 넣어야 해서 하원수단 창구(`/api/work/dismissal`)를
   * 지납니다 - 오늘이 기간 안이면 셔틀 체크표에도 바로 거는 것까지 하원수단 창과 같습니다.
   */
  async function saveRange(rangeStart: string, rangeEnd: string): Promise<boolean> {
    if (!rangeStart || !rangeEnd || rangeEnd < rangeStart) {
      notify("기간의 시작일과 종료일을 달력에서 골라주세요.", "error");
      return false;
    }
    if (days.every((d) => countWeekdayInRange(rangeStart, rangeEnd, d) === 0)) {
      notify("고른 기간 안에 고른 요일이 없습니다.", "error");
      return false;
    }
    setBusy(true);
    const failed: string[] = [];
    const done: string[] = [];
    try {
      for (const sid of picked) {
        const res = await fetch("/api/work/dismissal", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ studentId: sid, weekdays: days, kind, label, time, note, range: { start: rangeStart, end: rangeEnd } }),
        });
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        const name = students.find((s) => s.id === sid)?.name ?? sid;
        if (!res.ok) failed.push(`${name}(${body.error ?? "저장 실패"})`);
        else done.push(sid);
      }
      // dismissal-ok: 오늘의 답을 고르는 자리가 아니라, 방금 넣은 기간 줄을 편집 표에 다시 세우는 자리입니다.
      // 넣은 줄을 다시 읽어 표에 세웁니다. 묶음 번호(range_id)가 있어야 표에서 바로 지울 수 있습니다.
      if (done.length > 0) {
        const supabase = createClient();
        const { data, error } = await supabase
          .from("student_dismissal_plans")
          .select("id, student_id, weekday, kind, label, depart_time, note, week_start, range_id, range_start, range_end")
          .in("student_id", done)
          .eq("range_start", rangeStart)
          .eq("range_end", rangeEnd);
        if (error) notify(`저장은 했지만 표를 새로 읽지 못했습니다: ${error.message}. 화면을 새로고침해주세요.`, "error");
        else {
          const fresh = (data as PlanRow[] | null) ?? [];
          setPlans((prev) => [...prev.filter((p) => !fresh.some((f) => f.id === p.id)), ...fresh]);
        }
      }
    } finally {
      setBusy(false);
    }
    if (done.length > 0) {
      notify(
        `${done.length}명 × ${days.length}요일을 ${describeRange(rangeStart, rangeEnd)} 기간으로 저장했습니다.` +
          (failed.length ? ` 실패 ${failed.length}명: ${failed.join(", ")}` : ""),
        failed.length ? "error" : "success",
      );
      setPicked([]);
      setDays([]);
      return failed.length === 0;
    }
    notify(`저장하지 못했습니다: ${failed.join(", ")}`, "error");
    return false;
  }

  async function clearOne(studentId: string, weekday: number) {
    const p = planMap.get(planKey(studentId, weekday));
    if (!p) return;
    if (p.range_id) {
      // 기간으로 넣은 줄은 그 요일의 기간 전체를 지웁니다. 한 주만 지우면 남은 주가 계속 살아 있습니다.
      const res = await fetch("/api/work/dismissal", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ studentId, weekday, rangeId: p.range_id }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        notify("지우지 못했습니다: " + (body.error ?? ""), "error");
        return;
      }
      setPlans((prev) => prev.filter((x) => !(x.range_id === p.range_id && x.weekday === weekday)));
      return;
    }
    const supabase = createClient();
    const { error } = await supabase.rpc("clear_dismissal_plan", {
      p_student: studentId,
      p_weekday: weekday,
      p_week_start: weekStart,
    });
    if (error) {
      notify("지우지 못했습니다: " + error.message, "error");
      return;
    }
    setPlans((prev) => prev.filter((x) => !(x.student_id === studentId && x.weekday === weekday && (x.week_start ?? null) === weekStart)));
  }

  return (
    <div className="flex flex-col gap-3">
      {/* ── 넣기 ───────────────────────────────────────────────────────────── */}
      {/* ── 지금 넣어둔 하원수단 ─────────────────────────────────────────── */}
      <section className="rounded-2xl border border-violet-200 bg-violet-50/40 p-3">
        <div className="mb-2 flex flex-wrap items-baseline gap-2">
          <h2 className="text-sm font-bold text-slate-800">📋 넣어둔 하원수단</h2>
          <span className="text-[11px] text-slate-500">
            {registeredShown.length}명 · 매주 · 이번주만 · 기간을 모두 함께 보여줍니다 · 지운 것과 끝난 기간은 빠집니다
          </span>
          <label className="ml-auto flex items-center gap-1 text-[11px] font-semibold text-slate-500">
            <input type="checkbox" checked={showShuttleToo} onChange={(e) => setShowShuttleToo(e.target.checked)} className="h-3 w-3" />
            셔틀도 보기
          </label>
        </div>
        {registeredShown.length === 0 ? (
          <p className="py-3 text-center text-xs text-slate-400">넣어둔 하원수단이 없습니다.</p>
        ) : (
          <ul className="grid max-h-72 grid-cols-1 gap-1 overflow-y-auto sm:grid-cols-2">
            {registeredShown.map((r) => (
              <li key={r.id} className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-[11px]">
                <b className="text-slate-800">
                  <Who id={r.id} name={r.student!.name} />
                </b>
                {r.items.map((i) => (
                  <div key={i.key} className="mt-0.5 flex flex-wrap items-center gap-1">
                    <span className="font-semibold text-slate-600">
                      {i.days
                        .slice()
                        .sort()
                        .map((d) => WEEKDAYS.find((w) => w.n === d)?.ko)
                        .join("·")}
                    </span>
                    <span className={"rounded px-1.5 py-0.5 font-semibold " + (KIND_TONE[i.kind] ?? KIND_TONE.기타)}>{i.what}</span>
                    <span className="text-slate-500">{i.when}</span>
                    <span className="ml-auto flex gap-1">
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => startEdit(r.id, r.student!.name, i)}
                        className="rounded border border-slate-300 px-1.5 py-0.5 text-[10px] font-bold text-slate-600 hover:bg-slate-50"
                        title="이 하원수단을 아래 넣기 칸에 불러와 고칩니다"
                      >
                        ✏️ 수정
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void removeItem(r.id, r.student!.name, i)}
                        className="rounded border border-rose-200 px-1.5 py-0.5 text-[10px] font-bold text-rose-600 hover:bg-rose-50"
                        title="이 하원수단을 지웁니다"
                      >
                        지우기
                      </button>
                    </span>
                  </div>
                ))}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section id="dismissal-form" className={"rounded-2xl border bg-white p-3 " + (editing ? "border-amber-400 ring-2 ring-amber-200" : "border-slate-200")}>
        <h2 className="mb-2 text-sm font-bold text-slate-800">{editing ? `✏️ ${editing.name} 하원수단 고치기` : "한 번에 넣기"}</h2>
        {editing && (
          <p className="mb-2 flex flex-wrap items-center gap-2 rounded-lg bg-amber-50 px-2 py-1.5 text-[11px] text-amber-900">
            아래 내용을 고친 뒤 저장하면 새 내용으로 바뀌고 옛 하원수단은 지워집니다.
            <button
              type="button"
              onClick={() => {
                setEditing(null);
                setPicked([]);
                setDays([]);
              }}
              className="ml-auto rounded border border-amber-300 bg-white px-2 py-0.5 font-bold"
            >
              고치기 취소
            </button>
          </p>
        )}

        {/* 언제까지 — 표에 무엇이 보이는지도 여기서 갈립니다. 겹쳐 있는 것을 한 칸에 섞으면
            지우기를 눌렀을 때 어느 쪽이 지워지는지 아무도 모릅니다. */}
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-semibold text-slate-500">언제까지</span>
          {DISMISSAL_REPEATS.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setRepeat(r)}
              title={REPEAT_HINT[r]}
              className={
                "rounded-full px-2.5 py-1 text-[11px] font-bold " +
                (repeat === r ? "bg-slate-800 text-white" : "border border-slate-200 text-slate-500 hover:bg-slate-50")
              }
            >
              {r === "매주" ? "매주" : `${r}만`}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setRepeat("기간")}
            title={RANGE_HINT}
            className={
              "rounded-full px-2.5 py-1 text-[11px] font-bold " +
              (isRange ? "bg-slate-800 text-white" : "border border-slate-200 text-slate-500 hover:bg-slate-50")
            }
          >
            📅 기간 지정
          </button>
          <span className="text-[11px] text-slate-400">
            {isRange ? (
              <>
                {RANGE_HINT} · 아래 표는 <b>기간으로 넣은 것</b>을 모두 보여줍니다(칸마다 기간이 적혀 있습니다)
              </>
            ) : (
              <>
                {REPEAT_HINT[repeat as Exclude<DismissalChoice, "기간">]} · 아래 표는 <b>{describeWeek(weekStart, today)}</b>에 적힌 것만 보여줍니다
              </>
            )}
          </span>
        </div>
        {isRange && (
          <div className="mb-2 flex flex-wrap items-center gap-2 rounded-lg border border-violet-200 bg-violet-50/60 px-2.5 py-1.5 text-sm">
            <label className="flex items-center gap-1">
              <span className="text-[11px] font-semibold text-slate-500">시작</span>
              <input
                type="date"
                value={rangeStart}
                min={today}
                onChange={(e) => {
                  setRangeStart(e.target.value);
                  if (e.target.value > rangeEnd) setRangeEnd(e.target.value);
                }}
                className="rounded border border-slate-300 bg-white px-1.5 py-0.5"
              />
            </label>
            <span className="text-slate-400">~</span>
            <label className="flex items-center gap-1">
              <span className="text-[11px] font-semibold text-slate-500">끝</span>
              <input type="date" value={rangeEnd} min={rangeStart || today} onChange={(e) => setRangeEnd(e.target.value)} className="rounded border border-slate-300 bg-white px-1.5 py-0.5" />
            </label>
            {/* 실제로 며칠이 되는지 보여줍니다. 요일과 기간이 안 맞으면 0번인데, 그걸 저장 뒤에 알면 늦습니다. */}
            <span className="text-[11px] text-violet-800">
              {days.length === 0
                ? "요일을 골라주세요"
                : days
                    .slice()
                    .sort()
                    .map((d) => `${WEEKDAYS.find((w) => w.n === d)?.ko} ${countWeekdayInRange(rangeStart, rangeEnd, d)}번`)
                    .join(" · ")}
            </span>
          </div>
        )}

        <div className="mb-2 flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-semibold text-slate-500">요일</span>
          {WEEKDAYS.map((w) => (
            <button
              key={w.n}
              type="button"
              onClick={() => setDays((d) => (d.includes(w.n) ? d.filter((x) => x !== w.n) : [...d, w.n]))}
              className={
                "h-8 w-9 rounded-lg text-xs font-bold " +
                (days.includes(w.n) ? "bg-slate-800 text-white" : "border border-slate-200 text-slate-500 hover:bg-slate-50")
              }
            >
              {w.ko}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setDays(days.length === 5 ? [] : [1, 2, 3, 4, 5])}
            className="rounded-lg border border-slate-200 px-2 py-1 text-[11px] font-semibold text-slate-500 hover:bg-slate-50"
          >
            {days.length === 5 ? "요일 비우기" : "매일"}
          </button>
        </div>

        <div className="mb-2 flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-semibold text-slate-500">수단</span>
          {KINDS.map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setKind(k)}
              className={
                "rounded-full px-2.5 py-1 text-[11px] font-bold " +
                (kind === k ? "bg-slate-800 text-white" : "border border-slate-200 text-slate-500 hover:bg-slate-50")
              }
            >
              {k}
            </button>
          ))}
        </div>

        <div className="mb-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="차 이름 (예: 와이키키짐)"
            className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm"
          />
          <input
            value={time}
            onChange={(e) => setTime(e.target.value)}
            placeholder="시각 (예: 14:40)"
            className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm"
          />
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="메모 (없으면 비워두세요)"
            className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] text-slate-500">
            고른 아이 <b className="text-slate-800">{picked.length}명</b>
            {picked.length > 0 && (
              <>
                {" — "}
                {picked
                  .map((id) => students.find((s) => s.id === id)?.name)
                  .filter(Boolean)
                  .join(", ")}
              </>
            )}
          </span>
          <button
            type="button"
            disabled={busy || picked.length === 0 || days.length === 0}
            onClick={save}
            className="ml-auto rounded-lg bg-teal-600 px-4 py-1.5 text-xs font-bold text-white hover:bg-teal-700 disabled:opacity-40"
          >
            {picked.length}명 × {days.length}요일 저장
          </button>
        </div>
        <p className="mt-1.5 text-[11px] leading-relaxed text-slate-400">
          형제자매처럼 같은 차를 타는 아이는 함께 고르면 한 번에 들어갑니다. 같은 갈래에 이미 넣어둔 요일이 있으면{" "}
          <b>덮어씁니다</b>. 「이번주만」은 매주 하원수단을 지우지 않고 그 주에만 앞섭니다.
        </p>

        {/* 고른 아이가 셔틀을 타는 요일. 여기 있는 요일에 학원차를 넣으면 그날 셔틀 자리가
            비는데, 셔틀 배정은 그대로 남아 체크표에 계속 뜹니다 - 두 화면이 다른 말을 합니다.
            셔틀 쪽을 여기서 고치지는 않습니다(원본은 셔틀 탭). 보여주기만 합니다. */}
        {pickedRides.length > 0 && (
          <div className="mt-2 rounded-xl border border-sky-200 bg-sky-50/60 px-2.5 py-2">
            <p className="mb-1 text-[11px] font-bold text-sky-800">🚌 고른 아이의 셔틀 배정 (보기 전용)</p>
            <ul className="flex flex-col gap-0.5">
              {pickedRides.map((r, i) => (
                <li key={i} className="text-[11px] text-sky-900">
                  <b>{r.nameRaw}</b>
                  <span className="ml-1.5">{r.route ?? "노선 미상"}</span>
                  <span className="ml-1.5 text-sky-700">{r.stop ?? "정류장 미상"}</span>
                  <span className="ml-1.5 font-semibold">
                    {r.weekdays.length === 5
                      ? "매일"
                      : r.weekdays
                          .slice()
                          .sort()
                          .map((w) => WEEKDAYS.find((x) => x.n === w)?.ko ?? w)
                          .join("·")}
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-1 text-[10px] text-sky-700/80">
              이 요일에 학원차를 넣으면 셔틀 배정은 그대로 남습니다. 정말 안 타는 날이면 [셔틀 → 탑승 배정]에서도
              빼주세요.
            </p>
          </div>
        )}
      </section>

      {/* ── 최근 학부모 연락 (보기 전용) ──────────────────────────────────────
          넣을 때 «누구였더라»를 보려고 업무보드로 돌아가야 했습니다. 그 왕복이 곧
          «나중에 하자»가 되고, 나중에 한 것은 대개 안 한 것이 됩니다.
          자료를 옮겨 담지 않습니다 - 원본은 픽업 인박스이고 여기는 창문입니다. */}
      <section className="rounded-2xl border border-slate-200 bg-white p-3">
        <div className="mb-2 flex flex-wrap items-baseline gap-2">
          <h2 className="text-sm font-bold text-slate-800">📮 최근 학부모 연락</h2>
          <span className="text-[11px] text-slate-400">최근 2주 · 보기 전용 · 이름을 누르면 위에서 그 아이가 골라집니다</span>
        </div>
        {inquiries.length === 0 ? (
          <p className="py-4 text-center text-xs text-slate-400">최근 2주 연락이 없습니다.</p>
        ) : (
          <div className="max-h-64 overflow-y-auto">
            <ul className="flex flex-col gap-1">
              {inquiries.map((q) => (
                <li key={q.id} className="rounded-lg border border-slate-100 px-2 py-1.5 text-[11px]">
                  <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                    <button
                      type="button"
                      onClick={() => pickFromInquiry(q)}
                      className="rounded bg-slate-800 px-1.5 py-0.5 text-[11px] font-bold text-white hover:bg-slate-700"
                      title="이 아이를 위에서 고릅니다"
                    >
                      {q.name}
                    </button>
                    <span className="rounded bg-slate-100 px-1 text-[10px] font-semibold text-slate-500">{q.kind}</span>
                    <span className="text-slate-700">{q.summary || q.raw?.slice(0, 60) || "—"}</span>
                    <span className="ml-auto whitespace-nowrap text-[10px] text-slate-400">
                      {new Date(q.at).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}
                    </span>
                    {/* 요약에는 시각이 잘려 있는 경우가 있어 원문을 열 수 있게 둡니다. */}
                    {q.raw && (
                      <button
                        type="button"
                        onClick={() => setOpenRaw(openRaw === q.id ? null : q.id)}
                        className="text-[10px] font-semibold text-slate-500 underline decoration-dotted"
                      >
                        {openRaw === q.id ? "원문 접기" : "원문"}
                      </button>
                    )}
                    {q.url && (
                      <a href={q.url} target="_blank" rel="noreferrer" className="text-[10px] font-semibold text-sky-700 underline">
                        ↗ 토들
                      </a>
                    )}
                  </div>
                  {openRaw === q.id && q.raw && (
                    <p className="mt-1 whitespace-pre-wrap break-words rounded bg-slate-50 p-2 text-[11px] leading-relaxed text-slate-600">
                      {q.raw}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      {/* ── 명단 ───────────────────────────────────────────────────────────── */}
      <section className="rounded-2xl border border-slate-200 bg-white p-3">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="이름·반으로 찾기"
            className="w-48 rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm"
          />
          <button
            type="button"
            onClick={() => setOnlySet((v) => !v)}
            className={
              "rounded-lg px-2 py-1 text-[11px] font-semibold " +
              (onlySet ? "bg-lime-100 text-lime-800" : "border border-slate-200 text-slate-500 hover:bg-slate-50")
            }
          >
            {onlySet ? "넣어둔 아이만 보는 중" : "넣어둔 아이만"}
          </button>
          <span className="ml-auto text-[11px] text-slate-400">{list.length}명</span>
        </div>

        <div className="max-h-[60vh] overflow-y-auto">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-slate-50 text-left text-[11px] text-slate-400">
              <tr>
                <th className="px-2 py-1.5">고르기</th>
                <th className="px-2 py-1.5">학생</th>
                {WEEKDAYS.map((w) => (
                  <th key={w.n} className="px-2 py-1.5">
                    {w.ko}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {list.map((s) => (
                <tr key={s.id} className="border-t border-slate-100">
                  <td className="px-2 py-1.5">
                    <input
                      type="checkbox"
                      checked={picked.includes(s.id)}
                      onChange={() => toggleStudent(s.id)}
                      className="h-4 w-4"
                    />
                  </td>
                  <td className="px-2 py-1.5">
                    <b className="text-slate-800">{s.name}</b>
                    <span className="ml-1 text-[11px] text-slate-400">
                      {[s.grade ? `${s.grade}학년` : null, s.class_name].filter(Boolean).join(" ")}
                    </span>
                  </td>
                  {WEEKDAYS.map((w) => {
                    const p = planMap.get(planKey(s.id, w.n));
                    return (
                      <td key={w.n} className="px-2 py-1.5">
                        {p ? (
                          <button
                            type="button"
                            onClick={() => clearOne(s.id, w.n)}
                            title={[p.kind, p.label, p.depart_time, p.note].filter(Boolean).join(" · ") + " — 눌러서 지우기"}
                            className={"rounded px-1.5 py-0.5 text-[11px] font-semibold " + (KIND_TONE[p.kind] ?? KIND_TONE.기타)}
                          >
                            {p.depart_time ? `${p.depart_time} ` : ""}
                            {p.label || p.kind}
                            {p.range_start && p.range_end && (
                              <span className="ml-1 font-normal opacity-70">{describeRange(p.range_start, p.range_end)}</span>
                            )}
                          </button>
                        ) : (
                          <span className="text-[11px] text-slate-300">—</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
              {list.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-2 py-6 text-center text-slate-400">
                    찾는 학생이 없습니다.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="mt-1.5 text-[11px] text-slate-400">
          칸에 뜬 것을 누르면 그 요일 하원수단이 지워집니다. 비어 있는 요일은 <b>정해진 것이 없다</b>는 뜻입니다 —
          「셔틀」도 하나의 수단이라 셔틀을 타는 날도 적어두면 한 곳만 보면 됩니다.
        </p>
      </section>
    </div>
  );
}
