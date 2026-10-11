-- 청구 회차(issue_batch) — 「언제 몇 차로 나간 청구서인가」
--
-- 청구서에는 발행일(issue_date)과 청구월(billing_month)만 있었습니다. 10월 학비를 7일에 한 번,
-- 빠진 아이들을 15일에 한 번 더 냈으면 두 묶음이 섞여 «10월 학비 140장»으로만 보였고, 어떤
-- 아이가 몇 차에 나갔는지 알려면 장마다 발행일을 열어 봐야 했습니다.
--
-- 회차는 「발행일 YYMMDD _ 그날 몇 번째 묶음」입니다(예: 261007_1). 한 번에 여러 장을 내는 화면이
-- 다섯 군데라, 화면마다 번호를 붙이게 두면 한 곳은 반드시 빠뜨립니다. 그래서 **넣을 때 트리거가**
-- 붙입니다: 같은 발행일·같은 사람·같은 갈래(학비/학비외)로 3분 안에 이어 들어온 장은 같은 묶음,
-- 그 밖은 그날의 다음 번호입니다.

alter table public.invoices add column if not exists issue_batch text;

create index if not exists invoices_issue_batch_idx on public.invoices (issue_batch);

create or replace function public.invoice_stream_of(p_stream text, p_category text)
returns text
language sql
immutable
as $$
  select case
    when p_stream in ('학비', '학비외') then p_stream
    when p_category = '학비' then '학비'
    else '학비외'
  end
$$;

create or replace function public.set_invoice_issue_batch()
returns trigger
language plpgsql
as $$
declare
  b text;
  n integer;
begin
  if new.issue_batch is not null and new.issue_batch <> '' then
    return new;
  end if;

  -- 같은 묶음: 같은 발행일 · 같은 사람 · 같은 갈래로 3분 안에 들어온 장.
  select i.issue_batch into b
  from public.invoices i
  where i.issue_date = new.issue_date
    and coalesce(i.issued_by, '') = coalesce(new.issued_by, '')
    and public.invoice_stream_of(i.stream, i.category) = public.invoice_stream_of(new.stream, new.category)
    and i.created_at > now() - interval '3 minutes'
    and i.issue_batch is not null
  order by i.created_at desc
  limit 1;

  if b is null then
    select count(distinct i.issue_batch) into n
    from public.invoices i
    where i.issue_date = new.issue_date and i.issue_batch is not null;
    b := to_char(new.issue_date, 'YYMMDD') || '_' || (coalesce(n, 0) + 1);
  end if;

  new.issue_batch := b;
  return new;
end;
$$;

drop trigger if exists invoices_issue_batch on public.invoices;
create trigger invoices_issue_batch
  before insert on public.invoices
  for each row execute function public.set_invoice_issue_batch();

-- 이미 나간 장에도 회차를 붙입니다(빈 칸만 채움 - 다른 칸은 건드리지 않습니다). 같은 규칙으로
-- 묶습니다: 발행일·사람·갈래가 같고 만든 시각이 3분 넘게 벌어지지 않으면 같은 묶음.
with o as (
  select id, issue_date, created_at,
         coalesce(issued_by, '') as ib,
         public.invoice_stream_of(stream, category) as st,
         lag(created_at) over (partition by issue_date, coalesce(issued_by, ''), public.invoice_stream_of(stream, category) order by created_at, id) as prev
  from public.invoices
  where issue_batch is null
),
g as (
  select *, sum(case when prev is null or created_at - prev > interval '3 minutes' then 1 else 0 end)
              over (partition by issue_date, ib, st order by created_at, id) as grp
  from o
),
f as (
  select issue_date, ib, st, grp, min(created_at) as first_at
  from g
  group by issue_date, ib, st, grp
),
r as (
  select f.*, row_number() over (partition by issue_date order by first_at, ib, st) as rn
  from f
)
update public.invoices i
set issue_batch = to_char(g.issue_date, 'YYMMDD') || '_' || r.rn
from g
join r on r.issue_date = g.issue_date and r.ib = g.ib and r.st = g.st and r.grp = g.grp
where i.id = g.id and i.issue_batch is null;

-- 청구 회차 한눈에 — 청구월 × 갈래 × 회차. 화면(/finance/rounds)이 읽습니다.
create or replace view public.invoice_batches as
select
  coalesce(nullif(i.billing_month, ''), to_char(i.issue_date, 'YYYY-MM')) as billing_month,
  public.invoice_stream_of(i.stream, i.category) as stream,
  i.issue_batch,
  min(i.issue_date) as issue_date,
  min(i.created_at) as first_created_at,
  count(*) filter (where i.status = '발행') as alive_count,
  count(*) filter (where i.status = '취소') as cancelled_count,
  coalesce(sum(i.total_amount) filter (where i.status = '발행'), 0) as alive_amount,
  count(*) filter (where i.status = '발행' and coalesce(i.issued_offline, false)) as offline_count,
  string_agg(distinct nullif(i.issued_by, ''), ', ') as issued_by
from public.invoices i
where i.issue_batch is not null
group by 1, 2, 3;

alter view public.invoice_batches set (security_invoker = on);
revoke all on public.invoice_batches from anon;

notify pgrst, 'reload schema';
