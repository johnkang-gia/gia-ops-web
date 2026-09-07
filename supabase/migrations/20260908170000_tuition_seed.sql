-- ===== 학비 기본 요금표 심기 (25-26 납부 옵션 안내문) =====
--
-- 학부모에게 나가는 「정규과정/방과후 수업 등록금 납부 옵션 안내」의 숫자를 그대로 넣습니다.
--
-- **금액을 아홉 개 적어두지 않습니다.** 안내문의 숫자를 전부 검산하면 하나도 빠짐없이
-- 「기준 금액 1회분 × 회차수 × (1 − 할인율)」로 떨어집니다.
--
--   정규과정   11,000,000 × 3학기 = 33,000,000, 연납 ×0.9 = 29,700,000
--   방과후 5일반  450,000 × 5 × 0.95 = 2,137,500,  × 10 × 0.9 = 4,050,000
--   방과후 3일반  325,000 × 5 × 0.95 = 1,543,750,  × 10 × 0.9 = 2,925,000
--   방과후 2일반  250,000 × 5 × 0.95 = 1,187,500,  × 10 × 0.9 = 2,250,000
--
-- 그래서 기준 금액 하나와 옵션만 넣습니다. 금액을 아홉 개 적어두면 요금이 오를 때 아홉
-- 군데를 고쳐야 하고, 반드시 한 군데를 빠뜨립니다.
--
-- ── 이미 있으면 건드리지 않습니다 ──────────────────────────────────────
--
-- 재무 담당자가 [납부 항목 · 할인] 화면에서 이미 만들어 두었을 수 있습니다. 이름이 같은
-- 항목이 있으면 **그대로 둡니다** - 여기서 덮어쓰면 사람이 고쳐놓은 금액이 배포 때마다
-- 원래대로 돌아갑니다.
--
-- ── 할인은 심지 않습니다 ────────────────────────────────────────────────
--
-- 어떤 할인이 몇 %인지 아직 전달받지 못했습니다. 짐작해서 넣으면 그 값이 실제 청구에
-- 쓰이고, 틀린 채로 나간 청구서는 되돌리기 어렵습니다. [납부 항목 · 할인] 화면에서
-- 사람이 만들어 붙입니다.

do $$
declare
  v_plan uuid;
begin
  -- ── 정규과정 (08:30–14:40) ────────────────────────────────────────────
  select id into v_plan from public.fee_plans where category = '학비' and name = '정규과정' limit 1;
  if v_plan is null then
    insert into public.fee_plans (category, name, description, base_amount, unit, sort_order, created_by)
    values ('학비', '정규과정', '08:30–14:40 · 학기당 기준금액', 11000000, '학기', 10, '기본 요금표')
    returning id into v_plan;

    insert into public.fee_payment_options (plan_id, name, periods, discount_rate, due_note, sort_order) values
      (v_plan, '분기 납부', 1, 0,    '분기별 납기', 10),
      (v_plan, '1년 납부',  3, 0.10, '연납 10% 할인', 20);
  end if;

  -- ── 방과후 (14:50–16:10) ──────────────────────────────────────────────
  -- 요일 수만 다르고 옵션 구조는 셋 다 같습니다.
  select id into v_plan from public.fee_plans where category = '학비' and name = '방과후 5일반' limit 1;
  if v_plan is null then
    insert into public.fee_plans (category, name, description, base_amount, unit, sort_order, created_by)
    values ('학비', '방과후 5일반', 'Novel Study (월수금) + Debate/Writing (화목) · 월 기준금액', 450000, '월', 20, '기본 요금표')
    returning id into v_plan;
    insert into public.fee_payment_options (plan_id, name, periods, discount_rate, due_note, sort_order) values
      (v_plan, '월 납부',     1,  0,    '매월 25일 납부 / 방학기간 제외', 10),
      (v_plan, '5개월 납부',  5,  0.05, '5% 할인', 20),
      (v_plan, '10개월 납부', 10, 0.10, '10% 할인', 30);
  end if;

  select id into v_plan from public.fee_plans where category = '학비' and name = '방과후 3일반' limit 1;
  if v_plan is null then
    insert into public.fee_plans (category, name, description, base_amount, unit, sort_order, created_by)
    values ('학비', '방과후 3일반', 'Novel Study (월수금) · 월 기준금액', 325000, '월', 30, '기본 요금표')
    returning id into v_plan;
    insert into public.fee_payment_options (plan_id, name, periods, discount_rate, due_note, sort_order) values
      (v_plan, '월 납부',     1,  0,    '매월 25일 납부 / 방학기간 제외', 10),
      (v_plan, '5개월 납부',  5,  0.05, '5% 할인', 20),
      (v_plan, '10개월 납부', 10, 0.10, '10% 할인', 30);
  end if;

  select id into v_plan from public.fee_plans where category = '학비' and name = '방과후 2일반' limit 1;
  if v_plan is null then
    insert into public.fee_plans (category, name, description, base_amount, unit, sort_order, created_by)
    values ('학비', '방과후 2일반', 'Debate/Writing (화목) · 월 기준금액', 250000, '월', 40, '기본 요금표')
    returning id into v_plan;
    insert into public.fee_payment_options (plan_id, name, periods, discount_rate, due_note, sort_order) values
      (v_plan, '월 납부',     1,  0,    '매월 25일 납부 / 방학기간 제외', 10),
      (v_plan, '5개월 납부',  5,  0.05, '5% 할인', 20),
      (v_plan, '10개월 납부', 10, 0.10, '10% 할인', 30);
  end if;
end $$;


-- ── 한 학생이 한 학기에 같은 항목을 두 번 신청하지 않게 ──────────────────
--
-- 화면에서 옵션을 바꿀 때 새 줄을 넣지 않고 이 조건으로 덮어씁니다. 조건이 없으면 옵션을
-- 세 번 바꾼 학생에게 줄이 셋 남고, 청구서에 같은 항목이 세 번 찍힙니다.
--
-- term_id 가 비어 있는 옛 줄이 있을 수 있어 부분 인덱스를 둘로 나눕니다. null 은 유니크
-- 인덱스에서 서로 다른 값으로 취급되어, 그냥 걸면 term_id 없는 줄이 무제한으로 쌓입니다.
create unique index if not exists student_fee_enrollments_uniq
  on public.student_fee_enrollments (student_id, plan_id, term_id)
  where term_id is not null;

create unique index if not exists student_fee_enrollments_uniq_noterm
  on public.student_fee_enrollments (student_id, plan_id)
  where term_id is null;

-- 같은 할인을 같은 학기에 두 번 붙이지 않게. 두 번 붙으면 두 번 깎입니다.
create unique index if not exists student_fee_discounts_uniq
  on public.student_fee_discounts (student_id, discount_id, term_id)
  where term_id is not null;

create unique index if not exists student_fee_discounts_uniq_noterm
  on public.student_fee_discounts (student_id, discount_id)
  where term_id is null;
