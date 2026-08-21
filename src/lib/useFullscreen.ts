"use client";

import { useCallback, useEffect, useState } from "react";

// 사무실 모니터를 CCTV 프로그램과 반반으로 나눠 쓰다가, 하원 시간에만 대시보드가 화면 전체를
// 덮게 하기 위한 도구입니다(요청: "cctv프로그램하고 화면을 분할해서 반반 쓰고 있는데
// 하원시간에는 전체화면으로 전환되고 하원종료버튼을 누르거나 종료시간이 되면 다시 화면
// 되돌리게 만들어줘").
//
// 브라우저는 창 크기나 OS의 화면 분할을 바꿀 수 없습니다. 대신 전체화면(Fullscreen) 기능을 쓰면
// 브라우저가 모니터 전체를 덮어 옆의 CCTV 화면을 가리므로, 보는 사람 입장에서는 원하는 결과와
// 같습니다. 빠져나오면 원래 반반 배치가 그대로 돌아옵니다.
//
// ⚠️ 브라우저의 안전장치 하나를 알아둬야 합니다.
//   - 전체화면으로 "들어가는" 것은 사용자가 방금 무언가를 클릭한 직후에만 허용됩니다. 아무
//     웹사이트나 시간이 되면 마음대로 화면을 덮어버리는 것을 막기 위한 규칙입니다. 그래서
//     타이머만으로 자동 전환하려 하면 브라우저가 조용히 거절합니다.
//   - 전체화면에서 "나오는" 것은 아무 제약이 없습니다. 그래서 종료 시각이 되면 자동 복귀는
//     완전히 자동으로 동작합니다.
//
// 그래서 이 도구는 일단 자동 전환을 시도해보고, 거절당하면 화면에 큰 버튼을 띄우도록
// 성공/실패를 알려줍니다. (사무실 PC가 크롬 기업정책으로 자동 전체화면을 허용해둔 경우에는
// 시도가 성공해서 버튼 없이 그대로 전환됩니다.)

type FullscreenElement = HTMLElement & {
  webkitRequestFullscreen?: () => Promise<void> | void;
};
type FullscreenDocument = Document & {
  webkitExitFullscreen?: () => Promise<void> | void;
  webkitFullscreenElement?: Element | null;
};

function currentFullscreenElement(): Element | null {
  const doc = document as FullscreenDocument;
  return doc.fullscreenElement ?? doc.webkitFullscreenElement ?? null;
}

export function useFullscreen() {
  const [isFullscreen, setIsFullscreen] = useState(false);

  // 사용자가 Esc나 F11로 직접 빠져나가는 경우도 있어서, 우리 상태를 브라우저의 실제 상태에
  // 맞춰 둡니다. 이걸 안 하면 "전체화면인 줄 아는데 실제로는 아닌" 어긋남이 생깁니다.
  useEffect(() => {
    function sync() {
      setIsFullscreen(!!currentFullscreenElement());
    }
    sync();
    document.addEventListener("fullscreenchange", sync);
    document.addEventListener("webkitfullscreenchange", sync);
    return () => {
      document.removeEventListener("fullscreenchange", sync);
      document.removeEventListener("webkitfullscreenchange", sync);
    };
  }, []);

  // 성공하면 true, 브라우저가 거절하면 false를 돌려줍니다(거절은 오류가 아니라 정상적인
  // 상황이므로 화면을 깨뜨리지 않고 조용히 알려주기만 합니다).
  const enter = useCallback(async (): Promise<boolean> => {
    if (currentFullscreenElement()) return true;
    const el = document.documentElement as FullscreenElement;
    try {
      if (el.requestFullscreen) await el.requestFullscreen({ navigationUI: "hide" });
      else if (el.webkitRequestFullscreen) await el.webkitRequestFullscreen();
      else return false;
      return true;
    } catch {
      return false;
    }
  }, []);

  const exit = useCallback(async () => {
    if (!currentFullscreenElement()) return;
    const doc = document as FullscreenDocument;
    try {
      if (doc.exitFullscreen) await doc.exitFullscreen();
      else if (doc.webkitExitFullscreen) await doc.webkitExitFullscreen();
    } catch {
      // 이미 빠져나온 상태 등 - 무시해도 화면에 영향이 없습니다.
    }
  }, []);

  return { isFullscreen, enter, exit };
}
