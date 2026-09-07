"use client";

import { useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/common/ToastProvider";

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
export type PlanRow = {
  id: string;
  student_id: string;
  weekday: number;
  kind: string;
  label: string | null;
  depart_time: string | null;
  note: string | null;
};

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
}: {
  students: StudentLite[];
  initialPlans: PlanRow[];
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

  const planKey = (studentId: string, weekday: number) => `${studentId}|${weekday}`;
  const planMap = useMemo(() => new Map(plans.map((p) => [planKey(p.student_id, p.weekday), p])), [plans]);

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

  async function save() {
    if (picked.length === 0 || days.length === 0) {
      notify("아이와 요일을 고른 뒤 저장해주세요.", "error");
      return;
    }
    setBusy(true);
    const supabase = createClient();
    const rows = picked.flatMap((sid) =>
      days.map((w) => ({
        student_id: sid,
        weekday: w,
        kind,
        label: label.trim() || null,
        depart_time: time.trim() || null,
        note: note.trim() || null,
      }))
    );
    // 한 아이의 한 요일에는 하나뿐이라, 이미 있으면 덮어씁니다.
    const { data, error } = await supabase
      .from("student_dismissal_plans")
      .upsert(rows, { onConflict: "student_id,weekday" })
      .select();
    setBusy(false);
    if (error) {
      notify("저장하지 못했습니다: " + error.message, "error");
      return;
    }
    const saved = (data as PlanRow[] | null) ?? [];
    setPlans((prev) => {
      const next = prev.filter((p) => !saved.some((s) => s.student_id === p.student_id && s.weekday === p.weekday));
      return [...next, ...saved];
    });
    notify(`${picked.length}명 × ${days.length}요일 = ${rows.length}건 저장했습니다.`, "success");
    setPicked([]);
    setDays([]);
  }

  async function clearOne(studentId: string, weekday: number) {
    const p = planMap.get(planKey(studentId, weekday));
    if (!p) return;
    const supabase = createClient();
    const { error } = await supabase.from("student_dismissal_plans").delete().eq("id", p.id);
    if (error) {
      notify("지우지 못했습니다: " + error.message, "error");
      return;
    }
    setPlans((prev) => prev.filter((x) => x.id !== p.id));
  }

  return (
    <div className="flex flex-col gap-3">
      {/* ── 넣기 ───────────────────────────────────────────────────────────── */}
      <section className="rounded-2xl border border-slate-200 bg-white p-3">
        <h2 className="mb-2 text-sm font-bold text-slate-800">한 번에 넣기</h2>

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
          형제자매처럼 같은 차를 타는 아이는 함께 고르면 한 번에 들어갑니다. 이미 넣어둔 요일이 있으면{" "}
          <b>덮어씁니다</b> — 한 아이의 한 요일에는 하원수단이 하나뿐입니다.
        </p>
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
