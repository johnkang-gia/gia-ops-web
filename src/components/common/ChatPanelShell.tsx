"use client";

import { useState } from "react";
import { APP_VERSION } from "@/lib/version";

const CHAT = "https://chat.google.com/";

export default function ChatPanelShell() {
  const [src, setSrc] = useState(CHAT);
  const [help, setHelp] = useState(false);
  return (
    <div className="flex h-screen flex-col bg-white">
      <div className="flex h-[30px] shrink-0 items-center gap-1.5 bg-slate-900 px-2 text-[12px] text-white">
        <b>💬 구글챗</b>
        <button type="button" onClick={() => setSrc(CHAT + "?r=" + Date.now())} className="rounded-md border border-slate-600 px-1.5 text-[11px] text-slate-300 hover:bg-slate-800 hover:text-white" title="다시 불러오기">
          ↻
        </button>
        <a href={CHAT} target="_blank" rel="noreferrer" className="rounded-md border border-slate-600 px-1.5 text-[11px] text-slate-300 hover:bg-slate-800 hover:text-white" title="새 탭으로 열기">
          새 탭 ↗
        </a>
        <button type="button" onClick={() => setHelp((v) => !v)} className="rounded-md border border-slate-600 px-1.5 text-[11px] text-slate-300 hover:bg-slate-800 hover:text-white" title="안 보일 때">
          ?
        </button>
        <span className="ml-auto text-[10px] opacity-60">GIA 운영앱 v{APP_VERSION}</span>
      </div>
      {help && (
        <div className="shrink-0 border-b border-slate-200 px-3 py-2 text-[12px] leading-relaxed text-slate-700">
          화면이 비어 있거나 로그인 화면이 반복되면 ① 「새 탭 ↗」으로 구글챗에 한 번 로그인한 뒤 ② 「↻」. 크롬에서 서드파티 쿠키를 전부
          차단해 두면 패널 안에서 로그인이 유지되지 않습니다 — chrome://settings/cookies 에서 「시크릿 모드에서만 차단」으로 두거나
          chat.google.com 을 허용 목록에 넣으세요.
        </div>
      )}
      <iframe title="Google Chat" src={src} className="min-h-0 flex-1 border-0" allow="clipboard-read; clipboard-write; notifications; microphone; camera" />
    </div>
  );
}
