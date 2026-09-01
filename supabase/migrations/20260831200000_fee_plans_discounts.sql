-- 납부 항목과 할인 (인보이스 시스템 2단계)
--
-- 운영 조건 세 가지.
--   · 안내문에 없는 할인이 몇 개 더 있고, 그 내용은 부이사장님만 압니다.
--   · 할인 항목과 할인율은 재무 권한이 있는 사람이 직접 만들고 고칠 수 있어야 합니다.
--   · 형제할인은 운영하지 않기로 정해졌습니다. 할인 목록은 고정될 수 없고, 만들었다가
--     없앴다가 하는 것이 정상입니다.
--
-- ── 왜 금액표가 아니라 '항목 + 옵션'인가 ────────────────────────────────
--
-- 납부 안내문의 숫자를 전부 검산해보니 **하나도 빠짐없이 규칙으로 떨어집니다.**
--   정규과정  11,000,000 × 3학기 = 33,000,000, 연납 ×0.9 = 29,700,000
--   방과후 5일반  450,000/월, 5개월 ×0.95 = 2,137,500, 10개월 ×0.9 = 4,050,000
--   방과후 3일반  325,000/월, ×0.95 = 1,543,750, ×0.9 = 2,925,000
--   방과후 2일반  250,000/월, ×0.95 = 1,187,500, ×0.9 = 2,250,000
--
-- 즉 금액을 하나하나 적어둘 이유가 없습니다. **기준 금액 하나 + 납부 옵션(몇 회분을 묶고
-- 몇 % 깎는가)** 이면 전부 만들어집니다. 금액을 적어두면 요금이 오를 때마다 사람이 아홉
-- 군데를 고쳐야 하고, 한 군데를 빠뜨립니다.
--
-- ── 학년도가 연도를 걸치는 문제 ─────────────────────────────────────────
--
-- 지금 학기는 26-27학년도 1학기입니다. 한 학년은 3학기이고, 그 3학기가 두 해에 걸칩니다.
--
-- 그래서 여기서는 **학년도·분기를 새로 정의하지 않습니다.** 이미 있는 terms 표(year,
-- term_type, start_date, end_date)를 그대로 가리킵니다. 같은 개념을 두 군데서 다르게
-- 정의하면 반드시 어긋납니다.

