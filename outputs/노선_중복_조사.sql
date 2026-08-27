-- 【조사 전용 · 아무것도 바꾸지 않습니다】 노선관리에 같은 노선이 여러 번 보이는 이유 찾기
--
-- 담당자: "셔틀 노선관리에 보면 같은 노선이 중복되는 게 많아, 정리해줘."
--
-- 지우기 전에 **무엇이 중복인지** 먼저 봐야 합니다. 겉보기에 같아도 실제로는 다를 수 있습니다.
--   · 등원 12호 / 하원 12호  → 방향이 다르니 중복이 아닙니다
--   · 정규학기 12호 / 여름캠프2 12호 → 학기가 다르니 중복이 아닙니다
--   · 정규학기 하원 12호가 두 줄 → 이게 진짜 중복입니다
--
-- 그리고 둘 중 어느 쪽에 학생·정류장이 붙어 있는지 봐야 합니다. 비어 있는 쪽을 지워야
-- 아이들이 사라지지 않습니다.

-- ① 진짜 중복(같은 방향·같은 학기·같은 호차가 두 줄 이상)
select r.direction as "방향", r.term as "학기", r.route_no as "호차",
       count(*) as "줄 수",
       string_agg(
         coalesce(r.name,'(이름없음)')
         || ' · 정류장' || (select count(*) from shuttle_stops s where s.route_id = r.id)
         || ' · 학생'  || (select count(*) from shuttle_assignments a
                             join shuttle_stops s2 on s2.id = a.stop_id where s2.route_id = r.id)
         || ' · ' || (case when r.active then '사용중' else '꺼짐' end)
         || ' · ' || to_char(r.created_at at time zone 'Asia/Seoul', 'MM/DD HH24:MI'),
         E'\n' order by r.created_at)
         as "각 줄의 내용"
  from shuttle_routes r
 group by 1,2,3
having count(*) > 1
 order by 1, 2, nullif(regexp_replace(r.route_no, '[^0-9].*$', ''), '')::int;

-- ② 전체 노선 수 - 어느 학기·방향에 몇 개씩 있는지
select direction as "방향", term as "학기",
       count(*) as "노선 수",
       count(*) filter (where active) as "사용중",
       count(*) filter (where not active) as "꺼짐"
  from shuttle_routes
 group by 1,2 order by 1,2;

-- ③ 비어 있는 노선(정류장도 학생도 없음) - 정리 후보입니다.
select r.direction as "방향", r.term as "학기", r.route_no as "호차",
       coalesce(r.name,'(이름없음)') as "이름",
       r.active as "사용중",
       to_char(r.created_at at time zone 'Asia/Seoul', 'MM/DD HH24:MI') as "만든 시각"
  from shuttle_routes r
 where not exists (select 1 from shuttle_stops s where s.route_id = r.id)
 order by r.term, r.direction, r.created_at;
