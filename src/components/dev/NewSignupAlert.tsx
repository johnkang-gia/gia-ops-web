"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { PendingSignup } from "@/app/api/admin/pending-signups/route";

/**
 * **새 가입 신청 알림** — 개발자 계정에게만 뜹니다.
 *
 * ── 왜 이렇게 만드나 ────────────────────────────────────────────────
 *
 * 가입 신청이 오면 슬랙으로도 알림이 가지만, 슬랙을 안 보고 있으면 그 사람은 「승인 대기」
 * 화면에 갇힌 채로 하루를 보냅니다. 그래서 앱을 열면 **사이드바에 계속 남아 있는 표시**로
 * 둡니다 - 지나가는 팝업은 그 순간 화면을 안 보고 있으면 없는 것과 같습니다.
 *
 * ── 새로 온 사람은 한 번 더 알립니다 ────────────────────────────────
 *
 * 화면을 열어둔 채로 새 신청이 들어오면 사이드바 숫자만 조용히 바뀝니다. 그건 눈에 안
 * 띄므로, **이번에 새로 늘어난 사람**은 오른쪽 아래에 한 번 띄웁니다. 처음 화면을 열 때는
 * 안 띄웁니다 - 그때는 사이드바 표시로 충분하고, 열 때마다 팝업이 뜨면 곧 닫는 버릇이
 * 생깁니다.
 *
 * ── 못 읽었을 때 ────────────────────────────────────────────────────
 *
 * 다시 물어보다 실패하면 **아무 일 없던 것처럼 두지 않습니다.** 0건과 「못 읽었다」는 화면에
 * 똑같이 «표시 없음»으로 보이는데, 뒤쪽은 기다리는 사람이 있어도 모른다는 뜻입니다.
 */

/** 다시 물어보는 간격. 승인이 몇 분 늦는 것은 견딜 만하고, 짧으면 조회만 늘어납니다. */
const REFRESH_MS = 3 * 60_000;

export default function NewSignupAlert({ initial }: { initial: { items: PendingSignup[]; failed: boolean } }) {
  const [items, setItems] = useState<PendingSignup[]>(initial.items);
  const [failed, setFailed] = useState(initial.failed);
  /** 방금 새로 들어온 사람. 오른쪽 아래에 한 번 띄웁니다. */
  const [popped, setPopped] = useState<PendingSignup[]>([]);
  const known = useRef(new Set(initial.items.map((x) => x.email)));

  const check = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/pending-signups", { cache: "no-store" });
      if (!res.ok) {
        setFailed(true);
        return;
      }
      const json = (await res.json()) as { items: PendingSignup[] };
      const next = json.items ?? [];
      setFailed(false);
      const fresh = next.filter((x) => !known.current.has(x.email));
      for (const x of next) known.current.add(x.email);
      setItems(next);
      if (fresh.length > 0) setPopped(fresh);
    } catch {
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    const timer = setInterval(() => void check(), REFRESH_MS);
    // 다른 창에서 승인하고 돌아왔을 수 있습니다. 돌아온 그 순간에 맞춰줍니다.
    const onFocus = () => void check();
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [check]);

  if (items.length === 0 && !failed) return null;

  return (
    <>
      <div className="mt-2 rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-2">
        <div className="mb-1 flex items-center gap-1 text-[10px] font-bold text-amber-700">
          <span className="inline-flex h-4 min-w-4 animate-pulse items-center justify-center rounded-full bg-amber-500 px-1 text-[9px] font-black text-white">
            {items.length}
          </span>
          가입 승인 대기
        </div>
        <ul className="flex flex-col gap-0.5">
          {items.slice(0, 5).map((u) => (
            <li key={u.email} className="truncate text-[11px] font-medium text-amber-900">
              {u.name || u.email}
              {u.position && <span className="font-normal text-amber-700"> · {u.position}</span>}
            </li>
          ))}
          {items.length > 5 && <li className="text-[10px] text-amber-700">외 {items.length - 5}명</li>}
        </ul>
        {/* 못 읽었을 때를 그대로 적습니다. 조용히 0으로 두면 기다리는 사람이 있어도 모릅니다. */}
        {failed && <p className="mt-1 text-[10px] font-semibold text-red-600">지금은 확인하지 못했습니다</p>}
        <Link
          href="/admin/users"
          className="mt-1.5 block rounded-md bg-amber-500 py-1 text-center text-[10px] font-bold text-white hover:bg-amber-600"
        >
          승인하러 가기
        </Link>
      </div>

      {/* 화면을 열어둔 채로 새로 들어온 사람만 한 번 띄웁니다. */}
      {popped.length > 0 && (
        <div className="fixed bottom-4 right-4 z-[70] w-72 rounded-xl border border-amber-300 bg-white p-3 shadow-xl">
          <div className="mb-1 flex items-start gap-2">
            <span className="text-sm">🙋</span>
            <div className="min-w-0 flex-1">
              <p className="text-[12px] font-black text-slate-800">새 가입 신청이 들어왔습니다</p>
              {popped.map((u) => (
                <p key={u.email} className="truncate text-[11px] text-slate-600">
                  {u.name || "이름 미입력"} · {u.position || "직위 미입력"} · {u.email}
                </p>
              ))}
            </div>
            <button onClick={() => setPopped([])} className="shrink-0 text-xs font-bold text-slate-400 hover:text-slate-700">
              ✕
            </button>
          </div>
          <Link
            href="/admin/users"
            onClick={() => setPopped([])}
            className="mt-1 block rounded-lg bg-slate-900 py-1.5 text-center text-[11px] font-bold text-white"
          >
            사용자 관리에서 승인하기
          </Link>
        </div>
      )}
    </>
  );
}
