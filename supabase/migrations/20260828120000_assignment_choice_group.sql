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
