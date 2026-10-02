-- 도서관 앱이 명부 변경을 바로 알아채게 하는 번호 하나.
--
-- ── 무엇이 문제였나 ──────────────────────────────────────────────────
--
-- 도서관 앱은 운영앱과 같은 DB 의 lib_students 뷰(= wr_students 그대로)를 읽습니다. 자료는
-- 같습니다 - 실제로 맞대어 보면 456명 전원이 한 칸도 다르지 않습니다. 그런데 도서관 노트북은
-- 하루 종일 열려 있고, 화면은 **처음 열 때 한 번만** 명단을 읽습니다. 운영앱에서 학생을
-- 추가하거나 반을 바꿔도 그 화면은 다시 읽을 계기가 없어서, 노트북에는 아침 명단이 그대로
-- 떠 있었습니다. 오류가 아니라 «아직 그 아이가 없는 명단»으로 보입니다.
--
-- ── 그래서 ───────────────────────────────────────────────────────────
--
-- 명부가 바뀔 때마다 DB 가 이 번호를 올립니다(트리거). 도서관 앱은 이 표 하나만 실시간으로
-- 듣고, 번호가 바뀌면 화면을 다시 읽습니다. wr_students 를 직접 듣지 않는 이유: 도서관 가계정은
-- 그 표를 읽을 수 없고(운영앱 정보 격리), 뷰는 실시간 구독이 안 됩니다. 하원 도착체크가 쓰는
-- 「번호 문지기」와 같은 방식입니다(CLAUDE.md 2-13).
--
-- 문장 단위 트리거라 명부 일괄 반영(구글시트 139줄)도 번호는 한 번만 오릅니다.

create table if not exists public.lib_roster_version (
  id integer primary key default 1 check (id = 1),
  version bigint not null default 0,
  changed_at timestamptz not null default now()
);

insert into public.lib_roster_version (id) values (1) on conflict (id) do nothing;

alter table public.lib_roster_version enable row level security;

-- 읽기만 엽니다. 쓰는 일은 아래 트리거 함수만 합니다(security definer).
drop policy if exists "lib_read_roster_version" on public.lib_roster_version;
create policy "lib_read_roster_version" on public.lib_roster_version
  for select to authenticated using (is_lib_user());

create or replace function public.bump_lib_roster_version()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.lib_roster_version set version = version + 1, changed_at = now() where id = 1;
  return null;
end;
$$;

drop trigger if exists wr_students_bump_lib_roster on public.wr_students;
create trigger wr_students_bump_lib_roster
  after insert or update or delete on public.wr_students
  for each statement execute function public.bump_lib_roster_version();

-- 실시간 발행 목록에 넣습니다. 안 넣으면 구독은 붙는데 알림이 안 옵니다 - 하원 체크표에서
-- 이미 한 번 겪었습니다(v0.691.0).
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'lib_roster_version'
  ) then
    alter publication supabase_realtime add table public.lib_roster_version;
  end if;
end $$;
