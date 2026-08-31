-- 재무 권한 분리 (인보이스 시스템 1단계)
--
-- 담당자 요청:
--   "재무관리자의 권한을 새로 만들어서 재무관리자만 이 돈에 관한 메뉴를 볼 수 있도록",
--   "재무관리자는 다른 사람들이 볼 때는 그냥 관리자로 보이도록(개발자랑 최고관리자만 보이도록)",
--   "최고관리자는 개발자 바로 밑"
--
-- ── 왜 '재무관리자'라는 직위를 만들지 않았는가 ───────────────────────────
--
-- 처음에는 개발자 > 최고관리자 > 재무관리자 > 관리자 로 한 줄 세우려 했습니다. 그런데 재무는
-- 위아래가 아니라 **다른 축**입니다. 재무를 보는 사람이 셔틀이나 학사를 관리자보다 더 잘 알
-- 이유가 없습니다. 한 줄로 세우면 나중에 "재무만 보고 학생 명부는 못 보는 경리직원" 같은 것을
-- 만들 수가 없습니다.
--
-- 그래서 **계층 하나 + 열쇠 하나**로 나눕니다.
--
--   position       = 보이는 직위 (교사 · 행정직원 · 관리자 · 최고관리자 · 개발자)
--   finance_access = 재무 열쇠 (있음/없음) — 직위와 별개
--
-- 재무관리자 = position '관리자' + finance_access true.
-- 그러면 "남들에게는 그냥 관리자로 보인다"가 **숨기는 장치 없이** 성립합니다 - 실제로 관리자가
-- 맞으니까요. 숨김 로직으로 가리는 것보다 이쪽이 훨씬 덜 샙니다. 화면 한 군데를 빠뜨려도
-- 드러날 것이 없습니다.
--
-- 열쇠 자체는 개발자와 최고관리자에게만 보입니다(화면 단에서 거릅니다).

-- ── 1. 재무 열쇠 ────────────────────────────────────────────────────────
alter table public.app_users
  add column if not exists finance_access boolean not null default false;

comment on column public.app_users.finance_access is
  '재무 열쇠. 돈에 관한 화면을 볼 수 있는가. 직위(position)와 별개이며, 개발자·최고관리자에게만 보입니다.';

-- ── 2. 최고관리자 ───────────────────────────────────────────────────────
-- position에 값 하나를 더합니다. 최고관리자는 숨길 이유가 없으므로 보이는 직위로 둡니다
-- (숨겨야 하는 건 재무 열쇠뿐입니다).
alter table public.app_users drop constraint if exists app_users_position_check;
alter table public.app_users
  add constraint app_users_position_check
  check (position is null or position in ('교사', '행정직원', '관리자', '최고관리자', '개발자'));

-- ── 3. 관리자 판정에 최고관리자를 포함 ──────────────────────────────────
--
-- 이걸 빠뜨리면 최고관리자로 올린 사람이 **관리자 권한을 잃습니다**(RLS가 position='관리자'만
-- 보고 있었습니다). 직위를 올려줬는데 오히려 못 하게 되는, 알아채기 어려운 사고입니다.
create or replace function public.is_app_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select
    coalesce((auth.jwt() ->> 'email') ilike 'johnkang@giamicro.com', false)
    or exists (
      select 1 from app_users
      where email = lower(auth.jwt() ->> 'email')
        and status = 'approved'
        and position in ('관리자', '최고관리자')
    );
$$;

-- ── 4. 재무 접근 판정 ───────────────────────────────────────────────────
-- 앞으로 만들 돈 관련 표의 RLS는 전부 이 함수 하나만 봅니다. 판정 기준이 여러 군데로
-- 흩어지면 한 곳만 고치고 나머지를 잊습니다 - 이번 주에 그 실수를 몇 번 했습니다.
create or replace function public.has_finance_access()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select
    coalesce((auth.jwt() ->> 'email') ilike 'johnkang@giamicro.com', false)
    or exists (
      select 1 from app_users
      where email = lower(auth.jwt() ->> 'email')
        and status = 'approved'
        and finance_access = true
    );
$$;

-- ── 5. 열쇠를 누가 언제 주고 뺏었나 ─────────────────────────────────────
--
-- 돈 권한은 "지금 누가 갖고 있나"만으로는 부족합니다. 나중에 문제가 생겼을 때 **언제부터
-- 누가 줬는지**를 못 대면 아무 설명도 못 합니다. 권한을 바꾼 기록은 지워지지 않습니다.
create table if not exists public.finance_access_log (
  id uuid primary key default gen_random_uuid(),
  target_email text not null,
  granted boolean not null,
  changed_by text not null,
  reason text,
  changed_at timestamptz not null default now()
);

comment on table public.finance_access_log is
  '재무 열쇠 부여·회수 기록. 지우지 않습니다.';

create index if not exists finance_access_log_target_idx
  on public.finance_access_log (target_email, changed_at desc);

alter table public.finance_access_log enable row level security;

-- 읽기는 개발자·최고관리자만(=is_app_admin), 쓰기는 서버 라우트가 서비스 키로 합니다.
drop policy if exists finance_access_log_read on public.finance_access_log;
create policy finance_access_log_read
  on public.finance_access_log
  for select
  using (public.is_app_admin());
