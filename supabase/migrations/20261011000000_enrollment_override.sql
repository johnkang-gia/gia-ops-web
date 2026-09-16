-- ═══════════════════════════════════════════════════════════════════════
-- 교장님과 상담해서 정한 금액 — **목록에 없는 할인**
-- ═══════════════════════════════════════════════════════════════════════
--
-- 지금까지 금액은 언제나 「기준금액 × 회차 × (1 − 할인율)」로 떨어졌습니다. 그래서 목록에
-- 있는 할인으로 설명되지 않는 금액은 **적을 자리가 없었습니다.**
--
-- 그런데 실제로는 있습니다. 교장님과 상담해서 「이 집은 올해 이 금액으로 하자」고 정하는
-- 경우입니다. 이걸 담으려고 그때그때 할인 규칙을 새로 만들면(「○○네 감면 17.4%」) 할인
-- 목록이 학생 수만큼 늘어나고, 그 목록은 다음 학기에 아무도 못 지웁니다.
--
-- 그래서 **정한 금액을 그대로 적습니다.** 붙는 자리는 그 학생의 그 항목 한 줄입니다.
alter table public.student_fee_enrollments
  add column if not exists override_amount numeric,
  add column if not exists override_note text;

comment on column public.student_fee_enrollments.override_amount is
  '사람이 직접 정한 청구액. 비어 있으면 기준금액·옵션·할인으로 계산합니다. 0원(전액 면제)도 값입니다.';
comment on column public.student_fee_enrollments.override_note is
  '왜 그 금액인가. 안 적어도 되지만, 몇 달 뒤 「이 아이는 왜 이 금액이죠」에 답하려면 여기뿐입니다.';

-- **음수는 막습니다.** 마이너스 청구서는 환불이지 청구가 아니고, 그건 이 표가 다룰 일이
-- 아닙니다. 화면에서도 막지만, 화면을 거치지 않고 들어오는 길(SQL·나중에 만들 화면)이
-- 언젠가 생깁니다.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'student_fee_enrollments_override_nonneg'
  ) then
    alter table public.student_fee_enrollments
      add constraint student_fee_enrollments_override_nonneg
      check (override_amount is null or override_amount >= 0);
  end if;
end $$;

-- rls-ok: 이 표는 이미 RLS 가 켜져 있고 has_finance_access() 정책 하나로 잠겨 있습니다
--         (20260831200000). 칸을 더한다고 정책이 달라지지 않습니다.
