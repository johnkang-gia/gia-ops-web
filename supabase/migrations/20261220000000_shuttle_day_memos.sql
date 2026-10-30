-- 하원 메모 — 현장(휴대폰)에서 남기고 하원 체크표에서 읽습니다.
--
-- 하원 시간에 현장에서 알게 된 것(차가 늦는다, 어느 아이가 물건을 두고 갔다, 기사님이 바뀌었다)은
-- 지금까지 전화나 구글챗으로 행정실에 전해졌습니다. 그러면 체크표를 보는 사람은 그 사실을 모르고,
-- 나중에 「누가 언제 그랬나」를 찾을 곳도 없습니다. 하원 체크표 옆에 그날치로 모아 둡니다.
--
-- 모바일 화면은 로그인 없이 링크(shuttle_arrival_links 의 열쇠)로 열립니다. 그래서 쓰기는 서버
-- 창구(/api/shuttle/checklist-mobile)가 서비스 키로 하고, 누가 썼는지는 휴대폰에서 적은 이름으로
-- 남깁니다.

create table if not exists public.shuttle_day_memos (
  id uuid primary key default gen_random_uuid(),
  service_date date not null,
  term text not null default '정규학기',
  content text not null check (length(btrim(content)) > 0),
  -- 휴대폰에서 적은 이름. 로그인이 없는 화면이라 이것이 유일한 「누가」입니다.
  author text,
  -- 어디서 썼나: '모바일' · '체크표'
  source text not null default '모바일',
  -- 어느 링크로 들어왔나(링크를 닫았을 때 어디서 온 메모인지 되짚기 위해)
  link_id uuid,
  -- 행정실이 읽었다고 표시한 때·사람. 안 읽은 메모가 위에 남아야 놓치지 않습니다.
  checked_at timestamptz,
  checked_by text,
  -- 지우지 않고 숨깁니다. 잘못 적은 메모도 「그때 그렇게 적혔다」는 기록입니다.
  hidden_at timestamptz,
  hidden_by text,
  created_at timestamptz not null default now()
);

comment on table public.shuttle_day_memos is
  '하원 메모(그날치). 모바일 하원 체크표에서 쓰고 PC 하원 체크표에서 읽습니다.';

create index if not exists shuttle_day_memos_date_idx
  on public.shuttle_day_memos (service_date desc, created_at desc);

alter table public.shuttle_day_memos enable row level security;

-- 로그인한 교직원은 읽고, 체크표에서 쓰고, 확인 표시를 합니다. 지우는 정책은 만들지 않습니다.
drop policy if exists shuttle_day_memos_staff_read on public.shuttle_day_memos;
create policy shuttle_day_memos_staff_read on public.shuttle_day_memos
  for select to authenticated using (public.is_giamicro_user());

drop policy if exists shuttle_day_memos_staff_insert on public.shuttle_day_memos;
create policy shuttle_day_memos_staff_insert on public.shuttle_day_memos
  for insert to authenticated with check (public.is_giamicro_user());

drop policy if exists shuttle_day_memos_staff_update on public.shuttle_day_memos;
create policy shuttle_day_memos_staff_update on public.shuttle_day_memos
  for update to authenticated using (public.is_giamicro_user()) with check (public.is_giamicro_user());

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'shuttle_day_memos'
  ) then
    alter publication supabase_realtime add table public.shuttle_day_memos;
  end if;
end $$;

notify pgrst, 'reload schema';
