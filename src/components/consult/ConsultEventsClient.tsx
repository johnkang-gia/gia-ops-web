"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { ConsultEvent } from "@/lib/consult/model";
import { todayKst } from "@/lib/kst";

const STATUS_CHIP: Record<ConsultEvent["status"], string> = {
  준비: "bg-slate-100 text-slate-700",
  진행: "bg-emerald-600 text-white",
  종료: "bg-slate-200 text-slate-500",
};

export default function ConsultEventsClient({
  events,
  counts,
  loadError,
}: {
  events: ConsultEvent[];
  counts: Record<string, { total: number; done: number }>;
  loadError: string | null;
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [date, setDate] = useState(todayKst());
  const [endDate, setEndDate] = useState("");
  const [copyFrom, setCopyFrom] = useState<string>(events[0]?.id ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(loadError);

  async function create() {
    if (!name.trim()) {
      setError("행사 이름을 적어 주세요. 예: 2026학년도 2학기 학부모 상담");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/consult/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, event_date: date || null, end_date: endDate || null, copy_rooms_from: copyFrom || null }),
      });
      const j = (await res.json()) as { id?: string; error?: string; warning?: string };
      if (!res.ok || !j.id) {
        setError(j.error ?? "행사를 만들지 못했습니다.");
        return;
      }
      if (j.warning) alert(j.warning);
      router.push(`/school/consult/${j.id}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 sm:p-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900">학부모 상담</h1>
          <p className="mt-1 text-sm text-slate-500">
            행사마다 상담실·명단·기록이 따로 남습니다. 명단은 운영앱 명부에서 고르고, 현황판은 로그인 없이 태블릿·전자칠판에 띄웁니다.
          </p>
        </div>
        <Link href="/consult" className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50">
          🧑‍🏫 면담 화면 열기
        </Link>
      </header>

      {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}

      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="text-sm font-bold text-slate-800">새 상담 행사</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-[2fr_1fr_1fr]">
          <label className="text-xs text-slate-500">
            행사 이름
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="2026학년도 2학기 학부모 상담"
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900"
            />
          </label>
          <label className="text-xs text-slate-500">
            날짜
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
          </label>
          <label className="text-xs text-slate-500">
            끝 날짜(이틀 이상일 때)
            <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
          </label>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          {events.length > 0 && (
            <label className="flex items-center gap-2 text-xs text-slate-600">
              상담실 가져오기
              <select value={copyFrom} onChange={(e) => setCopyFrom(e.target.value)} className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm">
                <option value="">가져오지 않음</option>
                {events.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <button
            onClick={() => void create()}
            disabled={saving}
            className="ml-auto rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {saving ? "만드는 중…" : "+ 행사 만들기"}
          </button>
        </div>
      </section>

      <section className="space-y-2">
        {events.length === 0 && !loadError && (
          <p className="rounded-xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">아직 상담 행사가 없습니다.</p>
        )}
        {events.map((e) => {
          const c = counts[e.id] ?? { total: 0, done: 0 };
          return (
            <Link
              key={e.id}
              href={`/school/consult/${e.id}`}
              className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm hover:border-indigo-300"
            >
              <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS_CHIP[e.status]}`}>{e.status}</span>
              <span className="font-semibold text-slate-900">{e.name}</span>
              <span className="text-sm text-slate-500">
                {e.event_date ?? "날짜 미정"}
                {e.end_date ? ` ~ ${e.end_date}` : ""}
              </span>
              <span className="ml-auto text-sm text-slate-600">
                {c.done} / {c.total} 상담 완료
              </span>
            </Link>
          );
        })}
      </section>
    </div>
  );
}
