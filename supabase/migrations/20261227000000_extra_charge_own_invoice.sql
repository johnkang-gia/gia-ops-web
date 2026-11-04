-- 「+ 추가 항목」 중 **따로 청구서로 나가야 하는 것**(발전기금).
--
-- 발전기금은 기부금 성격이라 학부모가 학비와 다른 장으로 받기를 원하는 경우가 많습니다(영수증·처리 부서가 다름).
-- 학비 장에 한 줄로 붙이면 나눌 길이 없어서, 이 표시가 켜진 줄은 학비·학비외 장에 붙지 않고 그 줄만 담은 장으로 나갑니다.
-- 그렇게 나간 장은 invoices.category = '발전기금'(또는 '따로 청구')이고, 지난 미납 합치기·미납분 청구서에도 섞이지 않습니다.

alter table public.tuition_extra_charges
  add column if not exists own_invoice boolean not null default false;

comment on column public.tuition_extra_charges.own_invoice is
  '켜져 있으면 학비 장에 붙지 않고 이 줄만 담은 청구서로 따로 나갑니다(발전기금 등).';

-- 아직 청구서에 안 붙은 발전기금 줄은 따로 나가게 둡니다(이미 나간 줄은 그대로).
update public.tuition_extra_charges
   set own_invoice = true
 where invoice_id is null
   and cancelled_at is null
   and own_invoice = false
   and name like '발전기금%';
