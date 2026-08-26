-- 로그성 표의 보관주기 정리를 위한 인덱스
--
-- 야간 크론(/api/cron/purge-shuttle-locations)이 기간이 지난 로그를 지우도록 확장했는데,
-- 이 표들에는 "언제 만들어졌는가"로 찾는 인덱스가 없었습니다. 지금은 행이 적어서 전체를 훑어도
-- 금방 끝나지만, 매일 쌓이는 표라서 그대로 두면 지우는 작업 자체가 점점 무거워집니다.
--
-- 조회 쪽에도 같은 인덱스가 필요합니다 - 개발자 대시보드의 오류 로그·AI 사용량 화면은 항상
-- "최근 것부터" 정렬해서 보여주는데, 인덱스가 없으면 매번 표 전체를 정렬합니다.
--
-- ⚠️ 아직 만들어지지 않은 표가 있을 수 있습니다(안전운행 기록처럼 기능은 코드에 있지만 해당
-- 마이그레이션을 아직 실행하지 않은 경우). 그런 표에 인덱스를 만들려 하면 예전 버전처럼
--   ERROR: 42P01: relation "shuttle_safety_events" does not exist
-- 로 스크립트 전체가 멈춰버려서, 정작 만들 수 있는 인덱스까지 하나도 안 만들어집니다.
-- 그래서 표가 실제로 있을 때만 만들도록 to_regclass로 확인하고 넘어갑니다 - 나중에 그 표를
-- 만들면 이 파일을 다시 실행해 인덱스를 채우면 됩니다.
begin;

do $$
declare
  t record;
begin
  for t in
    select *
    from (values
      ('error_logs',            'error_logs_created_at_idx',              '(created_at desc)'),
      ('ai_usage_logs',         'ai_usage_logs_created_at_idx',           '(created_at desc)'),
      -- 라우트별 사용량 집계(어떤 AI 기능이 토큰을 얼마나 쓰는지)에서 함께 쓰입니다.
      ('ai_usage_logs',         'ai_usage_logs_route_created_idx',        '(route, created_at desc)'),
      ('shuttle_run_events',    'shuttle_run_events_created_at_idx',      '(created_at)'),
      -- 안전운행 기록만 시각 칸 이름이 recorded_at입니다(다른 표는 created_at).
      ('shuttle_safety_events', 'shuttle_safety_events_recorded_at_idx',  '(recorded_at)'),
      ('shuttle_pilot_pings',   'shuttle_pilot_pings_recorded_at_idx',    '(recorded_at)'),
      ('google_chat_mirror_messages',
                                'gcm_created_at_google_idx',              '(created_at_google)')
    ) as v(table_name, index_name, cols)
  loop
    if to_regclass('public.' || t.table_name) is null then
      raise notice '건너뜀: %(표 없음)', t.table_name;
      continue;
    end if;
    execute format('create index if not exists %I on public.%I %s', t.index_name, t.table_name, t.cols);
    raise notice '완료: % → %', t.table_name, t.index_name;
  end loop;
end $$;

commit;
