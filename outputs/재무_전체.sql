-- ═══════════════════════════════════════════════════════════════════════════
-- 재무 전체 — Supabase SQL Editor 붙여넣기용 (한 번에 실행)
--
-- 재무 기능에 필요한 마이그레이션 세 개를 순서대로 이어 붙였습니다.
--   1) 20260901160000_fee_items_invoices  학비외 항목 · 인보이스
--   2) 20260901180000_payments            수납 · 단가 이력 · 취소 사유
--   3) 20260901200000_fee_categories      항목 분류 등록
--
-- **이미 일부를 실행하셨어도 그대로 다시 돌리면 됩니다.** 전부 if not exists / or replace 라
-- 있는 것은 건너뛰고 없는 것만 만듭니다.
--
-- 앞서 실행한 20260831180000_finance_role 의 has_finance_access() 를 씁니다.
-- ═══════════════════════════════════════════════════════════════════════════

begin;


-- ███████████████████████████████████████████████████████████████████████████
-- 20260901160000_fee_items_invoices.sql — 학비외 항목 · 인보이스
-- ███████████████████████████████████████████████████████████████████████████

-- 학비외 수납 항목과 인보이스 (교재·악기·악기수리·교복 등)
--
-- 지금까지는 구글독스 양식 하나를 아이마다 복사해서 항목을 손으로 갈아 끼우고, 금액도
-- 손으로 넣고, 합계도 사람이 계산했습니다. 그 방식이 실제로 틀리고 있습니다 - 받은 양식의
-- 항목 합은 191,000원인데 총액 칸에는 191,200원이 적혀 있고, 금액에 `₩47,,000` 같은 오타도
-- 남아 있습니다. 사람이 나빠서가 아니라, 사람에게 시키면 안 되는 일을 시키고 있어서입니다.
--
-- 그래서 세 가지를 나눕니다.
--   ① 무엇을 파는가        fee_items          — 재무담당이 등록. 단가는 여기 한 곳에만.
--   ② 누가 무엇을 사는가   student_fee_items  — 기본 세트에서 뺀 것/더한 것만 기록.
--   ③ 무엇을 보냈는가      invoices           — 보낸 순간의 값을 굳혀 둡니다.

