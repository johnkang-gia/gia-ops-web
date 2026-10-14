-- ===== 자리 등록 기록으로 보유 권수를 다시 세기 =====
--
-- 요청: "지금 원래 있던 장서에 계속 추가가 되고 있더라고. 이 부분 계산해서 정상으로 돌려주고,
-- 장서에 맞게끔 분류된 걸로 체크하고 등록된 장서를 넘으면 추가 장서로 등록해줘. 그래야 장서
-- 관리가 제대로 되지. 자리 등록 로그를 분석해서 다시 제대로 계산해서 저장해줘. 안 그러면 전부
-- 다시 다 찍어야 하잖아."
--
-- ── 무엇이 잘못됐나 ────────────────────────────────────────────────────────
-- 자리 등록에서 같은 책이 또 찍히면 '장서추가'를 물었고, 누르면 lib_books.total_copies 가
-- 한 권 올라갔습니다. 그런데 3권짜리 책이 책장에서 세 권 나오는 것은 **새로운 사실이
-- 아닙니다.** 세는 동안 누른 '장서추가'만큼 보유 권수가 부풀었습니다.
--
-- 앱 쪽 규칙은 고쳤습니다(src/lib/shelfCount.ts): 적힌 권수 안에서는 묻지 않고 세고, 넘기는
-- 순간에만 묻습니다. 이 파일은 **이미 부풀어 버린 숫자**를 되돌립니다. 다시 다 찍지 않아도
-- 되는 이유는, 그동안 찍은 것이 lib_shelf_check 에 (책, 칸)마다 남아 있기 때문입니다.
--
-- ── 무엇을 참인 값으로 보는가 ──────────────────────────────────────────────
-- 사람이 책장을 비우며 손으로 센 숫자(lib_shelf_check.copies 의 합)입니다. total_copies 는
-- 등록할 때 적어 둔 숫자이고, 자리 등록은 그것을 처음으로 **실제로 세어 본** 일입니다.
--
--   맞출 권수 = greatest( 1,
--                        센 권수 + 세기 전부터 대출 중이던 권수,
--                        지금 대출 중인 권수 )
--
--   · "센 권수"는 찍어서 센 것이므로 그대로 믿습니다.
--   · 그 칸을 찍기 **전부터** 대출 나가 있던 책은 칸에 없었으니 세어지지 않았습니다. 그 몫은
--     더해 줍니다. 찍은 **뒤에** 나간 책은 칸에서 이미 세어졌으므로 더하지 않습니다(더하면
--     한 권을 두 번 셉니다). 가름선은 그 책을 처음 찍은 시각입니다.
--   · 마지막 줄은 안전선입니다. "대출 가능 권수 = total_copies - 대출중 건수"(20260821000000)
--     이므로 보유 권수가 대출 중인 권수보다 적어지면 음수가 나옵니다. 그런 일은 막습니다.
--
-- ── 아직 안 찍은 책은 건드리지 않습니다 ────────────────────────────────────
-- lib_shelf_check 에 줄이 없는 책은 세어 본 적이 없다는 뜻입니다. 그런 책의 숫자는 등록할 때
-- 적은 것뿐이지만, 아무 근거 없이 1권으로 깎는 것보다는 그대로 두는 쪽이 맞습니다.
--
-- 아직 안 돈 칸에 같은 책이 더 있으면 지금은 적게 잡힙니다. 그 칸을 찍는 순간 적힌 권수를
-- 넘으므로 앱이 '장서추가'를 묻고, 누르면 그때 올라갑니다 - 요청대로 "등록된 장서를 넘으면
-- 추가 장서로". 스스로 메워집니다.
--
-- ── 되돌릴 수 있게 ─────────────────────────────────────────────────────────
-- 바꾼 줄은 전부 lib_holdings_fix 에 바꾸기 전 값과 함께 남깁니다. 한 번에 되돌리는 길도
-- 함께 둡니다(lib_holdings_recount_revert). 남의 자료를 숫자만 고쳐 놓고 돌릴 길이 없으면
-- 그건 고친 게 아닙니다.

-- ── 번호를 20261129 로 잡은 이유 ──────────────────────────────────────────
-- 같은 저장소를 둘이 함께 쓰므로 새 마이그레이션은 폴더에 있는 모든 파일보다 뒤 번호여야
-- 합니다. 지금 가장 뒤는 20261128000000_invoice_duplicate_guard.sql 입니다.

