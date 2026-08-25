"use client";

import { useEffect, useState } from "react";

// 교사 자기반 대시보드. 우리 반 학부모 문의와 오늘 픽업(시각 명시분)을 한눈에 보여줍니다.
// 30초마다 /api/my-class를 다시 불러 새 문의·픽업이 자동으로 올라옵니다.

type Pickup = { id: string; student: string; time: string | null; note: string | null; urgent: boolean };
type Inquiry = {
  id: string;
  student: string;
  type: string | null;
  summary: string;
  urgent: boolean;
  at: string;
  answered: boolean;
  url: string | null;
  raw: string | null;
};
type Data = {
  teacherName: string | null;
  classLabel: string | null;
  demo: boolean;
  pickups: Pickup[];
  inquiries: Inquiry[];
};

const POLL_MS = 30000;

function timeLabel(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const hhmm = d.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });
  if (d.toDateString() === now.toDateString()) return `오늘 ${hhmm}`;
  const days = ["일", "월", "화", "수", "목", "금", "토"];
  return `${d.getMonth() + 1}/${d.getDate()}(${days[d.getDay()]}) ${hhmm}`;
}

export default function MyClassClient() {
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState<Inquiry | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function poll() {
      try {
        const res = await fetch("/api/my-class");
        if (!res.ok) return;
        const json = (await res.json()) as Data;
        if (!cancelled) setData(json);
      } catch {
        /* 잠시 후 다시 시도 */
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    poll();
    const t = setInterval(() => { if (typeof document === "undefined" || document.visibilityState === "visible") void poll(); }, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, []);

  const pickups = data?.pickups ?? [];
  const inquiries = data?.inquiries ?? [];
  const unanswered = inquiries.filter((q) => !q.answered).length;

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h1 className="text-lg font-bold text-slate-800">우리 반 현황</h1>
          <p className="text-xs text-slate-500">
            {data?.classLabel ? `${data.classLabel} · ` : ""}
            {data?.teacherName ? `${data.teacherName} 선생님` : ""}
            {data?.demo ? " · (데모)" : ""}
          </p>
        </div>
        <p className="text-[11px] text-slate-400">30초마다 자동 새로고침됩니다</p>
      </div>

      {loading && !data ? (
        <p className="py-16 text-center text-sm text-slate-400">불러오는 중…</p>
      ) : (
        <div className="space-y-6">
          {/* ── 오늘 픽업 ─────────────────────────────────────────────── */}
          <section>
            <div className="mb-2 flex items-center gap-2">
              <h2 className="text-sm font-bold text-slate-700">🚗 오늘 픽업</h2>
              <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-semibold text-blue-600">
                {pickups.length}명
              </span>
            </div>
            {pickups.length === 0 ? (
              <p className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-3 py-4 text-center text-xs text-slate-400">
                오늘 예정된 픽업이 없습니다.
              </p>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2">
                {pickups.map((p) => (
                  <div
                    key={p.id}
                    className={
                      "flex items-center gap-3 rounded-xl border bg-white px-3 py-2.5 " +
                      (p.urgent ? "border-red-300" : "border-slate-200")
                    }
                  >
                    <div
                      className={
                        "flex min-w-[64px] flex-col items-center justify-center rounded-lg px-2 py-1 " +
                        (p.time ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-400")
                      }
                    >
                      <span className="text-base font-black leading-none">{p.time ?? "시각"}</span>
                      <span className="mt-0.5 text-[9px] font-semibold leading-none">{p.time ? "픽업" : "미정"}</span>
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-bold text-slate-800">{p.student}</p>
                      {p.note && <p className="truncate text-[11px] text-slate-500">{p.note}</p>}
                    </div>
                    {p.urgent && (
                      <span className="shrink-0 rounded bg-red-50 px-1.5 py-0.5 text-[10px] font-bold text-red-600">급함</span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* ── 우리 반 문의 ──────────────────────────────────────────── */}
          <section>
            <div className="mb-2 flex items-center gap-2">
              <h2 className="text-sm font-bold text-slate-700">💬 우리 반 문의</h2>
              {unanswered > 0 && (
                <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-600">
                  미답변 {unanswered}
                </span>
              )}
            </div>
            {inquiries.length === 0 ? (
              <p className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-3 py-4 text-center text-xs text-slate-400">
                최근 7일간 들어온 문의가 없습니다.
              </p>
            ) : (
              <div className="space-y-1.5">
                {inquiries.map((q) => (
                  <button
                    key={q.id}
                    onClick={() => setDetail(q)}
                    className={
                      "flex w-full items-start gap-2.5 rounded-lg border px-3 py-2 text-left transition hover:bg-slate-50 " +
                      (q.answered ? "border-slate-200 opacity-60" : q.urgent ? "border-red-300 bg-red-50/40" : "border-slate-200")
                    }
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-sm font-bold text-slate-800">{q.student}</span>
                        {q.type && (
                          <span className="rounded bg-blue-50 px-1.5 py-0.5 text-[10px] font-semibold text-blue-600">{q.type}</span>
                        )}
                        {q.urgent && (
                          <span className="rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-bold text-red-600">급함</span>
                        )}
                        {q.answered && (
                          <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-600">답변완료</span>
                        )}
                      </div>
                      <p className="mt-0.5 line-clamp-2 text-xs text-slate-600">{q.summary || "(요약 없음)"}</p>
                    </div>
                    <span className="shrink-0 whitespace-nowrap text-[10px] text-slate-400">{timeLabel(q.at)}</span>
                  </button>
                ))}
              </div>
            )}
          </section>
        </div>
      )}

      {/* 문의 원문 보기 */}
      {detail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setDetail(null)}>
          <div className="w-full max-w-sm rounded-2xl bg-white p-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-2 flex items-center gap-1.5">
              <span className="text-sm font-bold text-slate-800">{detail.student}</span>
              {detail.type && (
                <span className="rounded bg-blue-50 px-1.5 py-0.5 text-[10px] font-semibold text-blue-600">{detail.type}</span>
              )}
            </div>
            <p className="whitespace-pre-wrap rounded-lg bg-slate-50 p-3 text-xs leading-relaxed text-slate-700">
              {detail.raw || detail.summary || "(내용 없음)"}
            </p>
            <div className="mt-3 flex gap-2">
              {detail.url && (
                <a
                  href={detail.url}
                  target="_blank"
                  rel="noreferrer"
                  className="flex-1 rounded-xl bg-blue-600 px-3 py-2 text-center text-xs font-bold text-white active:scale-95"
                >
                  토들에서 열기
                </a>
              )}
              <button
                onClick={() => setDetail(null)}
                className="flex-1 rounded-xl bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-500"
              >
                닫기
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
