-- 앞으로의 픽업 예약
--
-- "이번주 목금 이라엘 픽업입니다" 같은 연락 하나가 여러 날짜를 가리킵니다. 지금까지는
-- pickup_requests 한 줄에 날짜 하나만 담을 수 있어서, 이런 연락은 오늘 것만 처리되고
-- 나머지 날짜는 사람이 기억해야 했습니다. 기억에 기대는 부분이 사고가 나는 곳입니다.
--
-- 그래서 연락 하나에서 나온 날짜들을 각각 한 줄로 예약해둡니다. 당일 아침에 크론이
-- 그날치를 꺼내 하원 체크표에 반영하고, 담임 선생님께 알립니다.

create table if not exists public.pickup_schedules (
  id uuid primary key default gen_random_uuid(),

  -- 어느 연락에서 나왔는지. 원문으로 돌아가 확인할 수 있어야 합니다.
  request_id uuid references public.pickup_requests(id) on delete cascade,

  student_id uuid references public.wr_students(id) on delete cascade,
  -- 학생을 명부에서 못 찾은 경우에도 예약은 남깁니다(사람이 보고 고치도록).
  student_name text,

  service_date date not null,
  pickup_time text,

  -- 예정: 아직 그날이 오지 않음 / 적용됨: 그날 아침에 하원 체크표에 반영함
  -- 취소: 사람이 취소함 / 실패: 반영하려 했으나 탑승 배정이 없어 실패
  status text not null default '예정',

  -- "이번주 목금"처럼 표현이 확실치 않아 사람이 한 번 봐야 하는 건인지.
  -- 놓치는 것보다 낫기에 일단 예약하되, 인박스에서 눈에 띄게 합니다.
  needs_confirm boolean not null default false,

  -- 무엇을 보고 이 날짜를 잡았는지. 잘못 잡혔을 때 원인을 짚을 수 있어야 합니다.
  source_note text,

  homeroom_email text,
  -- 당일 담임께 알린 업무. 두 번 알리지 않기 위한 표시이기도 합니다.
  task_id uuid references public.tasks(id) on delete set null,

  created_at timestamptz not null default now(),
  applied_at timestamptz,
  cancelled_at timestamptz,
  cancelled_by text
);

-- 같은 연락에서 같은 날짜가 두 번 잡히지 않도록.
create unique index if not exists pickup_schedules_uniq
  on public.pickup_schedules (request_id, service_date);

-- 당일 아침 크론이 "오늘 예정"만 빠르게 꺼내갑니다.
create index if not exists pickup_schedules_date_status
  on public.pickup_schedules (service_date, status);

create index if not exists pickup_schedules_student
  on public.pickup_schedules (student_id, service_date);

alter table public.pickup_schedules enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'pickup_schedules' and policyname = 'pickup_schedules_rw'
  ) then
    create policy pickup_schedules_rw on public.pickup_schedules
      for all to authenticated using (true) with check (true);
  end if;
end $$;
