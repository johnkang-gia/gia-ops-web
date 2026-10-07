-- 월별 청구 · 여러 달 납부의 시작월 · 함께 하면 값이 바뀌는 프로그램(오케스트라·매쓰팀).
--
-- 학비는 학기 단위로만 「청구됨」을 판정했습니다. 그래서 월납 방과후를 9월에 한 번 청구하면
-- 그 학기 내내 「청구 완료」로 남아 10월분을 낼 길이 없었고, 지난달 청구서가 이번 달 화면에
-- 그대로 섞였습니다. 이제 월 단위 항목은 청구월(`invoices.billing_month`)로 판정합니다.
--
-- 5개월·10개월 납부는 「언제부터 언제까지 낸 것인가」가 어디에도 없었습니다. 운영앱 이전에
-- 받은 돈도 있으므로 사람이 시작월을 적을 수 있어야 하고, 운영앱에서 처음 청구하면 그 달이
-- 시작월이 됩니다.
--
-- 오케스트라는 함께 하는 방과후에 따라 합친 금액이 정해져 있습니다(주5회+오케 55만 등).
-- 조합마다 항목을 따로 만들면 프로그램이 늘 때마다 곱으로 늘어나므로, 「이 프로그램을 저
-- 항목과 함께 하면 합쳐서 얼마」를 한 표에 적습니다.
--
-- 전부 더하기만 합니다.

-- ── 1. 여러 달 납부의 시작월 ────────────────────────────────────────

alter table public.student_fee_enrollments
  add column if not exists paid_from text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'student_fee_enrollments_paid_from_ck'
  ) then
    alter table public.student_fee_enrollments
      add constraint student_fee_enrollments_paid_from_ck
      check (paid_from is null or paid_from ~ '^\d{4}-(0[1-9]|1[0-2])$');
  end if;
end $$;

comment on column public.student_fee_enrollments.paid_from is
  '여러 달을 한 번에 낸 납부 옵션의 시작월(YYYY-MM). 시작월부터 옵션 회차만큼의 달이 「납부 기간」입니다.';

-- ── 2. 함께 하면 값이 바뀌는 프로그램 ───────────────────────────────

create table if not exists public.fee_addon_prices (
  id uuid primary key default gen_random_uuid(),
  -- 더해지는 프로그램(오케스트라). 학비 항목입니다.
  addon_plan_id uuid not null references public.fee_plans(id) on delete cascade,
  -- 함께 하는 항목(방과후 5일반). 이 둘을 같이 하면 합쳐서 combined_amount 입니다.
  base_plan_id uuid not null references public.fee_plans(id) on delete cascade,
  -- 월 기준, 두 항목을 합친 금액. 학교가 안내하는 숫자 그대로 적습니다.
  combined_amount numeric(12, 0) not null check (combined_amount >= 0),
  active boolean not null default true,
  note text,
  created_at timestamptz not null default now(),
  unique (addon_plan_id, base_plan_id)
);

comment on table public.fee_addon_prices is
  '함께 하면 합친 금액이 정해진 프로그램. 더해지는 금액 = 합친 금액 − 함께 하는 항목의 월 기준금액.';

alter table public.fee_addon_prices enable row level security;
drop policy if exists fee_addon_prices_finance_only on public.fee_addon_prices;
create policy fee_addon_prices_finance_only on public.fee_addon_prices
  for all using (public.is_finance_user()) with check (public.is_finance_user());

-- ── 3. 처음 값 ──────────────────────────────────────────────────────
-- 매쓰팀(주1회 15만원)은 방과후처럼 고르는 항목입니다. 오케스트라는 혼자서는 신청하지 않고
-- (기준금액 0원), 함께 하는 항목에 따라 합친 금액이 정해집니다.

insert into public.fee_plans (category, name, description, base_amount, unit, active, sort_order, target_scope, target_departments, target_grades, target_classes)
select '학비', '매쓰팀 (주1회)', '특별 방과후', 150000, '월', true,
       coalesce(b.sort_order, 0) + 1, b.target_scope, b.target_departments, b.target_grades, b.target_classes
  from (select * from public.fee_plans where name = '방과후 2일반' and category = '학비' limit 1) b
 where not exists (select 1 from public.fee_plans where name = '매쓰팀 (주1회)');

insert into public.fee_plans (category, name, description, base_amount, unit, active, sort_order, target_scope, target_departments, target_grades, target_classes)
select '학비', '오케스트라', '특별 방과후 · 함께 하는 방과후에 따라 합친 금액이 정해집니다', 0, '월', true,
       coalesce(b.sort_order, 0) + 2, b.target_scope, b.target_departments, b.target_grades, b.target_classes
  from (select * from public.fee_plans where name = '방과후 2일반' and category = '학비' limit 1) b
 where not exists (select 1 from public.fee_plans where name = '오케스트라');

-- 납부 옵션은 매달 내는 것 하나로 시작합니다. 여러 달 할인은 학교가 정하면 요금표에서 더합니다.
insert into public.fee_payment_options (plan_id, name, periods, discount_rate, active, sort_order)
select p.id, '월 납부', 1, 0, true, 0
  from public.fee_plans p
 where p.name in ('매쓰팀 (주1회)', '오케스트라')
   and not exists (select 1 from public.fee_payment_options o where o.plan_id = p.id and o.name = '월 납부');

insert into public.fee_addon_prices (addon_plan_id, base_plan_id, combined_amount)
select a.id, b.id, v.amount
  from (values
    ('방과후 5일반', 550000),
    ('방과후 3일반', 425000),
    ('방과후 2일반', 350000),
    ('매쓰팀 (주1회)', 500000)
  ) as v(base_name, amount)
  join public.fee_plans b on b.name = v.base_name and b.category = '학비'
  cross join (select id from public.fee_plans where name = '오케스트라' limit 1) a
on conflict (addon_plan_id, base_plan_id) do nothing;

-- ── 4. 실시간 ───────────────────────────────────────────────────────
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'fee_addon_prices'
  ) then
    alter publication supabase_realtime add table public.fee_addon_prices;
  end if;
exception when others then
  raise notice '함께 하는 프로그램 표 실시간 등록을 건너뜁니다: %', sqlerrm;
end $$;

notify pgrst, 'reload schema';
