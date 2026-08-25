-- 로그성 표의 보관주기 정리를 위한 인덱스
--
-- 야간 크론(/api/cron/purge-shuttle-locations)이 기간이 지난 로그를 지우도록 확장했는데,
-- 이 표들에는 "언제 만들어졌는가"로 찾는 인덱스가 없었습니다. 지금은 행이 적어서 전체를 훑어도
-- 금방 끝나지만, 매일 쌓이는 표라서 그대로 두면 지우는 작업 자체가 점점 무거워집니다.
--
-- 조회 쪽에도 같은 인덱스가 필요합니다 - 개발자 대시보드의 오류 로그·AI 사용량 화면은 항상
-- "최근 것부터" 정렬해서 보여주는데, 인덱스가 없으면 매번 표 전체를 정렬합니다.
begin;

create index if not exists error_logs_created_at_idx
  on error_logs (created_at desc);

create index if not exists ai_usage_logs_created_at_idx
  on ai_usage_logs (created_at desc);

-- 라우트별 사용량 집계(어떤 AI 기능이 토큰을 얼마나 쓰는지)에서 함께 쓰입니다.
create index if not exists ai_usage_logs_route_created_idx
  on ai_usage_logs (route, created_at desc);

create index if not exists shuttle_run_events_created_at_idx
  on shuttle_run_events (created_at);

create index if not exists shuttle_safety_events_recorded_at_idx
  on shuttle_safety_events (recorded_at);

commit;
