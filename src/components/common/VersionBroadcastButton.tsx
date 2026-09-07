"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/common/ToastProvider";
import { APP_VERSION } from "@/lib/version";

/**
 * 확성기 — 「지금 새로고침해달라」를 전 직원 화면에 띄웁니다.
 *
 * 배포는 하루에도 여러 번 나가지만, **새로고침해야 하는 배포는 그중 일부**입니다. 글자 색을
 * 고친 배포에까지 노란 띠가 뜨면 사람들은 그 띠를 읽지 않게 되고, 그러면 정작 자료 구조가
 * 바뀐 배포에도 아무도 안 누릅니다.
 *
 * 그 판단은 기계가 못 합니다. 그래서 버튼으로 뺐습니다 — 개발자만 보이고, 누른 그 순간부터
 * 이 버전보다 낮은 화면에만 띠가 뜹니다.
 */
export default function VersionBroadcastButton({ userName }: { userName: string }) {
  const notify = useToast();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  async function send() {
    setBusy(true);
    const { error } = await createClient().from("version_broadcasts").insert({
      version: APP_VERSION,
      // 이유는 없어도 됩니다. 대개는 그냥 「새로고침해달라」이고, 이유를 적게 강제하면
      // 그 한 걸음 때문에 아예 안 보내게 됩니다. 적었으면 띠에 함께 뜹니다.
      note: note.trim() || null,
      created_by: userName,
    });
    setBusy(false);
    if (error) {
      // 조용히 닫으면 「보냈다」고 생각하는데 아무 화면에도 안 뜹니다.
      notify("알리지 못했습니다: " + error.message, "error");
      return;
    }
    setOpen(false);
    setNote("");
    notify(`v${APP_VERSION} 새로고침 안내를 보냈습니다.`, "success");
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="이 버전으로 새로고침해달라고 전 직원 화면에 띄웁니다"
        className="rounded px-1 text-[11px] text-[var(--shell-text-muted)] transition hover:text-[var(--shell-text)]"
      >
        📢
      </button>

      {open && (
        <div className="fixed inset-0 z-[999] flex items-center justify-center bg-black/40 p-4" onClick={() => !busy && setOpen(false)}>
          <div className="w-full max-w-sm rounded-xl bg-white p-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <p className="text-sm font-bold text-slate-800">📢 새로고침 안내 보내기</p>
            <p className="mt-1 text-[12px] leading-relaxed text-slate-500">
              지금 열려 있는 모든 화면 중 <b>v{APP_VERSION}보다 낮은</b> 화면에 노란 띠가 뜹니다. 최신 화면에는 아무것도
              뜨지 않습니다.
            </p>
            <label className="mt-3 block">
              <span className="text-[11px] font-semibold text-slate-500">한 줄 이유 (선택)</span>
              <input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                onKeyDown={(e) => {
                  // 대개는 이유 없이 그냥 보냅니다. 엔터로 끝나게 둡니다 - 버튼까지 손이
                  // 가야 하면 그 한 걸음 때문에 안 보내게 됩니다.
                  if (e.key === "Enter" && !busy) void send();
                }}
                placeholder="비워두면 새로고침 안내만 보냅니다"
                maxLength={60}
                autoFocus
                className="mt-0.5 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-[13px]"
              />
              <span className="mt-0.5 block text-[11px] text-slate-400">
                적으면 띠에 함께 뜹니다. 예: 출석부 계산 기준이 바뀌었습니다
              </span>
            </label>
            <div className="mt-4 flex items-center gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => void send()}
                className="rounded-lg bg-amber-500 px-3 py-1.5 text-[12px] font-bold text-amber-950 disabled:opacity-40"
              >
                {busy ? "보내는 중…" : note.trim() ? "이유와 함께 보내기" : "새로고침 안내만 보내기"}
              </button>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-lg border border-slate-200 px-3 py-1.5 text-[12px] font-semibold text-slate-500"
              >
                닫기
              </button>
              <span className="ml-auto text-[11px] text-slate-400">
                안 보내도 매일 오전 9시에 저절로 최신화됩니다
              </span>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
