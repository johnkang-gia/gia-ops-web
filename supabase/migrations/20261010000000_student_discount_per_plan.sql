-- ═══════════════════════════════════════════════════════════════════════
-- 할인은 **항목마다 다릅니다**
-- ═══════════════════════════════════════════════════════════════════════
--
-- 정규과정에 붙는 할인(목사 자제 10%·형제자매 10%·유치부 졸업 10%)과 방과후에 붙는
-- 할인(5개월납 5%·10개월납 10%)은 서로 다른 목록입니다. 규칙 쪽(fee_discounts)에는
-- 이미 plan_id 가 있어서 「이 할인은 정규과정 것」이라고 적을 수 있었는데, **학생에게
-- 붙이는 쪽**(student_fee_discounts)에는 그 칸이 없었습니다.
--
-- 그래서 한 학생에게 할인을 붙이면 **그 학생의 모든 항목**에 걸렸습니다. 형제 할인을
-- 붙이면 정규과정만이 아니라 방과후·셔틀에서도 10%가 빠졌고, 화면에는 오류가 아니라
-- 그냥 «깎인 금액»으로 보입니다. 학부모가 받은 청구서가 우리가 말한 금액과 다릅니다.
--
-- 이제 붙일 때 **어느 항목에 붙는지** 함께 적습니다. 비워두면 예전처럼 그 학생의 학비
-- 전체에 걸립니다 - 이미 붙어 있는 줄이 그 뜻이라, 그 줄들의 금액이 오늘 바뀌면 안 됩니다.
alter table public.student_fee_discounts
  add column if not exists plan_id uuid references public.fee_plans(id) on delete cascade;

comment on column public.student_fee_discounts.plan_id is
  '어느 납부 항목에 붙는 할인인가. 비어 있으면 그 학생의 학비 전체(예전 줄).';

create index if not exists student_fee_discounts_plan_idx
  on public.student_fee_discounts (plan_id);

-- 같은 할인을 같은 항목에 두 번 붙이지 않게. 두 번 붙으면 두 번 깎입니다.
--
-- 예전 색인은 (학생·할인·학기)까지만 봐서, 정규과정과 방과후에 같은 이름의 할인을
-- 각각 붙이는 것이 막혔습니다. 이제 항목까지 열쇠에 넣습니다. 빈 칸은 uuid 0 으로 바꿔
-- 세는데, 널은 서로 같지 않아서 그대로 두면 같은 줄을 여러 번 넣을 수 있습니다.
drop index if exists public.student_fee_discounts_uniq;
drop index if exists public.student_fee_discounts_uniq_noterm;

create unique index if not exists student_fee_discounts_uniq_v2
  on public.student_fee_discounts (
    student_id,
    discount_id,
    coalesce(term_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(plan_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );

-- rls-ok: 이 표는 이미 RLS 가 켜져 있고 has_finance_access() 정책 하나로 잠겨 있습니다
--         (20260831200000). 칸을 더한다고 정책이 달라지지 않습니다.