-- ── ① 바꾼 내역 ───────────────────────────────────────────────────────────
create table if not exists public.lib_holdings_fix (
  id uuid primary key default gen_random_uuid(),
  -- 한 번에 맞춘 묶음. 되돌릴 때 이 값으로 묶어서 돌립니다.
  batch uuid not null,
  book_id uuid not null references public.lib_books(id) on delete cascade,
  before_copies integer not null,
  after_copies integer not null,
  -- 그때 세어져 있던 숫자들. 나중에 "왜 이렇게 바꿨나"를 다시 설명할 수 있어야 합니다.
  counted_copies integer not null,
  loans_out integer not null default 0,
  loans_before integer not null default 0,
  shelf_rows integer not null default 0,
  reason text not null default '자리 등록 기록으로 다시 셈',
  fixed_at timestamptz not null default now(),
  fixed_by text,
  -- 되돌린 줄은 지우지 않고 표시만 합니다. 되돌린 사실도 기록입니다.
  reverted_at timestamptz
);

comment on table public.lib_holdings_fix is
  '보유 권수를 자리 등록 기록에 맞춰 바꾼 내역. before_copies 로 되돌릴 수 있습니다.';

create index if not exists lib_holdings_fix_batch_idx
  on public.lib_holdings_fix (batch, fixed_at desc);
create index if not exists lib_holdings_fix_book_idx
  on public.lib_holdings_fix (book_id, fixed_at desc);

alter table public.lib_holdings_fix enable row level security;

drop policy if exists lib_all_holdings_fix on public.lib_holdings_fix;
create policy lib_all_holdings_fix on public.lib_holdings_fix
  for all using (public.is_lib_user()) with check (public.is_lib_user());

-- ── ② 맞출 권수를 계산하는 뷰 ─────────────────────────────────────────────
-- 화면과 아래 두 함수가 모두 이 뷰 하나만 봅니다. 계산이 한 군데에만 있어야 화면에 보이는
-- 숫자와 실제로 저장되는 숫자가 어긋나지 않습니다.
drop view if exists public.lib_holdings_recount;
create view public.lib_holdings_recount as
with counted as (
  select
    c.book_id,
    sum(c.copies)::integer as counted_copies,
    count(*)::integer      as shelf_rows,
    min(c.checked_at)      as first_checked_at,
    max(c.checked_at)      as last_checked_at,
    string_agg(l.code || ' ' || c.copies || '권', ' · ' order by l.sort_order, l.code) as shelves
  from public.lib_shelf_check c
  join public.lib_locations l on l.id = c.location_id
  group by c.book_id
),
loans as (
  select
    ln.book_id,
    count(*)::integer as loans_out,
    count(*) filter (where ln.borrowed_at < ct.first_checked_at)::integer as loans_before
  from public.lib_loans ln
  join counted ct on ct.book_id = ln.book_id
  where ln.returned_at is null and ln.status = '대출중'
  group by ln.book_id
)
select
  b.id                           as book_id,
  b.title,
  b.author,
  b.isbn,
  b.item_code,
  b.label_level,
  b.total_copies                 as recorded_copies,
  ct.counted_copies,
  ct.shelf_rows,
  ct.shelves,
  ct.first_checked_at,
  ct.last_checked_at,
  coalesce(lo.loans_out, 0)      as loans_out,
  coalesce(lo.loans_before, 0)   as loans_before,
  greatest(
    1,
    ct.counted_copies + coalesce(lo.loans_before, 0),
    coalesce(lo.loans_out, 0)
  )::integer                     as suggested_copies
from public.lib_books b
join counted ct on ct.book_id = b.id
left join loans lo on lo.book_id = b.id;

-- 뷰는 만든 사람의 권한으로 돌고 Supabase 는 public 뷰를 anon 에게도 엽니다(운영앱 2-8).
alter view public.lib_holdings_recount set (security_invoker = on);
revoke all on public.lib_holdings_recount from anon;

comment on view public.lib_holdings_recount is
  '자리 등록에서 센 권수로 본 보유 권수. suggested_copies <> recorded_copies 인 줄이 고칠 줄입니다.';

-- ── ③ 지금 한 번 맞춥니다 ─────────────────────────────────────────────────
-- 요청: "다시 제대로 계산해서 저장해줘." 마이그레이션은 도서관 계정이 아니라 관리자 권한으로
-- 돌기 때문에 아래 함수(is_lib_user 로 막아 둔)를 쓰지 않고 그대로 씁니다.
do $$
declare
  v_batch uuid := gen_random_uuid();
  v_changed integer := 0;
