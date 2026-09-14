-- **올톡페이 결제내역 올리기 — 사람이 검수한 뒤에 반영합니다.**
--
-- ── 왜 바로 반영하지 않나 ──────────────────────────────────────────────────
--
-- 실측에서 올톡페이 285건 중 **249건(87%)만 자동으로 학생에 붙습니다.** 나머지 36건은
-- 고객명 칸이 자유 글자라 못 붙습니다 - 「강하라/치과진료비12,900원포함」·「홍선우(클라리넷)」
-- 처럼 사유가 이름 칸에 섞여 있고, 「류연진쌤」·「애니원감님」처럼 학생이 아닌 줄도 있습니다.
--
-- 그리고 형제 14쌍이 **번호를 함께 씁니다**(황라윤·황준호·황라원이 한 번호). 번호만으로는
-- 누구 건지 못 가릅니다.
--
-- 87% 가 맞는다고 바로 반영하면, 틀린 13% 는 **남의 아이 계좌에 남의 돈이 붙은 채로**
-- 화면에 «정상»으로 보입니다. 돈에서 이건 되돌리기가 가장 어려운 종류의 사고입니다.
--
-- 그래서 두 표로 나눕니다. **올린 것은 여기까지만 들어오고, 승인한 줄만 실제 표로 나갑니다.**
--
-- ── 왜 표를 따로 두나 ──────────────────────────────────────────────────────
--
-- 화면 상태로만 들고 있으면 검수하다 창을 닫는 순간 사라집니다. 285줄을 한 번에 다 볼
-- 수는 없고, 며칠에 걸쳐 나눠 보게 됩니다. 그 사이에 다른 사람이 이어서 볼 수도 있어야
-- 합니다.

create table if not exists public.payment_imports (
  id uuid primary key default gen_random_uuid(),
  source text not null default '올톡페이',
  file_name text not null,
  uploaded_by text not null,
  uploaded_at timestamptz not null default now(),
  -- 검수중 → 반영됨 / 버림. **반영됨은 되돌아가지 않습니다** - 이미 실제 표에 나갔습니다.
  status text not null default '검수중' check (status in ('검수중', '반영됨', '버림')),
  applied_at timestamptz,
  applied_by text,
  note text
);

comment on table public.payment_imports is
  '올톡페이에서 받은 결제내역 파일 한 벌. 올리면 여기 들어오고, 승인한 줄만 invoices·payments 로 나갑니다.';

create table if not exists public.payment_import_rows (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.payment_imports(id) on delete cascade,
  seq int not null,

  -- ── 파일에 적힌 그대로 ────────────────────────────────────────────────
  -- **원문을 고치지 않고 담습니다.** 다듬은 값만 두면 나중에 「파일에는 뭐라고 적혀
  -- 있었지」에 답할 수 없고, 판정이 틀렸을 때 무엇 때문인지 알 수 없습니다.
  raw_name text,
  raw_phone text,
  raw_why text,
  amount bigint not null,
  issued_at date,
  atp_status text,
  paid_at date,
  method text,
  card text,
  approval_no text,

  -- ── 앱이 낸 판정 ──────────────────────────────────────────────────────
  item_name text,
  stream text,
  match_kind text not null check (match_kind in ('자동', '확인필요', '못찾음')),
  suggested_student_id uuid references public.wr_students(id) on delete set null,
  match_why text,
  plan text not null check (plan in ('청구서 만들고 수납', '청구서만 만들기(미납)', '수납만 붙이기', '건너뜀')),
  -- 같은 파일을 두 번 올려도 같은 돈이 두 번 들어가지 않게 하는 열쇠.
  source_key text not null,

  -- ── 사람이 정한 것 ────────────────────────────────────────────────────
  -- 기본은 **대기**입니다. 아무도 안 본 줄이 저절로 나가면 검수하는 뜻이 없습니다.
  decision text not null default '대기' check (decision in ('대기', '승인', '보류', '건너뜀')),
  decided_student_id uuid references public.wr_students(id) on delete set null,
  decided_by text,
  decided_at timestamptz,
  reviewer_note text,

  -- ── 반영 결과 ─────────────────────────────────────────────────────────
  applied_invoice_id uuid references public.invoices(id) on delete set null,
  applied_payment_id uuid references public.payments(id) on delete set null,
  applied_at timestamptz,
  -- 실패한 줄은 **이유를 남깁니다.** 조용히 빠지면 며칠 뒤에 그 학생만 비어 있는 것을
  -- 발견하는데, 그때는 왜 빠졌는지 알 수 없습니다(CLAUDE.md 5).
  apply_error text
);

