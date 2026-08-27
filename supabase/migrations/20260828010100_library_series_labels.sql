-- ===== 도서관: 복본 · 시리즈 · 기존 색 라벨 =====
-- 요청: "같은 책이 여러권 있을때 자동으로 장수를 늘려서 등록해줘. 정렬할때 시리즈가 있다면
-- 시리즈 우선으로 분류해줘. 지금 책들에 그냥 색으로 라벨이 붙여서 분류되어 있는데 아마도
-- 연령으로 분류한거 같아. 2부터 6까지 5개의 라벨로 분류되어있어서 일단 이 라벨 기준으로 먼저
-- 책을 등록할게. 라벨에 숫자(2-6)와 라벨색, 그리고 번호가 부여되어있는데".
--
-- 복본은 이미 lib_books.total_copies로 세고 있어서 표를 고칠 필요가 없습니다(같은 ISBN을 다시
-- 찍으면 이 숫자를 올립니다). 여기서는 시리즈와 기존 라벨을 담을 칸만 만듭니다.

-- ── ① 시리즈 ───────────────────────────────────────────────────────────────
-- series    - '마법천자문', 'Harry Potter' 처럼 묶음 이름. 조회 결과나 제목에서 자동으로 뽑고,
--             틀리면 화면에서 고칩니다.
-- series_no - 그 안에서 몇 권째인지. 서가에 1, 2, 3... 순으로 꽂기 위한 값입니다.
alter table lib_books add column if not exists series text;
alter table lib_books add column if not exists series_no numeric;
create index if not exists lib_books_series_idx on lib_books(series, series_no);

-- ── ② 지금 책에 붙어 있는 색 라벨 ──────────────────────────────────────────
-- 학교가 예전에 붙여둔 라벨을 '있는 그대로' 적어둡니다. 새 체계로 바꾸더라도 원래 값이 남아
-- 있어야 ① 등록이 빠지지 않았는지 번호로 확인할 수 있고 ② 예전 방식으로 찾는 사람도 대응됩니다.
--
-- label_level - 라벨에 인쇄된 숫자(지금은 2~6). 뜻은 아직 확실하지 않아 대상 연령과 따로 둡니다.
-- label_no    - 라벨의 일련번호. '007'처럼 앞의 0이 의미를 가질 수 있어 글자로 담습니다.
alter table lib_books add column if not exists label_level smallint;
alter table lib_books add column if not exists label_no text;
create index if not exists lib_books_label_idx on lib_books(label_level, label_no);

-- ── ③ 라벨 등급 표 ─────────────────────────────────────────────────────────
-- 등급마다 색과 이름을 적어두는 작은 표입니다. 화면에서 라벨 색을 그대로 보여주고, 나중에
-- "2등급 = 유치부" 처럼 대상 연령과 짝지으면 정리 계획이 그 짝을 그대로 씁니다.
create table if not exists lib_label_levels (
  level smallint primary key,
  color text not null default '#64748b',
  name text,
  -- 이 등급이 어느 대상 연령에 해당하는지(정해지면). 비어 있으면 아직 모른다는 뜻입니다.
  audience text check (audience is null or audience in ('유치부', '초등부', '중고등부', '전체')),
  sort_order integer not null default 0,
  updated_at timestamptz not null default now()
);

alter table lib_label_levels enable row level security;
drop policy if exists "lib_all_label_levels" on lib_label_levels;
create policy "lib_all_label_levels" on lib_label_levels
  for all using (is_lib_user()) with check (is_lib_user());

-- 지금 쓰고 있는 다섯 등급을 미리 만들어 둡니다. 색은 화면에서 실제 라벨색으로 바꾸면 됩니다.
insert into lib_label_levels (level, color, sort_order) values
  (2, '#e11d48', 0),
  (3, '#f59e0b', 1),
  (4, '#16a34a', 2),
  (5, '#0284c7', 3),
  (6, '#7c3aed', 4)
on conflict (level) do nothing;

-- ── ④ 이동 목록 뷰에 시리즈·라벨 더하기 ────────────────────────────────────
-- 인쇄 목록에서 "이 책은 원래 4등급 128번" 임을 함께 보여주면, 종이를 들고 책장 앞에 선 사람이
-- 지금 라벨과 대조하기 쉽습니다.
drop view if exists lib_move_plan;
create view lib_move_plan as
select
  b.id                as book_id,
  b.title,
  b.author,
  b.isbn,
  b.item_code,
  b.cover_url,
  b.category,
  b.audience,
  b.language,
  b.series,
  b.series_no,
  b.label_level,
  b.label_no,
  b.total_copies,
  b.location_id       as from_id,
  fl.code             as from_code,
  fl.name             as from_name,
  fl.color            as from_color,
  fl.kind             as from_kind,
  b.target_location_id as to_id,
  tl.code             as to_code,
  tl.name             as to_name,
  tl.color            as to_color,
  tl.sort_order       as to_sort,
  (b.target_location_id is not null and b.target_location_id is distinct from b.location_id) as needs_move
from lib_books b
left join lib_locations fl on fl.id = b.location_id
left join lib_locations tl on tl.id = b.target_location_id
where b.status = '보유'
  and is_lib_user();

revoke all on lib_move_plan from anon;
grant select on lib_move_plan to authenticated;
