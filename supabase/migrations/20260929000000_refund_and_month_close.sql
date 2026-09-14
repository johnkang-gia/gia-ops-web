-- **환불·감액**과 **월 마감**.
--
-- ── ① 환불이 갈 곳이 없었습니다 ───────────────────────────────────────────
--
-- `payments.amount` 에 `> 0` 검사가 걸려 있고, 마이너스 청구서도 막혀 있고, 조정 표도
-- 없습니다. 그런데 중도 퇴학 일할 환불·과납·이중결제는 실제로 생깁니다.
--
-- 갈 곳이 없으면 사람은 둘 중 하나를 합니다 - **안 적거나, 원래 입금 줄을 지웁니다.**
-- 입금을 지우면 그날 수납 집계가 바뀌고, 이미 보고한 숫자와 달라집니다. 그리고 왜 달라졌는지
-- 되짚을 곳이 없습니다.
--
-- **원래 기록은 안 지우고 반대 방향 한 줄을 더합니다.** 회계 프로그램에서 가져올 가치가
-- 있는 개념은 이것 하나입니다.
--
-- 환불을 `payments` 안에 두는 이유: 잔액은 `청구액 − sum(입금)` 으로 계산됩니다
-- (`settlement.ts`). 같은 표에 음수로 넣으면 **잔액·월별 집계·거래명세서가 손댈 것 없이
-- 그대로 맞습니다.** 표를 따로 만들면 그 셋을 각각 고쳐야 하고, 하나를 빠뜨리면 그 화면만
-- 환불을 모릅니다.

alter table public.payments add column if not exists kind text not null default '입금';

alter table public.payments drop constraint if exists payments_kind_ok;
alter table public.payments add constraint payments_kind_ok
  check (kind in ('입금', '환불'));

-- 금액의 부호를 **종류가 정합니다.** 예전 검사(`amount > 0`)를 이것으로 바꿉니다 -
-- 종류와 부호가 따로 놀면 「환불인데 양수」 같은 줄이 생기고, 그 줄은 집계에서 입금으로
-- 세어집니다.
alter table public.payments drop constraint if exists payments_amount_check;
alter table public.payments drop constraint if exists payments_amount_sign_ok;
alter table public.payments add constraint payments_amount_sign_ok
  check ((kind = '입금' and amount > 0) or (kind = '환불' and amount < 0));

-- 왜 돌려줬는가. 환불은 되돌릴 수 없는 일이라 이유 없이 남으면 나중에 설명할 수 없습니다.
alter table public.payments add column if not exists refund_reason text;

alter table public.payments drop constraint if exists payments_refund_reason_ok;
alter table public.payments add constraint payments_refund_reason_ok
  check (kind <> '환불' or coalesce(btrim(refund_reason), '') <> '');

comment on column public.payments.kind is
  '입금 / 환불. 환불은 금액이 음수입니다 - 같은 표에 음수로 두면 잔액·월별 집계·거래명세서가 손댈 것 없이 맞습니다.';
comment on column public.payments.refund_reason is
  '환불 사유. 환불 줄에는 반드시 있어야 합니다(검사).';

-- 감액은 표를 새로 만들지 않습니다. `invoice_lines` 에 **마이너스 줄**을 하나 넣으면
-- 트리거가 합계를 다시 세고(20260928000000), 청구서에도 「감액 −50,000」이 그대로 보입니다.
-- 학부모가 무엇이 깎였는지 알아볼 수 있는 것이 요점입니다.

-- ── ② 월 마감 ─────────────────────────────────────────────────────────────
--
-- 지난 달 청구서를 오늘 고치면 **지난달 보고서와 달라집니다.** 그런데 아무도 모릅니다 -
-- 보고서는 이미 나갔고, 화면은 새 숫자를 아무 표시 없이 보여줍니다.
--
-- 닫은 달은 **손댈 수 없게** 합니다. 정말 고쳐야 하면 다시 열고, 연 기록이 남습니다 -
-- 열쇠를 없애는 것이 아니라, 여는 것이 눈에 띄게 만드는 것이 목적입니다.

create table if not exists public.finance_month_closes (
  month text primary key check (month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  closed_at timestamptz not null default now(),
  closed_by text not null,
  note text,
  -- 다시 연 기록. 열려 있으면 `reopened_at` 이 차 있습니다 - 줄을 지우지 않는 이유는
  -- 「한 번도 안 닫은 달」과 「닫았다가 연 달」이 달라서입니다.
  reopened_at timestamptz,
  reopened_by text,
  reopen_reason text
);

comment on table public.finance_month_closes is
  '닫은 청구월. 닫힌 달의 청구서·입금은 고칠 수 없습니다 - 고치면 이미 나간 보고서와 달라집니다.';

alter table public.finance_month_closes enable row level security;
drop policy if exists finance_month_closes_read on public.finance_month_closes;
create policy finance_month_closes_read on public.finance_month_closes
  for select using (public.is_finance_user());
drop policy if exists finance_month_closes_write on public.finance_month_closes;
create policy finance_month_closes_write on public.finance_month_closes
  for all using (public.is_finance_user()) with check (public.is_finance_user());

/** 그 달이 지금 닫혀 있는가. 다시 연 달은 열린 것으로 봅니다. */
create or replace function public.is_month_closed(p_month text)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.finance_month_closes
     where month = p_month and reopened_at is null
  );
