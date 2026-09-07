-- ===== 현금영수증: 발행은 단말기에서, 관리는 여기서 =====
--
-- 앱에서 국세청으로 바로 쏘는 길(대행사 API)은 두지 않기로 했습니다. 발행 자리에서 바로
-- 처리해야 하는 건이 있고(창구에서 그 자리에서 요청), 개인 휴대폰번호와 사업자등록번호가
-- 섞여 들어와서, 결제 단말기에서 그때그때 누르는 편이 실제로 더 빠릅니다.
--
-- 그래서 이 표의 역할이 바뀝니다. **발행 창구가 아니라 대기 명단**입니다.
--   · 누가 현금영수증을 달라고 했는가
--   · 어느 번호로 끊어야 하는가(휴대폰 / 사업자)
--   · 종이로 뽑아 단말기 앞에 내려보냈는가
--   · 끊었는가
--
-- 지금 구조로는 이 중 두 가지가 안 됩니다.

-- ── 1. 번호 없이 접수할 수 있어야 합니다 ─────────────────────────────────
--
-- 「현금영수증 해주세요」만 오고 번호는 나중에 오는 경우가 있습니다. 지금은 번호가
-- 필수라 그 건을 아예 못 적고, 못 적은 요청은 어디에도 남지 않아 잊힙니다.
--
-- 비워둘 수 있게 하되 **화면에서 「번호 없음」으로 맨 위에 세웁니다.** 조용히 섞여 있으면
-- 종이에 빈칸으로 나가서 단말기 앞에서 막힙니다.
alter table public.cash_receipts alter column identifier drop not null;

-- ── 2. 학생과 못 잇는 요청 ───────────────────────────────────────────────
--
-- 형제를 한 번에 내신 경우, 사업자 명의로 받으시는 경우처럼 학생 한 명에 붙이기 어려운
-- 건이 있습니다. 지금은 학생을 못 고르면 화면에 「학생 미확인」으로만 떠서, 종이에도
-- 누구인지 안 나옵니다. 부를 이름을 그대로 적을 자리를 둡니다.
alter table public.cash_receipts add column if not exists person_name text;

-- ── 3. 종이를 뽑아 내려보낸 시각 ─────────────────────────────────────────
--
-- 뽑아서 단말기에서 다 끊었는데 앱에 체크하는 것을 잊으면, 다음에 뽑을 때 같은 사람이
-- 또 나옵니다. 그러면 **두 번 발행**되고, 두 번 발행된 것은 취소 발행으로만 되돌릴 수
-- 있습니다. 이건 화면 문제가 아니라 세무 문제입니다.
--
-- 「이미 뽑아간 건」이라고 보이면 담당자가 체크를 잊었다는 것을 스스로 알아차립니다.
alter table public.cash_receipts add column if not exists printed_at timestamptz;
alter table public.cash_receipts add column if not exists printed_by text;

comment on column public.cash_receipts.identifier is
  '휴대폰번호(소득공제) 또는 사업자등록번호(지출증빙). 번호를 나중에 받는 경우 비어 있을 수 있습니다.';
comment on column public.cash_receipts.person_name is
  '학생과 잇기 어려운 건에서 부를 이름. 종이와 화면에 그대로 나옵니다.';
comment on column public.cash_receipts.printed_at is
  '단말기 입력용 종이로 뽑은 시각. 뽑았는데 발행 표시가 없는 건을 찾아 이중발행을 막습니다.';

-- 번호가 아직 없는 건을 찾는 조회. 발행 대기 중에서도 이것이 가장 급합니다.
create index if not exists cash_receipts_no_id_idx
  on public.cash_receipts (created_at desc)
  where status = '신청' and identifier is null;
