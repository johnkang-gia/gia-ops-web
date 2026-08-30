"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// 크론을 지금 눌러서 돌려보는 버튼들.
//
// 설정을 바꾸고 그게 먹었는지 보려면 다음 예약 시각까지 기다려야 했습니다. 하루 한 번짜리면
// 하루입니다. 그 사이 다른 것을 건드리게 되고, 그러면 무엇 때문에 됐는지도 흐려집니다.
//
// 결과를 그대로 펼쳐 보여줍니다. "성공"만 뜨면 무엇이 성공인지 알 수 없습니다 -
// 구독이 만들어졌는지, 아직 설정이 안 됐는지, 몇 건이 처리됐는지가 답에 들어 있습니다.

type Job = { key: string; label: string };

const JOBS: Job[] = [
  { key: "chat-subscription-renew", label: "구글챗 구독 갱신" },
  { key: "poll-chat-messages", label: "구글챗 메시지 수집" },
  { key: "shuttle-auto", label: "셔틀 도착·출발 감지" },
  { key: "pickup-schedules", label: "오늘 픽업 예약 적용" },
  { key: "shuttle-learn-stops", label: "정류장 좌표 학습" },
];

export default function RunCronButtons() {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<{ label: string; ok: boolean; text: string } | null>(null);

  async function run(job: Job) {
    setBusy(job.key);
    setResult(null);
    try {
      const res = await fetch("/api/dev/run-cron", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: job.key }),
      });
      const json = await res.json();
      setResult({
        label: job.label,
        ok: res.ok && json?.ok !== false,
        text: JSON.stringify(json?.result ?? json, null, 2),
      });
      // 크론이 심박을 갱신했을 수 있으니 위쪽 표도 다시 읽습니다.
      router.refresh();
    } catch (e) {
      setResult({ label: job.label, ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <div className="flex flex-wrap gap-1.5">
        {JOBS.map((j) => (
          <button
            key={j.key}
            type="button"
            onClick={() => run(j)}
            disabled={busy !== null}
            className="rounded-lg border border-slate-300 px-2 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40"
          >
            {busy === j.key ? "실행 중…" : `▶ ${j.label}`}
          </button>
        ))}
      </div>

      {result && (
        <div
          className={
            "mt-2 rounded-lg border p-2 " +
            (result.ok ? "border-emerald-200 bg-emerald-50" : "border-red-200 bg-red-50")
          }
        >
          <p className={"mb-1 text-[11px] font-bold " + (result.ok ? "text-emerald-800" : "text-red-700")}>
            {result.ok ? "✅" : "❌"} {result.label}
          </p>
          <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-all text-[10px] leading-tight text-slate-600">
            {result.text}
          </pre>
        </div>
      )}
    </div>
  );
}
