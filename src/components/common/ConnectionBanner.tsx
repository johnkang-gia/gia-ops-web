"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

// UX 점검에서 나온 지적 보완: Supabase 실시간 구독은 언마운트 시 정리만 할 뿐 재연결 로직이
// 없어서, 와이파이가 잠깐 끊기거나 노트북을 슬립했다 켜면 실시간 갱신이 조용히 멈춘 채로
// 남아있을 수 있습니다. 완전한 재연결 처리를 모든 구독 훅에 넣는 대신, 훨씬 가벼운 방법으로
// 같은 문제를 해결합니다: 브라우저의 online/offline 이벤트를 감지해 끊겼을 때 눈에 띄게
// 알리고, 다시 연결되면 router.refresh()로 화면을 최신 상태로 강제 동기화합니다(각 페이지의
// 서버 데이터 + 새로 마운트되는 realtime 채널이 전부 새로 맺어집니다).
export default function ConnectionBanner() {
  const [online, setOnline] = useState(true);
  const [justReconnected, setJustReconnected] = useState(false);
  const router = useRouter();

  useEffect(() => {
    setOnline(navigator.onLine);

    function handleOnline() {
      setOnline(true);
      setJustReconnected(true);
      router.refresh();
      setTimeout(() => setJustReconnected(false), 4000);
    }
    function handleOffline() {
      setOnline(false);
    }

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [router]);

  if (online && !justReconnected) return null;

  return (
    <div
      className={
        "absolute inset-x-0 top-0 z-[190] px-3 py-1 text-center text-[11px] font-semibold text-white " +
        (online ? "bg-emerald-600" : "bg-red-600")
      }
    >
      {online
        ? "🔄 인터넷이 다시 연결됐습니다 - 최신 내용으로 갱신했어요."
        : "🔌 인터넷 연결이 끊겼습니다. 지금 보이는 내용은 실시간으로 갱신되지 않을 수 있어요."}
    </div>
  );
}
