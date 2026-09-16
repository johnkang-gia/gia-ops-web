-- 「이미 받은 것을 적기만 한 장」에 자국을 채웁니다 — **칸은 이미 있습니다.**
--
-- ── 무엇이 문제였나 ──────────────────────────────────────────────────
--
-- 학비외에서 「이미 받음」으로 교복 10만원만 체크했더니, 10만원짜리 **청구서**가 만들어지고
-- 그 학생 줄에 「완납」이 붙었습니다. 뜻이 정반대입니다.
--
--   · 이미 받은 돈이라 **청구할 것이 없습니다.** 그런데 청구서가 생겼습니다.
--   · 그 학생은 교재비를 아직 안 냈는데 줄에는 「완납」이 떴습니다. 방금 만든 10만원짜리
--     한 장만 보고 판정했기 때문입니다.
--
-- 받은 돈을 장부에 남기려면 청구서와 입금이 짝으로 있어야 합니다(§2-12 — 완납·미납은 칸에
-- 적어두지 않고 청구액·입금합에서 냅니다). 그래서 장 자체는 필요합니다. 필요 없는 것은
-- **그 장이 청구서처럼 취급되는 것**입니다.
--
-- ── 칸은 처음부터 있었습니다 ─────────────────────────────────────────
--
-- `invoices.issued_offline` 이 바로 그 표시이고, 창구는 이미 채우고 있었습니다
-- (`issued_offline: !!paidAt`). 그런데 **읽는 화면이 한 곳도 없었습니다.** 취소 팝업이
-- 글자로 보여주는 것이 전부였습니다.
--
-- 이 저장소에서 반복된 사고가 전부 같은 모양입니다 — 판정을 적어두기만 하고 아무도 그것으로
-- 가르지 않는 것(학비 `target_scope`, 학비외 `billedItems`, 셔틀 `override_route_id`).
-- 그래서 새 칸을 만들지 않습니다. 같은 뜻을 두 칸에 두면 반드시 한쪽만 고쳐집니다(§2-11).
--
-- 여기서는 **옛 줄에 자국을 채우기만** 합니다. 가르는 일은 화면이 합니다.

-- 「이미 받음」으로 만든 장은 입금 메모에 자국이 남아 있습니다.
--
-- **완납인 것만** 채웁니다. 받은 만큼만 적은 장이라 완납이 아니면 「이미 받음」이 아니라
-- 진짜 청구서일 수 있고, 진짜 청구서를 목록에서 감추면 받을 돈이 조용히 사라집니다.
update public.invoices v
   set issued_offline = true
 where coalesce(v.issued_offline, false) = false
   and coalesce(v.status, '') <> '취소'
   and exists (
     select 1 from public.payments p
      where p.invoice_id = v.id
        and (p.memo like '받은 항목:%' or p.memo like '%이미 받은%')
   )
   and (select coalesce(sum(p2.amount), 0) from public.payments p2 where p2.invoice_id = v.id)
       >= v.total_amount;

comment on column public.invoices.issued_offline is
  '이미 받은 돈을 적기만 한 장인가. 수납 집계에는 들어가지만 청구서 목록의 대표 칸·발행 대상·올톡페이 발송 명단에서는 빠집니다 - 이미 받았으므로 청구할 것이 없습니다.';

-- 화면이 「진짜 청구서만」을 자주 고릅니다. 재무 화면은 잘라 읽지 않고 끝까지 읽으므로(§2-12)
-- 색인을 답니다.
create index if not exists invoices_billable_idx
  on public.invoices (student_id)
  where issued_offline is not true;
