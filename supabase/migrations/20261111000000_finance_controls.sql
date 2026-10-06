-- 재무 통제: 결재(결손·환불) · 보낸 청구서 정정 · 세입과목 · 과목경정.
--
-- 지금까지 환불은 누르는 순간 장부에 들어갔고, 받지 못할 돈을 정리할 길(결손)은 아예
-- 없었습니다. 둘 다 돈이 장부에서 빠져나가는 일인데, 한 사람이 혼자 끝낼 수 있었습니다.
-- 받지 못한 돈은 「미납」으로 영영 남아 미수금 합계를 부풀렸습니다.
--
-- 청구서는 학부모에게 보낸 뒤에도 취소·재발행밖에 고칠 길이 없었습니다. 보낸 뒤에 번호가
-- 바뀌면 학부모가 받은 종이와 우리 장부가 서로 다른 번호를 말합니다.
--
-- 수입을 「어느 과목(수업료·교재·급식…)으로 얼마」로 볼 방법도 없었습니다. 항목 이름은
-- 학기마다 바뀌어서 이름으로 모으면 해마다 다른 표가 나옵니다.
--
-- 전부 더하기만 합니다. 지우거나 바꾸는 줄은 없습니다.

-- ── 1. 세입과목 ─────────────────────────────────────────────────────

create table if not exists public.revenue_accounts (
  id uuid primary key default gen_random_uuid(),
  -- 사람이 부르는 번호. 한 번 정하면 바꾸지 않습니다 - 지난 보고서가 이 번호를 가리킵니다.
  code text not null unique,
  name text not null,
  level text not null check (level in ('관', '항', '목')),
  parent_id uuid references public.revenue_accounts(id) on delete restrict,
  sort_order integer not null default 0,
  active boolean not null default true,
  note text,
  created_at timestamptz not null default now()
);

comment on table public.revenue_accounts is
  '세입과목(관·항·목). 납부항목·분류가 여기 하나에 매달리고, 과목별 수입현황이 이 번호로 모입니다.';

alter table public.revenue_accounts enable row level security;
drop policy if exists revenue_accounts_finance_only on public.revenue_accounts;
create policy revenue_accounts_finance_only on public.revenue_accounts
  for all using (public.is_finance_user()) with check (public.is_finance_user());

insert into public.revenue_accounts (code, name, level, sort_order) values
  ('1000', '학생부담수입', '관', 10),
  ('9000', '기타수입', '관', 90)
on conflict (code) do nothing;

insert into public.revenue_accounts (code, name, level, parent_id, sort_order)
select v.code, v.name, '항', p.id, v.sort
  from (values
    ('1100', '수업료', '1000', 11),
    ('1200', '수익자부담수입', '1000', 12),
    ('9100', '잡수입', '9000', 91)
  ) as v(code, name, parent, sort)
  join public.revenue_accounts p on p.code = v.parent
on conflict (code) do nothing;

insert into public.revenue_accounts (code, name, level, parent_id, sort_order)
select v.code, v.name, '목', p.id, v.sort
  from (values
    ('1110', '정규과정 수업료', '1100', 111),
    ('1120', '방과후 수업료', '1100', 112),
    ('1210', '교재비', '1200', 121),
    ('1220', '교복·의류비', '1200', 122),
    ('1230', '급식비', '1200', 123),
    ('1240', '차량비', '1200', 124),
    ('1250', '체험·행사비', '1200', 125),
    ('1260', '악기·악기수리', '1200', 126),
    ('1290', '기타 수익자부담', '1200', 129),
    ('9110', '기타 잡수입', '9100', 911)
  ) as v(code, name, parent, sort)
  join public.revenue_accounts p on p.code = v.parent
on conflict (code) do nothing;

alter table public.fee_plans add column if not exists revenue_account_id uuid references public.revenue_accounts(id) on delete set null;
alter table public.fee_categories add column if not exists revenue_account_id uuid references public.revenue_accounts(id) on delete set null;
alter table public.fee_items add column if not exists revenue_account_id uuid references public.revenue_accounts(id) on delete set null;

