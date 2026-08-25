-- 기사 교대·차량번호 이력 관리(요청: 벤치마킹 채택). 지입차량이라 기사·차량번호·동승선생님이
-- 자주 바뀌는데, 바뀔 때마다 자동으로 스냅샷을 남겨 "언제 누가 어떤 차로 운행했는지"를
-- 추적할 수 있게 합니다. shuttle_routes를 수정하면 트리거가 알아서 한 줄 기록합니다.
create table if not exists public.shuttle_route_vehicle_history (
  id uuid primary key default gen_random_uuid(),
  route_id uuid not null references public.shuttle_routes(id) on delete cascade,
  route_no text,
  driver_name text,
  driver_phone text,
  vehicle_no text,
  teacher_name text,
  teacher_phone text,
  note text,
  changed_at timestamptz not null default now()
);
create index if not exists shuttle_rvh_route_idx on public.shuttle_route_vehicle_history (route_id, changed_at desc);

alter table public.shuttle_route_vehicle_history enable row level security;
drop policy if exists shuttle_rvh_select on public.shuttle_route_vehicle_history;
create policy shuttle_rvh_select on public.shuttle_route_vehicle_history
  for select using (auth.role() = 'authenticated');
-- 기록은 트리거(정의자 권한)로만 생기므로 일반 insert 정책은 두지 않습니다.

-- 변경 감지 트리거: 기사/연락처/차량/동승 중 하나라도 바뀌면 새 스냅샷을 남깁니다.
create or replace function public.log_shuttle_route_vehicle_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (tg_op = 'INSERT')
     or new.driver_name is distinct from old.driver_name
     or new.driver_phone is distinct from old.driver_phone
     or new.vehicle_no is distinct from old.vehicle_no
     or new.teacher_name is distinct from old.teacher_name
     or new.teacher_phone is distinct from old.teacher_phone then
    insert into public.shuttle_route_vehicle_history
      (route_id, route_no, driver_name, driver_phone, vehicle_no, teacher_name, teacher_phone, note)
    values
      (new.id, new.route_no, new.driver_name, new.driver_phone, new.vehicle_no, new.teacher_name, new.teacher_phone,
       case when tg_op = 'INSERT' then '노선 등록' else '기사·차량 변경' end);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_log_shuttle_route_vehicle on public.shuttle_routes;
create trigger trg_log_shuttle_route_vehicle
  after insert or update on public.shuttle_routes
  for each row execute function public.log_shuttle_route_vehicle_change();

-- 현재 노선들의 첫 스냅샷을 남깁니다(이미 이력이 있으면 중복 삽입하지 않음).
insert into public.shuttle_route_vehicle_history
  (route_id, route_no, driver_name, driver_phone, vehicle_no, teacher_name, teacher_phone, note)
select r.id, r.route_no, r.driver_name, r.driver_phone, r.vehicle_no, r.teacher_name, r.teacher_phone, '초기 기록'
from public.shuttle_routes r
where not exists (select 1 from public.shuttle_route_vehicle_history h where h.route_id = r.id);
