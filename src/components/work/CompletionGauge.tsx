"use client";

export default function CompletionGauge({ percent, label }: { percent: number; label: string }) {
  const r = 24;
  const c = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(100, percent));
  const offset = c - (clamped / 100) * c;

  return (
    <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
      <svg width="60" height="60" viewBox="0 0 60 60">
        <circle cx="30" cy="30" r={r} fill="none" stroke="#e2e8f0" strokeWidth="6" />
        <circle
          cx="30"
          cy="30"
          r={r}
          fill="none"
          stroke="#c6a15b"
          strokeWidth="6"
          strokeDasharray={c}
          strokeDashoffset={offset}
          strokeLinecap="round"
          transform="rotate(-90 30 30)"
        />
        <text x="30" y="35" textAnchor="middle" fontSize="13" fontWeight="700" fill="#1e293b">
          {clamped}%
        </text>
      </svg>
      <div>
        <div className="text-xs font-semibold text-slate-600">{label}</div>
        <div className="text-[11px] text-slate-400">업무 완료율</div>
      </div>
    </div>
  );
}
