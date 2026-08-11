"use client";

import { useEffect, useState } from "react";

const DISMISS_KEY = "gia-a2hs-banner-dismissed-at";
const DISMISS_DAYS = 3;

// 요청: "못하는 사람들 하나하나 찾아다니면서 설명할 수가 없어, 더 간단하게 자기 핸드폰에
// 추가하게 하는 방법 없을까?" - 로그인 없는 토큰 링크(도착체크 등)를 열었을 때, 아직 홈 화면에
// 추가하지 않은 경우 화면 위쪽에 추가 방법을 자동으로 안내해서 관리자가 일일이 말로 설명할
// 필요가 없게 합니다. 이미 홈 화면 아이콘으로 실행 중이면(standalone) 뜨지 않고, iOS는 Safari
// 공유 버튼, 안드로이드는 브라우저 메뉴로 안내 문구를 다르게 보여줍니다. 닫으면 며칠 동안은
// 다시 뜨지 않습니다(계속 뜨면 오히려 거슬려서 안 보게 되므로).
export default function AddToHomeScreenBanner() {
  const [platform, setPlatform] = useState<"ios" | "android" | null>(null);
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    const nav = window.navigator as Navigator & { standalone?: boolean };
    const isStandalone = nav.standalone === true || window.matchMedia("(display-mode: standalone)").matches;
    if (isStandalone) return;

    const ua = navigator.userAgent;
    const isIOS = /iphone|ipad|ipod/i.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    const isAndroid = /android/i.test(ua);
    if (!isIOS && !isAndroid) return;

    const lastDismissed = Number(localStorage.getItem(DISMISS_KEY) ?? 0);
    const daysSince = (Date.now() - lastDismissed) / (1000 * 60 * 60 * 24);
    if (lastDismissed && daysSince < DISMISS_DAYS) return;

    setPlatform(isIOS ? "ios" : "android");
    setDismissed(false);
  }, []);

  function dismiss() {
    localStorage.setItem(DISMISS_KEY, String(Date.now()));
    setDismissed(true);
  }

  if (!platform || dismissed) return null;

  return (
    <div className="mb-2 flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-2.5 py-2">
      <span className="shrink-0 text-lg">📲</span>
      <p className="flex-1 text-[11px] font-semibold leading-snug text-blue-800">
        {platform === "ios" ? (
          <>
            홈 화면에 추가하려면 <b>공유 버튼</b>(⬆️)을 누른 뒤 <b>&quot;홈 화면에 추가&quot;</b>를 선택하세요.
          </>
        ) : (
          <>
            홈 화면에 추가하려면 오른쪽 위 <b>⋮ 메뉴</b>를 누른 뒤 <b>&quot;홈 화면에 추가&quot;</b>를 선택하세요.
          </>
        )}
      </p>
      <button onClick={dismiss} className="shrink-0 rounded-full px-1.5 py-0.5 text-sm font-bold text-blue-400">
        ✕
      </button>
    </div>
  );
}
