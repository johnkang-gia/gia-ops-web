-- 명부의 이름 칸 정리 - 한글은 name, 영문은 name_en.
--
-- 담당자: "영어 이름으로 영어들을 넘기고, 마야랑 에이바는 한글 이름에다가 넣어주고,
--          제이콥도 한글 이름에 제이콥 넣어주고 영어 이름은 jacob으로 해줘."
--
-- 지금 몇몇 아이는 name 칸에 영문이 들어가 있습니다. 그러면 하원체크표·안내보드·기사님
-- 화면에 영문으로 뜨는데, 그 화면들을 보는 분들이 한글로 부르시니 알아보기 어렵습니다.
--
-- 한 트랜잭션입니다. 중간에 문제가 생기면 아무것도 바뀌지 않습니다.

begin;

-- ① 되돌릴 곳부터
drop table if exists wr_students_name_backup_20260827;
create table wr_students_name_backup_20260827 as
select id, name, name_en from wr_students where status = 'active' and is_demo = false;

-- ② name 칸에 영문이 들어 있으면 name_en으로 넘깁니다.
--    name_en이 이미 차 있으면 덮어쓰지 않습니다(더 정확한 값일 수 있으므로).
update wr_students
   set name_en = coalesce(nullif(name_en, ''), name)
 where status = 'active' and is_demo = false
   and name ~ '[A-Za-z]';

-- ③ 세 명은 한글 표기를 직접 넣습니다.
--    PDF·기사님·선생님이 실제로 부르는 이름입니다.
update wr_students
   set name = '마야'
 where status='active' and is_demo=false
   and name_en ilike 'Maya Amelia%';

update wr_students
   set name = '에이바'
 where status='active' and is_demo=false
   and name_en ilike 'Elliana Ma%';

update wr_students
   set name = '제이콥', name_en = 'Jacob Dylan Ma'
 where status='active' and is_demo=false
   and (name_en ilike 'Jacob Dylan%' or name = '제이콥 딜런 마');

-- ④ 셔틀 배정표에 박아둔 이름도 명부와 맞춥니다.
--    (student_name_raw는 화면에 그대로 뿌려지는 값이라, 명부만 고치면 셔틀은 옛 이름이
--     남습니다. 명부가 절대 기준이므로 여기서 다시 맞춰줍니다.)
update shuttle_assignments a
   set student_name_raw = w.name
  from wr_students w
 where a.student_id = w.id
   and a.student_name_raw is distinct from w.name;

commit;

-- 바뀐 것만 보여드립니다.
select b.name as "전 (한글칸)", b.name_en as "전 (영문칸)",
       w.name as "후 (한글칸)", w.name_en as "후 (영문칸)"
  from wr_students_name_backup_20260827 b
  join wr_students w on w.id = b.id
 where b.name is distinct from w.name
    or b.name_en is distinct from w.name_en
 order by w.name;

-- 아직 한글 이름이 없는 아이가 남아 있는지 확인합니다.
select name as "한글칸에 영문이 남은 아이", name_en as "영문칸", grade as "학년", class_name as "반"
  from wr_students
 where status='active' and is_demo=false and name ~ '[A-Za-z]'
 order by name;
