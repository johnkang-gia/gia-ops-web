-- ===== 97. 학생명부 공용화 + 권한 정리 =====
-- 요청: "학생명부를 다양하게 연결할 수 있도록 만들어주되, 이명부에 관한 권한은 행정직원,관리자,
-- 개발자... 로 할게" + 일반 교직원이 볼 수 있는 항목은 "이름(영어이름), 나이(생년월일), 성별,
-- 방과후수업진행여부, 악기, 셔틀탑승여부, 특이사항(알러지, 형제자매링크 등)"
--
-- 지금까지 wr_students는 "giamicro.com 계정이면 누구나 읽고 쓰기"였습니다. 즉 교사도 학생
-- 명부를 고칠 수 있었고, 보호자 연락처·주소 같은 개인정보도 전부 볼 수 있었습니다. 이번에
-- 두 가지로 나눕니다.
--   ① 원본 표(wr_students)   - 행정직원·관리자·개발자만 읽고 쓸 수 있음(모든 항목)
--   ② 공용 명부(wr_students_basic) - 교직원 누구나 읽을 수 있고, 위에 정하신 항목만 담음
-- 나중에 유치부 프로그램처럼 다른 시스템을 붙일 때도 ②를 보게 하면 개인정보를 넘기지 않고
-- 학생을 연결할 수 있습니다.
--
-- 개발자(johnkang@giamicro.com)는 is_app_admin() → is_wr_manager()에 이미 항상 포함되어 있어
-- 별도 처리 없이 최상위 권한으로 동작합니다.

-- 새로 필요한 항목들.
alter table wr_students add column if not exists afterschool boolean not null default false;
alter table wr_students add column if not exists instrument text
  check (instrument is null or instrument in ('첼로', '우쿨렐레', '클라리넷', '바이올린', '플룻'));
-- 형제자매 묶음 - 같은 집 아이들에게 같은 값을 넣어두면 부서를 넘나들어도(유치부 동생 ↔ 초등부
-- 형) 한 가족으로 이어집니다. 셔틀·보호자 연락·출결 이름 대조에 씁니다.
alter table wr_students add column if not exists family_id uuid;
create index if not exists wr_students_family_idx on wr_students(family_id);

-- ── ① 원본 표: 행정직원·관리자·개발자 전용 ────────────────────────────────────
drop policy if exists "giamicro_all_wr_students" on wr_students;
drop policy if exists "wr_manager_all_wr_students" on wr_students;
create policy "wr_manager_all_wr_students" on wr_students
  for all using (is_wr_manager()) with check (is_wr_manager());

-- 반 명부도 같은 기준으로 - 읽기는 모두(수업·출결 화면이 반 이름을 써야 함), 수정은 관리자급만.
drop policy if exists "giamicro_all_wr_classes" on wr_classes;
drop policy if exists "giamicro_select_wr_classes" on wr_classes;
create policy "giamicro_select_wr_classes" on wr_classes for select using (is_giamicro_user());
drop policy if exists "wr_manager_write_wr_classes" on wr_classes;
create policy "wr_manager_write_wr_classes" on wr_classes
  for all using (is_wr_manager()) with check (is_wr_manager());

-- ── ② 공용 명부: 교직원 누구나 읽기 ───────────────────────────────────────────
-- 보호자 연락처·이메일·주소·좌표·학번·custom_fields는 일부러 뺐습니다.
-- 뷰는 원본 표의 보안규칙을 우회하므로, 뷰 자체에서 giamicro.com 계정인지 한 번 확인합니다.
drop view if exists wr_students_basic;
create view wr_students_basic as
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
  s.created_at
from wr_students s
where is_giamicro_user();

revoke all on wr_students_basic from anon;
grant select on wr_students_basic to authenticated;
