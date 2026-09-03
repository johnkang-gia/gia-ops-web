-- ===== 형제자매 연결 =====
--
-- 137명 중 36명이 형제자매입니다. 17가정이고 그중 두 집은 세 남매입니다.
--
-- 왜 필요한가. 이 학교에서 형제자매는 **실무에서 계속 걸리는 자리**였습니다.
--
--   · 셔틀   - "서이 셔틀에 하임이도" 처럼 한 아이 차에 다른 아이를 태워달라는 연락
--   · 출결   - 형제 대화방에서 한 아이만 결석인데 다른 아이가 결석으로 들어간 일이 있었습니다
--   · 청구   - 같은 번호로 두 장이 갑니다. 어느 아이 것인지 부모가 헷갈립니다
--   · 하원   - 한 아이를 데리러 오면서 다른 아이도 데려가는 경우
--
-- 지금까지는 이것을 **연락처가 같다는 사실로 사람이 눈치채는 수밖에** 없었습니다.
--
-- 묶음 하나에 id 를 하나 주고, 같은 집 아이들이 그 id 를 나눠 갖습니다.
-- 별도의 '관계 표'를 두지 않은 이유: 형제가 셋이면 관계 표에는 세 줄(A-B, B-C, A-C)이
-- 필요하고, 한 명이 전학 가면 그 세 줄을 다 지워야 합니다. 하나 빠뜨리면 남은 두 아이가
-- 서로를 모릅니다. 묶음 id 는 한 칸만 비우면 끝납니다.

alter table public.wr_students add column if not exists sibling_group_id uuid;

comment on column public.wr_students.sibling_group_id is
  '같은 집 아이들이 나눠 갖는 묶음 id. 같은 값이면 형제자매입니다. 비어 있으면 외동이거나 아직 확인되지 않았습니다.';

create index if not exists wr_students_sibling_idx
  on public.wr_students (sibling_group_id)
  where sibling_group_id is not null;

-- 형제자매를 한눈에 보는 뷰. 화면에서 "이 아이의 형제자매"를 물을 때 이 뷰 하나만 봅니다.
create or replace view public.student_siblings as
select
  s.id            as student_id,
  s.name          as student_name,
  s.grade         as student_grade,
  s.class_name    as student_class,
  t.id            as sibling_id,
  t.name          as sibling_name,
  t.grade         as sibling_grade,
  t.class_name    as sibling_class,
  s.sibling_group_id
from public.wr_students s
join public.wr_students t
  on t.sibling_group_id = s.sibling_group_id
 and t.id <> s.id
where s.sibling_group_id is not null
  -- 데모 학생과 실제 학생이 한 집으로 묶이면 안 됩니다.
  and s.is_demo = t.is_demo;

comment on view public.student_siblings is
  '학생 한 명에 대해 그 형제자매를 한 줄씩. 같은 sibling_group_id 를 가진 아이들입니다.';