$$;

-- ── ③ 닫힌 달은 손댈 수 없습니다 ──────────────────────────────────────────
--
-- 코드로만 막으면 화면 하나를 빠뜨렸을 때 드러나지 않습니다. 데이터베이스가 막습니다.
create or replace function public.block_closed_month_invoice()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_month text;
begin
  -- 새로 들어오는 줄은 **새 달**에 넣는 것이 정상입니다. 닫힌 달에 넣으려 하면 막습니다.
  v_month := coalesce(
    case when tg_op = 'DELETE' then old.billing_month else new.billing_month end,
    to_char(case when tg_op = 'DELETE' then old.issue_date else new.issue_date end, 'YYYY-MM')
  );
  if v_month is not null and public.is_month_closed(v_month) then
    raise exception '% 은(는) 마감된 달입니다. 고치려면 재무 → 월별에서 그 달을 다시 열어주세요.', v_month
      using errcode = 'check_violation';
  end if;

  -- 옮기는 경우에는 **떠나는 달**도 봅니다. 닫힌 달에서 빼내면 그 달 합계가 줄어듭니다.
  if tg_op = 'UPDATE' and old.billing_month is distinct from new.billing_month
     and old.billing_month is not null and public.is_month_closed(old.billing_month) then
    raise exception '% 은(는) 마감된 달입니다. 그 달의 청구서를 다른 달로 옮길 수 없습니다.', old.billing_month
      using errcode = 'check_violation';
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

drop trigger if exists trg_block_closed_month_invoice on public.invoices;
create trigger trg_block_closed_month_invoice
  before insert or update or delete on public.invoices
  for each row execute function public.block_closed_month_invoice();

create or replace function public.block_closed_month_payment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_month text;
begin
  -- 입금은 **들어온 날**이 속한 달입니다. 청구월이 아니라 그날 통장에 찍힌 달이라,
  -- 9월분을 10월에 낸 돈은 10월에 속합니다.
  v_month := to_char(case when tg_op = 'DELETE' then old.paid_at else new.paid_at end, 'YYYY-MM');
  if v_month is not null and public.is_month_closed(v_month) then
    raise exception '% 은(는) 마감된 달입니다. 그 달의 입금은 고칠 수 없습니다 — 재무 → 월별에서 다시 열어주세요.', v_month
      using errcode = 'check_violation';
  end if;

  if tg_op = 'UPDATE' and old.paid_at is distinct from new.paid_at
     and public.is_month_closed(to_char(old.paid_at, 'YYYY-MM')) then
    raise exception '% 은(는) 마감된 달입니다. 그 달의 입금 날짜를 옮길 수 없습니다.', to_char(old.paid_at, 'YYYY-MM')
      using errcode = 'check_violation';
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

drop trigger if exists trg_block_closed_month_payment on public.payments;
create trigger trg_block_closed_month_payment
  before insert or update or delete on public.payments
  for each row execute function public.block_closed_month_payment();

-- ── ④ 항목별로 얼마를 청구하고 얼마를 받았나 ───────────────────────────────
--
-- 올톡페이는 청구사유가 자유 글자라 항목별로 셀 수 없었습니다(실측에서 「악기비」·
-- 「악기(바이올린)」·「악기비 (바이올린)」이 따로 세어졌습니다). 우리는 `invoice_lines` 로
-- 이미 쪼개 갖고 있으니, 세기만 하면 됩니다.
--
-- 줄 이름으로 묶습니다. 발행할 때 굳은 이름이라 그 시점의 참입니다 - 나중에 항목 이름을
-- 바꿔도 이미 나간 청구서의 이름은 그대로여야 합니다.
--
-- **받은 돈은 항목별로 나눠 셉니다.** 한 청구서에 10만원 중 6만원만 들어왔으면 각 항목이
-- 그 비율만큼 받은 것으로 봅니다 - 어느 항목을 먼저 받았는지는 대개 알 수 없고,
-- 알 수 있는 경우(`paid_payment_id`)에도 비율로 세는 편이 합계가 안 어긋납니다.
create or replace view public.finance_item_monthly as
with paid as (
  select invoice_id, sum(amount) as paid
    from public.payments
   group by invoice_id
)
select
  i.billing_month              as month,
  i.stream                     as stream,
  l.name                       as item_name,
  count(*)                     as line_count,
  sum(l.amount)                as billed,
  -- 청구액이 0 인 청구서에서 0 으로 나누지 않습니다.
  sum(
    case when i.total_amount > 0
      then l.amount * least(coalesce(p.paid, 0) / i.total_amount, 1)
      else 0
    end
  )                            as received
from public.invoice_lines l
join public.invoices i on i.id = l.invoice_id
left join paid p on p.invoice_id = i.id
where i.status = '발행'
  and i.billing_month is not null
group by i.billing_month, i.stream, l.name;

comment on view public.finance_item_monthly is
  '청구월 × 갈래 × 항목 이름별 청구·수납. 받은 돈은 그 청구서에서 항목이 차지하는 비율만큼 나눠 셉니다.';

-- rls-ok: 뷰는 바탕 표(invoices·invoice_lines·payments)의 RLS를 그대로 따릅니다.
