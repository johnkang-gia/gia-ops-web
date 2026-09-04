-- ===== 수강 그룹 — 반이 아닌 명단 =====
--
-- 학년·반은 **어느 교실에 앉는가**입니다. 그런데 학교에서 무언가를 붙일 때의 기준은
-- **무엇을 하는가**인 경우가 많습니다. 대부분은 둘이 같아서 지금까지 문제가 없었는데,
-- 방과후와 악기에서 갈라집니다.
--
--   방과후 로봇공학 교재  →  4학년 전원이 아니라, 로봇공학을 하는 아이들
--   바이올린 교본        →  반과 아무 상관이 없습니다
--
-- 지금 명부에는 이것을 적을 자리가 없습니다.
--
--   afterschool  boolean    방과후를 하는지 예/아니오만. **무엇을 하는지는 모릅니다**
--   instrument   enum 하나   악기를 둘 배우면 하나는 사라집니다
--
-- 그래서 방과후 교재를 붙일 대상을 지정할 방법이 아예 없었고, 결국 아이를 하나씩 체크하게
-- 됩니다. 그렇게 만든 명단은 **항목마다 흩어져** 있어서, "로봇공학 하는 아이가 누구지" 를
-- 물으면 답할 데가 없습니다.
--
-- 명단을 한 번 만들어 두면 이번 학기 교재도, 다음 학기 교재도, 그 그룹에 붙는 다른 것도
-- 전부 그 하나를 가리킵니다.

create table if not exists public.student_groups (
  id uuid primary key default gen_random_uuid(),

  -- 사람이 부르는 이름. '방과후 로봇공학', '오케스트라 바이올린'.
  name text not null,
  -- 방과후 · 악기 · 동아리 · 특강 · 기타
  -- 묶는 이유가 다르면 다루는 사람도 다릅니다. 화면에서 갈라 보기 위한 것뿐이라 느슨하게 둡니다.
  kind text not null default '방과후',

  -- 어느 학기 것인가. 방과후는 학기마다 다시 짭니다.
  term_id uuid references public.terms(id) on delete set null,

  -- 이 그룹이 주로 어느 부서인가. 비어 있으면 학교 전체입니다.
  department text,

  note text,
  created_by text,
  -- 오리엔테이션 연습용. 실제 명단과 섞이면 안 됩니다(CLAUDE.md 2-1).
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.student_groups is
  '반이 아닌 명단(방과후·악기반). 학비외 항목의 대상으로 고를 수 있고, 하원 시각 판단에도 씁니다.';

-- 같은 학기에 같은 이름의 그룹이 둘이면 어느 쪽에 넣었는지 알 수 없습니다.
create unique index if not exists student_groups_name_uniq
  on public.student_groups (coalesce(term_id::text, ''), name);

create table if not exists public.student_group_members (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.student_groups(id) on delete cascade,
  student_id uuid not null references public.wr_students(id) on delete cascade,
  note text,
  added_by text,
  created_at timestamptz not null default now(),
  -- 한 아이가 같은 그룹에 두 번 들어가면 교재도 두 번 붙습니다.
  unique (group_id, student_id)
);

create index if not exists student_group_members_student_idx
  on public.student_group_members (student_id);

-- ── 학비외 항목이 그룹을 대상으로 삼을 수 있게 ────────────────────────────
alter table public.fee_items
  add column if not exists target_group_id uuid references public.student_groups(id) on delete set null;

alter table public.fee_items
  drop constraint if exists fee_items_target_scope_ck;
alter table public.fee_items
  add constraint fee_items_target_scope_ck
  check (target_scope is null or target_scope in ('개별', '부서전체', '학년', '반', '그룹'));

comment on column public.fee_items.target_group_id is
  'target_scope=''그룹'' 일 때 이 그룹의 학생에게 붙습니다. 명단이 바뀌면 대상도 저절로 따라옵니다.';

-- ── 접근 제한 ────────────────────────────────────────────────────────────
-- 교직원은 읽습니다 - 방과후 명단은 담임·셔틀에도 필요합니다.
-- 고치는 것은 행정실만.
alter table public.student_groups enable row level security;
alter table public.student_group_members enable row level security;

do $$
declare t text;
begin
  foreach t in array array['student_groups', 'student_group_members'] loop
    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    execute format('drop policy if exists %I on public.%I', t || '_write', t);
    execute format('create policy %I on public.%I for select using (public.is_giamicro_user())', t || '_read', t);
    execute format(
      'create policy %I on public.%I for all using (public.is_wr_manager()) with check (public.is_wr_manager())',
      t || '_write', t);
  end loop;
end $$;

drop trigger if exists student_groups_set_updated_at on public.student_groups;
create trigger student_groups_set_updated_at
  before update on public.student_groups
  for each row execute function public.set_updated_at();
