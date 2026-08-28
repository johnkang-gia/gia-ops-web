-- 27호차 GPS: 출발·도착·정류장이 실제로 찍히고 있는지.
--
-- 네 가지를 순서대로 봅니다. 위에서부터 막히면 아래는 볼 것도 없습니다.
--   ① 위치 신호가 들어오고 있는가
--   ② 출발·도착(운행 이벤트)이 기록됐는가
--   ③ 정류장 도착이 찍혔는가
--   ④ 안 찍혔다면, 정류장 좌표가 없어서인가

-- ① 최근 위치 신호 --------------------------------------------------------
select r.route_no                                          as "호차",
       d.last_seen_at                                       as "마지막 신호",
       round(extract(epoch from (now() - d.last_seen_at)) / 60) as "몇 분 전",
       (select count(*) from public.shuttle_pilot_pings p
         where p.route_id = r.id
           and p.recorded_at >= now() - interval '24 hours')   as "24시간 위치 수",
       (select count(*) from public.shuttle_pilot_pings p
         where p.route_id = r.id
           and p.recorded_at::date = (now() at time zone 'Asia/Seoul')::date) as "오늘 위치 수"
  from public.shuttle_routes r
  left join public.shuttle_tracker_devices d on d.route_id = r.id
 where r.route_no = '27';

-- ② 오늘의 출발·도착 기록 -------------------------------------------------
select e.event                          as "무슨 일",
       to_char(e.created_at at time zone 'Asia/Seoul', 'HH24:MI') as "시각",
       e.created_by                     as "누가/무엇이"
  from public.shuttle_run_events e
  join public.shuttle_routes r on r.id = e.route_id
 where r.route_no = '27'
   and e.service_date = (now() at time zone 'Asia/Seoul')::date
 order by e.created_at;

-- ③ 최근 3일 정류장 도착 --------------------------------------------------
select to_char(sa.arrived_at at time zone 'Asia/Seoul', 'MM-DD HH24:MI') as "도착",
       s.seq                as "순번",
       s.address            as "정류장",
       sa.matched_by        as "어떤 기준으로 잡았나"
  from public.shuttle_stop_arrivals sa
  join public.shuttle_stops  s on s.id = sa.stop_id
  join public.shuttle_routes r on r.id = s.route_id
 where r.route_no = '27'
   and sa.arrived_at >= now() - interval '3 days'
 order by sa.arrived_at desc;

-- ④ 27호 정류장 중 좌표가 없는 곳 -----------------------------------------
--    좌표가 없으면 아무리 가까이 가도 도착으로 잡을 수 없습니다.
select s.seq      as "순번",
       s.address  as "정류장",
       case when s.lat is null or s.lng is null then '❌ 좌표 없음' else '✅ 있음' end as "좌표"
  from public.shuttle_stops  s
  join public.shuttle_routes r on r.id = s.route_id
 where r.route_no = '27'
   and r.direction = '하원'
 order by s.seq;
