-- 다음 달 청구서에 얹을 차액 — 청구서는 이미 나갔는데 금액이 바뀐 경우
--
-- 10월 청구서를 보낸 뒤에 「이 집은 이번 달 5만원 더 받기로」 또는 「덜 받기로」가 정해지는 일이
-- 있습니다. 보낸 장을 정정하면(정정 줄) 학부모가 이미 결제한 금액과 어긋나고, 다시 보내면 번호가
-- 바뀝니다. 그래서 차액은 **다음 달 장에 한 줄로** 얹습니다 - 학부모는 다음 달 청구서에서
-- 「10월분 추가(사유)」 한 줄을 봅니다.
--
-- 이 표는 «얹을 예정»만 적습니다. 돈은 청구서 줄(`invoice_lines`)에만 있고, 얹힌 뒤에는 `invoice_id`
-- 로 어느 장에 들어갔는지 남깁니다. 같은 줄이 두 장에 얹히지 않는 이유가 그 칸입니다.

create table if not exists public.tuition_extra_charges (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.wr_students(id) on delete cascade,
  term_id uuid references public.terms(id) on delete set null,
  -- 어느 항목의 차액인가. 비워 두면 학비 전체에 붙는 금액입니다.
  plan_id uuid references public.fee_plans(id) on delete set null,
  -- 청구서에 찍히는 이름. 「오케스트라 10월분 추가」처럼 학부모가 읽는 글자입니다.
  name text not null,
  -- 더 받으면 양수, 덜 받으면 음수. 0은 적을 이유가 없습니다.
  amount numeric(12, 2) not null,
  -- 몇 달 뒤 「왜 5만원이 더 붙었죠」에 답할 수 있는 자리는 여기뿐입니다.
  reason text not null,
  -- 어느 달 장부터 얹을 수 있는가(YYYY-MM). 비면 다음 발행 때.
  target_month text,
  invoice_id uuid references public.invoices(id) on delete set null,
  billed_at timestamptz,
  cancelled_at timestamptz,
  created_by text,
  created_at timestamptz not null default now(),
  constraint tuition_extra_charges_amount_nonzero check (amount <> 0),
  constraint tuition_extra_charges_reason_ck check (btrim(reason) <> ''),
  constraint tuition_extra_charges_month_ck check (target_month is null or target_month ~ '^\d{4}-(0[1-9]|1[0-2])$')
);

comment on table public.tuition_extra_charges is
  '다음 달 학비 청구서에 얹을 차액(추가·감액). 얹히면 invoice_id 가 채워지고 다시 얹히지 않습니다.';

create index if not exists tuition_extra_charges_pending_idx
  on public.tuition_extra_charges (student_id) where invoice_id is null and cancelled_at is null;

alter table public.tuition_extra_charges enable row level security;
drop policy if exists tuition_extra_charges_finance_only on public.tuition_extra_charges;
create policy tuition_extra_charges_finance_only on public.tuition_extra_charges
  for all using (public.is_finance_user()) with check (public.is_finance_user());

notify pgrst, 'reload schema';
