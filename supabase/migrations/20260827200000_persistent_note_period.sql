-- 지속 특이사항에 **기간**을 붙입니다.
--
-- 담당자: "픽업 인박스에서 예정된 픽업을 설정할 때, 우선 원칙은 그날만 일시적인 픽업인 거야.
--          근데 '~까지 픽업', 또는 '언제까지 결석'이라는 문구가 나오면 그건 특이사항에 올려서
--          그 기간 동안 반영되게 만들어야 해."
--
-- 맞는 구분입니다. 지금까지는 둘을 똑같이 다뤘습니다.
--
--   "오늘 3시에 픽업이요"          → 그날 하루짜리. 예약 한 줄이면 충분합니다.
--   "이번 주 금요일까지 픽업이요"   → 한 상태가 며칠 이어지는 것. 날짜마다 예약을 흩뿌리면
--                                   중간에 하나가 빠져도 아무도 모릅니다.
--
-- 두 번째는 "이 아이는 언제까지 이런 상태"라는 **하나의 사실**이라, 특이사항 한 줄로 두고
-- 매일 아침 그날 해당하는지 보는 편이 맞습니다. 그래야 하원체크표 옆 특이사항 위젯에서
-- "아, 이 아이는 금요일까지구나"가 한눈에 보입니다.
--
-- 그래서 두 가지를 더합니다.
--   ① effect_from / effect_to  - 언제부터 언제까지
--   ② effect_kind에 'pickup'·'absent' 추가 - 그 기간 동안 무엇으로 볼지

alter table public.shuttle_persistent_notes
  add column if not exists effect_from date,
  add column if not exists effect_to   date;

comment on column public.shuttle_persistent_notes.effect_from is
  '이 특이사항이 적용되기 시작하는 날. 비어 있으면 학기 내내(기존 동작).';
comment on column public.shuttle_persistent_notes.effect_to is
  '마지막 날(이 날 포함). 비어 있으면 끝나지 않습니다.';

-- effect_kind에 두 값을 더합니다. 기존 제약을 지우고 다시 겁니다.
alter table public.shuttle_persistent_notes
  drop constraint if exists shuttle_persistent_notes_effect_kind_check;

alter table public.shuttle_persistent_notes
  add constraint shuttle_persistent_notes_effect_kind_check
  check (effect_kind in ('none', 'skip_days', 'no_shuttle', 'pickup', 'absent'));

comment on column public.shuttle_persistent_notes.effect_kind is
  'none=표시만 / skip_days=그 요일엔 안 탐 / no_shuttle=셔틀 안 탐 / '
  'pickup=그 기간 매일 픽업 / absent=그 기간 매일 결석';

-- 어느 연락에서 나왔는지. 잘못 잡혔을 때 원문을 짚을 수 있어야 합니다.
alter table public.shuttle_persistent_notes
  add column if not exists request_id uuid references public.pickup_requests(id) on delete set null;

-- 매일 아침 크론이 "오늘 해당하는 것"만 꺼내갑니다. 그 조회를 위한 인덱스입니다.
create index if not exists shuttle_persistent_notes_period_idx
  on public.shuttle_persistent_notes (active, effect_kind, effect_from, effect_to);

-- 확인용
select effect_kind as "종류", count(*) as "건수"
  from public.shuttle_persistent_notes
 group by 1 order by 2 desc;
