-- 27호 정류장 도착 점검 (학기·사용여부를 제대로 거른 판)
--
-- 앞의 판은 route_no만 보고 term·active를 안 걸어서, 화면이 올바르게 숨기고 있는
-- **여름캠프2 27호(꺼둠)** 의 정류장까지 같이 세었습니다. "(주소 없음) 순번 1"과
-- "정류장 7곳"은 그래서 나온 숫자입니다 - 화면이 맞고 제 조회가 틀렸습니다.
--
-- 이 판은 정규학기 + 사용중만 봅니다.

-- ── ① 기기가 어느 27호에 붙어 있나 (여기가 핵심) ─────────────────────────
-- 기기가 여름캠프2 27호나 데모 27호에 붙어 있으면, 다른 노선의 정류장과 거리를 재게 되어
-- 영원히 안 찍힙니다.
select d.device_id            as "기기 id",
       d.enabled              as "켜짐",
       d.last_hit_at          as "마지막 신호",
       d.last_hit_reason      as "마지막 처리",
       r.route_no             as "호차",
       r.direction            as "방향",
       r.term                 as "학기",
       r.active               as "노선 사용중",
       case when r.term = '정규학기' and r.active then '✅ 맞는 노선'
            else '🔴 엉뚱한 노선에 붙어 있습니다' end as "판정",
       (select count(*) from public.shuttle_stops s where s.route_id = r.id) as "그 노선 정류장 수"
  from public.shuttle_tracker_devices d
  left join public.shuttle_routes r on r.id = d.route_id
 where r.route_no like '27%'
    or d.enabled;

-- ── ② 정규학기 27호 정류장 상태 ──────────────────────────────────────────
select s.seq                                            as "순번",
       coalesce(nullif(s.address, ''), '(주소 없음)')     as "주소",
       s.stop_time                                      as "예정 시각",
       case
         when s.gps_lat is not null then '✅ 학습됨 (반경 80~150m)'
         when s.lat     is not null then '🟡 주소 좌표 (반경 250m)'
         else                            '🔴 좌표 없음 - 도착 못 찍음'
       end                                              as "좌표 상태",
       s.gps_day_count                                  as "학습된 날 수",
       s.gps_confidence                                 as "신뢰도"
  from public.shuttle_stops s
  join public.shuttle_routes r on r.id = s.route_id
 where r.route_no like '27%' and r.direction = '하원'
   and r.term = '정규학기' and r.active
 order by s.seq;

-- ── ③ 오늘 핑이 각 정류장에 얼마나 가까웠나 ──────────────────────────────
-- ※ 운행이 끝난 뒤(17:30 이후)에 돌려야 의미가 있습니다. 그 전에는 차가 학교에 있어서
--    전부 수백~수천 m로 나옵니다.
with pings as (
  select p.route_id, p.lat, p.lng
    from public.shuttle_pilot_pings p
   where p.recorded_at >= (now() at time zone 'Asia/Seoul')::date
),
stops as (
  select s.id, s.route_id, s.seq, s.address, s.gps_lat,
         coalesce(s.gps_lat, s.lat) as slat,
         coalesce(s.gps_lng, s.lng) as slng
    from public.shuttle_stops s
    join public.shuttle_routes r on r.id = s.route_id
   where r.route_no like '27%' and r.direction = '하원'
     and r.term = '정규학기' and r.active
)
select st.seq                                        as "순번",
       coalesce(nullif(st.address, ''), '(주소 없음)') as "정류장",
       round(min(
         6371000 * acos(least(1, greatest(-1,
           sin(radians(pg.lat)) * sin(radians(st.slat)) +
           cos(radians(pg.lat)) * cos(radians(st.slat)) * cos(radians(pg.lng - st.slng))
         )))
       )::numeric)                                   as "가장 가까웠던 거리(m)",
       case when st.gps_lat is not null then 80 else 250 end as "허용 반경(m)",
       case
         when min(
           6371000 * acos(least(1, greatest(-1,
             sin(radians(pg.lat)) * sin(radians(st.slat)) +
             cos(radians(pg.lat)) * cos(radians(st.slat)) * cos(radians(pg.lng - st.slng))
           )))
         ) <= (case when st.gps_lat is not null then 80 else 250 end)
         then '✅ 반경 안까지 갔음'
         else '⏳ 반경 밖'
       end                                           as "판정"
  from stops st
  left join pings pg on pg.route_id = st.route_id
 where st.slat is not null
 group by st.seq, st.address, st.gps_lat
 order by st.seq;

-- ── ④ 오늘 찍힌 정류장 도착 ──────────────────────────────────────────────
select to_char(a.arrived_at at time zone 'Asia/Seoul', 'HH24:MI') as "도착시각",
       r.route_no      as "호차",
       s.seq           as "순번",
       s.address       as "정류장",
       a.distance_m    as "거리(m)",
       a.matched_by    as "근거"
  from public.shuttle_stop_arrivals a
  join public.shuttle_routes r on r.id = a.route_id
  join public.shuttle_stops  s on s.id = a.stop_id
 where a.service_date = (now() at time zone 'Asia/Seoul')::date
 order by a.arrived_at;
