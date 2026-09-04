-- ===== 의류: 학기별 사이즈 · 재고 · 교환 =====
--
-- 세 가지를 더합니다. 셋 다 실제로 겪는 일에서 나왔습니다.
--
--   ① 아이는 자랍니다        2학년 때 입던 옷과 3학년 때 입는 옷이 다릅니다
--   ② 발주한 옷이 재고가 됩니다  누구에게 주면 줄고, 안 맞아 돌아오면 늘어납니다
--   ③ 안 맞으면 바꿉니다      150을 주문했는데 작아서 160으로 바꿔달라고 합니다

-- ── ① 사이즈는 학기마다 ──────────────────────────────────────────────────
--
-- 지금은 아이당 한 줄이라 학년이 올라가면 **지난 학년 사이즈를 덮어씁니다.** 그러면
-- "작년에는 뭘 입었지" 에 답할 수 없고, 학기 초에 지난 사이즈로 만들어버릴 수도 있습니다.
--
-- 학기를 열쇠에 넣습니다. 학기 안에서는 거의 고정이고, 학기가 바뀌면 새로 잽니다.
-- 새 학기에 값이 아직 없으면 화면이 **지난 학기 값을 보여주되 '확인 필요'** 로 띄웁니다 -
-- 지난 값을 조용히 그대로 쓰면 안 맞는 옷이 옵니다.
alter table public.student_apparel_sizes
  add column if not exists term_id uuid references public.terms(id) on delete set null;

-- 열쇠를 (학생, 종류) 에서 (학생, 종류, 학기) 로 바꿉니다.
-- term_id 가 비어 있을 수 있어서(학기를 안 쓰던 시절 자료) 글자로 바꿔 묶습니다 -
-- 널끼리는 서로 다른 값으로 보기 때문에 그냥 두면 한 아이에 같은 줄이 여러 개 생깁니다.
alter table public.student_apparel_sizes
  drop constraint if exists student_apparel_sizes_student_id_kind_key;
drop index if exists student_apparel_sizes_student_id_kind_key;

create unique index if not exists student_apparel_sizes_uniq
  on public.student_apparel_sizes (student_id, kind, coalesce(term_id::text, ''));

comment on column public.student_apparel_sizes.term_id is
  '어느 학기의 사이즈인가. 아이는 자라므로 학년이 올라가면 값이 달라집니다. 새 학기에 값이 없으면 화면이 지난 학기 값을 확인용으로 보여줍니다.';

-- ── ② 재고 원장 ──────────────────────────────────────────────────────────
--
-- **잔량 한 숫자만 두지 않습니다.** 그러면 "왜 3벌이지" 에 답할 수 없고, 어긋났을 때
-- 어디서부터 틀렸는지 찾을 방법이 없습니다. 움직임을 한 줄씩 남기고 잔량은 더해서 냅니다.
--
--   입고  발주한 옷이 들어옴
--   배부  아이에게 정해줌 (사이즈를 확정하면 저절로)
--   반납  교환·취소로 돌아옴 (저절로)
--   분실  없어짐
--   조정  세어보니 달랐음 - 사람이 맞춤
create table if not exists public.apparel_stock_moves (
  id uuid primary key default gen_random_uuid(),
  piece_id uuid not null references public.apparel_order_pieces(id) on delete cascade,

  -- 사이즈는 자유 입력이라 글자 그대로 둡니다. 앞뒤 공백만 없앱니다.
  size text not null,
  kind text not null check (kind in ('입고', '배부', '반납', '분실', '조정')),
  -- 항상 양수입니다. 방향은 kind 가 정합니다 - 음수를 섞으면 합계를 읽을 때마다 헷갈립니다.
  qty integer not null check (qty > 0),

  -- 누구에게 나갔는가(배부·반납). 재고가 안 맞을 때 되짚는 길입니다.
  student_id uuid references public.wr_students(id) on delete set null,
  order_item_id uuid references public.apparel_order_items(id) on delete set null,

  note text,
  created_by text,
  created_at timestamptz not null default now()
);

create index if not exists apparel_stock_moves_piece_idx on public.apparel_stock_moves (piece_id, size);
create index if not exists apparel_stock_moves_item_idx on public.apparel_stock_moves (order_item_id);

comment on table public.apparel_stock_moves is
  '의류 입출고 원장. 잔량을 한 숫자로 두지 않는 이유: 어긋났을 때 어디서부터 틀렸는지 찾을 수 있어야 합니다.';

-- 품목·사이즈별 잔량. 화면은 이것만 읽습니다 - 더하는 규칙이 화면마다 다르면 안 됩니다.
create or replace view public.apparel_stock_balance as
select
  piece_id,
  size,
  sum(case when kind = '입고' then qty else 0 end)::int as 입고,
  sum(case when kind = '배부' then qty else 0 end)::int as 배부,
  sum(case when kind = '반납' then qty else 0 end)::int as 반납,
  sum(case when kind = '분실' then qty else 0 end)::int as 분실,
  sum(case when kind = '조정' then qty else 0 end)::int as 조정,
  (
    sum(case when kind = '입고' then qty else 0 end)
    + sum(case when kind = '반납' then qty else 0 end)
    + sum(case when kind = '조정' then qty else 0 end)
    - sum(case when kind = '배부' then qty else 0 end)
    - sum(case when kind = '분실' then qty else 0 end)
  )::int as 남음
