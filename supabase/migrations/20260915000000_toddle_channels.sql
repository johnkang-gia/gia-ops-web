-- 토들 채팅방 ↔ 학생 연결
--
-- ── 왜 표를 따로 두나 ────────────────────────────────────────────────────────
--
-- 토들의 학부모 채팅방 이름은 학교가 정한 규칙입니다('G2_Reina Park_Office').
-- 즉 **누구 이야기인지가 방 이름에 이미 적혀 있습니다.** 지금까지는 글이 들어올 때마다
-- 그 이름을 글자로 다시 풀었습니다 - 매번 같은 계산을 하고, 매번 같은 곳에서 틀렸습니다.
--
-- 학기 초에 한 번 이어두면 그 뒤로는 풀 일이 없습니다. 사람이 한 번 확인한 연결이라
-- 글자 해석보다 언제나 믿을 만합니다.
--
-- ── 왜 학생이 여럿인가 ───────────────────────────────────────────────────────
--
-- 형제는 방을 함께 씁니다('G3&G6_Ije & Ryeomyeong Kang_Office'). 방 하나에 아이가 둘
-- 이상이므로 연결도 여럿입니다. 방마다 아이 하나로 두면 형제 중 한 명이 늘 빠집니다.

create table if not exists public.toddle_channels (
  id uuid primary key default gen_random_uuid(),

  -- 토들에 적힌 방 이름 그대로. 이것이 열쇠입니다.
  label text not null unique,

  -- 방 이름에서 읽어낸 학년('G2', 'G3&G6'). 참고용이며 판단은 연결된 학생으로 합니다.
  grades text,

  -- 사람이 한 번 확인했는가. **확인 전에는 자동 판단에 쓰지 않습니다** -
  -- 기계가 제안한 것을 확인 없이 쓰면, 틀린 연결이 조용히 굳어집니다.
  confirmed_at timestamptz,
  confirmed_by text,

  -- 이 방에서 글이 마지막으로 들어온 때. 안 쓰는 방(졸업·전학)을 가려내는 데 씁니다.
  last_seen_at timestamptz,

  -- 연결하지 않기로 한 방(학교 공지방, 시험용 방 등). 목록에서 계속 뜨면 사람이
  -- 「아직 안 한 것」과 구별하지 못합니다.
  ignored boolean not null default false,
  note text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.toddle_channel_students (
  channel_id uuid not null references public.toddle_channels(id) on delete cascade,
  student_id uuid not null references public.wr_students(id) on delete cascade,

  -- 방 이름에 적힌 순서. 형제방에서 「첫째가 누구인가」를 화면이 그대로 보여줍니다.
  seq integer not null default 0,

  primary key (channel_id, student_id)
);

create index if not exists toddle_channel_students_student_idx
  on public.toddle_channel_students (student_id);

-- 방 이름으로 찾는 일이 가장 잦습니다.
create index if not exists toddle_channels_label_idx on public.toddle_channels (lower(label));

alter table public.toddle_channels enable row level security;
alter table public.toddle_channel_students enable row level security;

-- 돈에 관한 표가 아니라 교직원이면 누구나 봅니다. 다만 **바꾸는 것은 행정·관리자만**입니다 -
-- (행정 담당자는 관리자 권한을 함께 가집니다.) 잘못 연결하면 학부모 연락이 엉뚱한 아이에게 붙고, 그건 화면에 오류로 보이지 않습니다.
drop policy if exists toddle_channels_read on public.toddle_channels;
create policy toddle_channels_read on public.toddle_channels
  for select using (public.is_giamicro_user());

drop policy if exists toddle_channels_write on public.toddle_channels;
create policy toddle_channels_write on public.toddle_channels
  for all using (public.is_app_admin()) with check (public.is_app_admin());

drop policy if exists toddle_channel_students_read on public.toddle_channel_students;
create policy toddle_channel_students_read on public.toddle_channel_students
  for select using (public.is_giamicro_user());

drop policy if exists toddle_channel_students_write on public.toddle_channel_students;
create policy toddle_channel_students_write on public.toddle_channel_students
  for all using (public.is_app_admin()) with check (public.is_app_admin());

-- ── 아직 안 이어진 방을 한눈에 ───────────────────────────────────────────────
--
-- 「연결이 몇 개 남았는지」를 사람이 세지 않아도 되게 합니다. 세어야 하는 일은
-- 미뤄지고, 미룬 연결은 학기 내내 그대로 남습니다.
create or replace view public.toddle_channels_unlinked as
  select c.id, c.label, c.grades, c.last_seen_at
  from public.toddle_channels c
  where c.ignored = false
    and c.confirmed_at is null
  order by c.last_seen_at desc nulls last;
