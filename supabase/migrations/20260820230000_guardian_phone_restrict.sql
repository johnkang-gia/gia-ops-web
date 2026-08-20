-- ===== 98. 셔틀 배정표의 보호자 연락처 보호 =====
-- 요청: "보호자 연락처, 이메일, 주소, 좌표, 학번의 경우 행정직원과 관리자만 볼 수 있도록해줘"
--
-- 학생 명부(wr_students)는 앞 단계에서 이미 막았는데, 같은 정보가 셔틀 배정표에도 한 벌 더
-- 들어 있었습니다(shuttle_assignments.guardian_phone). 이 표는 동승선생님이 교사 계정일 수
-- 있어 조회를 열어둔 상태여서, 화면에는 안 보여도 데이터로는 교사가 읽을 수 있었습니다.
--
-- 명부와 같은 방식으로 나눕니다.
--   ① 원본 표(shuttle_assignments)          - 행정직원·관리자·개발자만
--   ② 공용 배정표(shuttle_assignments_basic) - 보호자 연락처만 빼고 나머지는 교직원 모두
-- 하원 체크표·실시간 셔틀은 ②만 있으면 되므로 동승선생님 업무에는 영향이 없습니다.

drop policy if exists "giamicro_select_shuttle_assignments" on shuttle_assignments;

drop view if exists shuttle_assignments_basic;
create view shuttle_assignments_basic as
select
  a.id,
  a.stop_id,
  a.student_id,
  a.student_name_raw,
  a.class_raw,
  a.weekdays,
  a.note,
  a.override_route_id,
  a.created_at
from shuttle_assignments a
where is_giamicro_user();

revoke all on shuttle_assignments_basic from anon;
grant select on shuttle_assignments_basic to authenticated;
