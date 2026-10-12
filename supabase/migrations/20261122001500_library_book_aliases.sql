-- ===== 겹치는 책 합치기 - 옛 번호를 살려두는 별명표 =====
--
-- 요청: "실제로는 같은 책인데, 내가 책 이름을 넣는 경우, 바코드를 찍는 경우 등이 생겨서, 같은
-- 책인데도 합쳐지지 않고 다른 장수로 관리되는 경우가 있어. 어떻게 합쳐서 관리할 수 있을까?"
--
-- ── 왜 안 합쳐졌나 ─────────────────────────────────────────────────────────
-- 책 한 줄을 가리키는 열쇠는 ISBN 아니면 도서관 라벨 번호(GIA-B-00001)입니다. 손으로 제목만
-- 적어 넣은 줄에는 ISBN이 없어서, 나중에 같은 책의 바코드를 찍어도 서로를 알아볼 길이
-- 없습니다. 제목으로 맞춰 보는 길이 아예 없었습니다.
--
-- ── 합칠 때 생기는 문제 ────────────────────────────────────────────────────
-- 두 줄을 합치면 한쪽 번호는 주인이 없어집니다. 그런데 그 번호는 **이미 책에 붙어 있는 라벨**
-- 입니다. 줄을 지우는 순간, 그 라벨을 찍으면 "아직 등록되지 않은 책입니다"가 뜹니다. 멀쩡히
-- 꽂혀 있는 책이 사라진 것처럼 보입니다.
--
-- 그래서 합치면서 **옛 번호를 별명으로 남깁니다.** 그 번호를 찍으면 합쳐진 책이 나옵니다.
-- 책에서 라벨을 뗄 필요가 없습니다.
--
-- 별명은 **찾기 전용**입니다. 책의 대표 번호(item_code)는 그대로 하나이고, 라벨을 새로 뽑을
-- 때도 대표 번호만 씁니다. 별명은 "예전에 이 번호로도 불렸다"는 기록일 뿐입니다.

create table if not exists public.lib_book_aliases (
  -- 찍히는 값 그대로(공백 없이 대문자). ISBN이면 10자리·13자리를 각각 한 줄씩 넣습니다.
  code text primary key,
  book_id uuid not null references public.lib_books(id) on delete cascade,
  -- 이 번호가 원래 무엇이었는지. isbn / item_code / product_code.
  kind text not null default 'item_code' check (kind in ('isbn', 'item_code', 'product_code')),
  -- 합쳐지면서 사라진 줄의 제목. 나중에 "이게 왜 여기 붙었지" 를 따라갈 수 있게 남깁니다.
  merged_title text,
  created_by text,
  created_at timestamptz not null default now()
);

comment on table public.lib_book_aliases is
  '합치면서 사라진 줄의 옛 번호. 책에 붙어 있는 옛 라벨을 찍어도 합쳐진 책이 나오게 하는 찾기 전용 표입니다.';

create index if not exists lib_book_aliases_book_idx on public.lib_book_aliases (book_id);

alter table public.lib_book_aliases enable row level security;

drop policy if exists lib_all_book_aliases on public.lib_book_aliases;
create policy lib_all_book_aliases on public.lib_book_aliases
  for all using (public.is_lib_user()) with check (public.is_lib_user());

notify pgrst, 'reload schema';
