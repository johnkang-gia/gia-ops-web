// 학부모 테스트 화면(2단계-c) 전용 최소 서비스워커 - 푸시 수신 + 알림 표시만 담당합니다.
// 앱 전체 오프라인 캐싱 등은 하지 않습니다(범위를 학부모 알림 기능으로 한정).
self.addEventListener("push", (event) => {
  let payload = { title: "GIA 셔틀", body: "새 소식이 있습니다." };
  try {
    if (event.data) payload = event.data.json();
  } catch {
    // JSON이 아니면 기본 문구를 그대로 씁니다.
  }
  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: "/icon-512.png",
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(self.clients.openWindow("/"));
});
