-- ===== 항목별로 「무엇을 냈고 무엇이 남았나」 =====
--
-- 부분 납부는 실제로 일어납니다. 교재비는 냈는데 교복값은 아직인 집이 있고, 그때 담당자가
-- 알아야 하는 것은 **남은 금액이 아니라 남은 항목**입니다. 학부모에게 「7만원 남았습니다」
-- 라고 하면 무슨 돈인지 되묻고, 그 통화가 그대로 행정실 일이 됩니다.
--
-- 그래서 입금 한 줄이 **어느 항목들을 덮었는지**를 남깁니다. 새 표를 만들지 않고 항목 줄에
-- 「이 줄은 이 입금으로 정산됨」을 답니다 - 한 항목이 두 번 정산될 일은 없기 때문입니다.

alter table public.invoice_lines
  add column if not exists paid_payment_id uuid references public.payments(id) on delete set null;

comment on column public.invoice_lines.paid_payment_id is
  '이 항목을 정산한 입금. 비어 있으면 아직 안 받은 항목입니다 - 남은 금액이 아니라 남은 항목을 말할 수 있게 하는 칸입니다.';

create index if not exists invoice_lines_paid_idx
  on public.invoice_lines (paid_payment_id) where paid_payment_id is not null;
