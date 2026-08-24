import { useEffect, useState } from "react";

// 일정 시간 마우스를 안 움직이면 커서를 숨깁니다(요청: "하원운행과, 업무대시보드에서 일정시간
// 지나면 마우스 포인터 사라지게"). 사무실 대형 모니터에 하루 종일 띄워두는 화면이라, 커서가
// 화면 가운데 멈춰 있으면 거슬립니다. 마우스를 움직이거나 누르면 다시 나타납니다.
export function useIdleCursor(idleMs = 4000): boolean {
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const reset = () => {
      setHidden(false);
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => setHidden(true), idleMs);
    };
    reset();
    window.addEventListener("mousemove", reset);
    window.addEventListener("mousedown", reset);
    window.addEventListener("wheel", reset);
    window.addEventListener("keydown", reset);
    window.addEventListener("touchstart", reset);
    return () => {
      if (timer) clearTimeout(timer);
      window.removeEventListener("mousemove", reset);
      window.removeEventListener("mousedown", reset);
      window.removeEventListener("wheel", reset);
      window.removeEventListener("keydown", reset);
      window.removeEventListener("touchstart", reset);
    };
  }, [idleMs]);
  return hidden;
}
