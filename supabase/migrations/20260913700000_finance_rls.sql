-- 돈에 관한 표를 **재무 열쇠 가진 사람에게만** 열어둡니다
--
-- ── 무엇이 문제였나 ──────────────────────────────────────────────────
--
-- 화면은 이미 잘 막혀 있었습니다 - 재무 메뉴는 `hasFinanceAccess` 로 걸러지고, 학생
-- 프로필의 납부 상태도 열쇠가 있어야 보입니다.
--
-- 그런데 **표 자체에는 자물쇠가 없었습니다.** 청구서·수납·요금 표에 RLS가 꺼져 있어서,
-- 로그인한 교직원이면 누구나 브라우저에서 곧장 읽을 수 있었습니다. 화면에서 안 보여주는
-- 것은 예의이지 자물쇠가 아닙니다 - 주소만 알면 담임 선생님도 전 학년 납부 내역을
-- 통째로 받아갈 수 있는 상태였습니다.
--
-- ── 이 마이그레이션이 하는 일 ────────────────────────────────────────
--
-- 자물쇠를 채우되, **채우는 것과 열쇠를 만드는 것을 같이 합니다.** RLS만 켜고 정책을 안
-- 만들면 아무도 못 읽게 되는데, 그건 오류로 안 보이고 「청구서가 없습니다」로 보입니다.
-- 그게 훨씬 나쁩니다.

-- ── 1. 재무 열쇠 판정 ───────────────────────────────────────────────
--
-- 코드의 `hasFinanceAccess()` 와 **같은 기준**입니다. 두 곳이 다르면 화면에는 보이는데
-- 자료는 안 오거나(또는 그 반대) 하는, 원인을 짐작하기 어려운 상태가 됩니다.
--
--   · 개발자 계정 — 권한이 아니라 화면을 고치기 위한 통로입니다.
--   · finance_access = true 인 승인된 계정.
--
-- 직위로 판정하지 않습니다. 관리자라고 자동으로 열리지 않고, 최고관리자도 열쇠를 따로
-- 받습니다 - 겸직은 할 수 있지만 기본이 꺼져 있어야 기록이 깨끗합니다.
create or replace function public.is_finance_user()
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

comment on function public.is_finance_user() is
  '재무 열쇠를 가졌는가. 코드의 hasFinanceAccess() 와 같은 기준이어야 합니다 - 다르면 화면과 자료가 어긋납니다.';

-- ── 2. 돈에 관한 표 ─────────────────────────────────────────────────
--
-- 읽기도 쓰기도 열쇠가 있어야 합니다. 「보기만 되게」로 나누지 않은 이유: 이 표들을 읽는
-- 화면은 전부 재무 화면이고, 재무 화면에 들어온 사람은 고치기도 합니다. 읽기만 되는
-- 사람을 위한 화면이 따로 없는데 정책만 나누면, 쓰이지 않는 규칙이 하나 늘 뿐입니다.
--
-- 서버(크론·API)는 서비스 키로 도므로 이 정책을 지나갑니다 - 청구서 발행·수납 반영은
-- 그대로 동작합니다.
do $$
declare
  t text;
begin
  foreach t in array array[
    'invoices', 'invoice_lines', 'payments', 'cash_receipts',
    'fee_plans', 'fee_items', 'fee_categories', 'fee_terms',
    'fee_discounts', 'fee_payment_options',
    'student_fee_enrollments', 'student_fee_items', 'student_fee_discounts',
    'fee_discount_log', 'fee_item_price_log'
  ] loop
    -- 표가 없으면 건너뜁니다. 있는 것만 잠그고, 없는 것 때문에 전체가 멈추지 않게 합니다.
    if to_regclass('public.' || t) is null then
      continue;
    end if;
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_finance_only', t);
    execute format(
      'create policy %I on public.%I for all using (public.is_finance_user()) with check (public.is_finance_user())',
      t || '_finance_only', t
    );
  end loop;
end $$;

-- ── 3. 의류 (돈이 아니라 물건) ──────────────────────────────────────
--
-- 유니폼 사이즈·주문·재고는 재무가 아니라 학교 운영입니다. 담임 선생님이 「이 아이 사이즈가
-- 뭐였지」를 보는 것은 막을 이유가 없습니다. 다만 고치는 것은 담당자만 합니다.
--
-- 여기에 RLS가 없던 것은 재무와 같은 사고였습니다 - 만들 때 켜는 줄을 빠뜨렸습니다.
do $$
declare
  t text;
begin
  foreach t in array array[
    'student_apparel_sizes', 'apparel_orders', 'apparel_order_items',
    'apparel_order_pieces', 'apparel_stock_moves', 'apparel_exchanges'
  ] loop
    if to_regclass('public.' || t) is null then
      continue;
    end if;
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_staff_read', t);
    execute format('drop policy if exists %I on public.%I', t || '_manager_write', t);
    execute format(
      'create policy %I on public.%I for select using (public.is_giamicro_user())',
      t || '_staff_read', t
    );
    execute format(
      'create policy %I on public.%I for all using (public.is_wr_manager()) with check (public.is_wr_manager())',
      t || '_manager_write', t
    );
  end loop;
end $$;

-- ── 4. 잠근 뒤에 확인할 수 있게 ─────────────────────────────────────
--
-- 「지금 누가 열쇠를 갖고 있나」를 물어볼 자리가 필요합니다. 열쇠를 가진 사람이 하나도
-- 없으면 재무 화면이 통째로 비는데, 그건 오류로 안 보이고 「자료가 없네」로 보입니다.
create or replace view public.finance_key_holders as
select email, name, position, status
from public.app_users
where finance_access = true and status = 'approved';

comment on view public.finance_key_holders is
  '재무 열쇠를 가진 계정. 잠근 뒤 「열쇠 가진 사람이 있는가」를 확인하는 자리입니다 - 아무도 없으면 재무 화면이 통째로 빕니다.';
