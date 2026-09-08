-- ===== 이 주소로 «누가 두드렸는지»를 남깁니다 =====
--
-- 「스크립트는 성공인데 앱은 아무것도 못 받았다」를 가릴 방법이 없었습니다. 토큰이 틀리면
-- 403으로 조용히 버려지고, 주소가 틀리면 애초에 우리에게 오지도 않습니다. 둘 다 화면에서는
-- **똑같이 «아직 없음»**으로 보입니다.
--
-- 그래서 토큰을 확인하기 **전에** 두드린 사실부터 적습니다. 그러면 세 가지가 갈립니다.
--
--   · 기록이 아예 없다      → 스크립트가 이 주소로 오지 않았습니다(ENDPOINT 문제)
--   · 있는데 «토큰 모름»    → 주소는 맞고 TOKEN 이 다릅니다
--   · 있는데 «받음»         → 다 맞았고, 그 뒤 처리 결과를 보면 됩니다
--
-- 토큰 전체는 적지 않습니다. 앞 6글자만 남겨 어느 토큰인지 알아볼 정도로만 둡니다 -
-- 진단하자고 열쇠를 통째로 적어두는 것은 문을 열어두는 것과 같습니다.

create table if not exists public.roster_sync_attempts (
  id uuid primary key default gen_random_uuid(),
  at timestamptz not null default now(),
  token_prefix text,
  link_id uuid references public.roster_sync_links(id) on delete set null,
  result text not null,
  note text
);

create index if not exists roster_sync_attempts_at_idx on public.roster_sync_attempts (at desc);

alter table public.roster_sync_attempts enable row level security;

drop policy if exists roster_sync_attempts_read on public.roster_sync_attempts;
create policy roster_sync_attempts_read on public.roster_sync_attempts
  for select using (public.is_giamicro_user());

-- 오래된 기록은 쌓아둘 이유가 없습니다. 진단은 «방금 무슨 일이 있었나»를 보는 일입니다.
create or replace function public.prune_roster_sync_attempts()
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.roster_sync_attempts where at < now() - interval '14 days';
$$;
