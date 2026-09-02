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
