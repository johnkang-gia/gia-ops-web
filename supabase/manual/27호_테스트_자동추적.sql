-- 27호 GPS 테스트: 온오프 없이 자동 추적(요청: "테스트는 그냥 (...) 온오프 하지말고 자동으로
-- 추적되도록"). 해당 기기를 always_on=true로 두어 시간대와 무관하게 항상 위치를 기록합니다.
-- (관리자 화면 셔틀 → 링크·기기 관리에서 27호의 [24h 테스트] 버튼을 켜도 동일합니다.)
update shuttle_tracker_devices set always_on = true, enabled = true
where route_id in (
  select id from shuttle_routes where direction = '하원' and term = '정규학기' and route_no = '27'
);
