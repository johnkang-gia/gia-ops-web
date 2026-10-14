-- 예치금 공유 — 형제자매(또는 정해 둔 여러 학생)가 한 통의 예치금을 나눠 씁니다.
--
-- 예치금은 학생 앞으로 남은 입금 줄(`payments.invoice_id is null`)입니다. 형제가 있는 집은 한 아이 이름으로 큰 돈을
-- 맡기고 「둘째 것도 여기서 빼 주세요」라고 합니다. 지금까지는 그 돈이 맡긴 아이의 청구서에서만 빠졌고, 둘째 몫은
-- 손으로 옮겨 적어야 했습니다.
--
-- ── 왜 새 «예치금 통장» 표를 만들지 않았나 ───────────────────────────────────────────────
--
-- 돈을 새 표로 옮기면 같은 돈이 두 곳(입금 줄 + 통장 잔액)에 생기고, 한쪽만 고쳐지는 날 금액이 두 번 쓰입니다.
-- 그래서 돈은 지금처럼 **입금 줄 하나에 한 번만** 있고, 이 파일은 «누구와 누구가 한 통을 쓰는가»만 적습니다.
-- 공유 잔액 = 묶음 안 학생들의 안 붙은 입금 줄 합계. 한 줄은 한 청구서에만 붙을 수 있으므로 둘이 같은 돈을 동시에
-- 쓸 수 없습니다(앱은 붙일 때 `invoice_id is null` 일 때만 고칩니다).
--
-- ── 남의 예치금을 내 청구서에 붙일 때 ──────────────────────────────────────────────────
--
-- 붙은 조각의 `student_id` 는 **청구서 주인**으로 바꾸고, 원래 맡긴 학생을 `shared_from_student_id` 에 남깁니다.
-- 청구서별·학생별 수납 합계가 모두 청구서 주인 기준으로 맞고, 「누구 돈에서 나갔나」는 사용내역서가 이 칸으로 적습니다.
-- 차감을 되돌리면 조각은 원래 주인에게 돌아갑니다.

create table if not exists public.deposit_shares (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  note text,
  created_by text,
  created_at timestamptz not null default now()
);
comment on table public.deposit_shares is
  '예치금 공유 묶음. 묶음 안 학생들의 예치금(안 붙은 입금 줄)을 한 통으로 보고 나눠 씁니다. 돈은 payments 에만 있습니다.';

create table if not exists public.deposit_share_members (
  share_id uuid not null references public.deposit_shares(id) on delete cascade,
  student_id uuid not null references public.wr_students(id) on delete cascade,
  added_by text,
  added_at timestamptz not null default now(),
  primary key (share_id, student_id)
);
-- 한 학생은 한 묶음에만 듭니다. 두 묶음에 들면 같은 돈이 두 통의 잔액에 동시에 잡힙니다.
create unique index if not exists deposit_share_members_one_share on public.deposit_share_members (student_id);
comment on table public.deposit_share_members is '예치금 공유 묶음의 학생. 한 학생은 한 묶음에만 듭니다.';

alter table public.deposit_shares enable row level security;
drop policy if exists deposit_shares_finance_only on public.deposit_shares;
create policy deposit_shares_finance_only on public.deposit_shares
  for all using (public.is_finance_user()) with check (public.is_finance_user());

alter table public.deposit_share_members enable row level security;
drop policy if exists deposit_share_members_finance_only on public.deposit_share_members;
create policy deposit_share_members_finance_only on public.deposit_share_members
  for all using (public.is_finance_user()) with check (public.is_finance_user());

-- 다른 학생의 예치금이 이 청구서에 붙었을 때, 원래 맡긴 학생.
alter table public.payments add column if not exists shared_from_student_id uuid references public.wr_students(id) on delete set null;
comment on column public.payments.shared_from_student_id is
  '공유 예치금에서 다른 학생의 청구서로 붙은 조각이면, 원래 맡긴 학생. student_id 는 청구서 주인입니다.';

-- 예치금에서 청구서로 옮겨 붙은 때. paid_at 은 돈이 처음 들어온 날이라 «언제 빠졌나»를 따로 적습니다.
alter table public.payments add column if not exists deposit_applied_at timestamptz;
comment on column public.payments.deposit_applied_at is '예치금에서 청구서로 차감된 시각. 사용내역서의 날짜입니다.';

notify pgrst, 'reload schema';