from public.apparel_stock_moves
group by piece_id, size;

comment on view public.apparel_stock_balance is
  '품목·사이즈별 재고. 남음이 음수면 그만큼 더 발주해야 합니다.';

-- ── 사이즈를 정하면 재고가 저절로 움직입니다 ─────────────────────────────
--
-- 화면에서 손으로 빼게 두면 반드시 빠뜨립니다. 그리고 빠뜨린 것은 **재고가 맞지 않는다는
-- 사실로만** 나중에 드러나는데, 그때는 어느 아이 것이 빠졌는지 알 수 없습니다.
--
-- 그래서 표에 붙입니다. 어느 화면에서 고치든 원장은 늘 맞습니다.
create or replace function public.apparel_move_stock()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  had boolean := false;
  has boolean := false;
begin
  if tg_op = 'UPDATE' then
    had := old.status = '확정' and old.size is not null and btrim(old.size) <> '';
  end if;
  has := new.status = '확정' and new.size is not null and btrim(new.size) <> '';

  -- 있던 것이 없어졌거나 사이즈·수량이 바뀌었으면 먼저 되돌립니다.
  if had and (not has or btrim(old.size) is distinct from btrim(new.size) or old.qty is distinct from new.qty) then
    insert into apparel_stock_moves (piece_id, size, kind, qty, student_id, order_item_id, created_by, note)
    values (old.piece_id, btrim(old.size), '반납', old.qty, old.student_id, old.id, new.updated_by, '사이즈 변경·취소로 되돌림');
  end if;

  -- 새로 정해졌거나 바뀌었으면 내보냅니다.
  if has and (not had or btrim(old.size) is distinct from btrim(new.size) or old.qty is distinct from new.qty) then
    insert into apparel_stock_moves (piece_id, size, kind, qty, student_id, order_item_id, created_by, note)
    values (new.piece_id, btrim(new.size), '배부', new.qty, new.student_id, new.id, new.updated_by, null);
  end if;

  return new;
end;
$$;

drop trigger if exists apparel_order_items_stock on public.apparel_order_items;
create trigger apparel_order_items_stock
  after insert or update of size, status, qty on public.apparel_order_items
  for each row execute function public.apparel_move_stock();

-- ── ③ 교환 ───────────────────────────────────────────────────────────────
--
-- 150을 받아 입어봤더니 작아서 160으로 바꿔달라고 합니다. 그러면 150 한 벌이 **재고로
-- 돌아오고** 160 한 벌이 나갑니다. 돌아온 150은 다른 아이에게 줄 수 있습니다 - 아이들끼리
-- 교환이 되는 것이 이 원장 덕분입니다.
--
-- 신청을 따로 남기는 이유: 바꿔달라는 말이 온 시점과 실제로 바꿔준 시점이 다릅니다. 그
-- 사이에 재고가 없으면 기다려야 하는데, 신청이 안 남아 있으면 그 아이는 잊힙니다.
create table if not exists public.apparel_exchanges (
  id uuid primary key default gen_random_uuid(),
  order_item_id uuid not null references public.apparel_order_items(id) on delete cascade,
  piece_id uuid not null references public.apparel_order_pieces(id) on delete cascade,
  student_id uuid not null references public.wr_students(id) on delete cascade,

  from_size text not null,
  to_size text not null,
  qty integer not null default 1 check (qty > 0),

  --   신청  : 바꿔달라고 함. 재고가 있으면 바로 처리할 수 있습니다
  --   완료  : 바꿔줬음. 이때 원장이 움직입니다(order_item 의 사이즈를 바꾸면 트리거가 합니다)
  --   취소  : 안 바꾸기로 함
  status text not null default '신청' check (status in ('신청', '완료', '취소')),

  reason text,
  requested_by text,
  done_by text,
  done_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists apparel_exchanges_open_idx on public.apparel_exchanges (status, created_at desc);
create index if not exists apparel_exchanges_piece_idx on public.apparel_exchanges (piece_id, status);

comment on table public.apparel_exchanges is
  '사이즈 교환 신청. 바꿔달라는 말이 온 시점과 바꿔준 시점이 달라서 따로 남깁니다 - 재고가 없어 기다리는 아이가 잊히지 않도록.';

-- ── 접근 제한 ────────────────────────────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array['apparel_stock_moves', 'apparel_exchanges'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    execute format('drop policy if exists %I on public.%I', t || '_write', t);
    execute format('create policy %I on public.%I for select using (public.is_giamicro_user())', t || '_read', t);
    execute format(
      'create policy %I on public.%I for all using (public.is_wr_manager()) with check (public.is_wr_manager())',
      t || '_write', t);
  end loop;
end $$;

grant select on public.apparel_stock_balance to authenticated;

drop trigger if exists apparel_exchanges_touch on public.apparel_exchanges;
create trigger apparel_exchanges_touch
  before update on public.apparel_exchanges
  for each row execute function public.set_updated_at();
