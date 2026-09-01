-- ═══════════════════════════════════════════════════════════════════════════
-- GIA 미적용 마이그레이션 3개 — Supabase SQL Editor 붙여넣기용
--
-- 작성일 2026-09-01 · 대상 프로젝트 yywtnvqrqsehxgzgrfra
--
-- 이 파일은 supabase/migrations 의 아래 세 파일을 순서 그대로 이어 붙인 것입니다.
-- 내용은 원본과 같고, 마지막에 실행 기록과 확인 조회만 덧붙였습니다.
--
--   1) 20260831180000_finance_role.sql
--   2) 20260831200000_fee_plans_discounts.sql
--   3) 20260831220000_dismissal_plans.sql
--
-- 순서가 중요합니다. 2번은 1번이 만든 has_finance_access() 를 쓰고, 3번은 wr_students 와
-- set_updated_at() 을 씁니다. 위에서부터 통째로 한 번에 실행하면 됩니다.
--
-- 전부 되돌릴 수 있게 한 덩어리로 묶었습니다(begin/commit). 중간에서 실패하면 아무것도
-- 남지 않으므로, 고친 뒤 다시 처음부터 실행하면 됩니다.
--
-- 이미 걸린 것을 또 실행해도 안전합니다 - 전부 if not exists / or replace 입니다.
-- ═══════════════════════════════════════════════════════════════════════════

begin;


-- ███████████████████████████████████████████████████████████████████████████
-- 20260831180000_finance_role.sql
-- 재무 권한 분리 — finance_access 열쇠, 최고관리자 직위, has_finance_access()
-- ███████████████████████████████████████████████████████████████████████████

-- 재무 권한 분리 (인보이스 시스템 1단계)
--
-- 정해진 것 세 가지.
--   · 돈에 관한 화면은 재무를 맡은 사람만 봅니다.
--   · 재무를 맡은 사람이 누구인지는 개발자와 최고관리자만 압니다. 다른 사람 눈에는
--     그냥 관리자로 보여야 합니다.
--   · 계층은 개발자 > 최고관리자 > 관리자 순입니다.
--
-- ── 왜 '재무관리자'라는 직위를 만들지 않았는가 ───────────────────────────
--
-- 처음에는 개발자 > 최고관리자 > 재무관리자 > 관리자 로 한 줄 세우려 했습니다. 그런데 재무는
-- 위아래가 아니라 **다른 축**입니다. 재무를 보는 사람이 셔틀이나 학사를 관리자보다 더 잘 알
-- 이유가 없습니다. 한 줄로 세우면 나중에 "재무만 보고 학생 명부는 못 보는 경리직원" 같은 것을
-- 만들 수가 없습니다.
--
-- 그래서 **계층 하나 + 열쇠 하나**로 나눕니다.
--
--   position       = 보이는 직위 (교사 · 행정직원 · 관리자 · 최고관리자 · 개발자)
--   finance_access = 재무 열쇠 (있음/없음) — 직위와 별개
--
-- 재무관리자 = position '관리자' + finance_access true.
-- 그러면 "남들에게는 그냥 관리자로 보인다"가 **숨기는 장치 없이** 성립합니다 - 실제로 관리자가
-- 맞으니까요. 숨김 로직으로 가리는 것보다 이쪽이 훨씬 덜 샙니다. 화면 한 군데를 빠뜨려도
-- 드러날 것이 없습니다.
--
-- 열쇠 자체는 개발자와 최고관리자에게만 보입니다(화면 단에서 거릅니다).

-- ── 1. 재무 열쇠 ────────────────────────────────────────────────────────
alter table public.app_users
  add column if not exists finance_access boolean not null default false;

comment on column public.app_users.finance_access is
  '재무 열쇠. 돈에 관한 화면을 볼 수 있는가. 직위(position)와 별개이며, 개발자·최고관리자에게만 보입니다.';

-- ── 2. 최고관리자 ───────────────────────────────────────────────────────
-- position에 값 하나를 더합니다. 최고관리자는 숨길 이유가 없으므로 보이는 직위로 둡니다
-- (숨겨야 하는 건 재무 열쇠뿐입니다).
alter table public.app_users drop constraint if exists app_users_position_check;
alter table public.app_users
  add constraint app_users_position_check
  check (position is null or position in ('교사', '행정직원', '관리자', '최고관리자', '개발자'));

