-- 업무 달력: 여러 날에 걸친 일정 + 색 태그
--
-- ── 무엇이 없었나 ────────────────────────────────────────────────────
--
-- 업무에는 마감일(`due_at`) 하나뿐이었습니다. 그래서 「10일부터 14일까지 학기말 정리」 같은
-- 일은 14일 칸에 점 하나로만 찍혔고, 달력을 봐도 **그 주가 통째로 잡혀 있다는 것이 안
-- 보였습니다.** 달력을 두는 이유가 「언제 몰려 있나」를 보는 것인데, 그게 안 보이면 달력을
-- 둔 값을 못 합니다.
--
-- 그리고 칸에 뜨는 것은 전부 회색 상자라, 무슨 종류의 일인지 열어봐야만 알 수 있었습니다.
--
-- ── 그래서 ───────────────────────────────────────────────────────────
--
--   · `start_on` — 시작일. 비어 있으면 하루짜리(마감일 그 날)입니다.
--   · `work_tags` + `tasks.tag_id` — 색 있는 이름표. 달력에서 색만 보고 종류를 압니다.

-- ── 시작일 ──────────────────────────────────────────────────────────
--
-- 마감(`due_at`)을 끝날로 그대로 씁니다. 새 칸을 둘도 만들지 않는 이유: 지금 쌓인 업무가
-- 전부 마감만 갖고 있어서, 끝날을 새 칸으로 옮기면 **옛 줄이 전부 달력에서 사라집니다.**
alter table public.tasks add column if not exists start_on date;

comment on column public.tasks.start_on is
  '여러 날에 걸친 일정의 시작일. 비어 있으면 하루짜리(due_at 그 날)입니다. 끝날은 due_at 을 그대로 씁니다.';

create index if not exists tasks_span_idx on public.tasks(start_on) where start_on is not null;

-- ── 색 태그 ─────────────────────────────────────────────────────────
--
-- 부서 색·모드 색과 따로 두는 이유: 저 둘은 **누구의 일인가**를 나타내고, 이건 **무슨
-- 일인가**를 나타냅니다. 같은 부서 안에서도 행사·정산·점검은 서로 다른 일입니다.
create table if not exists public.work_tags (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  -- 화면에 그대로 쓰는 색(#RRGGBB). 이름이 아니라 값으로 두는 이유: 학교마다 쓰고 싶은
  -- 색이 다르고, 목록을 코드에 박아두면 색 하나 추가에 배포가 필요합니다.
  color text not null default '#64748b' check (color ~ '^#[0-9a-fA-F]{6}$'),
  sort_order int not null default 100,
  created_by text,
  created_at timestamptz not null default now()
);

create unique index if not exists work_tags_name_idx on public.work_tags(lower(name));

alter table public.tasks add column if not exists tag_id uuid references public.work_tags(id) on delete set null;

comment on column public.tasks.tag_id is
  '색 태그. 달력에서 색만 보고 무슨 일인지 알아보라고 둡니다. 지우면 업무는 남고 색만 빠집니다.';

create index if not exists tasks_tag_idx on public.tasks(tag_id) where tag_id is not null;

alter table public.work_tags enable row level security;

-- 태그는 다 같이 쓰는 이름표입니다. 읽기는 로그인한 교직원 전체, 만들고 고치기는 행정·관리자.
drop policy if exists "giamicro_select_work_tags" on public.work_tags;
create policy "giamicro_select_work_tags" on public.work_tags
  for select using (public.is_giamicro_user());

drop policy if exists "wr_manager_write_work_tags" on public.work_tags;
create policy "wr_manager_write_work_tags" on public.work_tags
  for all using (public.is_wr_manager()) with check (public.is_wr_manager());

-- 처음 열었을 때 빈 화면이면 아무도 안 씁니다. 흔한 것 몇 개를 심어둡니다 - 이름과 색은
-- 화면에서 바꿀 수 있으니 여기 값은 출발점일 뿐입니다.
insert into public.work_tags (name, color, sort_order)
values
  ('행사', '#e11d48', 10),
  ('정산·회계', '#2563eb', 20),
  ('점검·정비', '#059669', 30),
  ('문서·보고', '#7c3aed', 40),
  ('셔틀', '#ea580c', 50)
on conflict do nothing;
