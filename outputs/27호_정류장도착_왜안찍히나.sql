-- 위치는 들어오는데 정류장 도착이 안 찍히는 이유.
--
-- 도착 판정은 딱 한 줄입니다:
--   "지금 핑 좌표에서 **그 기기에 연결된 노선의** 정류장 중 가장 가까운 것까지 80m 이내인가"
--
-- 그러니 안 찍히는 이유도 셋뿐입니다.
--   ⓐ 기기가 엉뚱한 노선에 붙어 있다   - 다른 노선의 정류장과 재고 있으니 영원히 멀다
--   ⓑ 정류장에 좌표가 없다             - 재볼 대상이 아예 없다 (27호는 2곳이 그렇습니다)
--   ⓒ 아직 80m 안에 안 들어왔다        - 정상. 곧 찍힙니다
--
-- ③번 표의 "가장 가까웠던 거리"가 답을 말해줍니다.

-- ── ① 기기가 어느 노선에 붙어 있나 ───────────────────────────────────────
select d.device_id                       as "기기 id",
       d.enabled                         as "켜짐",
       d.always_on                       as "24시간",
       d.last_hit_at                     as "마지막 신호",
       d.last_hit_reason                 as "마지막 처리",
       r.route_no                        as "연결된 호차",
       r.direction                       as "방향",
       r.term                            as "학기",
       r.active                          as "노선 사용중",
       (select count(*) from public.shuttle_stops s where s.route_id = r.id)                          as "그 노선 정류장 수",
       (select count(*) from public.shuttle_stops s
         where s.route_id = r.id and coalesce(s.gps_lat, s.lat) is not null)                          as "좌표 있는 정류장",
       r.id::text                        as "노선 id"
  from public.shuttle_tracker_devices d
  left join public.shuttle_routes r on r.id = d.route_id
 order by d.last_hit_at desc nulls last;

-- ── ② 오늘 들어온 핑 (최근 20개) ─────────────────────────────────────────
select to_char(p.recorded_at at time zone 'Asia/Seoul', 'HH24:MI:SS') as "시각",
       round(p.lat::numeric, 6)  as "위도",
       round(p.lng::numeric, 6)  as "경도",
       p.accuracy                as "오차(m)",
       round(p.speed::numeric, 1) as "속도(km/h)",
       r.route_no                as "호차"
  from public.shuttle_pilot_pings p
  join public.shuttle_routes r on r.id = p.route_id
 where p.recorded_at >= (now() at time zone 'Asia/Seoul')::date
 order by p.recorded_at desc
 limit 20;

-- ── ③ 오늘 핑들이 정류장에 얼마나 가까웠나 (핵심) ────────────────────────
--
-- 정류장마다 "오늘 가장 가까이 지나간 거리"를 잽니다.
--   80m 이하  → 도착이 찍혔어야 합니다. 안 찍혔으면 저장이 실패한 것입니다.
--   80m 초과  → 아직 안 갔거나, 정류장 좌표가 실제 정차 지점과 다릅니다.
with pings as (
  select p.route_id, p.lat, p.lng
    from public.shuttle_pilot_pings p
   where p.recorded_at >= (now() at time zone 'Asia/Seoul')::date
),
stops as (
  select s.id, s.route_id, s.seq, s.address,
         coalesce(s.gps_lat, s.lat) as slat,
         coalesce(s.gps_lng, s.lng) as slng
    from public.shuttle_stops s
)
select r.route_no                                   as "호차",
       st.seq                                       as "순번",
       coalesce(nullif(st.address, ''), '(주소 없음)') as "정류장",
       case when st.slat is null then null else round(min(
         6371000 * acos(least(1, greatest(-1,
           sin(radians(pg.lat)) * sin(radians(st.slat)) +
           cos(radians(pg.lat)) * cos(radians(st.slat)) * cos(radians(pg.lng - st.slng))
         )))
       )::numeric) end                              as "가장 가까웠던 거리(m)",
       case
         when st.slat is null then '🔴 정류장 좌표 없음 - 잴 수가 없습니다'
         when min(
           6371000 * acos(least(1, greatest(-1,
             sin(radians(pg.lat)) * sin(radians(st.slat)) +
             cos(radians(pg.lat)) * cos(radians(st.slat)) * cos(radians(pg.lng - st.slng))
           )))
         ) <= 80 then '✅ 80m 안까지 갔음 - 찍혔어야 합니다'
         else '⏳ 아직 80m 밖'
       end                                          as "판정"
  from stops st
  join public.shuttle_routes r on r.id = st.route_id
  left join pings pg on pg.route_id = st.route_id
 where r.route_no like '27%' and r.direction = '하원'
 group by r.route_no, st.seq, st.address, st.slat, st.slng
 order by st.seq;

-- ── ④ 오늘 실제로 찍힌 정류장 도착 ───────────────────────────────────────
select to_char(a.arrived_at at time zone 'Asia/Seoul', 'HH24:MI') as "도착시각",
       r.route_no      as "호차",
       s.seq           as "순번",
       s.address       as "정류장",
       a.distance_m    as "거리(m)"
  from public.shuttle_stop_arrivals a
  join public.shuttle_routes r on r.id = a.route_id
  join public.shuttle_stops  s on s.id = a.stop_id
 where a.service_date = (now() at time zone 'Asia/Seoul')::date
 order by a.arrived_at;
