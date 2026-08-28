-- 행선지 선택 버튼에 적을 말.
--
-- 담당자: "준서 준우 행선지 확인할 때 차량으로 하지 말고, 학원인지 집/기업은행인지 누르도록
--          해줘. 우리가 물어보는 게 그거니까. 그래서 대답에 따라 차 호수에 배정해줘."
--
-- 맞습니다. 아이에게 "몇 호차 타?"라고 묻지 않습니다. "어디 가?"라고 묻습니다. 화면이
-- 물어보는 말과 다르게 생기면, 듣고 나서 머릿속으로 한 번 더 바꿔야 하고 그때 틀립니다.
--
-- 호차는 우리가 아는 것이지 아이가 아는 것이 아닙니다. 아이 대답 그대로 누르면 호차 배정은
-- 시스템이 알아서 합니다.

alter table public.shuttle_assignments
  add column if not exists choice_label text;

comment on column public.shuttle_assignments.choice_label is
  '행선지 선택 버튼에 적을 말(예: 학원, 집·기업은행). 비어 있으면 호차 번호를 씁니다.';

-- 공용 배정표(뷰)에도 흘려보냅니다.
drop view if exists shuttle_assignments_basic;
create view shuttle_assignments_basic as
select
  a.id,
  a.stop_id,
  a.student_id,
  a.student_name_raw,
  a.class_raw,
  a.weekdays,
  a.note,
  a.override_route_id,
  a.choice_group,
  a.choice_label,
  a.created_at
from shuttle_assignments a
where is_giamicro_user();

revoke all on shuttle_assignments_basic from anon;
grant select on shuttle_assignments_basic to authenticated;

-- 이준서·이준우에 실제 말을 채웁니다.
--   4-2호 (서초구 동광로 28)      → 학원
--   9호   (서초구 서초중앙로 63)   → 집·기업은행
update public.shuttle_assignments a
   set choice_label = case r.route_no
         when '4-2' then '학원'
         when '9'   then '집·기업은행'
         else null
       end
  from public.shuttle_stops s, public.shuttle_routes r
 where s.id = a.stop_id
   and r.id = s.route_id
   and a.choice_group is not null
   and r.route_no in ('4-2', '9');

-- 확인. 학생마다 '학원'과 '집·기업은행'이 하나씩 있어야 합니다.
select a.student_name_raw as "학생",
       r.route_no         as "호차",
       a.choice_label     as "버튼에 적힐 말",
       s.address          as "정류장"
  from public.shuttle_assignments a
  join public.shuttle_stops  s on s.id = a.stop_id
  join public.shuttle_routes r on r.id = s.route_id
 where a.choice_group is not null
 order by a.student_name_raw, r.route_no;
