-- 「+ 추가」 자유 항목 — 한 아이에게만 받는 돈은 요금표에 항목을 만들지 않습니다
--
-- 셔틀비를 한 명에게만 받거나 오케스트라 추가금을 두 달만 받는 일이 있습니다. 그때마다 납부 항목을
-- 만들면 요금표가 한 명짜리 항목으로 늘고, 다음 학기에 아무도 못 지웁니다. 그래서 «이 아이에게 이 제목으로
-- 이 금액을 이 기간에»만 적는 줄을 둡니다. 표는 차액(tuition_extra_charges)과 같습니다 - 다음 학비 장에
-- 한 줄로 붙는 일은 똑같기 때문입니다.
--
-- 매달 받는 것은 **달마다 줄 하나**로 풀어 넣습니다(같은 series_id). 그래야 얹힌 달과 안 얹힌 달이 줄마다
-- invoice_id 로 남고, 중간에 그만두면 남은 줄만 지우면 됩니다.

alter table public.tuition_extra_charges
  add column if not exists series_id uuid,
  add column if not exists repeat text not null default 'once' check (repeat in ('once', 'monthly')),
  add column if not exists series_from text,
  add column if not exists series_to text;

comment on column public.tuition_extra_charges.series_id is '매달 받는 항목을 달마다 한 줄로 풀어 넣을 때 묶는 번호. 1회면 비어 있습니다.';
comment on column public.tuition_extra_charges.repeat is 'once=한 번, monthly=매달(달마다 줄 하나).';

create index if not exists tuition_extra_charges_series_idx on public.tuition_extra_charges (series_id) where series_id is not null;

notify pgrst, 'reload schema';
