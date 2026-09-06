-- ===== 납부 수단과 현금영수증 =====
--
-- 지금까지 수납은 사실상 **올톡페이 한 길**만 다뤘습니다. `method` 칸은 자유 글자라 무엇이든
-- 적을 수 있었지만, 화면에서 넣는 값은 '올톡페이'와 '수기' 둘뿐이었습니다.
--
-- 실제로는 네 갈래로 들어옵니다.
--
--   · 올톡페이   — 카톡·문자로 보낸 청구서를 학부모가 결제
--   · 방문 카드  — 행정실에서 단말기로 긁는 경우
--   · 계좌이체   — 통장으로 바로
--   · 현금       — 봉투로 들고 오시는 경우
--
-- 뒤 셋은 «수기»라는 한 덩어리에 뭉쳐 있었습니다. 그러면 월말에 «카드로 얼마, 현금으로
-- 얼마»를 셀 수 없고, 현금영수증을 발행해야 하는 건이 어느 것인지도 알 수 없습니다.
--
-- 값을 고정해 둡니다. 자유 글자로 두면 «현금», «현금납부», «cash» 가 섞이고 그러면 세는
-- 것이 다시 사람 일이 됩니다.

alter table public.payments
  add column if not exists method_kind text;

update public.payments
   set method_kind = case
     when method = '올톡페이' then '올톡페이'
     when method like '%카드%' then '방문카드'
     when method like '%이체%' or method like '%계좌%' then '계좌이체'
     when method like '%현금%' then '현금'
     else '기타'
   end
 where method_kind is null;

alter table public.payments
  drop constraint if exists payments_method_kind_ok;
alter table public.payments
  add constraint payments_method_kind_ok
  check (method_kind is null or method_kind in ('올톡페이', '방문카드', '계좌이체', '현금', '기타'));

comment on column public.payments.method_kind is
  '납부 수단(고정값). 자유 글자 method 와 달리 집계에 쓸 수 있습니다.';


-- ── 현금영수증 ──────────────────────────────────────────────────────────────
--
-- 현금·계좌이체로 받으면 학부모가 현금영수증을 요청합니다. 지금은 그 요청이 카톡이나
-- 구두로 오가고, 발행 여부는 담당자 기억에 있습니다. 연말정산 철에 «해주셨어요?»라는
-- 문의가 오면 확인할 방법이 없습니다.
--
-- **발행 자체는 홈택스에서 합니다.** 국세청 API 연동은 사업자 인증서와 별도 신청이 필요해
-- 지금 바로는 안 됩니다. 그래서 여기서는 «누가 무엇으로 신청했고, 발행됐는가»만 남기고
-- 화면에서 홈택스로 바로 건너가게 합니다.
--
-- 남기는 것이 요점입니다 - 기억에만 있으면 확인할 수 없고, 확인할 수 없으면 결국 두 번
-- 발행하거나 아예 못 합니다.

create table if not exists public.cash_receipts (
  id uuid primary key default gen_random_uuid(),

  payment_id uuid references public.payments(id) on delete cascade,
  invoice_id uuid references public.invoices(id) on delete set null,
  student_id uuid references public.wr_students(id) on delete set null,

  -- 소득공제(개인) / 지출증빙(사업자). 발행 구분이 달라 반드시 물어야 합니다.
  purpose text not null default '소득공제' check (purpose in ('소득공제', '지출증빙')),

  -- 휴대폰번호 또는 사업자등록번호. 어느 쪽인지는 purpose 로 압니다.
  identifier text not null,
  amount numeric(12, 2) not null check (amount > 0),

  -- 신청 / 발행 / 취소
  status text not null default '신청' check (status in ('신청', '발행', '취소')),
  issued_at date,
  -- 홈택스가 준 승인번호. 이게 있어야 «정말 나갔다»가 증명됩니다.
  approval_no text,
  note text,

  requested_by text,
  issued_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists cash_receipts_payment_idx on public.cash_receipts (payment_id);
create index if not exists cash_receipts_student_idx on public.cash_receipts (student_id);
-- 아직 발행 안 한 것을 찾는 조회가 가장 잦습니다.
create index if not exists cash_receipts_status_idx on public.cash_receipts (status) where status = '신청';

alter table public.cash_receipts enable row level security;

-- 돈에 관한 자료입니다. 재무 권한이 있는 사람만 봅니다 - 이 판단은 이미 invoices·payments 가
-- 쓰고 있는 함수와 같은 것을 씁니다. 두 벌로 만들면 한쪽만 고치고 다른 쪽을 잊습니다.
drop policy if exists cash_receipts_rw on public.cash_receipts;
create policy cash_receipts_rw on public.cash_receipts
  for all using (public.has_finance_access()) with check (public.has_finance_access());

comment on table public.cash_receipts is
  '현금영수증 신청·발행 기록. 발행은 홈택스에서 하고, 여기에는 누가 무엇으로 신청했고 언제 발행됐는지를 남깁니다.';
