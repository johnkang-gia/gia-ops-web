-- 재무 1단계 — 같은 학비 항목이 두 장 되지 않게, 그리고 이미 두 장이 된 것 하나 정리.
--
-- ── 무엇이 났나 ──────────────────────────────────────────────────────
--
-- 황이안 학생의 「방과후 5일반」 450,000원이 「이미 받음」으로 **두 번** 눌려 청구서가 두 장
-- 생겼습니다(2026-0170 9/27 · 2026-0169 9/28). 입금도 두 줄이 붙었습니다. 실제로 받은 돈은
-- 한 번입니다.
--
-- 막는 것이 없었습니다. 「이미 받음」은 청구서를 만드는 길이고, 청구서는 같은 항목으로 몇 장이든
-- 만들어졌습니다. 한 사람이 두 탭에서 눌러도, 어제 눌렀는지 잊고 오늘 또 눌러도 막히지 않았습니다.
--
-- ── 무엇을 하나 ──────────────────────────────────────────────────────
--
-- 1. 뒤에 생긴 2026-0169 를 **취소**합니다(지우지 않습니다). 그 장이 만든 「이미받음」 입금 한
--    줄은 지웁니다 - 청구서 취소 창구가 하는 것과 같은 일입니다(출처가 이미받음인 입금은
--    그 장과 함께 만들어진 것이라 그 장이 없어지면 함께 없어집니다).
-- 2. 학비 청구서는 **같은 학생·같은 학기·같은 청구월·같은 항목 범위**로 「발행」 상태 한 장만
--    있을 수 있게 유일 색인을 겁니다. 화면이 막는 것은 두 탭을 못 막습니다 - 데이터베이스가
--    막아야 합니다.
--
--    · 취소된 장은 세지 않습니다(새로 만들 수 있어야 하니까요).
--    · 미납을 다음 장으로 넘긴 장(`carried_to_invoice_id`)도 세지 않습니다 - 옛 장과 새 장이
--      같은 달·같은 범위일 수 있습니다.
--    · 학비외는 걸지 않습니다. 교복 두 벌을 두 번 사는 것은 정상입니다.
--    · `plan_scope` 가 빈 장은 「학비 전부」입니다. 그것도 한 달에 한 장입니다.

-- 1. 황이안 2026-0169
update public.invoices
   set status = '취소',
       cancel_reason = '같은 항목(방과후 5일반)으로 2026-0170 이 이미 있습니다. 「이미 받음」이 두 번 눌린 중복입니다.',
       cancelled_at = now(),
       cancelled_by = 'system:finance_phase1'
 where invoice_no = '2026-0169'
   and status = '발행';

delete from public.payments p
 using public.invoices i
 where p.invoice_id = i.id
   and i.invoice_no = '2026-0169'
   and p.origin = '이미받음';

-- 2. 유일 색인
create unique index if not exists invoices_tuition_scope_month_uniq
  on public.invoices (student_id, coalesce(term_id::text, ''), coalesce(billing_month, ''), coalesce(plan_scope, ''))
  where status = '발행'
    and coalesce(stream, category) = '학비'
    and carried_to_invoice_id is null;

comment on index public.invoices_tuition_scope_month_uniq is
  '같은 학생·학기·청구월·항목 범위의 학비 청구서는 「발행」 한 장뿐입니다. 취소된 장과 이월한 장은 세지 않습니다. 황이안 중복(2026-0169/0170) 재발 방지.';

-- rls-ok: 표를 만들지 않습니다. 줄 하나 취소와 색인 하나입니다.
