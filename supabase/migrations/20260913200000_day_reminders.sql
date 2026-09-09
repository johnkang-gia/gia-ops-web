-- 날짜 알림 — 그날 **챙겨야 할 한 가지**
--
-- ── 왜 업무가 아닌가 ────────────────────────────────────────────────
--
-- 「OO 약 점심에 먹이기」, 「OO 3시에 병원 가니 미리 내려보내기」 같은 것들은 업무처럼
-- 생겼지만 업무가 아닙니다.
--
--   · 맡을 사람을 정하지 않습니다 - 그날 그 자리에 있는 사람이 챙깁니다.
--   · 진행 상태가 없습니다 - 등록·진행·완료로 흐르지 않고, 그날 지나면 끝입니다.
--   · **그날에만** 뜻이 있습니다.
--
-- 이런 것을 업무로 만들면 흐름판이 하루살이 쪽지로 덮여, 정작 며칠씩 굴러가는 일이 묻힙니다.
-- 반대로 쪽지판(board_notes)에 적으면 **날짜가 없어서** 그날 아침에 눈에 띄지 않습니다.
-- 그래서 「날짜가 붙은 한 줄」이라는 자리를 따로 둡니다.
--
-- ── 왜 지우지 않고 남기나 ───────────────────────────────────────────
--
-- 지난 알림은 화면에서 내려가지만 표에는 남습니다. 「그때 그 약 언제부터 먹였더라」를
-- 되짚을 자리가 필요하고, 지우는 것은 언제든 할 수 있지만 없앤 것은 되살릴 수 없습니다.

create table if not exists public.day_reminders (
  id uuid primary key default gen_random_uuid(),

  -- 챙길 날. 이 표의 존재 이유라서 not null 입니다.
  day date not null,

  -- 한 줄. 「점심 후 김OO 약」처럼 그날 읽고 바로 알아볼 만큼만 적습니다.
  title text not null,

  -- 덧붙임(선택). 약 이름·연락처처럼 한 줄에 안 들어가는 것.
  note text,

  -- 어느 부서의 달력인가. 업무·쪽지와 같은 기준으로 가릅니다.
  department text not null,

  -- 몇 시. 비워도 됩니다 - 「오늘 중」인 것이 더 많습니다.
  at_time time,

  -- 챙겼는가. 지우지 않고 표시만 합니다 - 지우면 「했는지 안 했는지」가 아니라
  -- 「그런 일이 있었는지」까지 사라집니다.
  done boolean not null default false,
  done_by text,
  done_at timestamptz,

  author_email text not null,
  author_name text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.day_reminders is
  '그날 챙길 단발 기록. 맡을 사람도 진행 상태도 없고, 그날에만 뜻이 있습니다 - 업무와 갈라 두는 이유입니다.';

create index if not exists day_reminders_day_idx on public.day_reminders (department, day);

alter table public.day_reminders enable row level security;

drop policy if exists day_reminders_all on public.day_reminders;
create policy day_reminders_all on public.day_reminders for all using (true) with check (true);

-- 실시간 반영. 한 사람이 적어두면 다른 자리의 화면에도 바로 떠야 합니다 -
-- 새로고침해야 보이는 알림은 이미 놓친 알림입니다.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'day_reminders'
  ) then
    alter publication supabase_realtime add table public.day_reminders;
  end if;
end $$;