comment on table public.payment_import_rows is
  '올린 파일의 줄 하나. 승인한 줄만 invoices·payments 로 나갑니다 - 여기 있는 것만으로는 어떤 집계에도 안 잡힙니다.';

create unique index if not exists payment_import_rows_seq_uniq
  on public.payment_import_rows (batch_id, seq);

create index if not exists payment_import_rows_batch_idx on public.payment_import_rows (batch_id);
-- 같은 줄을 다른 묶음에서 또 반영하지 않았는지 화면이 물어볼 때 씁니다.
create index if not exists payment_import_rows_source_key_idx on public.payment_import_rows (source_key);

-- ── 청구서에도 열쇠를 답니다 ──────────────────────────────────────────────
--
-- `payments.source_key` 는 이미 있고 유일 색인이 걸려 있어 **같은 입금이 두 번 들어갈 수
-- 없습니다.** 그런데 청구서에는 그런 열쇠가 없어서, 같은 파일을 두 번 반영하면 청구서만
-- 두 장이 됩니다 - 그러면 그 학생의 미납이 두 배로 보입니다.
alter table public.invoices add column if not exists import_source_key text;

create unique index if not exists invoices_import_source_key_uniq
  on public.invoices (import_source_key)
  where import_source_key is not null;

comment on column public.invoices.import_source_key is
  '올린 파일에서 만들어진 청구서의 열쇠. 같은 줄로 두 번 만들 수 없습니다.';

-- ── 자물쇠 ────────────────────────────────────────────────────────────────
--
-- 돈에 관한 표입니다. 화면에서 안 보여주는 것은 예의이지 자물쇠가 아닙니다(CLAUDE.md 2-8).
alter table public.payment_imports enable row level security;
drop policy if exists payment_imports_all on public.payment_imports;
create policy payment_imports_all on public.payment_imports
  for all using (public.is_finance_user()) with check (public.is_finance_user());

alter table public.payment_import_rows enable row level security;
drop policy if exists payment_import_rows_all on public.payment_import_rows;
create policy payment_import_rows_all on public.payment_import_rows
  for all using (public.is_finance_user()) with check (public.is_finance_user());

-- ── 반영한 줄은 고칠 수 없습니다 ──────────────────────────────────────────
--
-- 이미 실제 표에 나간 줄의 판정을 나중에 바꾸면, **여기 적힌 것과 실제 청구서·입금이
-- 달라집니다.** 그건 오류로 안 보이고 「이상한 기록」으로만 보입니다. 고쳐야 하면 나간
-- 청구서를 취소하거나 환불로 되돌립니다 - 그 길은 이미 있습니다.
create or replace function public.block_applied_import_row()
returns trigger
language plpgsql
as $$
begin
  if old.applied_at is not null
     and (new.decision is distinct from old.decision
          or new.decided_student_id is distinct from old.decided_student_id
          or new.amount is distinct from old.amount) then
    raise exception '이미 반영된 줄입니다. 고치려면 그 청구서를 취소하거나 환불로 되돌려주세요.'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_block_applied_import_row on public.payment_import_rows;
create trigger trg_block_applied_import_row
  before update on public.payment_import_rows
  for each row execute function public.block_applied_import_row();

-- ── 어디까지 봤나 ─────────────────────────────────────────────────────────
--
-- 285줄을 한 번에 다 볼 수는 없습니다. 며칠에 걸쳐 나눠 보게 되고, 다른 사람이 이어서 볼
-- 수도 있습니다. 그러려면 **남은 줄이 몇 개인지가 한눈에** 보여야 합니다.
create or replace view public.payment_import_progress as
select
  b.id                                                as batch_id,
  b.file_name,
  b.status,
  b.uploaded_by,
  b.uploaded_at,
  count(r.*)                                          as rows_total,
  count(*) filter (where r.decision = '대기')          as waiting,
  count(*) filter (where r.decision = '승인')          as approved,
  count(*) filter (where r.decision = '보류')          as held,
  count(*) filter (where r.decision = '건너뜀')        as skipped,
  count(*) filter (where r.applied_at is not null)     as applied,
  count(*) filter (where r.apply_error is not null)    as failed,
  count(*) filter (where r.match_kind <> '자동')       as need_person,
  coalesce(sum(r.amount) filter (where r.decision = '승인'), 0) as approved_amount
from public.payment_imports b
left join public.payment_import_rows r on r.batch_id = b.id
group by b.id;

comment on view public.payment_import_progress is
  '묶음별 검수 진행. 남은 줄이 몇 개인지가 한눈에 보여야 며칠에 걸쳐 나눠 볼 수 있습니다.';

-- rls-ok: 뷰는 바탕 표(payment_imports·payment_import_rows)의 RLS를 그대로 따릅니다.
