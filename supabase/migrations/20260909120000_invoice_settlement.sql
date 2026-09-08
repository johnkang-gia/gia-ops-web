-- ===== 미납금 회수: 청구 갈래와 이월 =====
--
-- 지금까지 인보이스는 「보냈다」에서 끝났습니다. 낸 돈(payments)은 따로 쌓이고 잔액은
-- 계산으로 냈지만, **안 낸 돈이 다음 달로 넘어가는 길**이 없었습니다. 그래서 미납은
-- 사람이 기억해야 했고, 기억하는 일은 결국 안 하게 됩니다.
--
-- ── ① 청구 갈래(stream) ────────────────────────────────────────────────
--
-- 청구는 두 줄기로 나갑니다.
--
--   · 학비    — 정규 학비 + 방과후. 매달·매학기 같은 주기로 나갑니다.
--   · 학비외  — 교재·교복·행사. 필요할 때 나갑니다.
--
-- 미납 이월도 **같은 줄기 안에서만** 해야 합니다. 교복값이 안 들어왔다고 다음 달 학비
-- 청구서에 얹으면, 학부모는 무슨 돈인지 모르고 문의가 옵니다. 그리고 담당자도 갈래가
-- 섞이면 「이 달 학비가 얼마 걷혔나」를 셀 수 없습니다.
--
-- 이미 있는 `category` 로도 가릴 수는 있지만(학비 vs 교재·교복), 그 칸은 «어떤 항목을
-- 담았나»를 적는 자리라 뜻이 다릅니다. 갈래는 따로 적습니다.
--
-- ── ② 이월(carried_to_invoice_id) ──────────────────────────────────────
--
-- 미납을 다음 청구서에 「이전 미납」 줄로 얹습니다. 학부모는 **한 장만** 보면 됩니다.
--
-- 그런데 그대로 두면 **같은 돈이 두 번 청구됩니다** - 원래 인보이스도 미납으로 남아 있고
-- 새 인보이스에도 그 금액이 들어가니까요. 학부모에게 가장 하면 안 되는 실수입니다.
--
-- 그래서 원 인보이스에 «어디로 넘어갔는지»를 적어 잠급니다. 이 칸이 차 있으면 그 인보이스는
-- 미납 집계에서 빠지고, 화면에는 「2026-0031로 이월됨」이라고 적힙니다. 지우지 않습니다 -
-- 무엇을 언제 청구했는지는 남아야 합니다.

alter table public.invoices
  add column if not exists stream text;

-- 이미 발행된 것도 갈래를 채웁니다. category='학비' 인 것만 학비이고 나머지는 학비외입니다
-- (통합 인보이스는 교재·교복이 섞여 있어 학비외로 봅니다 - 학비 청구 주기에 얹으면 안 됩니다).
update public.invoices
   set stream = case when category = '학비' then '학비' else '학비외' end
 where stream is null;

alter table public.invoices drop constraint if exists invoices_stream_ok;
alter table public.invoices
  add constraint invoices_stream_ok check (stream is null or stream in ('학비', '학비외'));

comment on column public.invoices.stream is
  '청구 갈래. 학비(정규+방과후) / 학비외(교재·교복·행사). 미납 이월은 같은 갈래 안에서만 합니다.';

alter table public.invoices
  add column if not exists carried_to_invoice_id uuid references public.invoices(id) on delete set null;

comment on column public.invoices.carried_to_invoice_id is
  '이 인보이스의 미납이 옮겨간 새 인보이스. 차 있으면 미납 집계에서 빠집니다 - 같은 돈을 두 번 청구하지 않기 위한 잠금입니다.';

create index if not exists invoices_carried_idx
  on public.invoices (carried_to_invoice_id) where carried_to_invoice_id is not null;

create index if not exists invoices_stream_idx
  on public.invoices (stream, issue_date desc);

-- 이월 줄임을 알아볼 수 있게 표시를 답니다. 금액만 보고는 「이게 이월분인지 새 청구인지」를
-- 가릴 수 없고, 그러면 이번 달에 실제로 얼마를 청구했는지 셀 수 없습니다.
alter table public.invoice_lines
  add column if not exists carried_from_invoice_id uuid references public.invoices(id) on delete set null;

comment on column public.invoice_lines.carried_from_invoice_id is
  '이 줄이 어느 인보이스에서 넘어온 미납인가. 새 청구액과 이월액을 갈라 세는 데 씁니다.';
