-- ===== 100. 신입교사 오리엔테이션용 데모 계정 + 더미 데이터 =====
-- 요청: "교사들에게 설명하도록 교사 에게 보여줄수 있는 더미 계정을 하나 만들어주고, 학생데이터도
-- 더미로 넣어줘, 매번 신입선생님들이 오면 설명을 해야 하니 아예 가계정 하나와 더미데이터로
-- 어떻게 써넣으면 될지 알려줄 수 있게 가계정을 등록해줘"
--
-- 지금까지 신입 선생님께 사용법을 보여드리려면 (1) 실제 학생 명단을 띄워놓고 설명하거나
-- (2) 설명하는 사람의 계정으로 시연해야 했습니다. 둘 다 문제가 있습니다. 실제 학생의
-- 관찰기록을 연습 삼아 저장하면 그 기록이 그대로 학부모 리포트로 나가고, 잘못 누른 픽업 체크는
-- 하원 차량 운행에 곧바로 반영됩니다.
--
-- 그래서 "교사 화면은 실제와 완전히 똑같은데 보이는 학생은 전부 가짜"인 계정을 하나 둡니다.
-- 마음껏 눌러보고 저장하고 지워도 실제 기록에는 아무 영향이 없습니다.
--
-- 격리 방식: 표를 새로 만들지 않고 기존 표에 is_demo 칸 하나만 붙였습니다. 표를 따로 만들면
-- 모든 화면 코드를 "지금이 데모인지"에 따라 두 갈래로 나눠야 하고, 그러면 데모에서 잘 되던 게
-- 실제에서는 안 되는 일이 생깁니다. 지금 방식은 화면 코드가 하나 그대로이고, 누가 로그인했느냐에
-- 따라 보안규칙이 알아서 다른 행을 돌려줍니다 - 데모 계정에는 데모 행만, 나머지 모두에게는
-- 실제 행만 보입니다. 서로를 아예 볼 수 없으므로 섞일 수가 없습니다.

-- ── 데모 계정 판별 ───────────────────────────────────────────────────────────
-- 화면 쪽(src/lib/sharedAccounts.ts)의 isDemoAccount()와 같은 규칙입니다. 계정 목록을 DB에
-- 따로 두지 않고 이름 규칙으로 판단해서, 판별할 때마다 표를 조회하는 왕복을 없앴습니다.
create or replace function is_demo_user()
returns boolean
language sql
stable
as $$
  select coalesce(lower(auth.jwt() ->> 'email') like 'gia-demo%@giamicro.com', false);
$$;

-- ── 데모 표시 칸 ─────────────────────────────────────────────────────────────
alter table wr_students add column if not exists is_demo boolean not null default false;
alter table wr_classes  add column if not exists is_demo boolean not null default false;
create index if not exists wr_students_is_demo_idx on wr_students(is_demo);
create index if not exists wr_classes_is_demo_idx on wr_classes(is_demo);