comment on column public.fee_items.revenue_account_id is
  '이 항목만 따로 정한 세입과목. 비어 있으면 분류(fee_categories)의 과목을 따릅니다.';

-- 이름으로 짐작해 처음 한 번 채웁니다. 이미 정해진 칸은 건드리지 않습니다.
create or replace function public.guess_revenue_code(p_text text, p_tuition boolean)
returns text
language sql
immutable
as $$
  select case
    when p_tuition and p_text ~* '방과후|after' then '1120'
    when p_tuition then '1110'
    when p_text ~* '교재|book|text' then '1210'
    when p_text ~* '교복|의류|체육복|uniform' then '1220'
    when p_text ~* '급식|식비|간식|meal|lunch' then '1230'
    when p_text ~* '셔틀|차량|버스|bus|shuttle' then '1240'
    when p_text ~* '체험|행사|캠프|현장|소풍|trip|camp' then '1250'
    when p_text ~* '악기' then '1260'
    when p_text ~* '방과후' then '1120'
    else '1290'
  end
$$;

update public.fee_plans p
   set revenue_account_id = a.id
  from public.revenue_accounts a
 where p.revenue_account_id is null
   and a.code = public.guess_revenue_code(p.name, p.category = '학비');

update public.fee_categories c
   set revenue_account_id = a.id
  from public.revenue_accounts a
 where c.revenue_account_id is null
   and a.code = public.guess_revenue_code(c.name, false);

-- ── 2. 청구 줄: 정정 · 과목경정 ──────────────────────────────────────

alter table public.invoice_lines add column if not exists is_adjustment boolean not null default false;
alter table public.invoice_lines add column if not exists adjust_reason text;
alter table public.invoice_lines add column if not exists adjusted_by text;
alter table public.invoice_lines add column if not exists adjusted_at timestamptz;
alter table public.invoice_lines add column if not exists plan_id uuid references public.fee_plans(id) on delete set null;
alter table public.invoice_lines add column if not exists revenue_account_id uuid references public.revenue_accounts(id) on delete set null;

comment on column public.invoice_lines.is_adjustment is
  '보낸 뒤에 더한 정정 줄. 원래 줄은 그대로 두고 차액만 더합니다 - 학부모가 받은 종이의 줄이 장부에서 사라지지 않게.';
comment on column public.invoice_lines.revenue_account_id is
  '과목경정으로 사람이 정한 세입과목. 비어 있으면 항목·분류에서 따라옵니다.';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'invoice_lines_adjust_reason_ck') then
    alter table public.invoice_lines
      add constraint invoice_lines_adjust_reason_ck
      check (not is_adjustment or (adjust_reason is not null and btrim(adjust_reason) <> ''));
  end if;
end $$;

create table if not exists public.invoice_line_reclass_log (
  id uuid primary key default gen_random_uuid(),
  line_id uuid not null references public.invoice_lines(id) on delete cascade,
  invoice_id uuid references public.invoices(id) on delete cascade,
  from_account_id uuid references public.revenue_accounts(id) on delete set null,
  to_account_id uuid references public.revenue_accounts(id) on delete set null,
  reason text not null check (btrim(reason) <> ''),
  changed_by text,
  changed_at timestamptz not null default now()
);

create index if not exists invoice_line_reclass_log_line_idx on public.invoice_line_reclass_log (line_id, changed_at desc);

comment on table public.invoice_line_reclass_log is
  '과목경정 내력. 금액은 그대로이고 어느 과목으로 셀지만 바뀝니다. 왜 바꿨는지 없이는 남기지 않습니다.';

alter table public.invoice_line_reclass_log enable row level security;
drop policy if exists invoice_line_reclass_log_finance_only on public.invoice_line_reclass_log;
create policy invoice_line_reclass_log_finance_only on public.invoice_line_reclass_log
  for all using (public.is_finance_user()) with check (public.is_finance_user());

-- ── 3. 결손 ─────────────────────────────────────────────────────────

alter table public.invoices add column if not exists written_off_amount numeric(12, 2) not null default 0;
alter table public.invoices add column if not exists written_off_at timestamptz;
alter table public.invoices add column if not exists written_off_by text;
alter table public.invoices add column if not exists written_off_reason text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'invoices_written_off_nonneg') then
    alter table public.invoices
      add constraint invoices_written_off_nonneg check (written_off_amount >= 0);
  end if;