begin
  with todo as (
    select
      r.book_id,
      r.recorded_copies,
      r.suggested_copies,
      r.counted_copies,
      r.loans_out,
      r.loans_before,
      r.shelf_rows
    from public.lib_holdings_recount r
    where r.suggested_copies <> r.recorded_copies
  ),
  logged as (
    insert into public.lib_holdings_fix
      (batch, book_id, before_copies, after_copies, counted_copies, loans_out, loans_before,
       shelf_rows, fixed_by)
    select
      v_batch, t.book_id, t.recorded_copies, t.suggested_copies, t.counted_copies, t.loans_out,
      t.loans_before, t.shelf_rows, 'migration 20261129000000'
    from todo t
    returning book_id, after_copies
  )
  update public.lib_books b
     set total_copies = l.after_copies,
         updated_at = now()
    from logged l
   where l.book_id = b.id;

  get diagnostics v_changed = row_count;
  raise notice '보유 권수를 다시 센 책: %권 묶음 % ', v_changed, v_batch;
end $$;

-- ── ④ 앱에서 다시 맞추기 / 되돌리기 ───────────────────────────────────────
-- 칸을 더 돌고 나면 또 어긋날 수 있습니다(그 사이 등록 화면에서 권수가 올라간 책 등). 그때
-- 마이그레이션을 또 쓸 수는 없으니 버튼 하나로 다시 돌릴 수 있게 함수로 둡니다.
create or replace function public.lib_holdings_recount_apply(p_by text default null)
returns table (batch uuid, changed integer)
language plpgsql
set search_path = public
as $$
declare
  v_batch uuid := gen_random_uuid();
  v_changed integer := 0;
begin
  -- 함수는 부르는 사람의 권한으로 돕니다(security invoker). 그래도 한 번 더 막습니다.
  if not public.is_lib_user() then
    raise exception '도서관 계정만 보유 권수를 맞출 수 있습니다.';
  end if;

  with todo as (
    select
      r.book_id, r.recorded_copies, r.suggested_copies, r.counted_copies,
      r.loans_out, r.loans_before, r.shelf_rows
    from public.lib_holdings_recount r
    where r.suggested_copies <> r.recorded_copies
  ),
  logged as (
    insert into public.lib_holdings_fix
      (batch, book_id, before_copies, after_copies, counted_copies, loans_out, loans_before,
       shelf_rows, fixed_by)
    select
      v_batch, t.book_id, t.recorded_copies, t.suggested_copies, t.counted_copies, t.loans_out,
      t.loans_before, t.shelf_rows, p_by
    from todo t
    returning book_id, after_copies
  )
  update public.lib_books b
     set total_copies = l.after_copies,
         updated_at = now()
    from logged l
   where l.book_id = b.id;

  get diagnostics v_changed = row_count;
  return query select v_batch, v_changed;
end $$;

comment on function public.lib_holdings_recount_apply(text) is
  '자리 등록에서 센 권수에 맞춰 lib_books.total_copies 를 맞춥니다. 바꾼 내역은 lib_holdings_fix 에 남습니다.';

create or replace function public.lib_holdings_recount_revert(p_batch uuid)
returns integer
language plpgsql
set search_path = public
as $$
declare
  v_n integer := 0;
begin
  if not public.is_lib_user() then
    raise exception '도서관 계정만 되돌릴 수 있습니다.';
  end if;

  with back as (
    update public.lib_holdings_fix f
       set reverted_at = now()
     where f.batch = p_batch
       and f.reverted_at is null
    returning f.book_id, f.before_copies
  )
  update public.lib_books b
     set total_copies = k.before_copies,
         updated_at = now()
    from back k
   where k.book_id = b.id;

  get diagnostics v_n = row_count;
  return v_n;
end $$;

comment on function public.lib_holdings_recount_revert(uuid) is
  '한 묶음을 바꾸기 전 권수로 되돌립니다. 되돌린 줄은 lib_holdings_fix.reverted_at 에 표시됩니다.';

grant execute on function public.lib_holdings_recount_apply(text) to authenticated;
grant execute on function public.lib_holdings_recount_revert(uuid) to authenticated;

notify pgrst, 'reload schema';
