-- 캠프 신청에 수강료 말고 따로 받는 금액(셔틀 추가 요금 등)을 적는 칸.
--
-- 수강료는 참여 주·셔틀·할인으로 규칙대로 계산되는데, 외곽 지역 셔틀 추가 요금처럼 규칙에 없는 금액이 생겼습니다.
-- 금액 직접 정하기(amount_override)로 합계를 바꾸면 청구서에는 한 줄로 뭉쳐 나가서 학부모가 무슨 돈인지 모릅니다.
-- 그래서 항목마다 이름·금액을 적고, 청구서에는 수강료 다음 줄로 따로 찍습니다.
--
-- 모양: [{"name": "셔틀 추가(외곽)", "amount": 30000}, ...]. 비어 있으면 [] 입니다.
alter table public.camp_applications
  add column if not exists extras jsonb not null default '[]'::jsonb;

alter table public.camp_applications
  drop constraint if exists camp_applications_extras_is_array;
alter table public.camp_applications
  add constraint camp_applications_extras_is_array check (jsonb_typeof(extras) = 'array');

notify pgrst, 'reload schema';