-- ═══════════════════════════════════════════════════════════════════════
-- ① 항목 — 무엇을 파는가
-- ═══════════════════════════════════════════════════════════════════════
create table if not exists public.fee_items (
  id uuid primary key default gen_random_uuid(),

  --   교재 / 악기 / 악기수리 / 교복 / 기타
  category text not null default '교재',

  -- 인보이스에 그대로 찍히는 이름. 양식이 영문이라 영문명이 본문이고, 한글명은 화면에서
  -- 고를 때 쓰는 이름입니다. 둘을 한 칸에 섞으면 인보이스에 한글이 튀어나옵니다.
  name text not null,
  name_ko text,

  /**
   * 단가. **여기 한 곳에만 있습니다.**
   *
   * 아이마다 금액을 고칠 수 있게 두면 그 자리가 곧 오타가 나는 자리입니다. 값이 오르면
   * 이 줄 하나를 고치고, 이미 보낸 인보이스는 발행 시점 값이 굳어 있어 흔들리지 않습니다.
   */
  unit_price numeric(12, 2) not null default 0,

  /**
   * 기본으로 붙는 대상.
   *
   * 교재는 대개 "5학년 전원"처럼 학년으로 정해집니다. 137명을 하나씩 체크하게 두면 그 일은
   * 결국 안 하게 되고, 안 하면 빠집니다. 여기에 학년(또는 반)을 적어두면 그 아이들에게
   * 자동으로 들어가고, 예외만 손으로 빼면 됩니다.
   *
   * 둘 다 비어 있으면 아무에게도 자동으로 붙지 않습니다(개별로만 붙이는 항목).
   */
  default_grades text[] not null default '{}',
  default_classes text[] not null default '{}',

  -- 어느 학기 것인가. 학년도가 연도를 걸치는 문제는 terms가 이미 풀고 있습니다.
  term_id uuid references public.terms(id) on delete set null,

  -- 지우지 않고 끕니다. 지난 인보이스가 왜 그 금액이었는지 설명할 수 있어야 합니다.
  active boolean not null default true,
  sort_order integer not null default 0,
  note text,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.fee_items is
  '학비외 수납 항목(교재·악기·수리·교복). 단가는 여기 한 곳에만 있습니다.';

create index if not exists fee_items_active_idx on public.fee_items (active, category, sort_order);

-- ═══════════════════════════════════════════════════════════════════════
-- ② 아이별 가감 — 기본 세트와 다른 것만
-- ═══════════════════════════════════════════════════════════════════════
--
-- **다른 것만 적습니다.** 5학년 스무 명에게 같은 책이 들어간다면 그 스무 줄을 만들지 않고,
-- 한 명이 그 책을 안 산다는 사실 한 줄만 남깁니다. 줄이 적으면 틀릴 자리도 적습니다.
create table if not exists public.student_fee_items (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.wr_students(id) on delete cascade,
  item_id uuid not null references public.fee_items(id) on delete cascade,
  term_id uuid references public.terms(id) on delete set null,

  --   include : 기본 대상이 아닌데 이 아이는 삽니다
  --   exclude : 기본 대상인데 이 아이는 안 삽니다
  mode text not null default 'include' check (mode in ('include', 'exclude')),

  -- 같은 책을 두 권 사는 경우. 금액은 단가 × 수량으로만 나옵니다 - 손으로 못 고칩니다.
  qty integer not null default 1 check (qty >= 1),

  note text,
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- 한 아이의 한 항목에 대한 결정은 하나뿐입니다. 둘이면 어느 쪽이 맞는지 알 수 없습니다.
  unique (student_id, item_id)
);

create index if not exists student_fee_items_student_idx on public.student_fee_items (student_id);

-- ═══════════════════════════════════════════════════════════════════════
-- ③ 발행한 인보이스 — 보낸 순간을 굳힙니다
-- ═══════════════════════════════════════════════════════════════════════
--
-- 항목 표를 그대로 참조하면, 나중에 책값이 오를 때 **이미 보낸 인보이스의 금액까지 같이
-- 바뀝니다.** 학부모가 받은 종이와 화면이 달라지는 것이라, 보낸 순간의 이름과 금액을
-- 그대로 베껴 둡니다.
create table if not exists public.invoices (
  id uuid primary key default gen_random_uuid(),

  -- 사람이 부르는 번호. "2026-0001".
  invoice_no text not null unique,

  student_id uuid references public.wr_students(id) on delete set null,
  -- 학생이 나중에 전학을 가도 이 인보이스는 남아야 합니다. 그래서 이름도 베껴 둡니다.
  student_name text not null,
  student_name_ko text,
  grade_label text,

  issue_date date not null,
  due_date date not null,
  total_amount numeric(12, 2) not null default 0,

  --   발행 : 보냈음   ·   취소 : 무효(지우지 않고 남깁니다)
  status text not null default '발행' check (status in ('발행', '취소')),
  note text,
  issued_by text,
  created_at timestamptz not null default now()
);

create index if not exists invoices_student_idx on public.invoices (student_id, issue_date desc);
create index if not exists invoices_date_idx on public.invoices (issue_date desc);

create table if not exists public.invoice_lines (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  seq integer not null default 1,
  name text not null,
  qty integer not null default 1,
  unit_price numeric(12, 2) not null default 0,
  -- 단가 × 수량을 그대로 저장합니다. 화면에서 다시 곱하지 않습니다 - 굳힌 값이 뜻이 있습니다.
  amount numeric(12, 2) not null default 0
);

create index if not exists invoice_lines_invoice_idx on public.invoice_lines (invoice_id, seq);

-- ═══════════════════════════════════════════════════════════════════════
-- ④ 번호 매기기
-- ═══════════════════════════════════════════════════════════════════════
-- 사람이 손으로 번호를 붙이면 반드시 겹칩니다. 그 해의 다음 번호를 DB가 정합니다.
create or replace function public.next_invoice_no(p_year text default null)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  y text := coalesce(p_year, to_char(now() at time zone 'Asia/Seoul', 'YYYY'));
  n integer;
begin
  select coalesce(max((split_part(invoice_no, '-', 2))::int), 0) + 1
    into n
    from invoices
   where invoice_no like y || '-%';
  return y || '-' || lpad(n::text, 4, '0');
end;
$$;

-- ═══════════════════════════════════════════════════════════════════════
-- ⑤ 접근 제한 — 돈에 관한 것은 전부 재무 권한 뒤에
-- ═══════════════════════════════════════════════════════════════════════
do $$
declare t text;
begin
  foreach t in array array['fee_items', 'student_fee_items', 'invoices', 'invoice_lines'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_finance_only', t);
    execute format(
      'create policy %I on public.%I for all using (public.has_finance_access()) with check (public.has_finance_access())',
      t || '_finance_only', t
    );
  end loop;
end $$;

drop trigger if exists fee_items_set_updated_at on public.fee_items;
create trigger fee_items_set_updated_at
  before update on public.fee_items
  for each row execute function public.set_updated_at();

drop trigger if exists student_fee_items_set_updated_at on public.student_fee_items;
create trigger student_fee_items_set_updated_at
  before update on public.student_fee_items
  for each row execute function public.set_updated_at();

-- ███████████████████████████████████████████████████████████████████████████
-- 20260901180000_payments.sql — 수납 · 단가 이력 · 취소 사유
-- ███████████████████████████████████████████████████████████████████████████

-- 수납 — 들어온 돈을 인보이스에 붙입니다
--
-- 인보이스를 보내는 데서 끝나면 **"누가 안 냈나"에 답할 수 없습니다.** 그러면 결국 통장을
-- 눈으로 훑게 되고, 눈으로 훑는 일은 매번 하지 않게 되고, 안 하면 미납이 쌓입니다.
--
-- 잔액은 표에 저장하지 않습니다. `청구액 - 입금 합`으로 그때그때 냅니다. 같은 사실을 두
-- 곳에 두면 반드시 어긋나고, 어긋난 잔액은 없느니만 못합니다.

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),

  -- 어느 인보이스에 붙는 돈인가. 아직 못 붙인 입금(누구 것인지 모르는 돈)은 비어 있습니다.
  invoice_id uuid references public.invoices(id) on delete set null,
  student_id uuid references public.wr_students(id) on delete set null,

  paid_at date not null,
  amount numeric(12, 2) not null check (amount > 0),

  --   올톡페이 / 계좌이체 / 현금 …  자유롭게 적습니다.
  method text,

  /**
   * 입금자명. **대사의 유일한 단서**입니다.
   *
   * 통장에는 아이 이름이 아니라 보호자 이름이 찍히는 경우가 많아, 이 값을 그대로 남겨두고
   * 사람이 볼 수 있게 합니다. 자동으로 못 붙였을 때 이걸 보고 사람이 고릅니다.
   */
  payer_name text,
  memo text,

  --   엑셀 / 수기.  어디서 온 줄인지 알아야 잘못 들어온 것을 통째로 걷어낼 수 있습니다.
  source text not null default '수기',

  /**
   * 같은 파일을 두 번 올려도 같은 줄이 두 번 들어가지 않게 하는 열쇠.
   *
   * 날짜+금액+입금자명으로 만듭니다. 같은 사람이 같은 날 같은 금액을 두 번 낸 경우가 실제로
   * 있을 수 있으므로, 파일 안의 순번까지 넣어 구별합니다.
   */
  source_key text,

  --   자동 / 사람 이름.  누가 이 돈을 이 인보이스에 붙였는지.
  matched_by text,

  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.payments is
  '들어온 돈. 잔액은 저장하지 않고 청구액에서 빼서 냅니다.';

create index if not exists payments_invoice_idx on public.payments (invoice_id);
create index if not exists payments_student_idx on public.payments (student_id, paid_at desc);
create index if not exists payments_date_idx on public.payments (paid_at desc);

-- 두 번 올려도 한 번만 들어갑니다.
create unique index if not exists payments_source_key_uniq
  on public.payments (source_key)
  where source_key is not null;

-- ── 항목 단가 이력 ────────────────────────────────────────────────────────
--
-- 값이 오르면 지금은 덮어씁니다. 그러면 "작년엔 얼마였나"에 답할 수 없습니다.
-- 바뀔 때마다 한 줄 쌓아두면 그 물음에 답할 수 있고, 지난 인보이스의 금액도 설명됩니다.
create table if not exists public.fee_item_price_log (
  id uuid primary key default gen_random_uuid(),
  item_id uuid references public.fee_items(id) on delete cascade,
  item_name text not null,
  before_price numeric(12, 2),
  after_price numeric(12, 2) not null,
  changed_by text,
  changed_at timestamptz not null default now()
);

create index if not exists fee_item_price_log_item_idx on public.fee_item_price_log (item_id, changed_at desc);

create or replace function public.log_fee_item_price()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE' and new.unit_price is distinct from old.unit_price then
    insert into fee_item_price_log (item_id, item_name, before_price, after_price, changed_by)
    values (new.id, new.name, old.unit_price, new.unit_price, new.created_by);
  end if;
  return new;
end;
$$;

drop trigger if exists fee_items_price_log on public.fee_items;
create trigger fee_items_price_log
  after update on public.fee_items
  for each row execute function public.log_fee_item_price();

-- ── 인보이스 취소 사유 ────────────────────────────────────────────────────
-- 상태(발행/취소)는 이미 있는데 **왜 취소했는지** 적을 자리가 없었습니다. 지우지 않고 남기는
-- 것이 뜻이 있으려면 이유가 함께 있어야 합니다.
alter table public.invoices add column if not exists cancel_reason text;
alter table public.invoices add column if not exists cancelled_at timestamptz;
alter table public.invoices add column if not exists cancelled_by text;

-- ── 접근 제한 ─────────────────────────────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array['payments', 'fee_item_price_log'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_finance_only', t);
    execute format(
      'create policy %I on public.%I for all using (public.has_finance_access()) with check (public.has_finance_access())',
      t || '_finance_only', t
    );
  end loop;
end $$;

drop trigger if exists payments_set_updated_at on public.payments;
create trigger payments_set_updated_at
  before update on public.payments
  for each row execute function public.set_updated_at();

-- ███████████████████████████████████████████████████████████████████████████
-- 20260901200000_fee_categories.sql — 항목 분류 등록
-- ███████████████████████████████████████████████████████████████████████████

-- 학비외 항목의 분류를 등록해서 씁니다
--
-- 지금까지 분류는 항목에 적힌 글자에서 거꾸로 모아 만들었습니다. 그래서 **항목이 하나도
-- 없는 분류는 존재할 수가 없었습니다** - "악기"를 먼저 만들어두고 그 아래 첼로·바이올린을
-- 채워 넣는 순서로는 일을 못 했습니다.
--
-- 분류를 따로 두면 순서도 정할 수 있습니다. 교재가 늘 맨 앞에 오고 기타가 맨 뒤에 오는 것이
-- 글자 순서로는 안 됩니다.

create table if not exists public.fee_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  -- 표에서 열이 묶이는 순서. 작은 값이 왼쪽입니다.
  sort_order integer not null default 0,
  -- 지우지 않고 끕니다. 지난 인보이스의 항목이 이 분류에 매달려 있습니다.
  active boolean not null default true,
  note text,
  created_by text,
  created_at timestamptz not null default now()
);

comment on table public.fee_categories is
  '학비외 항목의 분류. 항목보다 먼저 만들 수 있어야 "악기" 아래에 첼로·바이올린을 채우는 순서가 됩니다.';

-- 이미 항목에 쓰인 분류는 그대로 옮겨둡니다. 안 그러면 화면을 열자마자 쓰던 분류가
-- 사라진 것처럼 보입니다.
insert into public.fee_categories (name, sort_order)
select distinct category, 0 from public.fee_items where coalesce(category, '') <> ''
on conflict (name) do nothing;

alter table public.fee_categories enable row level security;
drop policy if exists fee_categories_finance_only on public.fee_categories;
create policy fee_categories_finance_only on public.fee_categories
  for all using (public.has_finance_access()) with check (public.has_finance_access());

insert into supabase_migrations.schema_migrations (version, name)
values
  ('20260901160000', 'fee_items_invoices'),
  ('20260901180000', 'payments'),
  ('20260901200000', 'fee_categories')
on conflict (version) do nothing;

commit;

-- 확인 — 여섯 줄 모두 true 여야 합니다.
select '학비외 항목(fee_items)' as 항목, to_regclass('public.fee_items') is not null as 있음
union all select '학생별 가감(student_fee_items)', to_regclass('public.student_fee_items') is not null
union all select '인보이스(invoices)', to_regclass('public.invoices') is not null
union all select '인보이스 내역(invoice_lines)', to_regclass('public.invoice_lines') is not null
union all select '수납(payments)', to_regclass('public.payments') is not null
union all select '항목 분류(fee_categories)', to_regclass('public.fee_categories') is not null;
