-- ═══════════════════════════════════════════════════════════════════════════
-- 학생 사진 — Supabase SQL Editor 붙여넣기용
--
-- 명부에 사진 칸을 만들고, 사진을 담을 비공개 버킷을 하나 만듭니다.
-- 여러 번 실행해도 됩니다.
-- ═══════════════════════════════════════════════════════════════════════════

-- 학생 사진 (학생증·도서관 카드용)
--
-- 졸업앨범 사진을 그대로 두면 크기도 구도도 제각각이라 카드에 못 씁니다. **여권 규격으로
-- 잘라서** 보관합니다 - 35×45mm, 300dpi 기준 413×531px.
--
-- 원본은 두지 않습니다. 원본은 앨범 폴더에 이미 있고, 여기 또 쌓으면 용량이 몇 배가 되며
-- 지울 때도 두 번 지워야 합니다.

alter table public.wr_students add column if not exists photo_path text;
alter table public.wr_students add column if not exists photo_updated_at timestamptz;
alter table public.wr_students add column if not exists photo_updated_by text;

comment on column public.wr_students.photo_path is
  '학생 사진(여권 규격으로 자른 것)의 student-photos 버킷 경로. 원본은 보관하지 않습니다.';

-- 비공개 버킷입니다. 아이 얼굴이라 공개 URL을 만들지 않고, 볼 때마다 짧게 사는 서명 주소를
-- 발급받습니다.
insert into storage.buckets (id, name, public)
values ('student-photos', 'student-photos', false)
on conflict (id) do nothing;

-- 교직원(회사 계정으로 로그인한 사람) 전체가 보고 올릴 수 있습니다. 담임도 행정도 아이
-- 얼굴을 확인할 일이 있고, 하원 인계나 전화 응대에서 특히 그렇습니다.
drop policy if exists student_photos_read on storage.objects;
create policy student_photos_read on storage.objects
  for select using (bucket_id = 'student-photos' and public.is_giamicro_user());

drop policy if exists student_photos_write on storage.objects;
create policy student_photos_write on storage.objects
  for insert with check (bucket_id = 'student-photos' and public.is_giamicro_user());

drop policy if exists student_photos_update on storage.objects;
create policy student_photos_update on storage.objects
  for update using (bucket_id = 'student-photos' and public.is_giamicro_user());

drop policy if exists student_photos_delete on storage.objects;
create policy student_photos_delete on storage.objects
  for delete using (bucket_id = 'student-photos' and public.is_giamicro_user());

insert into supabase_migrations.schema_migrations (version, name)
values ('20260902160000', 'student_photos')
on conflict (version) do nothing;

-- 확인 — 두 줄 모두 true 여야 합니다.
select '명부 사진 칸' as 항목, exists (
  select 1 from information_schema.columns
  where table_schema='public' and table_name='wr_students' and column_name='photo_path') as 있음
union all select '사진 버킷', exists (select 1 from storage.buckets where id='student-photos');
