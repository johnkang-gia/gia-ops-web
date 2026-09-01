-- 하원 체크표 활동 기록 — 누가, 언제, 무엇을 했는가
--
-- 체크표는 행정실·담임·동승 선생님이 **함께** 쓰는 화면입니다. 한 아이의 픽업 표시가
-- 지워져 있거나 차가 바뀌어 있을 때, 지금까지는 그게 누가 한 일인지 알 방법이 없었습니다.
-- 그러면 확인 전화가 돌고, 결국 아무도 화면을 못 믿게 됩니다.
--
-- shuttle_boardings에도 updated_by가 있지만 그것은 **마지막 상태 한 줄**입니다.
-- "아침에 결석으로 찍혔다가 낮에 풀렸다"는 거기 안 남습니다. 되돌아본다는 것은 순서를
-- 본다는 뜻이라, 바뀔 때마다 한 줄씩 쌓습니다.

create table if not exists public.shuttle_checklist_log (
  id uuid primary key default gen_random_uuid(),
  service_date date not null,
  term text,

  -- 배정이 나중에 지워져도 기록은 남아야 하므로 외래키를 걸지 않습니다.
  -- 지워진 배정의 기록이 함께 사라지면, 정작 문제가 생겼을 때 볼 것이 없습니다.
  assignment_id uuid,
  student_name text not null,

  --   상태변경 : 예정 → 픽업 · 결석 · 탑승 …
  --   노선이동 : 오늘만 / 계속
  --   메모     : 학생별 특이사항
  action text not null check (action in ('상태변경', '노선이동', '메모')),

  -- 사람이 읽는 값으로 넣습니다('픽업', '7호', 메모 본문). id를 넣으면 나중에 이 줄을
  -- 읽는 사람이 또 다른 표를 찾아봐야 하고, 그 표가 바뀌어 있으면 뜻이 달라집니다.
  before_value text,
  after_value text,

  actor_email text not null,
  actor_name text,
  created_at timestamptz not null default now()
);

comment on table public.shuttle_checklist_log is
  '하원 체크표에서 일어난 일. 고치지도 지우지도 않습니다.';

create index if not exists shuttle_checklist_log_date_idx
  on public.shuttle_checklist_log (service_date desc, created_at desc);

create index if not exists shuttle_checklist_log_student_idx
  on public.shuttle_checklist_log (student_name, created_at desc);

alter table public.shuttle_checklist_log enable row level security;

-- 읽기와 쓰기는 로그인한 교직원 전체입니다 - 체크표를 쓰는 사람이 곧 기록을 남기는
-- 사람이고, 서로의 손길을 볼 수 있어야 함께 관리가 됩니다.
drop policy if exists "staff_read_checklist_log" on public.shuttle_checklist_log;
create policy "staff_read_checklist_log" on public.shuttle_checklist_log
  for select using (auth.role() = 'authenticated');

drop policy if exists "staff_insert_checklist_log" on public.shuttle_checklist_log;
create policy "staff_insert_checklist_log" on public.shuttle_checklist_log
  for insert with check (auth.role() = 'authenticated');

-- 수정·삭제 정책은 **일부러 만들지 않습니다.** 정책이 없으면 RLS가 막습니다.
-- 고칠 수 있는 기록은 기록이 아닙니다.

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'shuttle_checklist_log'
  ) then
    alter publication supabase_realtime add table public.shuttle_checklist_log;
  end if;
end $$;