-- ── 3. 관리자 판정에 최고관리자를 포함 ──────────────────────────────────
--
-- 이걸 빠뜨리면 최고관리자로 올린 사람이 **관리자 권한을 잃습니다**(RLS가 position='관리자'만
-- 보고 있었습니다). 직위를 올려줬는데 오히려 못 하게 되는, 알아채기 어려운 사고입니다.
create or replace function public.is_app_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select
    coalesce((auth.jwt() ->> 'email') ilike 'johnkang@giamicro.com', false)
    or exists (
      select 1 from app_users
      where email = lower(auth.jwt() ->> 'email')
        and status = 'approved'
        and position in ('관리자', '최고관리자')
    );
$$;

-- ── 4. 재무 접근 판정 ───────────────────────────────────────────────────
-- 앞으로 만들 돈 관련 표의 RLS는 전부 이 함수 하나만 봅니다. 판정 기준이 여러 군데로
-- 흩어지면 한 곳만 고치고 나머지를 잊습니다 - 이번 주에 그 실수를 몇 번 했습니다.
create or replace function public.has_finance_access()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select
    coalesce((auth.jwt() ->> 'email') ilike 'johnkang@giamicro.com', false)
    or exists (
      select 1 from app_users
      where email = lower(auth.jwt() ->> 'email')
        and status = 'approved'
        and finance_access = true
    );
$$;

-- ── 5. 열쇠를 누가 언제 주고 뺏었나 ─────────────────────────────────────
--
-- 돈 권한은 "지금 누가 갖고 있나"만으로는 부족합니다. 나중에 문제가 생겼을 때 **언제부터
-- 누가 줬는지**를 못 대면 아무 설명도 못 합니다. 권한을 바꾼 기록은 지워지지 않습니다.
create table if not exists public.finance_access_log (
  id uuid primary key default gen_random_uuid(),
  target_email text not null,
  granted boolean not null,
  changed_by text not null,
  reason text,
  changed_at timestamptz not null default now()
);

comment on table public.finance_access_log is
  '재무 열쇠 부여·회수 기록. 지우지 않습니다.';

create index if not exists finance_access_log_target_idx
  on public.finance_access_log (target_email, changed_at desc);

alter table public.finance_access_log enable row level security;

-- 읽기는 개발자·최고관리자만(=is_app_admin), 쓰기는 서버 라우트가 서비스 키로 합니다.
drop policy if exists finance_access_log_read on public.finance_access_log;
create policy finance_access_log_read
  on public.finance_access_log
  for select
  using (public.is_app_admin());


-- ███████████████████████████████████████████████████████████████████████████
-- 20260831200000_fee_plans_discounts.sql
-- 납부 항목·납부 옵션·할인 — 인보이스의 재료가 되는 표들
-- ███████████████████████████████████████████████████████████████████████████

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


-- ███████████████████████████████████████████████████████████████████████████
-- 20260831220000_dismissal_plans.sql
-- 하원수단 — 아이 기준 요일별 하원 방법(백서아 같은 경우)
-- ███████████████████████████████████████████████████████████████████████████

-- 하원수단 (학생 × 요일)
--
-- 요일마다 다른 방법으로 집에 가는 아이가 있습니다. 예를 들어 한 아이는 월요일 셔틀,
-- 화·목 1시 55분 메타프랩버스, 수요일 4시 30분 블루웨일버스, 금요일 3시 35분 블루웨일버스
-- 입니다. 이것은 셔틀 배정으로는 적을 수 없습니다.
--
-- 하원수단은 **아이를 기준으로** 저장합니다. 담임 선생님 화면에서도 아이 하나를 열면
-- 요일별 하원수단이 함께 떠야, 선생님이 아이를 맞는 곳으로 데리고 갈 수 있습니다.
--
-- **왜 셔틀 배정에 끼워 넣지 않는가:** 지금까지 "이 아이가 어떻게 집에 가는가"는 셔틀 배정
-- (shuttle_assignments)에만 있었습니다. 그런데 셔틀을 안 타는 날은 배정 자체가 없어서, 그
-- 요일에 아이가 어떻게 가는지 적을 자리가 아예 없었습니다. 학원 버스·도보·보호자 픽업은
-- 셔틀이 아니지만 **선생님이 아이를 어디로 보내야 하는지 알아야 하는 정보**입니다.
--
-- 그래서 셔틀과 별개로, **아이를 기준으로** 요일마다 한 줄씩 둡니다. 셔틀도 여기 한 종류로
-- 들어옵니다 - 그래야 "월요일은?"이라는 물음에 한 곳만 보면 됩니다.

