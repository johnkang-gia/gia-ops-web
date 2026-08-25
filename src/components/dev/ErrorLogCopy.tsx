"use client";

import { useState } from "react";

// 개발자 메뉴 오류 로그 복사(요청: 오류로그를 바로 복사해서 붙여넣기). 전체 복사 버튼과 개별
// 복사 버튼을 둡니다. 클립보드 접근이 막힌 환경(구형/비HTTPS)에서는 textarea 폴백을 씁니다.
export type DevErrorLog = {
  id: string;
  route: string;
  message: string;
  stack: string | null;
  user_email: string | null;
  created_at: string;
};

function fmt(e: DevErrorLog) {
  const t = e.created_at.slice(0, 19).replace("T", " ");
  return `[${t}] ${e.route}${e.user_email ? ` (${e.user_email})` : ""}\n${e.message}${e.stack ? "\n" + e.stack : ""}`;
}

async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* 폴백으로 넘어갑니다 */
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

export default function ErrorLogCopy({ logs }: { logs: DevErrorLog[] }) {
  const [copied, setCopied] = useState<string | null>(null);
  const flash = (key: string) => {
    setCopied(key);
    setTimeout(() => setCopied((c) => (c === key ? null : c)), 1500);
  };

  return (
    <div className="mb-6 flex flex-col gap-1.5">
      <div className="mb-1 flex items-center justify-between">
        <span className="text-xs font-semibold text-slate-400">최근 오류 로그 (최신 {logs.length}건)</span>
        {logs.length > 0 && (
          <button
            type="button"
            onClick={async () => {
              const ok = await copyText(logs.map(fmt).join("\n\n"));
              if (ok) flash("all");
            }}
            className="rounded-lg bg-slate-800 px-2.5 py-1 text-xs font-semibold text-white hover:bg-slate-900"
          >
            {copied === "all" ? "✓ 복사됨" : "📋 전체 복사"}
          </button>
        )}
      </div>
      {logs.length === 0 && <div className="rounded-lg bg-white p-3 text-sm text-slate-400 shadow-sm">기록된 오류가 없습니다.</div>}
      {logs.map((e) => (
        <div key={e.id} className="group rounded-lg border border-slate-200 bg-white p-3 text-xs shadow-sm">
          <div className="mb-1 flex items-center gap-2">
            <span className="shrink-0 rounded-full bg-red-50 px-2 py-0.5 font-mono text-red-600">{e.route}</span>
            <span className="shrink-0 text-slate-400">{e.created_at.slice(0, 19).replace("T", " ")}</span>
            {e.user_email && <span className="shrink-0 text-slate-400">{e.user_email}</span>}
            <button
              type="button"
              onClick={async () => {
                const ok = await copyText(fmt(e));
                if (ok) flash(e.id);
              }}
              className="ml-auto shrink-0 rounded-md border border-slate-200 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500 hover:bg-slate-50"
            >
              {copied === e.id ? "✓ 복사됨" : "📋 복사"}
            </button>
          </div>
          <p className="whitespace-pre-wrap text-slate-700">{e.message}</p>
          {e.stack && <p className="mt-1 whitespace-pre-wrap font-mono text-[10px] leading-snug text-slate-400">{e.stack}</p>}
        </div>
      ))}
    </div>
  );
}
