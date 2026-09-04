-- ===== 학비외 항목: 끄기를 없애고 삭제로 =====
--
-- 지금까지 항목은 지우지 못하고 **끄기**만 됐습니다. 끄면 목록에서 사라지지만 줄은 남고,
-- `꺼둔 것도 보기` 를 켜야 다시 보입니다. 그래서 잘못 만든 항목이 계속 쌓였고, 목록에는
-- 안 보이니 아무도 치우지 않았습니다.
--
-- 끄기를 만든 이유는 "지난 인보이스가 왜 그 금액이었는지 설명할 수 있어야 한다" 였는데,
-- **그 걱정은 이미 다른 방식으로 풀려 있습니다.** 인보이스는 항목을 가리키지 않고,
-- 발행하는 순간 이름과 금액을 `invoice_lines` 에 베껴 둡니다. 항목을 지워도 이미 보낸
-- 청구서는 글자 하나 바뀌지 않습니다.
--
-- 남는 것은 두 가지인데, 아래에서 각각 처리합니다.
--   ① 단가 이력(fee_item_price_log) — 지금은 항목을 지우면 같이 사라집니다
--   ② 아이별 가감(student_fee_items) — 함께 사라지는 것이 맞습니다(항목이 없어졌으므로)

-- ── ① 단가 이력은 항목보다 오래 남습니다 ─────────────────────────────────
--
-- `on delete cascade` 라서, 항목을 지우면 "작년엔 얼마였나" 가 함께 지워졌습니다.
-- 이력 표에는 이미 `item_name` 이 따로 저장돼 있어서, 항목 줄이 없어도 이력은 읽힙니다.
-- 그래서 연결만 끊고 이력은 남깁니다.
do $$
begin
  if exists (
    select 1 from pg_constraint
     where conrelid = 'public.fee_item_price_log'::regclass
       and contype = 'f'
       and confrelid = 'public.fee_items'::regclass
  ) then
    execute (
      select format('alter table public.fee_item_price_log drop constraint %I', conname)
        from pg_constraint
       where conrelid = 'public.fee_item_price_log'::regclass
         and contype = 'f'
         and confrelid = 'public.fee_items'::regclass
       limit 1
    );
  end if;

  alter table public.fee_item_price_log
    add constraint fee_item_price_log_item_fk
    foreign key (item_id) references public.fee_items(id) on delete set null;
end $$;

comment on column public.fee_item_price_log.item_id is
  '항목이 지워지면 비워집니다(이력은 남습니다). 어느 항목이었는지는 item_name 으로 읽습니다.';

-- ── ② 지금 꺼져 있는 항목을 지웁니다 ──────────────────────────────────────
--
-- 화면에서 끄기를 없애므로, 꺼진 채 남은 줄은 **보이지도 지워지지도 않는 상태**가 됩니다.
-- 화면에는 아무 일도 없는데 자료만 남아 있는 자리라 지금 정리합니다.
--
-- 다시 돌려도 안전합니다 - 이제 아무것도 항목을 끄지 않으므로 두 번째 실행에서는 지울 줄이
-- 없습니다.
do $$
declare
  n_items integer;
  n_links integer;
  names text;
begin
  select count(*), coalesce(string_agg(name, ', ' order by name), '')
    into n_items, names
    from public.fee_items where active = false;

  select count(*) into n_links
    from public.student_fee_items s
    join public.fee_items i on i.id = s.item_id
   where i.active = false;

  delete from public.fee_items where active = false;

  if n_items > 0 then
    raise notice '꺼둔 항목 %개를 지웠습니다: %', n_items, names;
    raise notice '함께 사라진 아이별 가감 %줄. 이미 발행한 인보이스는 값을 베껴 두므로 그대로입니다.', n_links;
  else
    raise notice '꺼둔 항목이 없습니다.';
  end if;
end $$;

-- ── ③ active 칸은 더 이상 쓰지 않습니다 ──────────────────────────────────
--
-- 칸을 지우지는 않습니다 - 되돌릴 수 없고, 예전 자료를 읽을 때 필요할 수 있습니다.
-- 다만 **거짓인 줄이 하나라도 남으면 화면에서 안 보이는데 지울 수도 없으므로**, 전부 참으로
-- 맞춰두고 화면 쪽에서도 이 칸을 걸러내지 않도록 바꿨습니다.
update public.fee_items set active = true where active = false;

alter table public.fee_items alter column active set default true;

comment on column public.fee_items.active is
  '더 이상 쓰지 않습니다. 항목은 끄는 것이 아니라 지웁니다(2026-09). 화면도 이 칸으로 거르지 않습니다.';