end $$;

comment on column public.invoices.written_off_amount is
  '받지 않기로 결재된 금액(결손). 잔액 = 청구액 − 입금 − 결손. 결재 없이는 바뀌지 않습니다.';

-- 마감된 달이라도 **결손 칸만** 바뀌는 것은 막지 않습니다. 결손은 보통 몇 달 뒤에
-- 정해지는데, 그 달을 다시 열게 하면 청구·수납 숫자까지 고칠 수 있는 문이 함께 열립니다.
-- 청구액·입금은 그대로라 그 달에 보고한 숫자는 바뀌지 않습니다.
create or replace function public.block_closed_month_invoice()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_month text;
begin
  if tg_op = 'UPDATE'
     and (to_jsonb(old) - array['written_off_amount', 'written_off_at', 'written_off_by', 'written_off_reason', 'updated_at'])
       = (to_jsonb(new) - array['written_off_amount', 'written_off_at', 'written_off_by', 'written_off_reason', 'updated_at']) then
    return new;
  end if;

  v_month := coalesce(
    case when tg_op = 'DELETE' then old.billing_month else new.billing_month end,
    to_char(case when tg_op = 'DELETE' then old.issue_date else new.issue_date end, 'YYYY-MM')
  );
  if v_month is not null and public.is_month_closed(v_month) then
    raise exception '% 은(는) 마감된 달입니다. 고치려면 재무 → 월별에서 그 달을 다시 열어주세요.', v_month
      using errcode = 'check_violation';
  end if;

  if tg_op = 'UPDATE' and old.billing_month is distinct from new.billing_month
     and old.billing_month is not null and public.is_month_closed(old.billing_month) then
    raise exception '% 은(는) 마감된 달입니다. 그 달의 청구서를 다른 달로 옮길 수 없습니다.', old.billing_month
      using errcode = 'check_violation';
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

-- ── 4. 결재 (결손 · 환불) ────────────────────────────────────────────

create table if not exists public.finance_requests (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('결손', '환불')),
  invoice_id uuid not null references public.invoices(id) on delete restrict,
  student_id uuid references public.wr_students(id) on delete set null,
  amount numeric(12, 2) not null check (amount > 0),
  reason text not null check (btrim(reason) <> ''),
  -- 환불: 돌려줄 날·방법. 승인될 때 그대로 입금 줄이 됩니다.
  payload jsonb not null default '{}'::jsonb,
  status text not null default '대기' check (status in ('대기', '승인', '반려', '취소')),
  requested_by text not null,
  requested_at timestamptz not null default now(),
  decided_by text,
  decided_at timestamptz,
  decision_note text,
  -- 승인으로 생긴 환불 입금 줄. 무엇이 이 결재로 생겼는지 거꾸로 찾을 수 있어야 합니다.
  applied_payment_id uuid references public.payments(id) on delete set null,
  applied_at timestamptz
);

comment on table public.finance_requests is
  '돈이 장부에서 빠지는 일(결손·환불)의 결재. 요청한 사람은 승인할 수 없습니다.';

create index if not exists finance_requests_status_idx on public.finance_requests (status, requested_at desc);
create index if not exists finance_requests_invoice_idx on public.finance_requests (invoice_id);

-- 한 청구서에 같은 종류의 대기 요청은 하나만. 둘이 함께 승인되면 두 번 빠집니다.
create unique index if not exists finance_requests_one_pending
  on public.finance_requests (invoice_id, kind) where status = '대기';

alter table public.finance_requests enable row level security;
drop policy if exists finance_requests_finance_only on public.finance_requests;
create policy finance_requests_finance_only on public.finance_requests
  for all using (public.is_finance_user()) with check (public.is_finance_user());

