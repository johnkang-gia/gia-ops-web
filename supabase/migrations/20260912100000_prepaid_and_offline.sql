-- 청구서보다 먼저 들어온 돈
--
-- ── 무엇이 문제였나 ──────────────────────────────────────────────────
--
-- 결제 체크를 **청구서가 있어야만** 할 수 있었습니다. 그런데 이미 낸 학부모가 있습니다 -
-- 청구서를 만들기 전에 계좌로 보내신 분, 학기 초에 한꺼번에 내신 분. 그 돈을 넣을 자리가
-- 없어서 담당자는 종이나 머릿속에 따로 적어두게 되고, 그렇게 적어둔 것은 반드시 어긋납니다.
--
-- ── 다른 곳은 어떻게 하나 ────────────────────────────────────────────
--
-- 회계 프로그램(QuickBooks·Xero)과 결제사(Stripe)가 공통으로 쓰는 방식은 하나입니다.
-- **청구서와 입금은 별개의 기록이고, 둘을 잇는 것이 「충당」입니다.** 우리 payments 표는
-- 이미 그렇게 생겼습니다(invoice_id 가 비어도 됩니다). 없던 것은 붙이는 규칙과 화면입니다.
--
-- 두 가지 길을 함께 둡니다.
--
--   A. 이미 받은 건 등록 — 청구서를 **받은 날짜로** 만들고 「안 보냄」 표시를 단 뒤 입금까지
--      한 번에 기록합니다. 지금 밀려 있는 것을 넣는 데 씁니다.
--   B. 선입금        — 청구서 없이 입금만 먼저 기록합니다. 나중에 청구서가 생기면 저절로
--      충당됩니다. 통장에 먼저 찍히는 돈(선납·형제 합산)이 이쪽입니다.

-- ── A: 안 보낸 청구서 표시 ──────────────────────────────────────────
--
-- 소급해 만든 청구서를 학부모에게 다시 보내면 «이미 낸 돈을 또 내라»가 됩니다. 보낼 것과
-- 안 보낼 것을 화면이 갈라 보여줘야 합니다.
alter table public.invoices add column if not exists issued_offline boolean not null default false;

comment on column public.invoices.issued_offline is
  '이미 받은 돈을 기록하려고 소급해 만든 청구서. 학부모에게 보내지 않습니다 - 보내면 또 내라는 말이 됩니다.';

create index if not exists invoices_offline_idx on public.invoices(issued_offline) where issued_offline;

-- ── B: 선입금 ───────────────────────────────────────────────────────
--
-- 어느 청구서에도 안 붙은 입금이 곧 선입금입니다. 새 칸을 만들지 않고 `invoice_id is null`
-- 로 셉니다 - 같은 사실을 두 곳에 적으면 반드시 어긋납니다.
--
-- 다만 **누구 돈인지**는 붙어 있어야 나중에 충당할 수 있습니다. 엑셀에서 들어온 줄은
-- student_id 도 비어 있어서, 사람이 학생을 골라 채웁니다.
create index if not exists payments_prepaid_idx
  on public.payments(student_id, paid_at) where invoice_id is null;

-- 쪼갠 입금. 50만원을 먼저 내신 분에게 30만원짜리 청구서가 나가면 30만원만 붙이고 20만원은
-- 남은 선입금으로 둡니다. 통장 한 줄이 우리 표에서 두 줄이 된 이유를 남겨둡니다.
alter table public.payments add column if not exists split_from_id uuid references public.payments(id) on delete set null;

comment on column public.payments.split_from_id is
  '선입금을 청구서에 일부만 충당하고 남은 돈. 통장 한 줄이 두 줄이 된 근거입니다.';

-- 선입금이 남아 있는 학생. 화면에서도 쓰지만, 무엇보다 사람이 언제든 눈으로 확인할 수 있어야 합니다.
create or replace view public.prepaid_balances as
select
  p.student_id,
  s.name as student_name,
  s.grade,
  s.class_name,
  count(*) as rows,
  sum(p.amount) as balance,
  min(p.paid_at) as oldest_paid_at
from public.payments p
join public.wr_students s on s.id = p.student_id
where p.invoice_id is null and p.student_id is not null
group by p.student_id, s.name, s.grade, s.class_name;
