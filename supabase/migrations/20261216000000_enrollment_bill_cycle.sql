-- 등록별 청구 주기 — «이 아이의 이 항목은 달마다 다시 청구하는가»
--
-- 정규과정은 학기 단위 항목이라 한 학기에 한 장이면 끝으로 판정했습니다. 그런데 학기 금액을 달마다
-- 나눠 내는 집이 있고, 그 금액은 옵션 없이 «직접 기입»으로 들어갑니다(최서연 2,532,500 · 강하늘 1,000,000).
-- 10월 장을 내고 나면 11월 화면에 「완납 10/2」로 떠서 11월 장을 낼 자리가 없었습니다. 항목 단위(월·학기)는
-- 요금표의 성격이고, 실제로 달마다 받는지는 **등록 한 줄의 성격**이라 그 줄에 적습니다.
--
--   auto  항목 단위·옵션 회차대로(지금까지의 규칙)
--   월    옵션·단위와 상관없이 달마다 새로 청구
--   학기  옵션·단위와 상관없이 학기에 한 장

alter table public.student_fee_enrollments
  add column if not exists bill_cycle text not null default 'auto'
  check (bill_cycle in ('auto', '월', '학기'));

comment on column public.student_fee_enrollments.bill_cycle is
  '청구 주기. auto=항목 단위·옵션 회차대로, 월=달마다 새로, 학기=학기에 한 장.';

-- 지금까지 쌓인 줄: 학기 단위 항목에 옵션 없이 금액만 적었고 그 금액이 기준금액의 절반에 못 미치면
-- 학기 금액을 달마다 나눠 내는 집입니다(990만/1,100만 같은 할인은 절반을 넘어 학기로 남습니다).
-- 화면에서 «매달 / 학기 1회»를 바꿀 수 있으니 틀린 줄은 거기서 고칩니다.
update public.student_fee_enrollments e
   set bill_cycle = '월'
  from public.fee_plans p
 where p.id = e.plan_id
   and e.bill_cycle = 'auto'
   and e.option_id is null
   and e.override_amount is not null
   and p.unit <> '월'
   and e.override_amount < p.base_amount * 0.5;

notify pgrst, 'reload schema';
