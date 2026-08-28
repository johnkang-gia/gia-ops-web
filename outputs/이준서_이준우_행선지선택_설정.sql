-- 이준서·이준우를 "행선지를 그날 정하는 학생"으로 묶습니다.
--
-- ※ 먼저 마이그레이션(20260828120000_assignment_choice_group.sql)을 돌린 뒤 실행하세요.
--
-- 배정은 지우지 않습니다. 정류장이 서로 다르기 때문입니다(학원 앞 / 집·기업은행).
-- 대신 같은 choice_group 값을 넣어, **정해지기 전에는 어느 명단에도 안 나오는 줄**로 만듭니다.

-- ① 먼저 지금 어떻게 배정돼 있는지 눈으로 확인합니다. 여기서 4줄(형제 2명 × 노선 2개)이
--    나와야 정상입니다. 그보다 많거나 적으면 아래 ②를 실행하기 전에 알려주세요.
select a.id,
       a.student_name_raw     as "학생",
       r.route_no             as "호차",
       r.direction            as "방향",
       s.address              as "정류장",
       a.weekdays             as "타는 요일",
       a.choice_group         as "현재 묶음"
  from public.shuttle_assignments a
  join public.shuttle_stops  s on s.id = a.stop_id
  join public.shuttle_routes r on r.id = s.route_id
 where a.student_name_raw like '%이준서%'
    or a.student_name_raw like '%이준우%'
 order by a.student_name_raw, r.route_no;

-- ② 확인이 끝나면 아래를 실행합니다. 형제 각자 따로 묶습니다
--    (한 명만 학원 가는 날이 있을 수 있으므로 각자 고를 수 있어야 합니다).
update public.shuttle_assignments a
   set choice_group = case
         when a.student_name_raw like '%이준서%' then 'lee-junseo'
         when a.student_name_raw like '%이준우%' then 'lee-junwoo'
       end
  from public.shuttle_stops s, public.shuttle_routes r
 where s.id = a.stop_id
   and r.id = s.route_id
   and r.direction = '하원'
   and (a.student_name_raw like '%이준서%' or a.student_name_raw like '%이준우%');

-- ③ 오늘 이미 만들어진 탑승 줄이 있으면 지웁니다. 남아 있으면 "이미 정한 것"으로 보여
--    오늘은 물어보는 화면에 안 뜹니다.
delete from public.shuttle_boardings b
 using public.shuttle_assignments a
 where b.assignment_id = a.id
   and a.choice_group in ('lee-junseo', 'lee-junwoo')
   and b.service_date = (now() at time zone 'Asia/Seoul')::date;

-- ④ 결과 확인. 두 명이 각각 2줄씩, 묶음 값이 채워져 있어야 합니다.
select a.student_name_raw as "학생",
       a.choice_group     as "묶음",
       r.route_no         as "고를 수 있는 호차",
       s.address          as "정류장"
  from public.shuttle_assignments a
  join public.shuttle_stops  s on s.id = a.stop_id
  join public.shuttle_routes r on r.id = s.route_id
 where a.choice_group is not null
 order by a.student_name_raw, r.route_no;
