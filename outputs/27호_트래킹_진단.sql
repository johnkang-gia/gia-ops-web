-- 【진단 전용 · 아무것도 바꾸지 않습니다】
-- 27호 테스트 셔틀이 3일째 기록에 안 잡히는 이유를 찾습니다.
--
-- 위치 신호는 이런 사슬을 거칩니다. 어디서 끊겼는지 한 칸씩 확인합니다.
--
--   기사님 폰(Traccar) → /api/shuttle/track → shuttle_pilot_pings
--                                                  ↓ (크론이 읽어서 판단)
--                                        shuttle_run_events(도착·출발)
--                                                  ↓
--                                            기록분석 화면
--
-- 어느 칸이 0이냐에 따라 원인이 다릅니다.
--   ① 기기 등록이 없다        → 27호에 기기가 안 붙어 있음
--   ② ping이 0이다            → 폰이 안 보내거나, 추적 시간대(평일 15:30~18:30) 밖에서 보냄
--   ③ ping은 있는데 event가 0 → **크론이 안 돌고 있음** (가장 유력)
--   ④ 둘 다 있는데 화면이 빈다 → 파일럿 등록(shuttle_pilot_routes)이 꺼져 있음

-- ① 27호 노선과 기기
select '① 노선·기기' as "단계",
       r.route_no as "호차", r.direction as "방향", r.active as "사용중", r.term as "학기",
       d.device_id as "기기", d.last_seen_at as "기기 마지막 신호"
  from shuttle_routes r
  left join shuttle_tracker_devices d on d.route_id = r.id
 where r.route_no like '27%'
 order by r.direction;

-- ② 최근 5일 위치 신호(날짜·시간대별)
select '② 위치신호' as "단계",
       (p.recorded_at at time zone 'Asia/Seoul')::date as "날짜",
       to_char(p.recorded_at at time zone 'Asia/Seoul', 'HH24') || '시' as "시간대",
       count(*) as "건수"
  from shuttle_pilot_pings p
  join shuttle_routes r on r.id = p.route_id
 where r.route_no like '27%'
   and p.recorded_at > now() - interval '5 days'
 group by 2,3 order by 2 desc, 3;

-- ③ 도착·출발 판단 결과(크론이 만드는 것)
select '③ 도착출발' as "단계",
       e.service_date as "날짜", e.kind as "종류", e.created_at as "기록시각", e.auto as "자동여부"
  from shuttle_run_events e
  join shuttle_routes r on r.id = e.route_id
 where r.route_no like '27%'
   and e.service_date > current_date - 5
 order by e.created_at desc;

-- ④ 파일럿(기록분석 화면에 뜨는 대상) 등록 상태
select '④ 파일럿등록' as "단계",
       r.route_no as "호차", pr.enabled as "켜짐", pr.created_at as "등록일"
  from shuttle_pilot_routes pr
  join shuttle_routes r on r.id = pr.route_id;

-- ⑤ 크론이 실제로 돌고 있는지 - 최근 오류 기록
select '⑤ 크론오류' as "단계", created_at as "시각", route as "어디서", message as "내용"
  from error_logs
 where route like 'cron:shuttle%'
   and created_at > now() - interval '5 days'
 order by created_at desc limit 20;
