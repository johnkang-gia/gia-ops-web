-- 예치금에서 뺀 돈이 **어느 항목 몫인지** 적는 칸.
--
-- 예치금 차감은 지금까지 청구서 합계에서 금액만 깎았습니다. 그래서 청구서·영수증에
-- 「예치금 ₩250,000 차감」은 적을 수 있어도 「교복값을 예치금에서」는 적을 수 없었고,
-- 학부모가 무엇이 남았는지 되물으면 행정실이 다시 계산해야 했습니다.
--
-- 항목을 통째로 덮으면 `invoice_lines.paid_payment_id` 로도 알 수 있지만, 예치금이 모자라
-- 한 항목을 **일부만** 덮는 경우가 있고, 한 항목을 예치금 두 줄이 나눠 덮는 경우도 있습니다.
-- 그래서 돈 쪽(payments)에 항목을 적습니다. 항목이 지워지면 비워집니다(돈은 남습니다).

alter table public.payments
  add column if not exists applied_line_id uuid references public.invoice_lines(id) on delete set null;

create index if not exists payments_applied_line_idx
  on public.payments (applied_line_id) where applied_line_id is not null;

comment on column public.payments.applied_line_id is
  '예치금에서 차감한 돈이 덮은 청구 항목. 일부만 덮었으면 금액이 항목보다 작습니다.';