-- 요청자 ≠ 결재자를 **데이터베이스가** 지킵니다. 화면과 API 가 막아도, 이름 칸은 보내는
-- 쪽이 적는 값이라 그대로 믿으면 자기 요청을 자기가 승인할 수 있습니다. 로그인한 사람의
-- 메일이 있으면 그것으로 덮어씁니다.
create or replace function public.guard_finance_request()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_me text := nullif(lower(coalesce(auth.jwt() ->> 'email', '')), '');
begin
  if tg_op = 'INSERT' then
    if v_me is not null then new.requested_by := v_me; end if;
    new.status := '대기';
    new.decided_by := null;
    new.decided_at := null;
    return new;
  end if;

  -- 결정된 요청은 다시 바꾸지 않습니다. 적용 결과(applied_*)만 채울 수 있습니다.
  if old.status <> '대기' then
    -- 승인 직후 장부 반영이 실패하면 대기로 되돌립니다. 반영되지 않은 「승인」이 남으면
    -- 화면에는 처리된 것으로 보이는데 장부에는 아무 일도 없습니다.
    if old.status = '승인' and new.status = '대기' and old.applied_at is null and new.applied_at is null then
      new.decided_by := null;
      new.decided_at := null;
      return new;
    end if;
    if new.status is distinct from old.status or new.amount is distinct from old.amount
       or new.decided_by is distinct from old.decided_by then
      raise exception '이미 % 처리된 요청입니다.', old.status using errcode = 'check_violation';
    end if;
    return new;
  end if;

  if new.amount is distinct from old.amount or new.invoice_id is distinct from old.invoice_id
     or new.kind is distinct from old.kind or new.requested_by is distinct from old.requested_by then
    raise exception '요청 내용은 바꿀 수 없습니다. 취소하고 다시 올려주세요.' using errcode = 'check_violation';
  end if;

  if new.status in ('승인', '반려') then
    if v_me is not null then new.decided_by := v_me; end if;
    if new.decided_by is null then
      raise exception '결재자를 알 수 없습니다.' using errcode = 'check_violation';
    end if;
    if lower(new.decided_by) = lower(old.requested_by) then
      raise exception '요청한 사람은 결재할 수 없습니다.' using errcode = 'check_violation';
    end if;
    new.decided_at := coalesce(new.decided_at, now());
  elsif new.status = '취소' then
    if v_me is not null and v_me <> lower(old.requested_by) then
      raise exception '요청은 올린 사람만 거둘 수 있습니다.' using errcode = 'check_violation';
    end if;
    new.decided_by := coalesce(v_me, new.decided_by);
    new.decided_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_finance_request on public.finance_requests;
create trigger trg_guard_finance_request
  before insert or update on public.finance_requests
  for each row execute function public.guard_finance_request();

-- ── 5. 월별 합계에 결손 더하기 ───────────────────────────────────────

create or replace view public.finance_monthly as
select
  i.billing_month                                                as month,
  i.stream                                                       as stream,
  count(*) filter (where i.status = '발행')                       as issued_count,
  coalesce(sum(i.total_amount) filter (where i.status = '발행'), 0) as issued_amount,
  count(*) filter (where i.status = '취소')                       as cancelled_count,
  coalesce((
    select sum(p.amount)
      from public.payments p
      join public.invoices v on v.id = p.invoice_id
     where v.billing_month = i.billing_month
       and v.stream is not distinct from i.stream
       and v.status = '발행'
  ), 0)                                                          as paid_amount,
  coalesce(sum(i.written_off_amount) filter (where i.status = '발행'), 0) as written_off_amount
from public.invoices i
where i.billing_month is not null
group by i.billing_month, i.stream;

alter view public.finance_monthly set (security_invoker = on);
revoke all on public.finance_monthly from anon;

-- ── 6. 실시간 ───────────────────────────────────────────────────────
-- 결재 대기는 다른 사람이 처리합니다. 열어둔 결재 화면에 새 요청이 안 오면 승인할 사람이
-- 모르고, 승인된 것이 요청한 사람 화면에 안 오면 또 올립니다.
do $$
declare t text;
begin
  foreach t in array array['finance_requests', 'revenue_accounts', 'invoice_line_reclass_log'] loop
    if not exists (
      select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
exception when others then
  raise notice '재무 통제 표 실시간 등록을 건너뜁니다: %', sqlerrm;
end $$;

notify pgrst, 'reload schema';
