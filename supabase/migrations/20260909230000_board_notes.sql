-- 공용 쪽지 — 업무보드 아래에 다 같이 보는 메모판
--
-- 업무보드의 채팅창은 거의 안 쓰였습니다. 사무실에 다 같이 앉아 있으니 말로 해버리고,
-- 그러면 채팅은 「아무도 안 쓰는데 자리는 제일 넓게 차지하는 것」이 됩니다.
--
-- 대신 필요한 건 **말로 한 것을 남겨두는 자리**입니다. 「오늘 3시에 소방점검 옵니다」,
-- 「김OO 어머니 전화 기다리는 중」 같은 것들 - 대화가 아니라 **붙여두는 쪽지**입니다.
--
-- 왜 부서메모(department_memos)로 안 되는가: 그건 **한 덩어리 글**이라 여러 사람이 동시에
-- 쓰면 서로 지웁니다. 쪽지는 한 장씩 따로 붙어야 각자 쓰고 각자 뗍니다.

create table if not exists public.board_notes (
  id uuid primary key default gen_random_uuid(),

  -- 어느 부서의 판인가. 부서를 넘나드는 것은 전체공지(work_notices)가 따로 있습니다.
  department text not null,

  content text not null,

  -- 색. 종이 쪽지처럼 눈으로 갈라 봅니다. 뜻을 코드에 박지 않습니다 - 「노랑은 급한 것」
  -- 같은 약속은 사람들이 쓰면서 정하고, 정하지 못해도 색은 그대로 쓸모가 있습니다.
  color text not null default 'yellow',

  -- 위에 고정. 오래된 것 위로 밀려 올라가는 것을 막습니다.
  pinned boolean not null default false,

  /**
   * 언제까지 붙어 있을 것인가.
   *
   * **이게 이 표의 요점입니다.** 지우는 일을 사람에게 맡기면 아무도 안 지웁니다. 그러면 판이
   * 지난 쪽지로 덮이고, 덮인 판은 아무도 안 봅니다 - 채팅창이 죽은 것과 같은 길입니다.
   * 기본은 오늘까지. 계속 붙여둘 것은 사람이 늘립니다.
   */
  expires_on date,

  -- 누가 붙였는가. 지우는 것은 붙인 사람과 관리자만입니다.
  author_email text not null,
  author_name text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists board_notes_dept_idx on public.board_notes (department, pinned desc, created_at desc);

alter table public.board_notes enable row level security;

drop policy if exists board_notes_read on public.board_notes;
create policy board_notes_read on public.board_notes
  for select using (public.is_giamicro_user());

-- 붙이는 것은 누구나. 사무실에서 말로 하던 것을 옮기는 자리라, 문턱이 있으면 안 씁니다.
drop policy if exists board_notes_insert on public.board_notes;
create policy board_notes_insert on public.board_notes
  for insert with check (public.is_giamicro_user());

-- 고치고 지우는 것은 **붙인 사람**만. 남의 쪽지를 말없이 지우면 그 사람은 자기가 붙인 것이
-- 왜 사라졌는지 영영 모릅니다.
drop policy if exists board_notes_own on public.board_notes;
create policy board_notes_own on public.board_notes
  for update using (public.is_giamicro_user() and author_email = auth.jwt() ->> 'email');

drop policy if exists board_notes_delete on public.board_notes;
create policy board_notes_delete on public.board_notes
  for delete using (public.is_giamicro_user() and author_email = auth.jwt() ->> 'email');

-- 실시간으로 붙고 떨어져야 합니다. 옆자리에서 붙인 쪽지가 내 화면에 안 뜨면, 결국 다시
-- 말로 하게 되고 이 판도 채팅과 같은 길을 갑니다.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'board_notes'
    ) then
      alter publication supabase_realtime add table public.board_notes;
    end if;
  end if;
end $$;

-- 지난 쪽지는 저절로 떨어집니다. 화면은 만료된 것을 안 보여주고, 이 함수가 이따금 치웁니다.
create or replace function public.prune_board_notes()
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.board_notes
  where expires_on is not null and expires_on < (now() at time zone 'Asia/Seoul')::date - interval '7 days';
$$;
