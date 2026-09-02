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
