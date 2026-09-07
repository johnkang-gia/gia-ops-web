-- 구글시트에서 명부를 받아 「반영 대기」로 쌓아둡니다.
--
-- 시트는 직원 여럿이 함께 편집합니다. 시트에 붙인 스크립트는 편집 권한이 있는 사람이면
-- 코드도 토큰도 꺼내 볼 수 있으므로, 토큰은 새어나갈 수 있다고 보고 설계합니다.
--
--   ① 들어온 줄은 **명부를 바로 고치지 않습니다.** 대기함에 쌓이고 사람이 확인해야 들어갑니다.
--      토큰이 새더라도 최악이 「대기함에 쓰레기 줄이 쌓이는 것」으로 끝납니다.
--   ② 이 창구는 **쓰기 전용**입니다. 명부를 읽어가는 데는 쓸 수 없습니다.
--   ③ 토큰은 언제든 재발급합니다(update).

create table if not exists roster_sync_links (
  id uuid primary key default gen_random_uuid(),
  label text not null default '구글시트 명부',
  token text not null unique,
  enabled boolean not null default true,
  sheet_hint text,
  last_push_at timestamptz,
  last_row_count integer,
  last_queued integer,
  last_error text,
  created_at timestamptz not null default now(),
  created_by text
);

create table if not exists roster_sync_inbox (
  id uuid primary key default gen_random_uuid(),
  link_id uuid references roster_sync_links(id) on delete cascade,
  name text not null,
  kind text not null,
  reason text,
  changes jsonb not null default '[]'::jsonb,
  values jsonb not null default '{}'::jsonb,
  student_id uuid,
  -- 같은 줄이 10분마다 다시 들어와도 대기함이 불어나지 않게 하는 열쇠입니다.
  fingerprint text not null,
  status text not null default '대기',
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by text
);

create unique index if not exists roster_sync_inbox_pending_key
  on roster_sync_inbox (fingerprint) where status = '대기';
create index if not exists roster_sync_inbox_status_idx
  on roster_sync_inbox (status, created_at desc);

alter table roster_sync_links enable row level security;
alter table roster_sync_inbox enable row level security;

drop policy if exists roster_sync_links_rw on roster_sync_links;
create policy roster_sync_links_rw on roster_sync_links
  for all using (public.is_giamicro_user()) with check (public.is_giamicro_user());

drop policy if exists roster_sync_inbox_rw on roster_sync_inbox;
create policy roster_sync_inbox_rw on roster_sync_inbox
  for all using (public.is_giamicro_user()) with check (public.is_giamicro_user());
