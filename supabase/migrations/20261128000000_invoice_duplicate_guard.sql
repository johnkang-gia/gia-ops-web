-- 같은 항목을 두 장에 청구하지 못하게 — 데이터베이스가 마지막으로 막습니다
--
-- 중복 청구는 화면·서버 검사가 여러 겹 있었는데도 매번 새 길로 났습니다.
--   · 최서연 10월 학비가 「학비+학비외 한 장」과 「학비 한 장」으로 두 번 발행 (plan_scope 글자 비교)
--   · 김에스더 10월 학비가 표에서는 미발행, 서버에서는 이미 발행 (분류 글자 「학비+학비외」)
-- 원인은 늘 같았습니다 - **무엇이 나갔는가를 글자로 가렸습니다.** 학비 줄에는 항목 번호가 없었습니다.
--
-- 이제 학비 줄에 항목 번호(`plan_id`)를 남기고(앱 v0.731.0), 데이터베이스가 줄을 넣을 때 확인합니다.
--   · 학비: 같은 학생 · 같은 항목 · **같은 청구월** 의 살아 있는 청구서가 이미 있으면 거절
--   · 학비외: 같은 학생 · 같은 항목 · **같은 학기** 의 살아 있는 청구서가 이미 있으면 거절
-- 살아 있는 청구서 = 「발행」 상태이고 다음 장으로 이월되지 않은 것.
--
-- 예외(거절하지 않음)
--   · 이월 줄(`carried_from_invoice_id`) - 지난 장의 남은 돈을 옮겨 담는 줄입니다
--   · 정정 줄(`is_adjustment`) - 보낸 장을 고치는 줄입니다
--   · 사람이 확인창에서 「한 번 더 청구」를 고른 장(`invoices.allow_duplicate`) - 한 학기에 교재를 두 번 사는 경우
--
-- 코드 검사는 «나쁜 모양»만 잡고 다음 사고는 새 모양으로 옵니다. 그래서 마지막 관문을 모양과 상관없는
-- 곳에 둡니다(동명이인 문지기와 같은 이유, CLAUDE.md §2-4-9).

alter table public.invoices add column if not exists allow_duplicate boolean not null default false;
comment on column public.invoices.allow_duplicate is
  '사람이 확인창에서 「같은 항목을 한 번 더 청구」를 고른 장. 중복 문지기(guard_invoice_line_duplicate)가 이 장은 막지 않습니다.';

create or replace function public.guard_invoice_line_duplicate()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inv record;
  v_month text;
  v_hit text;
begin
  if new.carried_from_invoice_id is not null or coalesce(new.is_adjustment, false) then
    return new;
  end if;
  if new.plan_id is null and new.item_id is null then
    return new;
  end if;

  select id, student_id, term_id, status, allow_duplicate, billing_month, issue_date, carried_to_invoice_id
    into v_inv
  from public.invoices where id = new.invoice_id;
  if v_inv.id is null or v_inv.student_id is null or v_inv.allow_duplicate or v_inv.status <> '발행' then
    return new;
  end if;
  v_month := coalesce(nullif(v_inv.billing_month, ''), to_char(v_inv.issue_date, 'YYYY-MM'));

  if new.plan_id is not null then
    select i2.invoice_no into v_hit
    from public.invoice_lines l2
    join public.invoices i2 on i2.id = l2.invoice_id
    where l2.plan_id = new.plan_id
      and l2.carried_from_invoice_id is null
      and not coalesce(l2.is_adjustment, false)
      and i2.id <> v_inv.id
      and i2.student_id = v_inv.student_id
      and i2.status = '발행'
      and i2.carried_to_invoice_id is null
      and coalesce(nullif(i2.billing_month, ''), to_char(i2.issue_date, 'YYYY-MM')) = v_month
    limit 1;
    if v_hit is not null then
      raise exception '같은 달(%)의 같은 학비 항목이 이미 청구서 %에 있습니다. 그 장을 취소한 뒤 다시 발행해주세요.', v_month, v_hit
        using errcode = 'unique_violation';
    end if;
  end if;

  if new.item_id is not null then
    select i2.invoice_no into v_hit
    from public.invoice_lines l2
    join public.invoices i2 on i2.id = l2.invoice_id
    where l2.item_id = new.item_id
      and l2.carried_from_invoice_id is null
      and not coalesce(l2.is_adjustment, false)
      and i2.id <> v_inv.id
      and i2.student_id = v_inv.student_id
      and i2.status = '발행'
      and i2.carried_to_invoice_id is null
      and not i2.allow_duplicate
      and (v_inv.term_id is null or i2.term_id is null or i2.term_id = v_inv.term_id)
    limit 1;
    if v_hit is not null then
      raise exception '같은 학기의 같은 항목이 이미 청구서 %에 있습니다. 정말 한 번 더 청구하는 것이면 확인창에서 고른 뒤 다시 발행해주세요.', v_hit
        using errcode = 'unique_violation';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists invoice_lines_duplicate_guard on public.invoice_lines;
create trigger invoice_lines_duplicate_guard
  before insert on public.invoice_lines
  for each row execute function public.guard_invoice_line_duplicate();

-- ── 이미 쌓인 중복을 보이게 ────────────────────────────────────────────────
--
-- 문지기는 앞으로 들어오는 줄만 막습니다. 이미 두 장에 걸쳐 있는 것은 이 뷰가 띄웁니다(개발자 › 진단,
-- 재무 「이번 달」). 비어 있어야 정상입니다. 학비는 항목 번호가 남은 줄(v0.731.0 이후)만 셉니다.
create or replace view public.invoice_duplicate_lines as
with live as (
  select l.id as line_id, l.name, l.plan_id, l.item_id, i.id as invoice_id, i.invoice_no, i.student_id,
         coalesce(i.student_name_ko, i.student_name) as student_name, i.term_id,
         coalesce(nullif(i.billing_month, ''), to_char(i.issue_date, 'YYYY-MM')) as month
  from public.invoice_lines l
  join public.invoices i on i.id = l.invoice_id
  where i.status = '발행'
    and i.carried_to_invoice_id is null
    and not i.allow_duplicate
    and l.carried_from_invoice_id is null
    and not coalesce(l.is_adjustment, false)
    and i.student_id is not null
)
select a.student_id, a.student_name, a.name as item_name, '학비'::text as stream, a.month as period,
       a.invoice_no as invoice_a, b.invoice_no as invoice_b
from live a join live b
  on a.student_id = b.student_id and a.plan_id = b.plan_id and a.month = b.month and a.invoice_id < b.invoice_id
where a.plan_id is not null
union all
select a.student_id, a.student_name, a.name, '학비외', coalesce(a.term_id::text, '학기 미지정'),
       a.invoice_no, b.invoice_no
from live a join live b
  on a.student_id = b.student_id and a.item_id = b.item_id
 and (a.term_id is null or b.term_id is null or a.term_id = b.term_id)
 and a.invoice_id < b.invoice_id
where a.item_id is not null;

alter view public.invoice_duplicate_lines set (security_invoker = on);
revoke all on public.invoice_duplicate_lines from anon;
comment on view public.invoice_duplicate_lines is
  '같은 학생의 같은 항목이 살아 있는 청구서 두 장에 걸려 있는 줄. 비어 있어야 정상입니다.';

notify pgrst, 'reload schema';
