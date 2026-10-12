-- ===== 장서 위치 등록(책장 한 칸씩 확인하기) =====
--
-- 요청: "임시저장 책장에서 2-1부터 쭉 다시 책장별로 꺼내서 바코드를 찍을 거야. 이미 예전에
-- 등록은 해놨는데 아이들이 만져서 책이 여기저기 흩어지기도 하고 ... 다시 위치등록을 하려 해."
--
-- ── 지금 자료로는 안 되는 일 ───────────────────────────────────────────────
-- lib_books 에는 줄마다 자리(location_id)가 **하나**입니다. 권마다 자리를 적는 칸이 없습니다.
-- 그래서 "2-1 · 12권"이 12권 모두 2-1에 있다는 뜻이 되지 못합니다 - 그 줄에 적어 둔 자리가
-- 2-1이고 기록상 권수가 12라는 뜻일 뿐입니다. 실제로는 여러 칸에 흩어져 있는 쪽이 보통입니다.
--
-- 책장 한 칸을 비우며 전부 찍는 작업은, 그 "어느 칸에 몇 권"을 처음으로 **실제로 세어 보는**
-- 일입니다. 세어 놓고 버리면 다음에 또 책장을 비워야 합니다.
--
-- ── 그래서 (책, 칸) 마다 한 줄 ─────────────────────────────────────────────
-- 같은 책을 이 칸에서 두 번 찍으면 copies 가 2가 됩니다. 다른 칸에서 찍으면 그 칸의 줄이
-- 따로 생깁니다. 다 돌고 나면
--
--   · 기록상 권수(lib_books.total_copies) vs 실제로 찾은 권수(이 표의 합)
--   · 한 책이 몇 칸에 흩어져 있는지
--
-- 둘 다 그대로 나옵니다. 어긋난 줄이 곧 고쳐야 할 줄입니다.
--
-- lib_books.location_id 는 그대로 둡니다(앱 곳곳이 '대표 자리'로 쓰고 있습니다). 찍을 때마다
-- 그 칸으로 갱신되므로 가장 최근에 확인한 자리가 됩니다.

create table if not exists public.lib_shelf_check (
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null references public.lib_books(id) on delete cascade,
  location_id uuid not null references public.lib_locations(id) on delete cascade,
  -- 이 칸에서 실제로 찾아 찍은 권수. 같은 책을 또 찍으면 올라갑니다.
  copies integer not null default 1 check (copies > 0),
  -- 마지막으로 이 칸에서 찍은 시각. 오래된 줄은 "그 뒤로 확인 안 한 칸"이라는 뜻입니다.
  checked_at timestamptz not null default now(),
  checked_by text,
  note text
);

comment on table public.lib_shelf_check is
  '책장 한 칸을 비우며 찍어 센 결과. (책, 칸)마다 한 줄이고 copies 는 그 칸에서 실제로 찾은 권수입니다.';

-- 같은 책을 같은 칸에서 또 찍으면 줄을 늘리지 않고 copies 를 올립니다.
create unique index if not exists lib_shelf_check_book_loc_idx
  on public.lib_shelf_check (book_id, location_id);
create index if not exists lib_shelf_check_loc_idx
  on public.lib_shelf_check (location_id, checked_at desc);

alter table public.lib_shelf_check enable row level security;

drop policy if exists lib_all_shelf_check on public.lib_shelf_check;
create policy lib_all_shelf_check on public.lib_shelf_check
  for all using (public.is_lib_user()) with check (public.is_lib_user());

-- ── 한눈에 보는 요약 ───────────────────────────────────────────────────────
-- 기록상 권수와 실제로 찾은 권수가 다른 책, 그리고 여러 칸에 흩어진 책을 바로 뽑아 볼 수
-- 있게 해 둡니다. 화면에서 매번 같은 집계를 짜 맞추지 않아도 됩니다.
drop view if exists public.lib_shelf_check_summary;
create view public.lib_shelf_check_summary as
select
  b.id                                   as book_id,
  b.title,
  b.author,
  b.isbn,
  b.item_code,
  b.label_level,
  b.label_no,
  b.total_copies                         as recorded_copies,
  coalesce(sum(c.copies), 0)::integer    as found_copies,
  count(c.id)::integer                   as shelf_count,
  -- '2-1 5권 · 3-3 7권' 처럼 바로 쓸 수 있게 칸별 내역을 붙여 둡니다.
  coalesce(
    string_agg(l.code || ' ' || c.copies || '권', ' · ' order by l.sort_order, l.code),
    ''
  )                                      as shelves,
  max(c.checked_at)                      as last_checked_at
from public.lib_books b
left join public.lib_shelf_check c on c.book_id = b.id
left join public.lib_locations l on l.id = c.location_id
group by b.id;

comment on view public.lib_shelf_check_summary is
  '책마다 기록상 권수와 실제로 찾은 권수, 그리고 어느 칸에 몇 권씩 있는지.';

notify pgrst, 'reload schema';
