-- ===== 100. 도서관 구역(책장 위치) 체계 =====
-- 요청: "장서목록을 검색하고 볼 수 있게 해주고, 그 장서가 어느 구역에 있는지도 잘 찾을 수 있게...
-- 책을 등록하고 나중에 책장에 꽂고나서 그 책장에 구역을 부과하고... 반납하고나서도 아무데나
-- 꽂아 넣는게 아니라 정해진 위치에 다시 넣을 수 있도록" + "나중에 책장구조를 알려줄게 그러면
-- 화면에 책장화면을 간단한 벡터로 넣어주고, 그 구역을 보여줘서 찾아 넣을 수 있게"
--
-- 지금까지 책의 위치는 lib_books.location 이라는 자유 입력 글자 한 칸이었습니다. 사람마다
-- 'A-3', 'a3', 'A3 칸'처럼 다르게 적으면 검색이 안 되고, 배치도를 그릴 수도 없습니다. 구역을
-- 별도 표로 올려서 ① 이름을 한 곳에서 관리하고 ② 책장 평면도의 좌표를 함께 담습니다.

-- ── ① 구역(lib_locations) ───────────────────────────────────────────────────
-- code   - 라벨과 바코드에 찍히는 짧은 이름. 체계는 학교가 정하는 대로 자유롭게 씁니다
--          (A-1 같은 책장-칸 번호도 되고, '그림책' 같은 분류 이름도 됩니다).
-- map_*  - 도서관 평면도에서의 자리(격자 칸 단위). 책장 구조를 받은 뒤에 채우면 되고,
--          비어 있으면 배치도 대신 목록으로만 보여줍니다.
create table if not exists lib_locations (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  name text,
  note text,
  color text not null default '#1d4ed8',
  sort_order integer not null default 0,
  map_x numeric,
  map_y numeric,
  map_w numeric not null default 3,
  map_h numeric not null default 2,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists lib_locations_code_idx on lib_locations(upper(code));
create index if not exists lib_locations_sort_idx on lib_locations(sort_order, code);

-- ── ② 도서관 평면도 설정(lib_map) ───────────────────────────────────────────
-- 격자 칸 수만 정해두면, 구역들을 그 위에 올려놓는 방식으로 배치도를 그립니다.
create table if not exists lib_map (
  id integer primary key default 1 check (id = 1),
  cols integer not null default 24 check (cols between 4 and 200),
  rows integer not null default 14 check (rows between 4 and 200),
  note text,
  updated_at timestamptz not null default now()
);
insert into lib_map (id) values (1) on conflict (id) do nothing;

-- ── ③ 책에 구역 연결 ────────────────────────────────────────────────────────
alter table lib_books add column if not exists location_id uuid
  references lib_locations(id) on delete set null;
create index if not exists lib_books_location_idx on lib_books(location_id);

-- 예전에 자유 입력으로 적어둔 위치가 있으면 구역으로 옮겨 담습니다(처음 설치라면 아무 일도
-- 일어나지 않습니다). lib_books.location 칸은 그대로 두지만 화면에서는 더 이상 쓰지 않습니다.
insert into lib_locations (code)
select distinct trim(location)
from lib_books
where location is not null and trim(location) <> ''
on conflict do nothing;

update lib_books b
set location_id = l.id
from lib_locations l
where b.location_id is null
  and b.location is not null
  and upper(trim(b.location)) = upper(l.code);

-- ── ④ 반납 후 제자리 정리 표시 ──────────────────────────────────────────────
-- 반납받은 책을 책수레에 모아뒀다가 나중에 꽂는 경우가 많아서, "아직 안 꽂은 책"을 구역별로
-- 묶어 보여줄 수 있도록 정리 시각을 남깁니다. 반납함(book drop)에 들어온 책도 같은 목록에
-- 나타납니다.
alter table lib_loans add column if not exists reshelved_at timestamptz;
create index if not exists lib_loans_reshelve_idx on lib_loans(returned_at desc)
  where status = '반납완료' and reshelved_at is null;

-- ── ⑤ 갱신시각 자동 기록 ────────────────────────────────────────────────────
drop trigger if exists lib_locations_set_updated_at on lib_locations;
create trigger lib_locations_set_updated_at
  before update on lib_locations
  for each row execute function set_updated_at();

drop trigger if exists lib_map_set_updated_at on lib_map;
create trigger lib_map_set_updated_at
  before update on lib_map
  for each row execute function set_updated_at();

-- ── ⑥ 보안규칙 ──────────────────────────────────────────────────────────────
alter table lib_locations enable row level security;
alter table lib_map enable row level security;

drop policy if exists "lib_all_locations" on lib_locations;
create policy "lib_all_locations" on lib_locations
  for all using (is_lib_user()) with check (is_lib_user());

drop policy if exists "lib_all_map" on lib_map;
create policy "lib_all_map" on lib_map
  for all using (is_lib_user()) with check (is_lib_user());

-- ── ⑦ 도서카드 꾸미기(배경 그림 · 사진) ─────────────────────────────────────
-- 요청: "도서카드 배경 그림을 보내주면 거기에 학생의 이름과 학생고유바코드를 넣어서 인쇄할 수
-- 있도록... 사진을 넣을 수도 있고, 사진없이 이름만 넣어서 뽑을 수 있도록".
-- 배경 그림은 학교가 직접 올려서 언제든 바꿀 수 있게 만듭니다(그림 파일은 Supabase 저장소에
-- 두고 주소만 여기 적어둡니다).
alter table lib_settings add column if not exists card_bg_url text;
alter table lib_settings add column if not exists card_text_color text not null default '#10203a';
alter table lib_settings add column if not exists card_show_photo boolean not null default false;

-- 도서카드에 넣을 학생 사진. 운영앱의 학생 명부(wr_students)는 건드리지 않고 도서관 쪽에만
-- 보관합니다(도서관 가계정이 학생 개인정보 표를 고칠 수 없기 때문이기도 합니다).
create table if not exists lib_student_photos (
  student_no text primary key,
  url text not null,
  updated_at timestamptz not null default now()
);

alter table lib_student_photos enable row level security;
drop policy if exists "lib_all_student_photos" on lib_student_photos;
create policy "lib_all_student_photos" on lib_student_photos
  for all using (is_lib_user()) with check (is_lib_user());

drop trigger if exists lib_student_photos_set_updated_at on lib_student_photos;
create trigger lib_student_photos_set_updated_at
  before update on lib_student_photos
  for each row execute function set_updated_at();

-- ── ⑧ 그림 파일 저장소(Supabase Storage) ────────────────────────────────────
-- 도서카드 배경과 학생 사진을 담을 'library' 버킷입니다. 인쇄 화면에서 그림을 바로 불러와야
-- 해서 읽기는 공개로 두고, 올리고 지우는 것은 회사 계정만 할 수 있게 합니다.
-- (저장소 권한은 프로젝트 설정에 따라 마이그레이션에서 못 건드릴 수도 있어, 실패해도 전체가
--  멈추지 않도록 감쌌습니다. 그런 경우 Supabase 대시보드에서 버킷만 만들어 주면 됩니다.)
do $$
begin
  insert into storage.buckets (id, name, public)
  values ('library', 'library', true)
  on conflict (id) do nothing;
exception when others then
  raise notice 'library 버킷을 만들지 못했습니다(대시보드에서 직접 만들어 주세요): %', sqlerrm;
end $$;

do $$
begin
  execute $p$drop policy if exists "library_read" on storage.objects$p$;
  execute $p$create policy "library_read" on storage.objects
    for select using (bucket_id = 'library')$p$;

  execute $p$drop policy if exists "library_write" on storage.objects$p$;
  execute $p$create policy "library_write" on storage.objects
    for insert to authenticated with check (bucket_id = 'library' and is_lib_user())$p$;

  execute $p$drop policy if exists "library_update" on storage.objects$p$;
  execute $p$create policy "library_update" on storage.objects
    for update to authenticated using (bucket_id = 'library' and is_lib_user())$p$;

  execute $p$drop policy if exists "library_delete" on storage.objects$p$;
  execute $p$create policy "library_delete" on storage.objects
    for delete to authenticated using (bucket_id = 'library' and is_lib_user())$p$;
exception when others then
  raise notice '저장소 권한 설정을 건너뜁니다(대시보드에서 설정해 주세요): %', sqlerrm;
end $$;
