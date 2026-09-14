-- **청구 금액은 한 곳에서만 정해집니다.**
--
-- ── 무엇이 위험한가 ────────────────────────────────────────────────────────
--
-- 같은 금액이 **두 곳에** 있습니다.
--
--   · `invoice_lines.amount` — 항목마다 얼마
--   · `invoices.total_amount` — 그 합계
--
-- 지금은 둘이 맞습니다(실측 7장·20줄 전부 일치). 맞는 이유는 **발행 API 한 곳에서만** 넣기
-- 때문이고, 다른 데서 항목을 고칠 길이 아직 없었기 때문입니다.
--
-- 그런데 항목을 고칠 자리는 생깁니다 - 금액을 잘못 적었거나, 한 항목을 빼야 하거나, 교재를
-- 하나 더 넣어야 합니다. 그 자리를 만드는 순간 **합계를 같이 고치는 것을 잊는 날이 반드시
-- 옵니다.** 그리고 그건 오류로 안 보입니다 - 청구서에는 항목이 3줄인데 합계는 4줄짜리로
-- 찍히고, 학부모는 그 합계로 결제합니다. 돈 이야기에서 가장 나쁜 실패입니다.
--
-- ── 그래서 데이터베이스가 맞춥니다 ─────────────────────────────────────────
--
-- 코드가 고치든, SQL 로 고치든, 나중에 만들 화면에서 고치든 **항목이 바뀌면 합계가 저절로
-- 따라갑니다.** 코드로만 막으면 화면 하나를 빠뜨렸을 때 드러나지 않습니다(CLAUDE.md 2-5 와
-- 같은 이유).
--
-- 합계를 따로 안 두고 그때그때 세는 방법도 있지만, 그러면 청구서를 읽는 모든 자리가 내역까지
-- 함께 읽어야 합니다. 청구서 목록은 하루에도 여러 번 그리는 화면이라 그 대가가 큽니다.
-- 값은 그대로 두되 **틀릴 수 없게** 만드는 편이 낫습니다.

-- ── ① 금액이 바뀐 내력 ─────────────────────────────────────────────────────
--
-- 돈이 바뀌면 **왜 바뀌었는지 물어볼 곳**이 있어야 합니다. 합계만 조용히 달라지면, 나중에
-- 장부가 안 맞을 때 어디서부터 어긋났는지 되짚을 수가 없습니다.
create table if not exists public.invoice_amount_log (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  invoice_no text,
  before_amount numeric(12, 2),
  after_amount numeric(12, 2),
  -- 무엇 때문에 바뀌었나. 트리거가 적으므로 사람 이름이 아니라 **계기**를 적습니다.
  reason text,
  changed_at timestamptz not null default now()
);

create index if not exists invoice_amount_log_invoice_idx
  on public.invoice_amount_log (invoice_id, changed_at desc);

comment on table public.invoice_amount_log is
  '청구 합계가 바뀐 내력. 항목이 바뀌면 트리거가 합계를 다시 세고 그 사실을 여기 남깁니다.';

alter table public.invoice_amount_log enable row level security;
drop policy if exists invoice_amount_log_select on public.invoice_amount_log;
-- 돈에 관한 기록이라 재무 열쇠를 가진 사람만 봅니다(CLAUDE.md 2-8).
create policy invoice_amount_log_select on public.invoice_amount_log
  for select using (public.is_finance_user());
-- 넣는 것은 트리거(정의자 권한)만 합니다. 사람이 손으로 적을 일이 없습니다.

