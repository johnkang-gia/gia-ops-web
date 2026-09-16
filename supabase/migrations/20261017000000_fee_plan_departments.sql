-- 학비 항목: **어느 부서의 학비인가**
--
-- ── 무엇이 문제였나 ──────────────────────────────────────────────────
--
-- 학비는 초등부와 중고등부가 다릅니다. 그런데 납부 항목에는 대상이 「전체 / 학년 / 반」뿐
-- 이어서, 부서로 가르려면 **학년을 하나씩 골라 넣어야** 했습니다.
--
--   초등부 정규과정 → 2·3·4·5학년
--   중고등부 정규과정 → 6·7·8·9…학년
--
-- 이 목록은 적던 날의 사진입니다. 학년이 하나 늘면 그 학년만 조용히 빠지고, 화면에는
-- 「대상 있음」으로 보입니다. 더 나쁜 것은 **6학년이 중고등부**라는 규칙이 코드 한 곳
-- (`departmentOf`)에 있는데, 여기 적은 학년 목록은 그 규칙을 모른다는 점입니다 - 기준이
-- 바뀌면 두 곳이 어긋나고, 어긋난 쪽은 학부모가 받은 청구서에서야 드러납니다.
--
-- ── 그래서 ───────────────────────────────────────────────────────────
--
-- 대상에 **부서**를 더합니다. 부서로 적어두면 학년이 늘어도 판정이 따라옵니다 - 그 판정은
-- 이미 한 곳에만 있습니다(CLAUDE.md §2-2).
--
-- 지금까지 만든 항목은 `target_scope` 가 「전체」이거나 학년·반이라 그대로 돕니다. 새 칸이
-- 비어 있으면 예전과 똑같이 동작합니다 - 고친 적 없는 항목의 대상이 혼자 바뀌면 안 됩니다.

alter table public.fee_plans
  add column if not exists target_departments text[];

comment on column public.fee_plans.target_departments is
  '이 항목이 열리는 부서(초등부·중고등부). target_scope = ''부서'' 일 때만 봅니다. 학년 목록으로 부서를 흉내 내면 학년이 늘 때 조용히 빠집니다.';

-- 대상 갈래에 '부서'를 더합니다. 기존 값(전체·학년·반)은 그대로 둡니다.
alter table public.fee_plans
  drop constraint if exists fee_plans_target_scope_ck;
alter table public.fee_plans
  add constraint fee_plans_target_scope_ck
  check (target_scope is null or target_scope in ('전체', '부서', '학년', '반'));

-- 「부서」인데 부서가 비어 있으면 **아무에게도 안 열립니다.** 화면에는 「대상 있음」으로
-- 보이므로, 그 상태로는 저장되지 않게 막습니다(조용한 실패 금지).
alter table public.fee_plans
  drop constraint if exists fee_plans_target_departments_ck;
alter table public.fee_plans
  add constraint fee_plans_target_departments_ck
  check (
    target_scope is distinct from '부서'
    or (target_departments is not null and array_length(target_departments, 1) >= 1)
  );
