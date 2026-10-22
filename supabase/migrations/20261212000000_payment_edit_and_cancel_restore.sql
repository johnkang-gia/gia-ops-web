-- 수납 수단 고치기 · 취소 되돌리기 · 이한범 10월 청구서 복구
--
-- 수납을 «계좌이체»로 잘못 적은 뒤 고칠 길이 없어서, 청구서 발행 취소(↩)로 지우려 했습니다.
-- 발행 취소는 사람이 붙인 입금을 지우지 않고 예치금으로 떼어내므로(청구 취소로 떼어냄), 받은 돈
-- 두 건(300,000원 · 191,200원)이 예치금으로 옮겨지고 청구서 두 장(2026-0321 학비, 2026-0218 학비외)은
-- 취소 상태가 되었습니다.
--
-- ① 떼어낸 입금이 «어느 청구서에서 왔는지»를 남깁니다. 지금까지는 invoice_id 를 비우면서 그 사실도
--    함께 사라져, 취소를 되돌릴 때 어느 돈을 다시 붙여야 하는지 알 수 없었습니다.
-- ② 이한범 학생의 두 장을 취소 전으로 돌리고, 입금을 원래 장에 다시 붙이며 수단을 올톡페이로 고칩니다.
--    지금 상태(취소 · 예치금)일 때만 바꿉니다 - 그 사이 사람이 손댔으면 아무것도 하지 않습니다.

alter table public.payments add column if not exists detached_from_invoice_id uuid references public.invoices(id) on delete set null;
comment on column public.payments.detached_from_invoice_id is
  '청구서 발행 취소로 예치금이 된 입금이 원래 붙어 있던 청구서. 「취소 되돌리기」가 이 칸을 보고 다시 붙입니다.';

-- ② 이한범(2026-10-17 수납, 2026-10-22 취소)
do $$
declare
  v_ok int;
begin
  select count(*) into v_ok
  from public.payments
  where (id = '04cd02e5-43e0-49d6-8e58-422770dd7216' and amount = 300000)
     or (id = '5e32111b-8ec8-41c4-b670-7ad0e620f58d' and amount = 191200);
  if v_ok <> 2 then
    raise notice '이한범 복구: 입금 두 건을 찾지 못해 건너뜁니다(%건).', v_ok;
    return;
  end if;

  if exists (
    select 1 from public.payments
    where id in ('04cd02e5-43e0-49d6-8e58-422770dd7216', '5e32111b-8ec8-41c4-b670-7ad0e620f58d')
      and invoice_id is not null
  ) then
    raise notice '이한범 복구: 입금이 이미 다른 곳에 붙어 있어 건너뜁니다.';
    return;
  end if;

  update public.invoices
     set status = '발행', cancelled_at = null, cancelled_by = null, cancel_reason = null
   where id in ('820d6fb8-03b9-41d5-b80d-279168e806b1', '8db5d392-466d-4399-b449-420607411d19')
     and status = '취소';

  update public.payments
     set invoice_id = '820d6fb8-03b9-41d5-b80d-279168e806b1',
         method = '올톡페이', method_kind = '올톡페이',
         matched_by = '취소 되돌림',
         memo = coalesce(memo, '') || ' · 수단 계좌이체→올톡페이(2026-10-22 정정)'
   where id = '04cd02e5-43e0-49d6-8e58-422770dd7216' and invoice_id is null;

  update public.payments
     set invoice_id = '8db5d392-466d-4399-b449-420607411d19',
         method = '올톡페이', method_kind = '올톡페이',
         matched_by = '취소 되돌림',
         memo = coalesce(memo, '') || ' · 수단 계좌이체→올톡페이(2026-10-22 정정)'
   where id = '5e32111b-8ec8-41c4-b670-7ad0e620f58d' and invoice_id is null;
end $$;

notify pgrst, 'reload schema';