create table if not exists public.student_dismissal_plans (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.wr_students(id) on delete cascade,
  -- 1=월 … 5=금. 셔틀도 수업도 평일만 있습니다.
  weekday smallint not null check (weekday between 1 and 5),
  -- 무엇을 타고 가는가.
  --   셔틀      : GIA 셔틀 (호차는 셔틀 배정이 정답이므로 여기 적지 않습니다)
  --   외부버스  : 학원 차량 (메타프랩·블루웨일 등) — label에 이름을 적습니다
  --   보호자픽업: 보호자가 학교로 데리러 옴
  --   도보      : 혼자 감 / 걸어서 감
  --   기타      : 위 어디에도 안 맞는 것 — note에 적습니다
  kind text not null check (kind in ('셔틀', '외부버스', '보호자픽업', '도보', '기타')),
  -- 버스 이름처럼 사람이 부르는 이름. '메타프랩버스', '블루웨일버스'.
  label text,
  -- 출발/도착 시각. 'HH:MM' 문자열입니다.
  --
  -- time 타입이 아니라 문자열인 이유: 학부모가 알려주는 시각은 "1:55"처럼 오전/오후가 없는
  -- 경우가 많습니다. 억지로 시각으로 바꾸면 새벽 1시 55분이 되어버립니다. 화면에 적힌 그대로
  -- 두고, 사람이 읽습니다.
  depart_time text,
  note text,
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- 한 아이의 한 요일에는 하원수단이 하나입니다. 둘이면 어느 쪽이 맞는지 알 수 없습니다.
  unique (student_id, weekday)
);

create index if not exists student_dismissal_plans_student_idx
  on public.student_dismissal_plans(student_id);

drop trigger if exists student_dismissal_plans_set_updated_at on public.student_dismissal_plans;
create trigger student_dismissal_plans_set_updated_at
  before update on public.student_dismissal_plans
  for each row execute function public.set_updated_at();

alter table public.student_dismissal_plans enable row level security;

-- 담임 선생님이 읽어야 하는 정보라 **교직원 전체가 읽습니다.**
-- 쓰기도 교직원 전체에게 엽니다 - 담임이 학부모에게 직접 듣는 경우가 가장 많고, 행정실을
-- 거쳐야만 고칠 수 있으면 결국 아무도 안 고쳐서 낡은 값이 남습니다.
drop policy if exists "staff_read_dismissal_plans" on public.student_dismissal_plans;
create policy "staff_read_dismissal_plans" on public.student_dismissal_plans
  for select using (auth.role() = 'authenticated');

drop policy if exists "staff_write_dismissal_plans" on public.student_dismissal_plans;
create policy "staff_write_dismissal_plans" on public.student_dismissal_plans
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'student_dismissal_plans'
  ) then
    alter publication supabase_realtime add table public.student_dismissal_plans;
  end if;
end $$;


-- ███████████████████████████████████████████████████████████████████████████
-- 실행 기록 남기기
--
-- SQL Editor 에서 직접 실행하면 Supabase 의 마이그레이션 이력에는 남지 않습니다. 그러면
-- 앱의 진단 화면이 "파일은 있는데 DB에는 없다"고 계속 경고하고, 다음에 CLI 나 Actions 가
-- 돌 때 같은 파일을 또 실행하려 듭니다. 그래서 여기서 직접 적어둡니다.
-- ███████████████████████████████████████████████████████████████████████████

insert into supabase_migrations.schema_migrations (version, name)
values
  ('20260831180000', 'finance_role'),
  ('20260831200000', 'fee_plans_discounts'),
  ('20260831220000', 'dismissal_plans')
on conflict (version) do nothing;

commit;

-- ███████████████████████████████████████████████████████████████████████████
-- 확인 — 아래 조회를 따로 한 번 더 실행해서 눈으로 보십시오.
-- 세 줄 모두 true 여야 합니다.
-- ███████████████████████████████████████████████████████████████████████████

select
  '재무 열쇠 칸(app_users.finance_access)' as 항목,
  exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'app_users' and column_name = 'finance_access'
  ) as 있음
union all
select
  '납부 항목 표(fee_plans)',
  to_regclass('public.fee_plans') is not null
union all
select
  '하원수단 표(student_dismissal_plans)',
  to_regclass('public.student_dismissal_plans') is not null;