-- ═══════════════════════════════════════════════════════════════════════
-- 1. 납부 항목 — 무엇에 얼마를 받는가
-- ═══════════════════════════════════════════════════════════════════════
create table if not exists public.fee_plans (
  id uuid primary key default gen_random_uuid(),
  -- 학비 / 학비외 두 갈래(담당자 요청). 화면과 집계를 이 값으로 완전히 가릅니다.
  category text not null check (category in ('학비', '학비외')),
  -- 사람이 부르는 이름. '정규과정', '방과후 5일반', '셔틀', '교재비' …
  name text not null,
  description text,
  -- 기준 금액 1회분. 정규과정은 학기당, 방과후는 월당입니다.
  base_amount numeric(12, 2) not null default 0,
  -- 기준 금액이 '한 번'을 무엇으로 세는지. 납부 옵션이 이걸 몇 개 묶을지 정합니다.
  unit text not null default '월' check (unit in ('월', '학기', '연', '회')),
  active boolean not null default true,
  sort_order integer not null default 0,
  -- 금액이 오르면 이전 항목을 끄고 새로 만듭니다. 금액을 덮어쓰면 지난 청구서가
  -- 왜 그 금액이었는지 설명할 수 없게 됩니다.
  effective_from date,
  effective_to date,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.fee_plans is
  '납부 항목. 기준 금액 1회분만 담고, 묶음·할인은 fee_payment_options가 정합니다.';

-- ═══════════════════════════════════════════════════════════════════════
-- 2. 납부 옵션 — 몇 회분을 묶고 몇 % 깎는가
-- ═══════════════════════════════════════════════════════════════════════
-- 안내문의 "Option A 월 납부 / Option B 5개월 납부 / Option C 10개월 납부"가 이것입니다.
-- 학부모가 서명해서 고르는 그 항목입니다.
create table if not exists public.fee_payment_options (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.fee_plans(id) on delete cascade,
  name text not null,                       -- '월 납부' '5개월 납부' '1년 납부' '분기 납부'
  periods integer not null default 1,       -- 기준 금액의 몇 회분인가 (월납 1, 5개월 5, 연납 3학기 등)
  discount_rate numeric(5, 4) not null default 0,  -- 0.10 = 10% 할인
  -- 언제까지 내야 하는가. '매월 25일'처럼 사람이 읽는 말로 둡니다 - 규칙으로 만들면
  -- 예외(방학·공휴일)를 담을 수가 없고, 결국 메모가 따로 생깁니다.
  due_note text,
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  unique (plan_id, name)
);

comment on table public.fee_payment_options is
  '납부 옵션. 청구액 = fee_plans.base_amount × periods × (1 - discount_rate).';

-- ═══════════════════════════════════════════════════════════════════════
-- 3. 할인 — 자유롭게 만들고 없애기
-- ═══════════════════════════════════════════════════════════════════════
--
-- 형제할인처럼 있다가 없어지는 할인이 실제로 있습니다. 그래서 **지우지 않고 끕니다
-- (active=false).** 이게 핵심입니다. 지워버리면 작년 청구서가
-- 왜 그 금액이었는지 설명할 수 없게 됩니다. "지금 쓰는 할인"과 "그때 썼던 할인"은 다른
-- 물음이고, 둘 다 답할 수 있어야 합니다.
--
-- 그리고 부이사장님만 아는 할인이 있습니다. 그래서 이 표 전체가 재무 권한
-- 뒤에 있습니다 - 할인 **이름조차** 권한 없는 사람에게는 안 보입니다.
create table if not exists public.fee_discounts (
  id uuid primary key default gen_random_uuid(),
  name text not null,                        -- '형제 할인', '조기납부 할인', '특별 감면' …
  description text,
  -- 비율(percent)인가 정액(amount)인가.
  kind text not null default 'percent' check (kind in ('percent', 'amount')),
  -- percent면 0.10 = 10%, amount면 원 단위 금액.
  value numeric(12, 4) not null default 0,
  -- 어디에 걸리는가. null이면 아무 데나(사람이 골라서 붙임).
  category text check (category in ('학비', '학비외')),
  plan_id uuid references public.fee_plans(id) on delete set null,
  -- 켜고 끄기. **지우지 않습니다.**
  active boolean not null default true,
  -- 유효 기간. 비워두면 계속입니다.
  effective_from date,
  effective_to date,
  -- 최고관리자 승인이 있어야 붙일 수 있는 할인인가. 금액이 큰 감면은 2인 확인이
  -- 필요합니다 - 한 사람이 걸고 한 사람이 승인하는 것이 돈 다루는 기본입니다.
  requires_approval boolean not null default false,
  sort_order integer not null default 0,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.fee_discounts is
  '할인 규칙. 지우지 않고 active로 끕니다 - 지난 청구서가 왜 그 금액이었는지 설명할 수 있어야 합니다.';

-- 할인 규칙이 바뀐 기록. 누가 언제 무엇을 켜고 껐는지.
create table if not exists public.fee_discount_log (
  id uuid primary key default gen_random_uuid(),
  discount_id uuid references public.fee_discounts(id) on delete set null,
  discount_name text not null,               -- 규칙이 지워져도 이름은 남습니다
  action text not null,                      -- '생성' '수정' '켬' '끔'
  before_value jsonb,
  after_value jsonb,
  changed_by text not null,
  reason text,
  changed_at timestamptz not null default now()
);

create index if not exists fee_discount_log_at_idx on public.fee_discount_log (changed_at desc);

-- ═══════════════════════════════════════════════════════════════════════
-- 4. 학생이 고른 것 / 학생에게 걸린 할인
-- ═══════════════════════════════════════════════════════════════════════
-- 학부모가 안내문에 √ 표시하고 서명해서 낸 그 선택입니다. 이게 곧 계약이고, 청구
-- 일정을 정합니다.
create table if not exists public.student_fee_enrollments (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.wr_students(id) on delete cascade,
  -- 어느 학기 것인가. 학년도가 연도를 걸치는 문제는 terms가 이미 풀고 있습니다.
  term_id uuid references public.terms(id) on delete set null,
  plan_id uuid not null references public.fee_plans(id) on delete restrict,
  option_id uuid references public.fee_payment_options(id) on delete set null,
  -- 학부모가 서명해서 낸 날.
  signed_at date,
  note text,
  active boolean not null default true,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists student_fee_enrollments_student_idx
  on public.student_fee_enrollments (student_id, active);

create table if not exists public.student_fee_discounts (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.wr_students(id) on delete cascade,
  discount_id uuid not null references public.fee_discounts(id) on delete restrict,
  term_id uuid references public.terms(id) on delete set null,
  -- 왜 이 아이에게 붙였는가. 비워둘 수 없게 화면에서 막습니다.
  reason text,
  granted_by text,
  -- 승인이 필요한 할인이면 누가 승인했는지.
  approved_by text,
  approved_at timestamptz,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists student_fee_discounts_student_idx
  on public.student_fee_discounts (student_id, active);

-- ═══════════════════════════════════════════════════════════════════════
-- 5. 접근 제한 — 전부 재무 권한 뒤에
-- ═══════════════════════════════════════════════════════════════════════
-- 판정은 has_finance_access() 하나만 봅니다(20260831180000). 표마다 조건을 따로 쓰면
-- 한 곳만 고치고 나머지를 잊습니다.
do $$
declare t text;
begin
  foreach t in array array[
    'fee_plans', 'fee_payment_options', 'fee_discounts',
    'fee_discount_log', 'student_fee_enrollments', 'student_fee_discounts'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_finance_only', t);
    execute format(
      'create policy %I on public.%I for all using (public.has_finance_access()) with check (public.has_finance_access())',
      t || '_finance_only', t
    );
  end loop;
end $$;
