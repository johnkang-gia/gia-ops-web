-- 하원 셔틀명단에서 아이 순서를 손으로 정합니다.
--
-- 명단·체크표·안내보드는 정류장 순서 → 이름 순으로만 그렸습니다. 같은 정류장에서 타는 아이들은
-- 가나다순이 되는데, 실제로는 동승 선생님이 부르는 순서(형제 먼저, 앞자리 아이 먼저)가 따로
-- 있고 그 순서는 종이 체크표에 손으로 적어 쓰고 있었습니다.
--
-- 배정 줄에 순서 칸을 둡니다. 0이면 정하지 않은 것이고, 그때는 전처럼 이름 순입니다. 정류장
-- 순서가 먼저이고 이 칸은 **같은 정류장 안에서만** 뜻을 가집니다 - 차가 서는 순서를 거스르는
-- 명단은 현장에서 못 씁니다.
alter table public.shuttle_assignments add column if not exists sort_order integer not null default 0;

-- 공용 뷰에도 같은 칸을 내보냅니다. 체크표·명단·도착체크가 전부 이 뷰를 읽습니다.
drop view if exists public.shuttle_assignments_basic;
create view public.shuttle_assignments_basic as
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
  a.sort_order,
  a.created_at
from public.shuttle_assignments a
where public.is_giamicro_user();

alter view public.shuttle_assignments_basic set (security_invoker = on);
revoke all on public.shuttle_assignments_basic from anon;
grant select on public.shuttle_assignments_basic to authenticated;