-- ── ② 합계를 다시 세는 함수 ────────────────────────────────────────────────
create or replace function public.recalc_invoice_total(p_invoice_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_before numeric(12, 2);
  v_after  numeric(12, 2);
  v_no     text;
begin
  select total_amount, invoice_no into v_before, v_no
    from public.invoices where id = p_invoice_id;
  -- 청구서가 이미 지워졌으면 할 일이 없습니다(내역은 cascade 로 함께 사라집니다).
  if not found then return; end if;

  select coalesce(sum(amount), 0) into v_after
    from public.invoice_lines where invoice_id = p_invoice_id;

  -- 같으면 손대지 않습니다. 매번 쓰면 updated_at 이 흔들리고 기록이 쓸데없이 쌓입니다.
  if v_before is not distinct from v_after then return; end if;

  update public.invoices set total_amount = v_after where id = p_invoice_id;

  insert into public.invoice_amount_log (invoice_id, invoice_no, before_amount, after_amount, reason)
  values (p_invoice_id, v_no, v_before, v_after, p_reason);
end;
$$;

comment on function public.recalc_invoice_total(uuid, text) is
  '청구 합계를 내역에서 다시 셉니다. 값이 바뀔 때만 쓰고, 바뀐 내력을 남깁니다.';

-- ── ③ 항목이 바뀌면 합계가 따라갑니다 ──────────────────────────────────────
create or replace function public.sync_invoice_total()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    perform public.recalc_invoice_total(old.invoice_id, '항목 삭제');
    return old;
  end if;

  -- 항목을 **다른 청구서로 옮긴** 경우에는 양쪽을 다시 셉니다. 새 쪽만 세면 옛 청구서에
  -- 그 금액이 남아 있고, 그 청구서는 영영 과다청구로 남습니다.
  if tg_op = 'UPDATE' and old.invoice_id is distinct from new.invoice_id then
    perform public.recalc_invoice_total(old.invoice_id, '항목 이동(나감)');
  end if;

  perform public.recalc_invoice_total(
    new.invoice_id,
    case tg_op when 'INSERT' then '항목 추가' else '항목 수정' end
  );
  return new;
end;
$$;

drop trigger if exists trg_sync_invoice_total on public.invoice_lines;
create trigger trg_sync_invoice_total
  after insert or update or delete on public.invoice_lines
  for each row execute function public.sync_invoice_total();

-- ── ④ 지금 어긋난 줄이 있으면 맞춥니다 ─────────────────────────────────────
--
-- 실측에서는 전부 일치했지만, 맞추는 일은 값이 바뀔 때만 기록을 남기므로 이미 맞는 줄에는
-- 아무 일도 일어나지 않습니다. 어긋난 줄이 하나라도 있으면 여기서 드러납니다.
do $$
declare r record;
begin
  for r in
    select i.id
      from public.invoices i
      left join (
        select invoice_id, sum(amount) as s from public.invoice_lines group by invoice_id
      ) l on l.invoice_id = i.id
     where i.total_amount is distinct from coalesce(l.s, 0)
       -- 내역이 아예 없는 청구서는 건드리지 않습니다. 옛 방식으로 합계만 적어 둔 줄이
       -- 있을 수 있고, 그것을 0 으로 만들면 멀쩡한 청구서가 사라집니다.
       and exists (select 1 from public.invoice_lines x where x.invoice_id = i.id)
  loop
    perform public.recalc_invoice_total(r.id, '기존 줄 맞춤(마이그레이션)');
  end loop;
end $$;

-- ── ⑤ 어긋난 것이 있으면 화면에서 보입니다 ─────────────────────────────────
--
-- 트리거가 있어도 **누군가 트리거를 끄고 손댈 수** 있습니다. 그런 일이 있었는지를 사람이
-- 언제든 확인할 수 있어야 합니다 - 확인할 방법이 없는 규칙은 지켜지는 것처럼 보일 뿐입니다.
create or replace view public.invoice_total_mismatch as
select
  i.id,
  i.invoice_no,
  i.student_name_ko,
  i.status,
  i.total_amount            as saved_total,
  coalesce(l.s, 0)          as line_total,
  i.total_amount - coalesce(l.s, 0) as gap
from public.invoices i
left join (
  select invoice_id, sum(amount) as s from public.invoice_lines group by invoice_id
) l on l.invoice_id = i.id
where exists (select 1 from public.invoice_lines x where x.invoice_id = i.id)
  and i.total_amount is distinct from coalesce(l.s, 0);

comment on view public.invoice_total_mismatch is
  '합계와 내역이 어긋난 청구서. 비어 있어야 정상입니다 - 한 줄이라도 있으면 그 청구서는 학부모가 받은 금액과 우리 장부가 다릅니다.';

-- rls-ok: 뷰는 바탕 표(invoices·invoice_lines)의 RLS를 그대로 따릅니다. 재무 열쇠가 없으면
-- 바탕 표를 못 읽으므로 이 뷰도 빈 결과를 봅니다.
