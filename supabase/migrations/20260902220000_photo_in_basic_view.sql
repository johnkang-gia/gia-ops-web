-- 공용 명부 뷰에 학생 사진 경로를 더합니다
--
-- 업무보드의 학생 검색은 교직원 누구나 여는 화면이라 원본 표(wr_students)를 못 읽습니다.
-- 공용 뷰(wr_students_basic)만 볼 수 있는데 거기에 사진 칸이 없어서, 검색 결과에 얼굴을
-- 띄울 방법이 없었습니다.
--
-- 뷰의 where 절(is_giamicro_user() and is_demo = is_demo_user())은 그대로 둡니다. 이 한 줄이
-- 데모 계정에는 데모 학생만, 실제 계정에는 실제 학생만 보이게 하는 유일한 방어선입니다.

drop view if exists public.wr_students_basic;
create view public.wr_students_basic as
select
  s.id,
  s.name,
  s.name_en,
  s.grade,
  s.class_name,
  s.class_id,
  s.department,
  s.status,
  s.birth_date,
  s.gender,
  s.afterschool,
  s.instrument,
  s.shuttle_mode,
  s.allergies,
  s.note,
  s.family_id,
  -- 사진 자체가 아니라 **경로**만 나갑니다. 실제 그림은 비공개 버킷에 있고, 볼 때마다 짧게
  -- 사는 주소를 따로 받아야 합니다.
  s.photo_path,
  s.created_at
from public.wr_students s
where public.is_giamicro_user()
  and s.is_demo = public.is_demo_user();

revoke all on public.wr_students_basic from anon;
grant select on public.wr_students_basic to authenticated;
