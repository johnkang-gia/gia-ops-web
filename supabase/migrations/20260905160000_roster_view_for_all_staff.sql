-- ===== 학생 명부: 모두가 보고, 고치는 것은 행정실만 =====
--
-- 지금 `wr_students` 는 행정직원·관리자만 읽을 수 있습니다(RLS). 그래서 교사가 명부 관리를
-- 누르면 화면이 **주간 관찰기록으로 되돌아갔습니다** - 권한이 없다고 판단해 되돌리는 줄이
-- 화면 맨 앞에 있었기 때문입니다.
--
-- 그런데 담임은 자기 반 아이의 학년·반·생일·알레르기·셔틀을 늘 봐야 합니다. 못 보게 막을
-- 이유가 없고, 막으면 결국 종이 명단을 따로 들고 다니게 됩니다.
--
-- 막아야 하는 것은 **보호자 연락처**입니다. 그것만 빼고 나머지는 교직원 모두가 봅니다.
--
-- 공용 뷰(wr_students_basic)에 명부 화면이 쓰는 칸을 더합니다. 원본 표는 그대로 잠가둡니다 -
-- 화면에서만 가리면 주소창을 직접 치거나 API 를 부르는 것으로 뚫립니다. **뷰에 아예 없어야**
-- 못 봅니다.

drop view if exists public.wr_students_basic;
create view public.wr_students_basic as
select
  s.id,
  -- 영구 고유번호. 동명이인을 가릴 때 씁니다.
  s.student_no,
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

  -- 주소와 좌표. 셔틀 노선을 정하는 자리에서 필요합니다.
  s.address,
  s.lat,
  s.lng,
  s.geocoded_at,

  -- 학생 본인 연락처. 보호자 번호와 다릅니다.
  s.phone,

  -- 관리자가 직접 만든 칸들. 명부 화면이 이 칸도 함께 보여줍니다.
  s.custom_fields,

  -- 사진 자체가 아니라 **경로**만 나갑니다. 실제 그림은 비공개 버킷에 있고, 볼 때마다 짧게
  -- 사는 주소를 따로 받아야 합니다.
  s.photo_path,
  s.photo_updated_at,
  s.created_at
  --
  -- 일부러 뺀 칸: mother_phone · father_phone · parent_phone · parent_email
  --
  -- 보호자 연락처는 행정실이 다룹니다. 교사가 학부모에게 직접 거는 일이 없지는 않지만,
  -- 그 통로는 담임 화면(픽업 체크·문의)에 따로 있고 거기서는 그 반 아이만 보입니다.
  -- 여기서 전교생 연락처가 한 화면에 늘어서는 것과는 다른 일입니다.
from public.wr_students s
-- 이 한 줄이 데모 계정에는 데모 학생만, 실제 계정에는 실제 학생만 보이게 하는 유일한
-- 방어선입니다. 건드리지 않습니다.
where public.is_giamicro_user()
  and s.is_demo = public.is_demo_user();

revoke all on public.wr_students_basic from anon;
grant select on public.wr_students_basic to authenticated;

comment on view public.wr_students_basic is
  '교직원 공용 명부. 보호자 연락처(mother_phone·father_phone·parent_phone·parent_email)는 일부러 빠져 있습니다 - 화면에서만 가리면 API 로 뚫리므로 뷰에 아예 두지 않습니다.';
