-- 의류 제작 건 ↔ 납부 항목.
--
-- ── 무엇이 문제였나 ─────────────────────────────────────────────────────────
--
-- 의류 화면은 누가 교복을 맞추는지(제작 건 명단)를 알고, 학비외 청구는 「교복」 항목을 누구에게
-- 청구할지를 압니다. **둘을 잇는 칸이 없어서** 사람이 두 화면을 열어 놓고 이름을 대조했습니다.
-- 제작 명단에 뒤늦게 들어온 아이는 청구에서 빠지고, 그건 오류가 아니라 「그 아이는 청구 대상이
-- 아닌 화면」으로 보입니다.
--
-- ── 그래서 ───────────────────────────────────────────────────────────────────
--
-- 제작 건에 납부 항목을 하나 답니다(`fee_item_id`). 달려 있으면 명단에 들어오는 아이마다
-- `student_fee_items` 에 그 항목을 붙입니다(트리거). 청구는 그대로 학비외 청구에서 하고, 청구서가
-- 어디까지 갔는지는 의류 화면이 `invoice_lines.item_id` 로 읽어 보여줍니다.
--
-- 명단에서 빠지면(모든 품목이 「제외」) 트리거가 붙인 것만 「안 산다」로 돌립니다 - 사람이 따로
-- 넣은 것은 건드리지 않고, 지우지도 않습니다(이미 청구된 줄이 가리키고 있을 수 있습니다).

alter table public.apparel_orders
  add column if not exists fee_item_id uuid references public.fee_items(id) on delete set null;

comment on column public.apparel_orders.fee_item_id is
  '이 제작 건의 납부 항목. 달려 있으면 명단의 아이마다 student_fee_items 에 그 항목이 붙습니다.';

create or replace function public.apparel_attach_fee_item()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item uuid;
  v_term uuid;
  v_left integer;
begin
  select fee_item_id, term_id into v_item, v_term from public.apparel_orders where id = new.order_id;
  if v_item is null then
    return new;
  end if;

  if new.status <> '제외' then
    insert into public.student_fee_items (student_id, item_id, term_id, mode, qty, note, updated_by)
    values (new.student_id, v_item, v_term, 'include', 1, '의류 제작 건에서 자동', new.updated_by)
    on conflict (student_id, item_id) do update
      set mode = 'include',
          updated_at = now()
      where public.student_fee_items.note = '의류 제작 건에서 자동'
        and public.student_fee_items.mode = 'exclude';
  else
    select count(*) into v_left
      from public.apparel_order_items i
     where i.order_id = new.order_id and i.student_id = new.student_id and i.status <> '제외' and i.id <> new.id;
    if v_left = 0 then
      update public.student_fee_items
         set mode = 'exclude', updated_at = now()
       where student_id = new.student_id and item_id = v_item and note = '의류 제작 건에서 자동';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists apparel_order_items_attach_fee on public.apparel_order_items;
create trigger apparel_order_items_attach_fee
  after insert or update of status on public.apparel_order_items
  for each row execute function public.apparel_attach_fee_item();

-- 항목을 나중에 달아도 이미 들어와 있는 명단에 붙습니다.
create or replace function public.apparel_backfill_fee_item()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.fee_item_id is null or new.fee_item_id is not distinct from old.fee_item_id then
    return new;
  end if;
  insert into public.student_fee_items (student_id, item_id, term_id, mode, qty, note, updated_by)
  select distinct i.student_id, new.fee_item_id, new.term_id, 'include', 1, '의류 제작 건에서 자동', i.updated_by
    from public.apparel_order_items i
   where i.order_id = new.id and i.status <> '제외'
  on conflict (student_id, item_id) do nothing;
  return new;
end;
$$;

drop trigger if exists apparel_orders_backfill_fee on public.apparel_orders;
create trigger apparel_orders_backfill_fee
  after update of fee_item_id on public.apparel_orders
  for each row execute function public.apparel_backfill_fee_item();
