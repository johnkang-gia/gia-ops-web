-- 27호가 오늘 정류장·기록분석까지 나올 준비가 됐는지 한 번에 확인합니다.
--
-- 추적은 **평일 15:30~18:30**에만 켜집니다(창 밖 좌표는 서버가 받아서 버립니다).
-- 그래서 그 전에는 "아직 없음"이 정상입니다. 문제는 "창이 열렸는데도 안 나오는 것"이고,
-- 그건 아래 5가지 중 하나가 비어 있기 때문입니다.
--
-- ⑤가 이번에 가장 의심스러운 자리입니다. 정류장에 좌표가 없으면 차는 잘 다녀도
-- "어느 정류장에 섰는지"를 아무도 모릅니다 - 기록분석의 정류장 줄이 통째로 비어 보입니다.

-- ── ① 27호 노선이 있는가 ─────────────────────────────────────────────────
select '① 노선' as "단계", id::text as "값", route_no as "호차", name as "지역", term as "학기", active::text as "사용중"
  from public.shuttle_routes
 where route_no like '27%' and direction = '하원';

-- ── ② 기사님 휴대폰(Traccar)이 27호에 연결되어 있는가 ────────────────────
select '② 기기' as "단계",
       d.device_id as "기기 id",
       d.enabled::text as "켜짐",
       r.route_no as "연결된 호차",
       d.last_seen_at as "마지막 신호"
  from public.shuttle_tracker_devices d
  left join public.shuttle_routes r on r.id = d.route_id
 where r.route_no like '27%';

-- ── ③ 오늘 위치가 실제로 들어오고 있는가 ─────────────────────────────────
-- 15:30 전이면 0이 정상입니다.
select '③ 오늘 위치' as "단계",
       count(*) as "핑 개수",
       min(recorded_at) as "처음",
       max(recorded_at) as "마지막"
  from public.shuttle_pilot_pings p
  join public.shuttle_routes r on r.id = p.route_id
 where r.route_no like '27%'
   and p.recorded_at >= (now() at time zone 'Asia/Seoul')::date;

-- ── ④ 오늘 도착·출발이 찍혔는가 ──────────────────────────────────────────
select '④ 운행 이벤트' as "단계", e.event as "무엇", e.created_at as "언제"
  from public.shuttle_run_events e
  join public.shuttle_routes r on r.id = e.route_id
 where r.route_no like '27%'
   and e.service_date = (now() at time zone 'Asia/Seoul')::date
 order by e.created_at;

-- ── ⑤ 정류장에 좌표가 있는가 (가장 중요) ─────────────────────────────────
--
-- 도착 판정은 "핑 좌표와 정류장 좌표의 거리 ≤ 80m"입니다.
-- gps_lat(학습값)이 있으면 그걸 쓰고, 없으면 lat(주소 지오코딩)을 씁니다.
-- 둘 다 비어 있으면 그 정류장은 **영원히 도착이 안 찍힙니다.**
select '⑤ 정류장 좌표' as "단계",
       s.seq as "순번",
       coalesce(nullif(s.address, ''), '(주소가 비어 있음)') as "정류장 주소",
       s.stop_time as "예정 시각",
       case
         when s.gps_lat is not null then '✅ 학습된 좌표'
         when s.lat     is not null then '🟡 주소 좌표(정확도 낮음)'
         else                            '🔴 좌표 없음 - 도착이 안 찍힙니다'
       end as "상태"
  from public.shuttle_stops s
  join public.shuttle_routes r on r.id = s.route_id
 where r.route_no like '27%' and r.direction = '하원'
 order by s.seq;

-- ── 요약 ─────────────────────────────────────────────────────────────────
select
  (select count(*) from public.shuttle_stops s join public.shuttle_routes r on r.id = s.route_id
    where r.route_no like '27%' and r.direction = '하원') as "27호 정류장 수",
  (select count(*) from public.shuttle_stops s join public.shuttle_routes r on r.id = s.route_id
    where r.route_no like '27%' and r.direction = '하원' and s.gps_lat is null and s.lat is null) as "좌표 없는 정류장",
  (select count(*) from public.shuttle_stop_arrivals a join public.shuttle_routes r on r.id = a.route_id
    where r.route_no like '27%' and a.service_date = (now() at time zone 'Asia/Seoul')::date) as "오늘 정류장 도착",
  to_char(now() at time zone 'Asia/Seoul', 'YYYY-MM-DD HH24:MI') as "지금(한국)",
  case
    when extract(dow from now() at time zone 'Asia/Seoul') in (0, 6) then '주말 - 추적 안 함'
    when (now() at time zone 'Asia/Seoul')::time < '15:30' then '아직 창이 안 열림(15:30부터)'
    when (now() at time zone 'Asia/Seoul')::time >= '18:30' then '창이 닫힘'
    else '✅ 지금 추적 시간대'
  end as "추적 창";
