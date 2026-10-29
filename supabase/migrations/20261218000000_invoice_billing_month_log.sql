-- 청구월 옮김 내력.
--
-- 청구서의 «몇 월분인가»(billing_month)는 발행할 때 보고 있던 달로 정해집니다. 재무 화면의 달이 다음 달에
-- 머문 채 발행하면 10월에 낸 청구서가 11월분으로 찍히고, 11월 칸이 «청구됨»으로 잠겨 11월 청구를 못 합니다.
-- 그 장을 취소하고 다시 내면 번호가 바뀌고 학부모 문자와 어긋나므로, 청구월만 옮기는 길을 두고 언제·누가·왜
-- 옮겼는지를 남깁니다.
create table if not exists public.invoice_billing_month_log (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  from_month text,
  to_month text not null check (to_month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  reason text not null check (btrim(reason) <> ''),
  changed_by text,
  changed_at timestamptz not null default now()
);

create index if not exists invoice_billing_month_log_inv_idx on public.invoice_billing_month_log (invoice_id, changed_at desc);

comment on table public.invoice_billing_month_log is
  '청구서의 청구월(몇 월분)을 옮긴 내력. 금액·번호는 그대로이고 어느 달 청구로 셀지만 바뀝니다.';

alter table public.invoice_billing_month_log enable row level security;
drop policy if exists invoice_billing_month_log_finance_only on public.invoice_billing_month_log;
create policy invoice_billing_month_log_finance_only on public.invoice_billing_month_log
  for all using (public.is_finance_user()) with check (public.is_finance_user());
