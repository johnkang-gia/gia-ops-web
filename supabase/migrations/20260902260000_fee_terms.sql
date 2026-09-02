-- 학비외 항목·인보이스를 학기로 묶습니다
--
-- 다음 학기에는 교재가 또 달라집니다. 학기를 구분하지 않으면 지난 학기 교재가 새 학기 표에
-- 계속 열로 서 있고, 그것을 하나씩 끄는 일이 매 학기 반복됩니다. 끄는 것을 빠뜨리면 안 사는
-- 책이 청구됩니다.
--
-- **재무 전용 학기 표를 새로 둡니다.** 이미 있는 `terms` 는 사건기록(학기 돌아보기)에 매여
-- 있어서, 거기에 재무를 얹으면 한쪽을 고칠 때 다른 쪽이 흔들립니다.

create table if not exists public.fee_terms (
  id uuid primary key default gen_random_uuid(),
  -- 화면에 그대로 보이는 이름. `2026 정규학기`, `2026 여름캠프` 처럼 적습니다.
  name text not null unique,
  starts_on date,
  ends_on date,
  -- 지금 쓰는 학기. **하나만** 켜집니다(아래 인덱스로 막습니다).
  is_current boolean not null default false,
  note text,
  created_by text,
  created_at timestamptz not null default now()
);

comment on table public.fee_terms is
  '학비외 항목·인보이스를 묶는 학기. 학기가 바뀌면 새 줄을 만들고, 지난 학기 항목은 그대로 남습니다.';

-- 현재 학기는 하나뿐입니다. 둘이 켜져 있으면 화면마다 다른 학기를 보여주게 됩니다.
create unique index if not exists fee_terms_one_current on public.fee_terms (is_current) where is_current;

-- 지금까지 만든 것은 전부 이번 정규학기 것입니다.
insert into public.fee_terms (name, is_current, note)
select '2026 정규학기', true, '학기 구분을 넣기 전에 등록한 항목과 청구서가 여기에 들어 있습니다.'
where not exists (select 1 from public.fee_terms);

alter table public.fee_items add column if not exists fee_term_id uuid references public.fee_terms(id) on delete set null;
alter table public.invoices  add column if not exists fee_term_id uuid references public.fee_terms(id) on delete set null;

create index if not exists fee_items_fee_term_idx on public.fee_items (fee_term_id);
create index if not exists invoices_fee_term_idx on public.invoices (fee_term_id);

-- 이미 있는 항목·청구서를 현재 학기로 넘깁니다. 비워두면 어느 학기에서도 안 보입니다.
update public.fee_items set fee_term_id = (select id from public.fee_terms where is_current limit 1)
where fee_term_id is null;
update public.invoices set fee_term_id = (select id from public.fee_terms where is_current limit 1)
where fee_term_id is null;

alter table public.fee_terms enable row level security;
drop policy if exists fee_terms_finance_only on public.fee_terms;
create policy fee_terms_finance_only on public.fee_terms
  for all using (public.has_finance_access()) with check (public.has_finance_access());
