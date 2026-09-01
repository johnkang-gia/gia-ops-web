-- 하원수단 (학생 × 요일)
--
-- 요일마다 다른 방법으로 집에 가는 아이가 있습니다. 예를 들어 한 아이는 월요일 셔틀,
-- 화·목 1시 55분 메타프랩버스, 수요일 4시 30분 블루웨일버스, 금요일 3시 35분 블루웨일버스
-- 입니다. 이것은 셔틀 배정으로는 적을 수 없습니다.
--
-- 하원수단은 **아이를 기준으로** 저장합니다. 담임 선생님 화면에서도 아이 하나를 열면
-- 요일별 하원수단이 함께 떠야, 선생님이 아이를 맞는 곳으로 데리고 갈 수 있습니다.
--
-- **왜 셔틀 배정에 끼워 넣지 않는가:** 지금까지 "이 아이가 어떻게 집에 가는가"는 셔틀 배정
-- (shuttle_assignments)에만 있었습니다. 그런데 셔틀을 안 타는 날은 배정 자체가 없어서, 그
-- 요일에 아이가 어떻게 가는지 적을 자리가 아예 없었습니다. 학원 버스·도보·보호자 픽업은
-- 셔틀이 아니지만 **선생님이 아이를 어디로 보내야 하는지 알아야 하는 정보**입니다.
--
-- 그래서 셔틀과 별개로, **아이를 기준으로** 요일마다 한 줄씩 둡니다. 셔틀도 여기 한 종류로
-- 들어옵니다 - 그래야 "월요일은?"이라는 물음에 한 곳만 보면 됩니다.

create table if not exists public.student_dismissal_plans (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.wr_students(id) on delete cascade,
  -- 1=월 … 5=금. 셔틀도 수업도 평일만 있습니다.
  weekday smallint not null check (weekday between 1 and 5),
  -- 무엇을 타고 가는가.
  --   셔틀      : GIA 셔틀 (호차는 셔틀 배정이 정답이므로 여기 적지 않습니다)
  --   외부버스  : 학원 차량 (메타프랩·블루웨일 등) — label에 이름을 적습니다
  --   보호자픽업: 보호자가 학교로 데리러 옴
  --   도보      : 혼자 감 / 걸어서 감
  --   기타      : 위 어디에도 안 맞는 것 — note에 적습니다
  kind text not null check (kind in ('셔틀', '외부버스', '보호자픽업', '도보', '기타')),
  -- 버스 이름처럼 사람이 부르는 이름. '메타프랩버스', '블루웨일버스'.
  label text,
  -- 출발/도착 시각. 'HH:MM' 문자열입니다.
  --
  -- time 타입이 아니라 문자열인 이유: 학부모가 알려주는 시각은 "1:55"처럼 오전/오후가 없는
  -- 경우가 많습니다. 억지로 시각으로 바꾸면 새벽 1시 55분이 되어버립니다. 화면에 적힌 그대로
  -- 두고, 사람이 읽습니다.
  depart_time text,
  note text,
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- 한 아이의 한 요일에는 하원수단이 하나입니다. 둘이면 어느 쪽이 맞는지 알 수 없습니다.
  unique (student_id, weekday)
);

create index if not exists student_dismissal_plans_student_idx
  on public.student_dismissal_plans(student_id);

drop trigger if exists student_dismissal_plans_set_updated_at on public.student_dismissal_plans;
create trigger student_dismissal_plans_set_updated_at
  before update on public.student_dismissal_plans
  for each row execute function public.set_updated_at();

alter table public.student_dismissal_plans enable row level security;

-- 담임 선생님이 읽어야 하는 정보라 **교직원 전체가 읽습니다.**
-- 쓰기도 교직원 전체에게 엽니다 - 담임이 학부모에게 직접 듣는 경우가 가장 많고, 행정실을
-- 거쳐야만 고칠 수 있으면 결국 아무도 안 고쳐서 낡은 값이 남습니다.
drop policy if exists "staff_read_dismissal_plans" on public.student_dismissal_plans;
create policy "staff_read_dismissal_plans" on public.student_dismissal_plans
  for select using (auth.role() = 'authenticated');

drop policy if exists "staff_write_dismissal_plans" on public.student_dismissal_plans;
create policy "staff_write_dismissal_plans" on public.student_dismissal_plans
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'student_dismissal_plans'
  ) then
    alter publication supabase_realtime add table public.student_dismissal_plans;
  end if;
end $$;
