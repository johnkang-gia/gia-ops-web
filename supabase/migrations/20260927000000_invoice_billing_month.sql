-- **청구월** — 이 청구서가 «몇 월치»인가.
--
-- ── 왜 발행일로는 안 되나 ──────────────────────────────────────────────────
--
-- 지금은 월별 집계를 하려면 `issue_date` 의 월로 묶는 수밖에 없습니다. 그런데 발행일과
-- 「몇 월치인가」는 다릅니다.
--
--   · 9월분 학비를 8월 28일에 미리 보냅니다 → 발행일로 세면 **8월 수입**이 됩니다.
--   · 8월분을 못 걷어 9월 5일에 다시 보냅니다 → 발행일로 세면 **9월 수입**이 됩니다.
--
-- 둘 다 오류로는 안 보입니다. 그냥 그 달 숫자가 다릅니다. 그리고 그 숫자로 다음 달 청구액을
-- 산출하면 틀린 값이 한 번 더 퍼집니다.
--
-- ── 어떻게 담나 ────────────────────────────────────────────────────────────
--
-- `YYYY-MM` 글자 한 칸입니다. 날짜(date)로 두지 않는 이유는 「월」이 곧 값이기 때문입니다 -
-- 날짜로 두면 1일인지 말일인지를 화면마다 다시 정하게 되고, 시간대까지 얽힙니다.
--
-- **기존 줄은 발행일의 월로 채웁니다.** 지금까지 그렇게 세어 왔으니 그 값이 지금의 참입니다.
-- 앞으로 발행하는 것만 사람이 고릅니다. 비워 두면 「안 정함」과 「발행일과 같음」이
-- 구별되지 않아, 옛 줄이 집계에서 통째로 빠집니다.

alter table public.invoices add column if not exists billing_month text;

alter table public.invoices drop constraint if exists invoices_billing_month_format;
alter table public.invoices add constraint invoices_billing_month_format
  check (billing_month is null or billing_month ~ '^\d{4}-(0[1-9]|1[0-2])$');

-- 발행일의 **한국 날짜** 기준 월입니다. issue_date 는 date 라 시간대가 없지만, 만드는 쪽이
-- 한국 날짜로 넣고 있으므로 그대로 잘라 씁니다.
update public.invoices
   set billing_month = to_char(issue_date, 'YYYY-MM')
 where billing_month is null;

create index if not exists invoices_billing_month_idx on public.invoices (billing_month, stream);

comment on column public.invoices.billing_month is
  '몇 월치 청구인가(YYYY-MM). 발행일과 다를 수 있습니다 - 9월분을 8월 말에 보내도 9월로 셉니다.';

-- ── 월별 집계 ──────────────────────────────────────────────────────────────
--
-- **화면이 줄을 끌어와 더하지 않습니다.** 지금 재무 화면들은 invoices 를 limit 500~1000 으로
-- 읽어 화면에서 합산합니다. 139명 × (학비+학비외) ≒ 월 278장이라 **두 달이면 500을 넘습니다.**
-- 넘는 순간 개요의 「발행한 금액」이 조용히 줄어드는데, 오류가 아니라 그냥 다른 숫자입니다.
--
-- 그래서 합계는 데이터베이스가 냅니다. 몇 년이 쌓여도 한 줄씩만 돌려줍니다.
create or replace view public.finance_monthly as
select
  i.billing_month                                                as month,
  i.stream                                                       as stream,
  count(*) filter (where i.status = '발행')                       as issued_count,
  coalesce(sum(i.total_amount) filter (where i.status = '발행'), 0) as issued_amount,
  count(*) filter (where i.status = '취소')                       as cancelled_count,
  -- 그 청구서들에 붙은 돈. 청구서가 취소됐으면 세지 않습니다 - 취소된 청구서에 돈이
  -- 붙어 있으면 그건 정리가 안 된 것이고, 수입으로 세면 그 사실이 묻힙니다.
  coalesce((
    select sum(p.amount)
      from public.payments p
      join public.invoices v on v.id = p.invoice_id
     where v.billing_month = i.billing_month
       and v.stream is not distinct from i.stream
       and v.status = '발행'
  ), 0)                                                          as paid_amount
from public.invoices i
where i.billing_month is not null
group by i.billing_month, i.stream;

comment on view public.finance_monthly is
  '청구월 × 갈래(학비/학비외)별 청구·수납 합계. 화면이 줄을 끌어와 더하지 않게 하려고 둡니다.';

-- rls-ok: 뷰는 바탕 표(invoices·payments)의 RLS를 그대로 따릅니다. 재무 열쇠가 없는 사람은
-- 바탕 표를 못 읽으므로 이 뷰도 빈 결과를 봅니다. 뷰에 정책을 따로 걸면 오히려 두 기준이
-- 생겨 어긋납니다.
