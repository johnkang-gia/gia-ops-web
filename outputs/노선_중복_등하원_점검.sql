-- 탑승 배정에 같은 호차가 두 번 뜨는 이유를 찾습니다.
--
-- 담당자: "하원 27호차가 두 개이고 하나는 오전 8시 출발 7명, 하나는 16:35 출발 3명.
--          아무래도 등원·하원이 섞인 것 같아."
--
-- 짐작되는 것은 셋입니다. 어느 것인지 아래 표가 말해줍니다.
--   ⓐ 학기가 섞임      - 정규학기 27호와 여름캠프2 27호가 같이 보임
--   ⓑ 방향이 잘못 박힘 - 실제로는 등원인데 direction이 '하원'
--   ⓒ 진짜 중복        - 같은 학기·같은 방향에 27호가 두 줄
--
-- ※ 고치기 전에 먼저 봅니다. 지우는 SQL은 이 결과를 확인한 뒤에 만들겠습니다.

-- ── ① 27호 전부 ───────────────────────────────────────────────────────────
select r.direction                      as "방향",
       r.route_no                       as "호차",
       r.term                           as "학기",
       r.active                         as "사용중",
       r.depart_time                    as "출발시각",
       r.name                           as "지역",
       r.driver_name                    as "기사님",
       (select count(*) from public.shuttle_stops s where s.route_id = r.id)          as "정류장",
       (select count(*) from public.shuttle_assignments a
          join public.shuttle_stops s2 on s2.id = a.stop_id
         where s2.route_id = r.id)                                                    as "배정 인원",
       case
         when r.direction = '하원' and r.depart_time < '12:00' then '⚠️ 하원인데 오전 출발 - 등원일 가능성'
         when r.direction = '등원' and r.depart_time >= '12:00' then '⚠️ 등원인데 오후 출발 - 하원일 가능성'
         else '정상'
       end                              as "진단",
       r.id::text                       as "노선 id"
  from public.shuttle_routes r
 where r.route_no like '27%'
 order by r.direction, r.term, r.depart_time;

-- ── ② 같은 학기·같은 방향에 같은 호차가 두 줄인 경우(진짜 중복) ──────────
select r.term                as "학기",
       r.direction           as "방향",
       r.route_no            as "호차",
       count(*)              as "줄 수",
       string_agg(coalesce(r.depart_time, '?') || '(' || r.active::text || ')', ' · ' order by r.depart_time) as "출발시각(사용중)"
  from public.shuttle_routes r
 group by r.term, r.direction, r.route_no
having count(*) > 1
 order by r.term, r.direction, r.route_no;

-- ── ③ 방향이 시각과 어긋나는 노선 전체 ────────────────────────────────────
-- 등원은 오전, 하원은 오후입니다. 어긋나면 어느 한쪽이 잘못 박힌 것입니다.
select r.direction    as "지금 방향",
       r.route_no     as "호차",
       r.term         as "학기",
       r.depart_time  as "출발시각",
       r.active       as "사용중",
       (select count(*) from public.shuttle_assignments a
          join public.shuttle_stops s on s.id = a.stop_id
         where s.route_id = r.id)  as "배정 인원",
       case when r.direction = '하원' then '등원이어야 할 듯' else '하원이어야 할 듯' end as "아마도"
  from public.shuttle_routes r
 where (r.direction = '하원' and r.depart_time <  '12:00')
    or (r.direction = '등원' and r.depart_time >= '12:00')
 order by r.term, r.route_no;

-- ── ④ 학기별 노선 수 ─────────────────────────────────────────────────────
-- 탑승 배정 화면은 지금까지 학기를 안 가리고 전부 보여줬습니다. 여름캠프2가 남아 있으면
-- 모든 호차가 두 번씩 보입니다.
select coalesce(term, '(학기 없음)') as "학기",
       direction                     as "방향",
       count(*) filter (where active)       as "사용중",
       count(*) filter (where not active)   as "꺼둠"
  from public.shuttle_routes
 group by term, direction
 order by term, direction;
