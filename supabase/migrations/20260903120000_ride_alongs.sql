-- ===== 오늘만 같이 타는 아이 =====
--
-- "선생님 오늘 하교시 서이 셔틀에 하임이두 같이 보내주세요!"
--
-- 이런 연락이 종종 옵니다. 뜻은 이렇습니다.
--   · 김서이가 타는 차에
--   · 정하임을 **오늘 하루만** 같이 태워달라
--   · 정하임은 **평소 셔틀을 타지 않습니다**
--
-- 지금 시스템에는 이것을 적을 자리가 없었습니다. 오늘만 차를 바꾸는 것
-- (shuttle_boardings.override_route_id)은 **이미 배정이 있는 아이**에게만 걸 수 있는데,
-- 평소 안 타는 아이는 배정 자체가 없기 때문입니다. 그래서 이런 연락은 늘 사람이 기억하거나
-- 특이사항 메모에 적어두는 수밖에 없었고, 그 말은 잊으면 아이가 차를 못 탄다는 뜻입니다.
--
-- **정식 배정을 건드리지 않습니다.** 배정에 넣었다가 다음 날 지우는 방식은, 지우는 것을
-- 잊으면 안 타는 아이가 계속 명단에 남습니다. 날짜를 못 박은 별도의 줄로 두면 다음 날에는
-- 저절로 사라집니다.

create table if not exists public.shuttle_ride_alongs (
  id uuid primary key default gen_random_uuid(),

  -- 어느 날 하원인가. 이 날짜에만 명단에 나타납니다.
  service_date date not null,

  -- 오늘만 타는 아이.
  student_id uuid references public.wr_students(id) on delete cascade,
  -- 아직 누구인지 못 가린 경우를 위해 원문 표기를 함께 둡니다. '하임이' 처럼 적혀 오는데
  -- 명부에는 임하임과 정하임이 있어서, 사람이 고르기 전까지는 student_id 가 빕니다.
  student_surface text,

  -- 누구 차에 타는가. 요청은 늘 "누구 셔틀에" 로 옵니다 - 호차가 아니라 아이 이름입니다.
  host_student_id uuid references public.wr_students(id) on delete set null,
  host_surface text,
  -- 위 두 사람으로 정해진 노선. 굳혀 둡니다 - 태우는 아이의 배정이 나중에 바뀌어도,
  -- 그날 어느 차에 태웠는지는 그대로 남아야 합니다.
  route_id uuid references public.shuttle_routes(id) on delete set null,

  -- 확인대기: 누구인지 못 가렸거나 노선을 못 정함 (사람이 한 번 봐야 합니다)
  -- 확정    : 오늘 명단에 오릅니다
  -- 취소    : 사람이 아니라고 판단했거나 요청이 철회됨
  status text not null default '확인대기' check (status in ('확인대기', '확정', '취소')),

  -- 어느 연락에서 나왔는가. 원문을 다시 읽을 수 있어야 합니다 - 자동으로 읽은 것이라
  -- 틀렸을 때 근거를 봐야 고칠 수 있습니다.
  request_id uuid references public.pickup_requests(id) on delete set null,
  raw_text text,
  -- 자동으로 넣었는지 사람이 넣었는지. 자동이 자꾸 틀리면 이 값으로 셀 수 있습니다.
  created_by text,
  confirmed_by text,
  confirmed_at timestamptz,
  note text,

  term_id uuid references public.terms(id) on delete set null,
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 같은 날 같은 아이를 같은 차에 두 번 태울 일은 없습니다. 두 줄이 되면 명단에 두 번 뜹니다.
create unique index if not exists shuttle_ride_alongs_uniq
  on public.shuttle_ride_alongs (service_date, student_id, route_id)
  where student_id is not null and route_id is not null;

create index if not exists shuttle_ride_alongs_date_idx
  on public.shuttle_ride_alongs (service_date, status);

drop trigger if exists shuttle_ride_alongs_set_updated_at on public.shuttle_ride_alongs;
create trigger shuttle_ride_alongs_set_updated_at
  before update on public.shuttle_ride_alongs
  for each row execute function public.set_updated_at();

-- 학기 도장. 다른 표와 같은 방식으로 지금 학기가 자동으로 찍힙니다.
drop trigger if exists shuttle_ride_alongs_stamp_term on public.shuttle_ride_alongs;
create trigger shuttle_ride_alongs_stamp_term
  before insert on public.shuttle_ride_alongs
  for each row execute function public.stamp_current_term();

alter table public.shuttle_ride_alongs enable row level security;

-- 기사님·동승선생님 화면은 토큰 링크(서비스 키)로 읽으므로 여기 정책과 무관합니다.
-- 교직원은 읽고 쓸 수 있어야 합니다 - 연락은 담임에게도 오고, 행정실만 고칠 수 있으면
-- 그 사이에 차가 떠납니다.
drop policy if exists "staff_read_ride_alongs" on public.shuttle_ride_alongs;
create policy "staff_read_ride_alongs" on public.shuttle_ride_alongs
  for select using (public.is_giamicro_user());

drop policy if exists "staff_write_ride_alongs" on public.shuttle_ride_alongs;
create policy "staff_write_ride_alongs" on public.shuttle_ride_alongs
  for all using (public.is_giamicro_user()) with check (public.is_giamicro_user());

comment on table public.shuttle_ride_alongs is
  '오늘 하루만 다른 아이 차에 같이 타는 아이. 정식 배정(shuttle_assignments)은 건드리지 않습니다 - 날짜가 지나면 저절로 사라져야 하기 때문입니다.';
