-- 27호에서 좌표가 없는 정류장 2곳이 어디인지.
--
-- 이 2곳은 차가 실제로 서더라도 "몇 시에 어느 정류장" 줄이 안 생깁니다.
-- 나머지 5곳은 오늘 그대로 나옵니다.

select s.seq                                              as "순번",
       coalesce(nullif(s.address, ''), '⛔ 주소 자체가 비어 있음') as "주소",
       s.stop_time                                        as "예정 시각",
       s.gate                                             as "도착장소",
       case when s.address is null or s.address = ''
            then '주소부터 넣어야 합니다'
            else '주소는 있는데 좌표 변환이 안 됐습니다 - 주소를 다시 저장하면 바로 잡힙니다'
       end                                                as "무엇을 해야 하나",
       s.id::text                                         as "정류장 id"
  from public.shuttle_stops s
  join public.shuttle_routes r on r.id = s.route_id
 where r.route_no like '27%'
   and r.direction = '하원'
   and s.gps_lat is null
   and s.lat is null
 order by s.seq;
