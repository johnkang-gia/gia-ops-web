-- 【진단 전용 · 아무것도 바꾸지 않습니다】  27호가 3일째 기록에 안 잡히는 이유 찾기
--
-- (이전 판에서 e.kind / e.auto 를 썼는데 실제 칸 이름은 e.event 였습니다. 코드에서 실제
--  타입을 확인하고 고쳤습니다 - 칸 이름을 추측해서 쓴 제 실수였습니다.)
--
-- 위치 신호는 이 사슬을 거칩니다. 어디서 끊겼는지 한 칸씩 봅니다.
--
--   기사님 폰(Traccar) → /api/shuttle/track → shuttle_pilot_pings
--                                                  ↓ (크론이 읽어서 판단)
--                                        shuttle_run_events(출발·도착)
--                                                  ↓
--                                            기록분석 화면
--
--   ① 기기 등록이 없다        → 27호에 기기가 안 붙어 있음
--   ② ping이 0이다            → 폰이 안 보내거나, 추적 시간대(평일 15:30~18:30) 밖에서 보냄
--   ③ ping은 있는데 event가 0 → **크론이 안 돌고 있음** (가장 유력)
--   ④ 둘 다 있는데 화면이 빈다 → 파일럿 등록이 꺼져 있음

-- ① 27호 노선과 기기
select '① 노선·기기' as "단계",
       r.route_no as "호차", r.direction as "방향", r.active as "사용중", r.term as "학기",
       d.device_id as "기기ID", d.enabled as "기기켜짐",
       d.last_seen_at as "기기 마지막 신호"
  from shuttle_routes r
  left join shuttle_tracker_devices d on d.route_id = r.id
 where r.route_no like '27%'
 order by r.direction;

-- ② 최근 5일 위치 신호(날짜·시간대별)
select '② 위치신호' as "단계",
       (p.recorded_at at time zone 'Asia/Seoul')::date as "날짜",
       to_char(p.recorded_at at time zone 'Asia/Seoul', 'HH24') || '시' as "시간대",
       count(*) as "건수",
       min(p.recorded_at at time zone 'Asia/Seoul')::time(0) as "처음",
       max(p.recorded_at at time zone 'Asia/Seoul')::time(0) as "마지막"
  from shuttle_pilot_pings p
  join shuttle_routes r on r.id = p.route_id
 where r.route_no like '27%'
   and p.recorded_at > now() - interval '5 days'
 group by 2,3 order by 2 desc, 3;

-- ③ 출발·도착 판단 결과(크론이 만드는 것)
select '③ 출발도착' as "단계",
       e.service_date as "날짜", e.event as "종류",
       (e.created_at at time zone 'Asia/Seoul')::timestamp(0) as "기록시각",
       coalesce(e.created_by, '(자동)') as "누가"
  from shuttle_run_events e
  join shuttle_routes r on r.id = e.route_id
 where r.route_no like '27%'
   and e.service_date > current_date - 5
 order by e.created_at desc;

-- ④ 파일럿(기록분석 화면에 뜨는 대상) 등록 상태
select '④ 파일럿등록' as "단계",
       r.route_no as "호차", r.direction as "방향", pr.enabled as "켜짐"
  from shuttle_pilot_routes pr
  join shuttle_routes r on r.id = pr.route_id
 where r.route_no like '27%';

-- ⑤ 크론 오류 기록
select '⑤ 크론오류' as "단계",
       (created_at at time zone 'Asia/Seoul')::timestamp(0) as "시각",
       route as "어디서", left(message, 120) as "내용"
  from error_logs
 where route like 'cron:shuttle%'
   and created_at > now() - interval '5 days'
 order by created_at desc limit 20;

-- ⑥ 전체 위치 신호(노선 상관없이) - 27호만 문제인지, 아예 아무것도 안 들어오는지 구분합니다.
select '⑥ 전체신호' as "단계",
       (p.recorded_at at time zone 'Asia/Seoul')::date as "날짜",
       count(*) as "건수", count(distinct p.route_id) as "노선수"
  from shuttle_pilot_pings p
 where p.recorded_at > now() - interval '5 days'
 group by 2 order by 2 desc;
