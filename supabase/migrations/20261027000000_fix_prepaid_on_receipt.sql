-- 이미 어긋난 자료를 바로잡습니다 — 앞 판의 규칙을 자료에도 적용합니다.
--
-- ── ① 쪼갠 조각의 출처 ───────────────────────────────────────────────
--
-- 앞 마이그레이션(20261026)의 백필 순서가 틀렸습니다. 뿌리의 출처를 채우기 **전에** 물려주기를
-- 돌려서 아무것도 안 내려갔고, 그 다음 마지막 손질이 `source` 를 그대로 넣어 쪼갠 조각이
-- 전부 `origin = '쪼갬'` 이 됐습니다.
--
-- 「쪼갬」은 **어떻게 생겼나**이지 **어디서 왔나**가 아닙니다. 이 값으로는 취소가 여전히 그
-- 돈을 못 알아봅니다 - 고치려고 만든 칸이 같은 실패를 되풀이하는 셈입니다.
--
-- 뿌리를 따라 올라가 진짜 출처를 다시 적습니다. 출처는 바꿀 수 없게 막아 두었으므로
-- (`payments_origin_fixed_trg`) 고치는 동안만 문지기를 내립니다.

alter table public.payments disable trigger payments_origin_fixed_trg;

do $$
declare
  n int;
begin
  -- 「쪼갬」은 출처가 아니므로 비웁니다. 그래야 아래에서 뿌리 값이 내려올 수 있습니다.
  update public.payments set origin = null where origin = '쪼갬';

  for i in 1..20 loop
    update public.payments c
       set origin = p.origin
      from public.payments p
     where c.split_from_id = p.id
       and c.origin is null
       and p.origin is not null
       and p.origin <> '쪼갬';
    get diagnostics n = row_count;
    exit when n = 0;
  end loop;

  -- 뿌리를 잃은 조각(부모가 이미 지워진 줄)은 알 길이 없습니다. 빈 칸으로 두지 않습니다 -
  -- 빈 칸이면 취소가 또 못 알아봅니다.
  update public.payments set origin = '알수없음' where origin is null;
end $$;

alter table public.payments enable trigger payments_origin_fixed_trg;

-- ── ② 「이미 받음」 장에 얹힌 선입금을 떼어냅니다 ─────────────────────
--
-- 「이미 받음」으로 만든 장은 만들면서 받은 돈을 바로 붙이므로 **이미 완납**입니다. 그 위에
-- 선입금이 또 붙으면 받지도 않은 돈이 장부에 들어옵니다. 새 규칙은 이것을 아예 못 하게
-- 막았지만, 이미 붙어 있는 줄은 그대로 남아 있습니다.
--
-- **지우지 않고 떼어냅니다**(`invoice_id = null`). 지우면 그 돈이 진짜였을 때 되돌릴 수
-- 없습니다. 떼어내면 선입금으로 돌아가 「재무 → 선입금」 화면에 뜨고, 사람이 보고 정합니다 -
-- 돌려줄 돈인지, 다음 청구서에 쓸 돈인지, 애초에 두 번 적힌 것인지.
--
-- 되돌린 장에 자국을 남깁니다. 나중에 「이 줄이 왜 선입금이 됐지」에 답할 수 있어야 합니다.
update public.payments p
   set invoice_id = null,
       memo = coalesce(p.memo, '') || ' · 「이미 받음」 장에서 떼어냄(이미 완납인 장에 선입금이 얹혀 있었습니다)'
  from public.invoices i
 where p.invoice_id = i.id
   and i.issued_offline is true
   and coalesce(i.status, '') <> '취소'
   and p.matched_by = '선입금 자동충당'
   and p.origin is distinct from '이미받음';
