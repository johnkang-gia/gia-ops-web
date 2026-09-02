-- 학기를 하나의 뿌리로 모읍니다
--
-- 학기 개념이 세 갈래로 나뉘어 있었습니다.
--   · `terms`               — 업무·회의·관찰기록·사건기록·반 편성이 이미 여기 붙어 있습니다
--   · `shuttle_routes.term` — `정규학기` / `여름캠프2` 라는 **글자**
--   · `fee_terms`           — 학비외 항목·청구서용으로 따로 만든 표
--
-- 셋이 따로 놀면 "지금 학기"가 화면마다 다릅니다. 가장 많이 붙어 있는 `terms` 를 뿌리로 삼고
-- 나머지를 여기로 끌어옵니다.

-- ── 1. 진행중인 학기는 하나 ────────────────────────────────────────────
--
-- 둘이 켜져 있으면 화면마다 다른 학기를 현재로 보게 됩니다. 이미 여러 개가 켜져 있을 수
-- 있으므로, 가장 최근 것만 남기고 나머지를 종료로 내립니다.
update public.terms set status = '종료'
where status = '진행중'
  and id <> (
    select id from public.terms where status = '진행중'
    order by start_date desc nulls last, created_at desc limit 1
  );

create unique index if not exists terms_one_running
  on public.terms ((status)) where status = '진행중';

-- ── 2. 셔틀을 학기에 붙입니다 ──────────────────────────────────────────
--
-- 셔틀 화면들은 `shuttle_routes.term` 이라는 **글자**로 갈라 봅니다. 그 글자를 학기 표가
-- 들고 있게 해서, 학기를 만들 때 이름을 정하면 셔틀도 따라오게 합니다. 글자를 그대로 두는
-- 이유는 지난 학기 노선·정류장·탑승기록이 전부 그 글자에 매달려 있기 때문입니다 - 한꺼번에
-- 갈아엎으면 지난 기록이 미아가 됩니다.
alter table public.terms add column if not exists shuttle_label text;
comment on column public.terms.shuttle_label is
  '이 학기의 셔틀 자료를 가리키는 이름(shuttle_routes.term 에 들어가는 글자).';

update public.terms set shuttle_label = '정규학기'
where status = '진행중' and shuttle_label is null;

alter table public.shuttle_routes add column if not exists term_id uuid references public.terms(id) on delete set null;
create index if not exists shuttle_routes_term_id_idx on public.shuttle_routes (term_id);

update public.shuttle_routes r
set term_id = t.id
from public.terms t
where r.term_id is null and t.shuttle_label is not null and r.term = t.shuttle_label;

-- ── 3. 재무를 학기에 붙입니다 ──────────────────────────────────────────
--
-- `fee_items` 에는 원래 `term_id` 가 있었는데 안 쓰고 있었습니다. 어제 급히 만든 `fee_terms`
-- 대신 그 칸을 씁니다.
alter table public.invoices add column if not exists term_id uuid references public.terms(id) on delete set null;
create index if not exists invoices_term_id_idx on public.invoices (term_id);

do $$
declare cur uuid;
begin
  select id into cur from public.terms where status = '진행중' limit 1;
  if cur is null then return; end if;

  update public.fee_items set term_id = cur where term_id is null;
  update public.invoices  set term_id = cur where term_id is null;
end $$;

-- 따로 만들었던 재무 학기표는 더 이상 쓰지 않습니다. 두 곳에 학기가 있으면 반드시 어긋납니다.
alter table public.fee_items drop column if exists fee_term_id;
alter table public.invoices  drop column if exists fee_term_id;
drop table if exists public.fee_terms;

-- ── 4. 학기 시작 도우미 ────────────────────────────────────────────────
-- 사건번호는 사람이 붙이면 겹칩니다. DB가 만듭니다.
create or replace function public.next_term_case_id()
returns text
language sql
volatile
as $$
  select 'TRM-' || to_char(now() at time zone 'Asia/Seoul', 'YYMMDD') || '-' ||
         lpad((floor(random() * 10000))::int::text, 4, '0');
$$;
