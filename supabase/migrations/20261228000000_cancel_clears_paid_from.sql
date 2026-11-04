-- 취소된 청구서가 남긴 «묶음 납부 시작월»을 비웁니다.
--
-- 학비 발행은 여러 달 묶음(5개월·10개월) 항목의 시작월(student_fee_enrollments.paid_from)을 그 장의 청구월로 적습니다.
-- 청구서 취소는 이 칸을 되돌리지 않아서, 장은 취소됐는데 그 항목이 「납부 기간 … 기간 납부 완료」로 남아 다시 고를 수
-- 없었습니다(방과후 5개월 납부 장을 취소한 뒤 재발행이 막힘). 앱의 취소 창구는 이제 함께 되돌립니다. 이 파일은 이미
-- 그렇게 남은 줄을 정리합니다.
--
-- 비우는 조건(셋 다):
--   · 시작월 = 그 학생의 **취소된** 학비 장의 청구월이고, 그 장에 이 항목 줄이 있었음 (발행이 적은 값)
--   · 같은 항목을 담은 **살아 있는** 장이 하나도 없음 (다른 장이 기간을 덮고 있으면 둡니다)
-- 사람이 손으로 적은 시작월(운영앱 이전 납부)은 취소된 장의 청구월과 같을 일이 드물고, 같더라도 살아 있는 장이 없는
-- 기간을 «납부 완료»로 두는 것이 더 큰 사고(청구 누락)라 비웁니다.

update public.student_fee_enrollments e
   set paid_from = null
 where e.paid_from is not null
   and exists (
     select 1
       from public.invoices i
       join public.invoice_lines l on l.invoice_id = i.id
      where i.student_id = e.student_id
        and i.status = '취소'
        and l.plan_id = e.plan_id
        and coalesce(i.billing_month, to_char(i.issue_date, 'YYYY-MM')) = e.paid_from
   )
   and not exists (
     select 1
       from public.invoices i
       join public.invoice_lines l on l.invoice_id = i.id
      where i.student_id = e.student_id
        and i.status = '발행'
        and l.plan_id = e.plan_id
   );
