-- 요청 변경: 테스트라도 하원 시간대(평일 15:30~18:30)에만 추적. 27호 기기의 24시간 추적을 끕니다.
-- (관리자 화면 셔틀 → 링크·기기 관리에서 27호의 [24h 테스트]를 꺼도 동일합니다.)
update shuttle_tracker_devices set always_on = false
where route_id in (
  select id from shuttle_routes where direction = '하원' and term = '정규학기' and route_no = '27'
);
