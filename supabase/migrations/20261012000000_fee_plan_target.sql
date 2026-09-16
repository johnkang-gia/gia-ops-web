-- ═══════════════════════════════════════════════════════════════════════
-- 학비 항목도 **누구를 위한 것인가**를 적습니다
-- ═══════════════════════════════════════════════════════════════════════
--
-- 학비외 항목(교재·교복)은 「3학년」·「G4R 반」처럼 대상을 적어둘 수 있는데, 학비 항목은
-- 언제나 전교생 것이었습니다. 그런데 실제로는 다릅니다 - 방과후 2일반은 특정 학년만
-- 열리고, 어떤 과정은 한 반에만 있습니다.
--
-- 대상이 없으면 청구 표에서 **139명 전원의 칸이 열려** 있습니다. 그 아이에게 열리지 않는
-- 과정을 실수로 고르면 오류가 아니라 그냥 «청구된 금액»으로 보이고, 학부모가 묻고 나서야
-- 압니다.
alter table public.fee_plans
  add column if not exists target_scope text not null default '전체',
  add column if not exists target_grades text[] not null default '{}',
  add column if not exists target_classes text[] not null default '{}';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'fee_plans_target_scope_chk') then
    alter table public.fee_plans
      add constraint fee_plans_target_scope_chk check (target_scope in ('전체', '학년', '반'));
  end if;
end $$;

comment on column public.fee_plans.target_scope is
  '누구를 위한 항목인가. 전체=모든 학생, 학년=target_grades, 반=그 학년의 그 반.';
comment on column public.fee_plans.target_grades is
  '대상 학년. 「전체」일 때는 비워둡니다 - 학년을 하나씩 적어두면 그 목록은 적던 날의 사진이라, 학년이 늘면 새 학년만 조용히 빠집니다.';
comment on column public.fee_plans.target_classes is
  '대상 반. 학년과 **둘 다** 맞아야 대상입니다 - 같은 반 이름을 다른 학년이 쓰는 경우가 있습니다.';

-- rls-ok: 이 표는 이미 RLS 가 켜져 있고 has_finance_access() 정책 하나로 잠겨 있습니다
--         (20260831200000). 칸을 더한다고 정책이 달라지지 않습니다.
