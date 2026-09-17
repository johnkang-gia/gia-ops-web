-- 입금의 **출처**를 따로 적습니다 — 지금은 「어떻게 붙었나」가 「어디서 왔나」를 덮어씁니다.
--
-- ── 무엇이 문제였나 ──────────────────────────────────────────────────
--
-- `payments.matched_by` 하나가 **두 가지 사실**을 담고 있었습니다.
--
--   · 어디서 온 돈인가 — 「이미받음」 · 「완납체크」 · 수납 화면 입력
--   · 어떻게 붙었나   — 「선입금 자동충당」
--
-- 선입금을 청구서에 자동으로 붙이는 일(`prepaidApply`)이 이 칸을 **「선입금 자동충당」으로
-- 덮어씁니다.** 그 순간 그 돈이 원래 어디서 왔는지가 사라집니다.
--
-- 그 다음이 사고입니다. 청구서를 취소하면 「이미 받음」이 만든 입금은 **함께 지워져야**
-- 합니다 - 발행이 만든 돈이니 발행을 없던 일로 하면 그 돈도 없던 일입니다. 그런데 취소는
-- `matched_by = '이미받음'` 인 줄만 찾습니다. 한 번이라도 충당을 거친 줄은 이름이 바뀌어
-- 있어서 **안 지워지고 선입금으로 살아남습니다.**
--
-- 살아남은 돈은 다음 청구서에 저절로 붙습니다. 같은 항목을 「이미 받음」으로 다시 적으면
-- 진짜 입금이 또 들어오고, 장부에는 **받은 적 없는 돈**이 쌓입니다. 한 학생의 학비외
-- 총청구액이 291,000원인데 납부금액이 482,000원으로 찍혔습니다.
--
-- ── 무엇을 하나 ──────────────────────────────────────────────────────
--
-- 출처를 담는 칸(`origin`)을 따로 둡니다. **넣을 때 한 번 적고 다시는 안 바꿉니다.**
-- 쪼갠 줄은 뿌리의 출처를 물려받습니다 - 100,000원을 9,000원과 91,000원으로 나눠도 그 돈이
-- 어디서 왔는지는 그대로입니다.
--
-- 같은 뜻을 두 칸에 두지 않기 위해 `matched_by` 는 그대로 둡니다. 그 칸은 이제 **붙은
-- 방법**만 뜻합니다.

alter table public.payments add column if not exists origin text;

comment on column public.payments.origin is
  '이 돈이 어디서 왔는가(이미받음·완납체크·수납·올톡페이 등). 넣을 때 한 번 적고 바꾸지 않습니다 - matched_by 는 「어떻게 붙었나」라서 충당이 덮어씁니다.';

-- ① 아직 안 덮인 줄. `matched_by` 가 곧 출처입니다.
update public.payments
   set origin = matched_by
 where origin is null
   and matched_by is not null
   and matched_by <> '선입금 자동충당';

-- ② 쪼갠 줄. 뿌리를 따라 올라가 그 출처를 물려받습니다. 쪼갬이 겹겹이 일어난 줄이 있어
--    (100,000 → 9,000 + 91,000 → 다시 9,000 + 82,000) 채워질 때까지 되풀이합니다.
do $$
declare
  n int;
begin
  for i in 1..20 loop
    update public.payments c
       set origin = p.origin
      from public.payments p
     where c.split_from_id = p.id
       and c.origin is null
       and p.origin is not null;
    get diagnostics n = row_count;
    exit when n = 0;
  end loop;
end $$;

-- ③ 그래도 빈 줄. 덮어쓰기 전의 이름을 알 길이 없으므로 `source` 를 씁니다. 완벽하진 않지만
--    **빈 칸보다 낫습니다** - 빈 칸이면 취소가 또 그 돈을 못 알아봅니다.
update public.payments set origin = coalesce(origin, source, '알수없음') where origin is null;

alter table public.payments alter column origin set default '수납';

-- ── 한 번 적으면 안 바뀝니다 ─────────────────────────────────────────
--
-- 코드에서 안 고치기로 하는 것만으로는 부족합니다. 이 칸이 덮어써지는 것이 바로 이번 사고의
-- 원인이었고, 그 덮어쓰기는 **의도한 것이 아니라 한 칸에 두 뜻을 담았기 때문**에 일어났습니다.
-- 다음에 누가 또 같은 실수를 하면 여기서 막힙니다.
create or replace function public.payments_origin_is_fixed()
returns trigger
language plpgsql
as $$
begin
  if old.origin is not null and new.origin is distinct from old.origin then
    raise exception '입금의 출처(origin)는 바꿀 수 없습니다. 「어떻게 붙었나」는 matched_by 에 적으세요. (%: % → %)',
      old.id, old.origin, new.origin;
  end if;
  return new;
end $$;

drop trigger if exists payments_origin_fixed_trg on public.payments;
create trigger payments_origin_fixed_trg
  before update on public.payments
  for each row execute function public.payments_origin_is_fixed();

-- ── 입금이 청구액보다 많은 장 ────────────────────────────────────────
--
-- 이번 일을 화면이 **스스로 찾아내게** 합니다. 지금까지는 담당자가 표를 보다가 「어? 과납이
-- 왜 이렇게」라고 느껴야만 드러났습니다.
--
-- 일부러 더 받아둔 경우도 있으므로 「문제」가 아니라 「확인」입니다. 다만 비어 있는 것이
-- 정상이고, 숫자가 늘면 무언가 두 번 붙고 있다는 뜻입니다.
create or replace view public.invoice_overpaid as
select
  i.id,
  i.invoice_no,
  i.student_name_ko,
  i.stream,
  i.issued_offline,
  i.total_amount,
  p.paid,
  p.paid - i.total_amount as over
from public.invoices i
join (
  select invoice_id, sum(amount) as paid
    from public.payments
   where invoice_id is not null
   group by invoice_id
) p on p.invoice_id = i.id
where coalesce(i.status, '') <> '취소'
  and p.paid > i.total_amount;

comment on view public.invoice_overpaid is
  '입금이 청구액보다 많은 장. 일부러 더 받아둔 경우도 있지만, 늘어나면 같은 돈이 두 번 붙고 있다는 뜻입니다.';

alter view public.invoice_overpaid set (security_invoker = on);
revoke all on public.invoice_overpaid from anon;

-- rls-ok: 이 파일이 만드는 것은 뷰 하나뿐이고, 바로 위에서 읽는 사람의 권한으로 돌게 하고
--         로그인 안 한 사람의 권한을 거뒀습니다.
