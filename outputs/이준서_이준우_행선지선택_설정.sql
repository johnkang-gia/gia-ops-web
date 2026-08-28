-- ⚠ 이 파일 하나만 실행하면 됩니다.
--
-- 앞서 "column a.choice_group does not exist" 오류가 난 이유는, 칸을 만드는
-- 마이그레이션을 먼저 돌리지 않고 설정 SQL부터 실행했기 때문입니다. 제가 두 파일로
-- 나눠 드려서 생긴 일입니다 - 순서가 있으면 한 파일로 드렸어야 했습니다.
--
-- 아래는 [1부] 칸 만들기 → [2부] 형제 묶기 순서로 이어져 있습니다. 통째로 실행하세요.

-- ══════════════════════════════════════════════════════════════════════════
-- [1부] 칸 만들기
-- ══════════════════════════════════════════════════════════════════════════

-- 행선지를 그날 물어보고 정하는 학생.
--
-- 담당자: "4-2호차 이준서, 이준우는 9호의 이준서 이준우와 같은 아이들이고 형제야.
--          이 둘은 우리가 직접 어디 가는지 물어보고, 학원이라고 하면 4-2호를,
--          집이나 기업은행이라고 하면 9호를 태워. (...) 애들은 둘 다 비워두고
--          행선지 물어보고 결정하면 그때 둘 중 하나로 배정하는 걸로 해줘."
--
-- 지금은 같은 아이가 두 노선에 각각 배정돼 있어 **양쪽 다 '탄다'로 보입니다.** 4-2호
-- 기사님은 9호가 태웠겠거니, 9호 기사님은 4-2호가 태웠겠거니 하면 아무도 안 태웁니다.
-- 정원도 두 번 잡힙니다.
--
-- 배정은 둘 다 그대로 둡니다(정류장이 서로 다르므로 지우면 안 됩니다). 대신 같은
-- choice_group 값을 넣어 **"정해지기 전에는 어느 명단에도 안 나오는 줄"**로 만듭니다.
-- 그날 선택하면 그 배정에만 오늘치 탑승 줄(shuttle_boardings)이 생기고, 그때 비로소
-- 그 노선 명단에 나타납니다. 선택 안 한 쪽은 계속 숨어 있습니다.
--
-- 학원 요일이 자주 바뀌고 둘 다 안 타는 날도 많아서, 요일 고정으로는 놓칩니다.
-- 안 정했으면 안 정했다고 **눈에 보이게** 두는 것이 이 설계의 핵심입니다.

alter table public.shuttle_assignments
  add column if not exists choice_group text;

comment on column public.shuttle_assignments.choice_group is
  '행선지를 그날 정하는 학생. 같은 값끼리 택1. 오늘 탑승 줄이 없으면 어느 명단에도 안 뜹니다.';

-- 같은 묶음을 빠르게 찾기 위한 색인. 값이 있는 줄만 담습니다(대부분의 학생은 null).
create index if not exists shuttle_assignments_choice_group_idx
  on public.shuttle_assignments (choice_group)
  where choice_group is not null;

-- 공용 배정표(뷰)에도 이 칸을 흘려보냅니다.
--
-- 하원 체크표는 이 뷰로 명단을 읽습니다. 뷰에 칸이 없으면 체크표만 이 규칙을 모른 채
-- 아이를 명단에 띄웁니다. 한 화면에서는 안 보이는 아이가 다른 화면에서는 타는 것으로
-- 나오면, 지금 두 노선에 중복 배정된 것과 똑같은 위험이 됩니다.
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
  a.created_at
from shuttle_assignments a
where is_giamicro_user();

revoke all on shuttle_assignments_basic from anon;
grant select on shuttle_assignments_basic to authenticated;


-- ══════════════════════════════════════════════════════════════════════════
-- [2부] 이준서·이준우 묶기
-- ══════════════════════════════════════════════════════════════════════════

-- 이준서·이준우를 "행선지를 그날 정하는 학생"으로 묶습니다.
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