-- 리포트·출결에는 is_demo 칸을 따로 두지 않고 "이 학생이 데모 학생인가"를 되묻습니다. 칸을
-- 하나 더 두면 학생은 데모인데 리포트는 실제로 표시되는 식으로 두 값이 어긋날 수 있습니다.
--
-- security definer로 두는 이유: 보안규칙 안에서 다른 표를 조회하면 그 표의 보안규칙도 함께
-- 걸립니다. wr_students는 행정직원급만 읽을 수 있으므로, 이 함수가 일반 함수라면 교사가 리포트를
-- 읽을 때 조회가 막혀 "리포트가 하나도 없는" 화면이 됩니다. definer로 두면 함수 안에서는 소유자
-- 권한으로 조회하되, 돌려주는 값은 참/거짓 한 개뿐이라 개인정보가 새지 않습니다.
create or replace function wr_student_is_demo(p_student_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select coalesce((select is_demo from wr_students where id = p_student_id), false);
$$;

-- ── 보안규칙: 데모 계정과 실제 계정이 서로를 못 보게 ──────────────────────────
-- 공용 명부(뷰)는 원본 표의 보안규칙을 우회하므로 뷰 자체의 where 절이 유일한 방어선입니다.
-- is_demo = is_demo_user() 한 줄이 양방향을 동시에 처리합니다: 데모 계정(참)에게는 데모 행만,
-- 나머지 계정(거짓)에게는 실제 행만 보입니다.
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
where is_giamicro_user()
  and s.is_demo = is_demo_user();

revoke all on wr_students_basic from anon;
grant select on wr_students_basic to authenticated;

-- 원본 학생 표(행정직원·관리자·개발자 전용)에서는 데모 학생을 아예 감춥니다 - 학생 명부 관리
-- 화면에 가짜 학생이 섞여 나오면 실제 명단을 헷갈리게 만듭니다. 데모 학생은 이 마이그레이션이
-- 유일한 관리 창구입니다(바꿀 일이 생기면 여기서 고쳐 다시 배포합니다).
drop policy if exists "wr_manager_all_wr_students" on wr_students;
create policy "wr_manager_all_wr_students" on wr_students
  for all using (is_wr_manager() and is_demo = false)
  with check (is_wr_manager() and is_demo = false);

drop policy if exists "giamicro_select_wr_classes" on wr_classes;
create policy "giamicro_select_wr_classes" on wr_classes
  for select using (is_giamicro_user() and is_demo = is_demo_user());

drop policy if exists "wr_manager_write_wr_classes" on wr_classes;
create policy "wr_manager_write_wr_classes" on wr_classes
  for all using (is_wr_manager() and is_demo = false)
  with check (is_wr_manager() and is_demo = false);

-- 관찰기록: 데모 계정이 연습으로 저장한 기록은 실제 화면 어디에도 나타나지 않고, 반대로 실제
-- 학생 기록은 데모 계정에서 절대 열리지 않습니다.
drop policy if exists "giamicro_select_wr_reports" on wr_reports;
create policy "giamicro_select_wr_reports" on wr_reports
  for select using (is_giamicro_user() and wr_student_is_demo(student_id) = is_demo_user());

drop policy if exists "giamicro_insert_wr_reports" on wr_reports;
create policy "giamicro_insert_wr_reports" on wr_reports
  for insert with check (is_giamicro_user() and wr_student_is_demo(student_id) = is_demo_user());

drop policy if exists "giamicro_update_wr_reports" on wr_reports;
create policy "giamicro_update_wr_reports" on wr_reports
  for update using (is_giamicro_user() and wr_student_is_demo(student_id) = is_demo_user())
  with check (is_giamicro_user() and wr_student_is_demo(student_id) = is_demo_user());

drop policy if exists "giamicro_all_attendance_records" on attendance_records;
create policy "giamicro_all_attendance_records" on attendance_records
  for all using (is_giamicro_user() and wr_student_is_demo(student_id) = is_demo_user())
  with check (is_giamicro_user() and wr_student_is_demo(student_id) = is_demo_user());

-- ── 데모 셔틀 노선 ───────────────────────────────────────────────────────────
-- 픽업 체크 화면을 실제처럼 보여주려면 학생이 하원 차량에 배정되어 있어야 합니다. 셔틀 표들은
-- 이미 term(정규학기 / 여름캠프2)으로 나뉘어 있고 모든 화면이 term으로 걸러 조회하므로, '데모'
-- term을 하나 더 두면 실제 운행 화면에는 전혀 나타나지 않습니다.
alter table shuttle_routes drop constraint if exists shuttle_routes_term_check;
alter table shuttle_routes add constraint shuttle_routes_term_check
  check (term in ('정규학기', '여름캠프2', '데모'));

-- 화면마다 term 조건을 붙이는 것만으로는 부족합니다. 노선 관리·지역 현황처럼 term을 따지지 않고
-- 전체를 훑는 화면이 여럿 있어서, 그런 곳에 가짜 "9호"가 섞여 나오면 실제 운행표를 헷갈리게
-- 만듭니다. 반대로 데모 계정이 실제 정류장 주소를 읽을 수 있는 것도 바람직하지 않습니다.
-- 그래서 학생 명부와 같은 방식으로 보안규칙 단계에서 양방향으로 갈라둡니다.
--
-- 아래 두 함수를 security definer로 두는 이유는 wr_student_is_demo와 같습니다 - 보안규칙 안에서
-- 다른 표를 조회하면 그 표의 규칙이 또 걸려 서로 물고 물리는 상황이 생기기 때문입니다.
create or replace function shuttle_route_is_demo(p_route_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select coalesce((select term = '데모' from shuttle_routes where id = p_route_id), false);
$$;

create or replace function shuttle_stop_is_demo(p_stop_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select coalesce((select shuttle_route_is_demo(route_id) from shuttle_stops where id = p_stop_id), false);
$$;

create or replace function shuttle_assignment_is_demo(p_assignment_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select coalesce((select shuttle_stop_is_demo(stop_id) from shuttle_assignments where id = p_assignment_id), false);
$$;

drop policy if exists "giamicro_select_shuttle_routes" on shuttle_routes;
create policy "giamicro_select_shuttle_routes" on shuttle_routes
  for select using (is_giamicro_user() and (term = '데모') = is_demo_user());
drop policy if exists "wr_manager_write_shuttle_routes" on shuttle_routes;
create policy "wr_manager_write_shuttle_routes" on shuttle_routes
  for all using (is_wr_manager() and term <> '데모') with check (is_wr_manager() and term <> '데모');

drop policy if exists "giamicro_select_shuttle_stops" on shuttle_stops;
create policy "giamicro_select_shuttle_stops" on shuttle_stops
  for select using (is_giamicro_user() and shuttle_route_is_demo(route_id) = is_demo_user());

drop policy if exists "giamicro_select_shuttle_assignments" on shuttle_assignments;
drop policy if exists "wr_manager_write_shuttle_assignments" on shuttle_assignments;
create policy "wr_manager_write_shuttle_assignments" on shuttle_assignments
  for all using (is_wr_manager() and shuttle_stop_is_demo(stop_id) = false)
  with check (is_wr_manager() and shuttle_stop_is_demo(stop_id) = false);

-- 탑승 체크(픽업/결석)는 데모 계정이 직접 저장하는 유일한 셔틀 데이터입니다. 실제 하원 운행에
-- 절대 섞이지 않도록 여기가 마지막 방어선입니다.
drop policy if exists "giamicro_all_shuttle_boardings" on shuttle_boardings;
create policy "giamicro_all_shuttle_boardings" on shuttle_boardings
  for all using (is_giamicro_user() and shuttle_assignment_is_demo(assignment_id) = is_demo_user())
  with check (is_giamicro_user() and shuttle_assignment_is_demo(assignment_id) = is_demo_user());

-- 공용 배정표(뷰)도 같은 기준으로 - 뷰는 원본 표의 보안규칙을 우회하므로 따로 걸러야 합니다.
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
where is_giamicro_user()
  and shuttle_stop_is_demo(a.stop_id) = is_demo_user();

revoke all on shuttle_assignments_basic from anon;
grant select on shuttle_assignments_basic to authenticated;

-- ── 데모 데이터 ──────────────────────────────────────────────────────────────
-- 고정 UUID를 씁니다. 나중에 이 마이그레이션을 고쳐 다시 돌려도 같은 행을 갱신하게 되어
-- 데모 학생이 두 벌 세 벌로 늘어나지 않습니다.

-- 계정 정보. 실제 로그인 비밀번호는 여기서 만들 수 없고(마이그레이션 파일에 비밀번호를 적어두는
-- 것은 위험합니다), 관리자가 [관리자 > 공용 계정 관리] 화면에서 직접 정합니다. 이 행은 그
-- 계정이 로그인했을 때 "승인된 초등부 교사"로 취급되도록 미리 깔아두는 것입니다.
insert into app_users (email, name, department, position, status, decided_by, decided_at)
values ('gia-demo@giamicro.com', '오리엔테이션 데모', '초등부', '교사', 'approved', 'system', now())
on conflict (email) do update
  set name = excluded.name,
      department = excluded.department,
      position = excluded.position,
      status = excluded.status;

-- 데모 담임반. teacher_email이 데모 계정이라 로그인하면 [내 담임반]에 바로 이 반이 뜹니다.
insert into wr_classes (id, grade, class_name, teacher_email, department, is_demo)
values ('d0000000-0000-4000-a000-000000000001', '3', 'Demo', 'gia-demo@giamicro.com', '초등부', true)
on conflict (id) do update
  set grade = excluded.grade,
      class_name = excluded.class_name,
      teacher_email = excluded.teacher_email,
      department = excluded.department,
      is_demo = true;

-- 데모 학생 8명. 설명할 거리가 나오도록 상황을 일부러 섞었습니다 - 알러지가 있는 학생, 악기
-- 수업을 듣는 학생, 방과후 수업이 있는 학생, 형제자매가 함께 다니는 경우(family_id가 같은 두
-- 명), 셔틀을 타지 않는 학생까지 한 반 안에 들어 있습니다.
insert into wr_students (id, name, name_en, grade, class_name, class_id, department, status, birth_date, gender, afterschool, instrument, shuttle_mode, allergies, note, family_id, is_demo)
values
  ('d0000000-0000-4000-b000-000000000001', '김서준', 'Seojun Kim',   '3', 'Demo', 'd0000000-0000-4000-a000-000000000001', '초등부', 'active', '2017-03-14', '남', true,  '바이올린',  '등하원', null,        '수업 중 질문이 많고 발표를 좋아합니다.', 'd0000000-0000-4000-c000-000000000001', true),
  ('d0000000-0000-4000-b000-000000000002', '이하윤', 'Hayun Lee',    '3', 'Demo', 'd0000000-0000-4000-a000-000000000001', '초등부', 'active', '2017-06-02', '여', false, '첼로',      '등하원', '땅콩',      '조용하지만 글쓰기를 잘합니다.', null, true),
  ('d0000000-0000-4000-b000-000000000003', '박도윤', 'Doyun Park',   '3', 'Demo', 'd0000000-0000-4000-a000-000000000001', '초등부', 'active', '2017-01-28', '남', true,  null,        '등하원', null,        null, null, true),
  ('d0000000-0000-4000-b000-000000000004', '최지우', 'Jiwoo Choi',   '3', 'Demo', 'd0000000-0000-4000-a000-000000000001', '초등부', 'active', '2017-09-19', '여', false, '플룻',      '등하원', null,        '친구들을 잘 챙깁니다.', null, true),
  ('d0000000-0000-4000-b000-000000000005', '정시우', 'Siwoo Jung',   '3', 'Demo', 'd0000000-0000-4000-a000-000000000001', '초등부', 'active', '2017-11-05', '남', false, null,        '없음', '우유',      '하원은 보호자가 직접 데리러 옵니다.', null, true),
  ('d0000000-0000-4000-b000-000000000006', '강유나', 'Yuna Kang',    '3', 'Demo', 'd0000000-0000-4000-a000-000000000001', '초등부', 'active', '2017-04-22', '여', true,  '우쿨렐레',  '등하원', null,        null, 'd0000000-0000-4000-c000-000000000002', true),
  ('d0000000-0000-4000-b000-000000000007', '윤예준', 'Yejun Yoon',   '3', 'Demo', 'd0000000-0000-4000-a000-000000000001', '초등부', 'active', '2017-07-30', '남', false, '클라리넷',  '등하원', null,        '동생과 함께 등하원합니다.', 'd0000000-0000-4000-c000-000000000002', true),
  ('d0000000-0000-4000-b000-000000000008', '임소율', 'Soyul Lim',    '3', 'Demo', 'd0000000-0000-4000-a000-000000000001', '초등부', 'active', '2017-12-11', '여', false, null,        '없음', null,        null, null, true)
on conflict (id) do update
  set name = excluded.name,
      name_en = excluded.name_en,
      grade = excluded.grade,
      class_name = excluded.class_name,
      class_id = excluded.class_id,
      department = excluded.department,
      status = excluded.status,
      birth_date = excluded.birth_date,
      gender = excluded.gender,
      afterschool = excluded.afterschool,
      instrument = excluded.instrument,
      shuttle_mode = excluded.shuttle_mode,
      allergies = excluded.allergies,
      note = excluded.note,
      family_id = excluded.family_id,
      is_demo = true;

-- 데모 하원 노선 1개 + 정류장 1개. 픽업 체크 화면에서 "9호"로 표시됩니다.
insert into shuttle_routes (id, direction, route_no, name, driver_name, vehicle_no, teacher_name, depart_time, term, active, sort_order)
values ('d0000000-0000-4000-d000-000000000001', '하원', '9', '데모 노선', '홍기사', '서울 00가 0000', '데모 동승', '16:00', '데모', true, 999)
on conflict (id) do update
  set direction = excluded.direction,
      route_no = excluded.route_no,
      name = excluded.name,
      term = '데모',
      active = true;

insert into shuttle_stops (id, route_id, seq, stop_time, address, note)
values ('d0000000-0000-4000-e000-000000000001', 'd0000000-0000-4000-d000-000000000001', 1, '16:20', '데모 정류장 (Demo stop)', '연습용입니다.')
on conflict (id) do update
  set route_id = excluded.route_id,
      seq = excluded.seq,
      stop_time = excluded.stop_time,
      address = excluded.address;

-- 8명 중 6명만 셔틀에 배정합니다. 나머지 2명(정시우·임소율)은 픽업 체크 화면에서 "셔틀 미탑승"
-- 회색 카드로 나타나서, 그 상태가 어떻게 보이는지도 함께 설명할 수 있습니다.
insert into shuttle_assignments (id, stop_id, student_id, student_name_raw, class_raw, weekdays)
values
  ('d0000000-0000-4000-f000-000000000001', 'd0000000-0000-4000-e000-000000000001', 'd0000000-0000-4000-b000-000000000001', '김서준', '3 Demo', '{1,2,3,4,5}'),
  ('d0000000-0000-4000-f000-000000000002', 'd0000000-0000-4000-e000-000000000001', 'd0000000-0000-4000-b000-000000000002', '이하윤', '3 Demo', '{1,2,3,4,5}'),
  ('d0000000-0000-4000-f000-000000000003', 'd0000000-0000-4000-e000-000000000001', 'd0000000-0000-4000-b000-000000000003', '박도윤', '3 Demo', '{1,2,3,4,5}'),
  ('d0000000-0000-4000-f000-000000000004', 'd0000000-0000-4000-e000-000000000001', 'd0000000-0000-4000-b000-000000000004', '최지우', '3 Demo', '{1,2,3,4,5}'),
  ('d0000000-0000-4000-f000-000000000005', 'd0000000-0000-4000-e000-000000000001', 'd0000000-0000-4000-b000-000000000006', '강유나', '3 Demo', '{1,2,3,4,5}'),
  ('d0000000-0000-4000-f000-000000000006', 'd0000000-0000-4000-e000-000000000001', 'd0000000-0000-4000-b000-000000000007', '윤예준', '3 Demo', '{1,2,3,4,5}')
on conflict (id) do update
  set stop_id = excluded.stop_id,
      student_id = excluded.student_id,
      student_name_raw = excluded.student_name_raw,
      class_raw = excluded.class_raw,
      weekdays = excluded.weekdays;

-- 이미 작성된 관찰기록 예시 두 건. 신입 선생님이 빈 화면부터 시작하면 "무엇을 어느 정도로
-- 적어야 하는지" 감이 오지 않습니다. 발행된 기록 하나와 임시저장 하나를 미리 넣어두어, 완성된
-- 예시를 열어보고 그 수준에 맞춰 연습할 수 있게 합니다.
insert into wr_reports (id, student_id, subject, academic, improvement, participation, behavior, social, teacher_note, eval_badges, status, report_date)
values
  ('d0000000-0000-4000-9000-000000000001', 'd0000000-0000-4000-b000-000000000001', '담임',
   '곱셈 단원에서 두 자리 수 계산까지 정확하게 해결합니다. 특히 문장제 문제를 그림으로 바꿔 푸는 방법을 스스로 찾아냈습니다.',
   '풀이 과정을 생략하고 답만 적는 경우가 있어, 과정을 남기도록 지도하고 있습니다.',
   '발표를 자원하는 횟수가 지난주보다 늘었고, 친구의 답에도 이유를 물으며 반응합니다.',
   '준비물을 스스로 챙기고 정리 시간에 끝까지 남아 돕습니다.',
   '모둠 활동에서 의견이 갈릴 때 먼저 양보하고 대안을 제안합니다.',
   '이번 주 서준이는 수학에서 자신감이 눈에 띄게 붙었습니다. 답을 맞히는 것보다 과정을 설명하는 데 재미를 붙이고 있어, 집에서도 "왜 그렇게 풀었어?"라고 한 번 물어봐 주시면 큰 도움이 됩니다.',
   '{"academic":["excellent"],"improvement":["good"],"participation":["excellent"],"behavior":["good"],"social":["good"]}',
   'published', current_date),
  ('d0000000-0000-4000-9000-000000000002', 'd0000000-0000-4000-b000-000000000002', '담임',
   '읽기 이해력이 좋아 글의 흐름을 잘 요약합니다.',
   '', '', '', '', '',
   '{"academic":["good"],"improvement":["good"],"participation":["good"],"behavior":["good"],"social":["good"]}',
   'draft', current_date)
on conflict (id) do update
  set academic = excluded.academic,
      improvement = excluded.improvement,
      participation = excluded.participation,
      behavior = excluded.behavior,
      social = excluded.social,
      teacher_note = excluded.teacher_note,
      eval_badges = excluded.eval_badges,
      status = excluded.status,
      report_date = excluded.report_date;
