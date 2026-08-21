-- ============================================================================
--  GIA 운영앱 - 손으로 적용하는 SQL 2/3 : 2026학년도 3학기 학교 데이터 (학생·반·시간표)
-- ============================================================================
--  GitHub Actions의 자동 반영이 v0.127.0 실행부터 실패해서, 그 뒤로 만든 스키마와 3학기 학교
--  데이터가 실서버에 하나도 들어가지 않았습니다. 자동 반영을 고치기 전에 우선 손으로 넣습니다.
--
--  ▶ 사용법 - Supabase 대시보드 → SQL Editor → New query → 이 파일 전체 붙여넣기 → Run
--  ▶ 순서대로 1 → 2 → 3 을 각각 실행해주세요.
--  ▶ 빨간 오류가 나면 그 문구를 그대로 알려주세요. 어디서 막혔는지 바로 알 수 있습니다.
--  ▶ 여러 번 실행해도 안전합니다 - 모든 문장이 "없으면 만들고 있으면 갱신"하는 방식입니다.
-- ============================================================================



-- ════════════════════════════════════════════════════════════════
-- 20260822120000_term3_school_data.sql
-- ════════════════════════════════════════════════════════════════
-- ===== 103. 2026학년도 3학기 학교 데이터 일괄 적재 =====
-- 요청: "이번정규학기(3학기)에 모든 데이터를 줄거야... 아이들 정규학기 만들어서 넣어주고, 반도,
-- 담임도 전부 들어가 있어... 각 반 시간표 등 학교에 관한 모든 자료가 있으니 분석해서 데이터를
-- 전부 넣어줘"
--
-- 출처: "26-27 GIA Primary Roster [Admin Version].pdf" (35쪽)
--   1쪽  학생 명부(재학 100명 + 전출·퇴원 26명)
--   2쪽  교직원 명부
--   10~17쪽 반별 시간표 8개
--
-- ── 이 파일이 지키는 원칙 ────────────────────────────────────────────────────
-- ① 여러 번 돌려도 같은 결과가 되도록 만들었습니다. 이름·생년월일로 기존 학생을 찾아 갱신하고,
--    없을 때만 새로 만듭니다. 실수로 두 번 적용돼도 학생이 두 벌로 늘지 않습니다.
-- ② 앱에서 손으로 채워둔 값은 지우지 않습니다. 명부에 값이 있는 칸만 덮어쓰고, 명부가 비어 있는
--    칸은 기존 값을 그대로 둡니다. 특이사항(note)은 덮어쓰지 않고 뒤에 덧붙입니다.
-- ③ 사람이 확인해야 하는 상황(동명이인, 생년월일 불일치 등)은 화면에 뜨도록 wr_import_issues에
--    남깁니다 - 조용히 넘어가면 나중에 "왜 이 학생이 두 명이지?"를 추적할 수 없습니다.
-- ④ 담임은 아직 이메일이 없어(선생님들이 가입 전) 이름만 넣어둡니다. 가입할 때 자동으로
--    연결됩니다.

-- ── 확인이 필요한 사항을 남겨두는 곳 ────────────────────────────────────────
create table if not exists wr_import_issues (
  id uuid primary key default gen_random_uuid(),
  source text not null,               -- 어떤 자료를 넣다가 생긴 문제인지
  kind text not null,                 -- 동명이인 / 생년월일불일치 / 생년월일없음
  student_name text,
  detail text not null,
  resolved boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists wr_import_issues_open_idx on wr_import_issues(resolved, created_at desc);
alter table wr_import_issues enable row level security;
drop policy if exists "wr_manager_all_wr_import_issues" on wr_import_issues;
create policy "wr_manager_all_wr_import_issues" on wr_import_issues
  for all using (is_wr_manager()) with check (is_wr_manager());

-- 같은 자료를 다시 넣을 때 지난 기록이 쌓여 헷갈리지 않도록, 이 자료로 남긴 것만 비웁니다.
delete from wr_import_issues where source = '26-27 Primary Roster';

-- 아직 가입하지 않은 선생님은 이름만 적어둡니다. 반(wr_classes)에는 이미 "계정 없을 때 이름만"
-- 적는 teacher_name 칸이 있어 그대로 쓰고, 과목에는 같은 용도의 칸이 없어 새로 만듭니다.
-- 선생님이 가입할 때 이 이름을 보고 본인 반·과목을 고르면 이메일이 채워집니다.
alter table wr_subjects add column if not exists teacher_name text;
alter table wr_classes  add column if not exists room text;

-- 직위에 따라 가입할 때 받는 정보가 달라집니다(요청: "교사와 교직원, 관리자를 선택했을 때 각각
-- 다르게 아래에 나오도록"). 행정직원·관리자는 반/과목 대신 맡은 업무를 적습니다.
alter table app_users add column if not exists duty text;

-- 전출·퇴원 학생의 마지막 등원일. status='inactive'만으로는 "언제 그만뒀는지"를 알 수 없어
-- 지난 기록을 되짚을 때 근거가 사라집니다.
alter table wr_students add column if not exists left_on date;


-- ── ① 학기 ──────────────────────────────────────────────────────────────────
-- 2026학년도 3학기: 2026-08-24(월) ~ 2026-11-13(금).
insert into terms (id, case_id, term_type, year, start_date, end_date, status)
values ('3a000000-0000-4000-9000-000000000003', 'TRM-2026-T3', '3학기', '2026', '2026-08-24', '2026-11-13', '진행중')
on conflict (case_id) do update
  set term_type = excluded.term_type, year = excluded.year,
      start_date = excluded.start_date, end_date = excluded.end_date, status = excluded.status;

-- 주간 관찰기록용 학기(별도 표). 새 학기가 시작되면 이전 학기는 자동으로 내려갑니다.
update wr_terms set is_active = false where is_active = true;
insert into wr_terms (id, name, start_date, end_date, is_active)
values ('3a000000-0000-4000-9100-000000000003', '2026학년도 3학기', '2026-08-24', '2026-11-13', true)
on conflict (id) do update
  set name = excluded.name, start_date = excluded.start_date,
      end_date = excluded.end_date, is_active = true;


-- ── ② 반 8개 ───────────────────────────────────────────────────────────────
-- 담임 이메일은 비워둡니다(선생님들이 아직 가입 전). 대신 teacher_name에 명부의 이름을 넣어두면
-- [반/담임 배정 관리] 화면에 "계정 없을 때 이름만"으로 그대로 보이고, 선생님이 가입할 때 그
-- 이름을 보고 본인 반을 고르면 이메일이 채워집니다.
insert into wr_classes (id, grade, class_name, department, teacher_name, room, is_demo)
values ('3a000000-0000-4000-a000-000000000001', '2', 'G2J', '초등부', 'Ms. Jaime', 'A동 2F', false)
on conflict (id) do update
  set grade = excluded.grade, class_name = excluded.class_name, department = '초등부',
      teacher_name = coalesce(wr_classes.teacher_name, excluded.teacher_name),
      room = excluded.room;
insert into wr_classes (id, grade, class_name, department, teacher_name, room, is_demo)
values ('3a000000-0000-4000-a000-000000000002', '2', 'G2C', '초등부', 'Ms. Carina', 'A동 2F', false)
on conflict (id) do update
  set grade = excluded.grade, class_name = excluded.class_name, department = '초등부',
      teacher_name = coalesce(wr_classes.teacher_name, excluded.teacher_name),
      room = excluded.room;
insert into wr_classes (id, grade, class_name, department, teacher_name, room, is_demo)
values ('3a000000-0000-4000-a000-000000000003', '2', 'G2A', '초등부', 'Ms. Aimie', 'A동 2F', false)
on conflict (id) do update
  set grade = excluded.grade, class_name = excluded.class_name, department = '초등부',
      teacher_name = coalesce(wr_classes.teacher_name, excluded.teacher_name),
      room = excluded.room;
insert into wr_classes (id, grade, class_name, department, teacher_name, room, is_demo)
values ('3a000000-0000-4000-a000-000000000004', '3', 'G3JU', '초등부', 'Ms. June', '신관 4F', false)
on conflict (id) do update
  set grade = excluded.grade, class_name = excluded.class_name, department = '초등부',
      teacher_name = coalesce(wr_classes.teacher_name, excluded.teacher_name),
      room = excluded.room;
insert into wr_classes (id, grade, class_name, department, teacher_name, room, is_demo)
values ('3a000000-0000-4000-a000-000000000005', '3', 'G3JA', '초등부', 'Ms. Janelle', '신관 5F', false)
on conflict (id) do update
  set grade = excluded.grade, class_name = excluded.class_name, department = '초등부',
      teacher_name = coalesce(wr_classes.teacher_name, excluded.teacher_name),
      room = excluded.room;
insert into wr_classes (id, grade, class_name, department, teacher_name, room, is_demo)
values ('3a000000-0000-4000-a000-000000000006', '4', 'G4R', '초등부', 'Ms. Rachel', 'B동 2F', false)
on conflict (id) do update
  set grade = excluded.grade, class_name = excluded.class_name, department = '초등부',
      teacher_name = coalesce(wr_classes.teacher_name, excluded.teacher_name),
      room = excluded.room;
insert into wr_classes (id, grade, class_name, department, teacher_name, room, is_demo)
values ('3a000000-0000-4000-a000-000000000007', '4', 'G4S', '초등부', 'Ms. Song', 'B동 1F', false)
on conflict (id) do update
  set grade = excluded.grade, class_name = excluded.class_name, department = '초등부',
      teacher_name = coalesce(wr_classes.teacher_name, excluded.teacher_name),
      room = excluded.room;
insert into wr_classes (id, grade, class_name, department, teacher_name, room, is_demo)
values ('3a000000-0000-4000-a000-000000000008', '5', 'G5E', '초등부', 'Mr. Eugene', '신관 6F', false)
on conflict (id) do update
  set grade = excluded.grade, class_name = excluded.class_name, department = '초등부',
      teacher_name = coalesce(wr_classes.teacher_name, excluded.teacher_name),
      room = excluded.room;

-- ── ③ 학생 ─────────────────────────────────────────────────────────────────
-- 명부를 임시 표에 담고, 이름·생년월일로 기존 학생을 찾아 갱신하거나 새로 만듭니다.
create temporary table _roster (
  seq int, name text, name_en text, birth_date date, gender text, grade text,
  class_name text, class_id uuid, parent_phone text, phone_raw text,
  instrument text, afterschool boolean, allergies text, note text,
  uniform text, after_days text, start_day text, status text, left_on date
);

insert into _roster values
(1, '이신원', 'Max Lee', '2019-08-20', '남', '2', 'G2J', '3a000000-0000-4000-a000-000000000001', '010-9282-2232', '(M) 010-9282-2232', '첼로', true, null, 'Jun (이준원) 동생', '16호', 'E', 'March 3, 2026', 'active', null),
(2, '노유겸', 'Noah Roh', '2019-12-24', '남', '2', 'G2J', '3a000000-0000-4000-a000-000000000001', '010-3200-6207', '(M) 010-3200-6207 (F) 010-7746-7060', '바이올린', true, null, null, '16호', 'E', 'March 3, 2026', 'active', null),
(3, '주이안', 'Ian Ju', '2019-03-15', '남', '2', 'G2J', '3a000000-0000-4000-a000-000000000001', '010-9120-5718', '(M) 010-9120-5718', '우쿨렐레', true, null, '예전 마이크로 재학생 Robin (김건희) 동생', '16호', 'E', 'March 3, 2026', 'active', null),
(4, '문준연', 'Joon Moon', '2019-09-05', '남', '2', 'G2J', '3a000000-0000-4000-a000-000000000001', '010-9136-4946', '(M) 010-9136-4946 (F) 010-9255-1940', '우쿨렐레', true, null, null, '16호', 'E', 'March 3, 2026', 'active', null),
(5, '김서준', 'Leo Kim', '2019-05-20', '남', '2', 'G2J', '3a000000-0000-4000-a000-000000000001', '010-4726-9877', '010-4726-9877', '바이올린', true, null, null, null, 'E', 'August 24, 2026', 'active', null),
(6, '김준영', 'Junyoung Kim', null, '남', '2', 'G2J', '3a000000-0000-4000-a000-000000000001', '010-5253-8530', '010-5253-8530', null, true, null, null, '17호', 'E', 'August 24, 2026', 'active', null),
(7, '이연우', 'Yeni Lee', '2019-10-22', '여', '2', 'G2J', '3a000000-0000-4000-a000-000000000001', '010-5045-2915', '010-5045-2915', '우쿨렐레', true, null, null, '16호', 'E', 'March 3, 2026', 'active', null),
(8, '심규민', 'Gyumin Shim', '2019-07-04', '여', '2', 'G2J', '3a000000-0000-4000-a000-000000000001', '010-7794-4865', '(M) 010-7794-4865 (F) 010-5554-4865', '바이올린', true, null, null, '16호', 'E', 'March 3, 2026', 'active', null),
(9, '황라원', 'Sophia Hwang', '2019-02-07', '여', '2', 'G2J', '3a000000-0000-4000-a000-000000000001', '010-2264-1478', '(M) 010-2264-1478', '플룻', true, null, 'June Hwang (황준호) 동생 / 황라윤과 쌍둥이', '16호', 'E', 'March 3, 2026', 'active', null),
(10, '신민하', 'Brooklyn Shin', '2019-07-23', '여', '2', 'G2J', '3a000000-0000-4000-a000-000000000001', '010-5351-2123', '(M) 010-5351-2123', '바이올린', true, null, null, '16호', 'E', 'March 3, 2026', 'active', null),
(11, '이예나', 'Eliana Lee', '2019-06-24', '여', '2', 'G2J', '3a000000-0000-4000-a000-000000000001', '010-8754-2684', '(M) 010-8754-2684', '바이올린', true, null, null, '16호', 'MTTHF', 'March 3, 2026', 'active', null),
(12, '김나율', 'Anna Kim', '2019-05-14', '여', '2', 'G2J', '3a000000-0000-4000-a000-000000000001', '010-7389-0228', '(M) 010-7389-0228', '바이올린', true, null, null, '16호', 'E', 'March 3, 2026', 'active', null),
(13, '이라엘', 'Lael Lee', '2019-01-11', '여', '2', 'G2J', '3a000000-0000-4000-a000-000000000001', '010-6538-6529', '(M) 010-6538-6529', '우쿨렐레', true, 'eggs, nuts', 'Allergy: eggs, nuts ** 매달 미리 식단표 공유 드리기', '17호', 'E', 'March 3, 2026', 'active', null),
(14, '권태이', 'Tay Kwon', '2019-09-12', '남', '2', 'G2C', '3a000000-0000-4000-a000-000000000002', '010-8722-3060', '(M) 010-8722-3060', '바이올린', true, null, null, '16호', 'E', 'March 3, 2026', 'active', null),
(15, '전준백', 'Justin Jeon', '2019-04-29', '남', '2', 'G2C', '3a000000-0000-4000-a000-000000000002', '010-3050-8681', '(M) 010-3050-8681', '우쿨렐레', true, null, null, '17호', 'E', 'March 3, 2026', 'active', null),
(16, '전지완', 'Eric Jeon', '2019-10-08', '남', '2', 'G2C', '3a000000-0000-4000-a000-000000000002', '010-8875-4490', '(M) 010-8875-4490', '바이올린', true, 'peanuts', 'Allergy: peanuts', '16호', 'MWF', 'March 3, 2026', 'active', null),
(17, '황이안', 'Ian Hwang', '2019-12-01', '남', '2', 'G2C', '3a000000-0000-4000-a000-000000000002', '010-3176-4702', '(M) 010-3176-4702', '바이올린', true, null, null, '16호', 'E', 'March 3, 2026', 'active', null),
(18, '이현우', 'Harry Lee', '2019-01-07', '남', '2', 'G2C', '3a000000-0000-4000-a000-000000000002', '010-9143-8857', '(M) 010-9143-8857 (F) 010-9100-9946', '첼로', true, null, null, '17호', 'E', 'March 3, 2026', 'active', null),
(19, '김준원', 'Junwon Kim', null, '남', '2', 'G2C', '3a000000-0000-4000-a000-000000000002', '010-5253-8530', '010-5253-8530', null, true, null, null, '17호', 'E', 'August 24, 2026', 'active', null),
(20, '박하솜', 'Hasom Park', '2019-02-09', '여', '2', 'G2C', '3a000000-0000-4000-a000-000000000002', '010-4592-5945', '(M) 010-4592-5945', '바이올린', false, null, null, '16호', 'N/A', 'March 3, 2026', 'active', null),
(21, '김재이', 'Jay Kim', '2019-05-10', '여', '2', 'G2C', '3a000000-0000-4000-a000-000000000002', '010-5321-0324', '(M) 010-5321-0324', '바이올린', true, null, 'GIA 유치부 ALBATROSS반', '16호', 'E', 'March 3, 2026', 'active', null),
(22, '이아인', 'Ayn Lee', '2019-12-30', '여', '2', 'G2C', '3a000000-0000-4000-a000-000000000002', '010-6889-2937', '(M) 010-6889-2937', '바이올린', true, null, null, '16호', 'E(5월까지)', 'March 3, 2026', 'active', null),
(23, '고서윤', 'Jenny Go', '2019-01-08', '여', '2', 'G2C', '3a000000-0000-4000-a000-000000000002', '010-8654-7611', '(M) 010-8654-7611 (F) 010-4173-7364', '플룻', true, null, null, '16호', 'E', 'March 3, 2026', 'active', null),
(24, '이은재', 'Ellie Lee', '2019-04-18', '여', '2', 'G2C', '3a000000-0000-4000-a000-000000000002', '010-4005-2413', '(M) 010-4005-2413 (F) 010-4845-2413', '우쿨렐레', false, null, null, '16호', 'N/A', 'March 3, 2026', 'active', null),
(25, '김사랑', 'Benecia Kim', '2019-08-21', '여', '2', 'G2C', '3a000000-0000-4000-a000-000000000002', '010-6222-6037', '(GM) 010-5240-6037 (M) 010-6222-6037 (F) 010-6222-6074', '바이올린', true, null, null, '16호', 'E', 'March 3, 2026', 'active', null),
(26, '백서아', 'Ruby Paik', '2019-08-07', '여', '2', 'G2C', '3a000000-0000-4000-a000-000000000002', '010-4785-9973', '(M) 010-4785-9973', '첼로', true, 'shrimp 거의 사라진 상태, 먹어도 되나 먹고 나서 주의 요망 특히 입주변 발진', 'Allergy: shrimp 거의 사라진 상태, 먹어도 되나 먹고 나서 주의 요망 특히 입주변 발진', '16호', 'MWF', 'March 3, 2026', 'active', null),
(27, '황라윤', 'Bella Hwang', '2019-02-07', '여', '2', 'G2C', '3a000000-0000-4000-a000-000000000002', '010-2264-1478', '(M) 010-2264-1478', '플룻', true, null, 'June Hwang (황준호) 동생 / 황라원과 쌍둥이', '16호', 'E', 'March 3, 2026', 'active', null),
(28, '김도은', 'Rogan Kim', '2019-02-07', '남', '2', 'G2A', '3a000000-0000-4000-a000-000000000003', '010-4739-6231', '(M) 010-4739-6231 (F) 010-5031-6231', '바이올린', true, null, null, '18호', 'E', 'March 3, 2026', 'active', null),
(29, '고진우', 'Jinwoo Ko', '2019-09-01', '남', '2', 'G2A', '3a000000-0000-4000-a000-000000000003', '010-8972-2394', '(M) 010-8972-2394', '클라리넷', true, null, null, '16호', 'E', 'March 3, 2026', 'active', null),
(30, '김단우', 'Danu Kim', '2019-09-08', '남', '2', 'G2A', '3a000000-0000-4000-a000-000000000003', '010-3442-0078', '(M) 010-3442-0078', '바이올린', true, null, null, '17호', 'E', 'March 3, 2026', 'active', null),
(31, '이서준', 'Seojun Lee', '2019-07-30', '남', '2', 'G2A', '3a000000-0000-4000-a000-000000000003', '010-4866-8100', '(M) 010-4866-8100 (F) 01052279339', '바이올린', true, null, null, '16호', 'E', 'March 3, 2026', 'active', null),
(32, '서민준', 'Eden Seo', '2019-11-05', '남', '2', 'G2A', '3a000000-0000-4000-a000-000000000003', '010-2186-6134', '(M) 010-2186-6134 (F) 010-2522-6134', '첼로', true, null, null, '16호', 'E', 'March 3, 2026', 'active', null),
(33, '박세인', 'Clara Park', '2019-09-26', '여', '2', 'G2A', '3a000000-0000-4000-a000-000000000003', '010-2050-9828', '(M) 010-2050-9828', '바이올린', false, null, null, '16호', 'N/A', 'March 3, 2026', 'active', null),
(34, '한우영', 'Zoe Han', '2019-10-21', '여', '2', 'G2A', '3a000000-0000-4000-a000-000000000003', '010-5148-3885', '(M) 010-5148-3885 (F) 010-9469-2435', '바이올린', true, null, null, '17호', 'E', 'March 3, 2026', 'active', null),
(35, '곽세린', 'Celine Kwak', '2019-10-23', '여', '2', 'G2A', '3a000000-0000-4000-a000-000000000003', '010-8843-5196', '(M) 010-8843-5196 (F) 010-9232-1492', '바이올린', true, null, null, '16호', 'TTH', 'March 3, 2026', 'active', null),
(36, '박세주', 'Reina Park', '2019-05-30', '여', '2', 'G2A', '3a000000-0000-4000-a000-000000000003', '010-6380-8798', '(M) (010-6380-8798', '우쿨렐레', true, null, null, '16호', 'E', 'March 3, 2026', 'active', null),
(37, '김재이', 'Jay Kim', '2019-08-28', '여', '2', 'G2A', '3a000000-0000-4000-a000-000000000003', '010-9048-6336', '(F) 010-8669-5994 (M) 010-9048-6336', '바이올린', true, null, 'GIA 유치부 EMU반', '16호', 'E', 'March 3, 2026', 'active', null),
(38, '원세빈', 'Sophia Won', '2019-03-12', '여', '2', 'G2A', '3a000000-0000-4000-a000-000000000003', '010-5813-0000', '(M) 010-5813-0000', '첼로', true, null, null, '16호', 'E', 'March 3, 2026', 'active', null),
(39, '심재이', 'Jay Shim', '2019-03-02', '여', '2', 'G2A', '3a000000-0000-4000-a000-000000000003', '010-9253-3303', '010-9253-3303', '우쿨렐레', true, null, null, '16호', 'E', 'August 24, 2026', 'active', null),
(40, '연하윤', 'Hayoon Yon', '2019-10-08', '여', '2', 'G2A', '3a000000-0000-4000-a000-000000000003', '010-7121-9559', '(M) 010-7121-9559', '바이올린', true, null, null, '16호', 'E', 'March 3, 2026', 'active', null),
(41, '황이준', 'June Hwang', '2018-07-07', '남', '3', 'G3JU', '3a000000-0000-4000-a000-000000000004', '010-8686-8118', '(M) 010-8686-8118', '바이올린', true, null, 'Health Note: June’s Eating Habits', '17호', 'E', 'August 25, 2025', 'active', null),
(42, '이준원', 'Jun Lee', '2018-03-14', '남', '3', 'G3JU', '3a000000-0000-4000-a000-000000000004', '010-9282-2232', '010-9282-2232', '바이올린', true, null, null, '17호', 'E', 'March 4, 2025', 'active', null),
(43, '유한솔', 'Kai Yoo', '2017-01-22', '남', '3', 'G3JU', '3a000000-0000-4000-a000-000000000004', '010-8786-0409', '010-8786-0409', '우쿨렐레', true, null, null, '18호', 'TTH', 'March 4, 2026', 'active', null),
(44, '엄하율', 'Henry Hayule Eom', '2018-06-08', '남', '3', 'G3JU', '3a000000-0000-4000-a000-000000000004', '010-3244-8902', '010-3244-8902', '바이올린', true, null, null, '17호', 'MTTHF', 'February 19, 2026', 'active', null),
(45, '강이제', 'Ije Kang', '2018-09-24', '남', '3', 'G3JU', '3a000000-0000-4000-a000-000000000004', '010-5826-8910', '(M) 010-5826-8910', '우쿨렐레', true, null, null, 'L', 'E', 'March 30, 2026', 'active', null),
(46, '김현수', 'Hans Kim', '2018-07-28', '남', '3', 'G3JU', '3a000000-0000-4000-a000-000000000004', '010-8760-9264', '010-8760-9264', '첼로', true, null, '김리안 (Rian Kim)', '17호', 'E', 'March 4, 2025', 'active', null),
(47, '홍서형', 'Danny Hong', '2018-07-12', '남', '3', 'G3JU', '3a000000-0000-4000-a000-000000000004', '010-7176-5490', '(M) 010-7176-5490 (F) 010-3512-1353', '클라리넷', true, null, null, '17호', 'TTH', 'March 4, 2025', 'active', null),
(48, '민노엘', 'Noel Min', '2018-10-28', '남', '3', 'G3JU', '3a000000-0000-4000-a000-000000000004', '010-5576-0201', '(M) 010-5576-0201', '우쿨렐레', true, null, null, '18호', 'E', 'March 4, 2026', 'active', null),
(49, '정세진', 'Emma Jung', '2018-01-13', '여', '3', 'G3JU', '3a000000-0000-4000-a000-000000000004', '010-7140-2415', '010-7140-2415', '바이올린', true, null, '정도현 (Aaron Jung)', '17호', 'E', 'March 4, 2025', 'active', null),
(50, '최서아', 'Sarah Choi', '2018-05-28', '여', '3', 'G3JU', '3a000000-0000-4000-a000-000000000004', '010-2723-2046', '010-2723-2046', '바이올린', true, null, null, '17호', 'TTH', 'March 4, 2025', 'active', null),
(51, '민송희', 'Sophia Min', '2018-06-27', '여', '3', 'G3JU', '3a000000-0000-4000-a000-000000000004', '010-3151-2767', '010-3151-2767', '첼로', true, null, null, '18호', 'E', 'March 4, 2025', 'active', null),
(52, '임다현', 'Diane Lim', '2018-09-27', '여', '3', 'G3JU', '3a000000-0000-4000-a000-000000000004', '010-3165-8055', '(M) 010-3165-8055 (F) 010-8716-8602', '첼로', false, null, '임선우 (Sunwoo Lim)', '17호', 'N/A', 'March 4, 2025', 'active', null),
(53, '임예나', 'Grace Lim', '2018-08-18', '여', '3', 'G3JU', '3a000000-0000-4000-a000-000000000004', '010-9901-7999', '010-9901-7999', '바이올린', true, 'Mung beans', 'Allergy: Mung beans', '17호', 'E', 'March 4, 2025', 'active', null),
(54, '이서아', 'Vivian Lee', '2018-10-22', '여', '3', 'G3JU', '3a000000-0000-4000-a000-000000000004', '010-5703-2692', '010-5703-2692', '우쿨렐레', true, 'Dog, Peach', 'Allergy: Dog, Peach', '16호', 'E', 'March 4, 2025', 'active', null),
(55, '차봄', 'Bom Cha', '2018-10-30', '여', '3', 'G3JU', '3a000000-0000-4000-a000-000000000004', '010-2811-0707', '(M) 010-2811-0707 (F) 010-9129-1443', '우쿨렐레', true, null, null, '16호', 'MWF', 'March 4, 2025', 'active', null),
(56, '황시원', 'Sean Hwang', '2018-07-07', '남', '3', 'G3JA', '3a000000-0000-4000-a000-000000000005', '010-8686-8118', '(M) 010-8686-8118 (삼촌) 010-8831-1849', '바이올린', true, 'Celery', 'Allergy: Celery', '17호', 'E', 'August 25, 2025', 'active', null),
(57, '지수', 'Soo Ji', '2018-03-20', '남', '3', 'G3JA', '3a000000-0000-4000-a000-000000000005', '010-9087-8430', '010-9087-8430', '바이올린', true, 'Animal Hair', 'Allergy: Animal Hair', '17호', 'E', 'March 4, 2025', 'active', null),
(58, '임주한', 'Juhan Lim', '2018-08-30', '남', '3', 'G3JA', '3a000000-0000-4000-a000-000000000005', '010-5760-1866', '010-5760-1866', '바이올린', false, null, null, '18호', 'N/A', 'March 4, 2025', 'active', null),
(59, '이주원', 'Benny Lee', '2018-08-13', '남', '3', 'G3JA', '3a000000-0000-4000-a000-000000000005', '010-3575-2841', '010-3575-2841', '바이올린', true, null, null, '17호', 'TTH', 'March 4, 2025', 'active', null),
(60, '이준서', 'Justin Lee', '2018-05-21', '남', '3', 'G3JA', '3a000000-0000-4000-a000-000000000005', '010-4655-2574', '(M) 010-4655-2574 (F) 010-8942-2580', '첼로', true, null, null, '17호', 'E', 'March 4, 2025', 'active', null),
(61, '정레인', 'Rain Jung', '2018-01-18', '남', '3', 'G3JA', '3a000000-0000-4000-a000-000000000005', '010-4806-4862', '(M) 010-4806-4862 (F) 010-5443-4862', '바이올린', true, null, null, '17호', 'E', 'August 25, 2025', 'active', null),
(62, '강서후', 'Seohu Kang', '2018-12-05', '남', '3', 'G3JA', '3a000000-0000-4000-a000-000000000005', '010-6645-8648', '010-6645-8648', '바이올린', true, null, null, '17호', 'MTWTH', 'March 4, 2025', 'active', null),
(63, '송윤진', 'Diana Song', '2018-10-01', '여', '3', 'G3JA', '3a000000-0000-4000-a000-000000000005', '010-9142-9438', '010-9142-9438', '플룻', true, null, null, null, 'E', 'August 24, 2026', 'active', null),
(64, '이예온', 'Grace Lee', '2018-11-13', '여', '3', 'G3JA', '3a000000-0000-4000-a000-000000000005', '010-4256-8836', '(M) 010-4256-8836', '첼로', true, null, null, '16호', 'E', 'September 15, 2025', 'active', null),
(65, '정이엘', 'E.L. Jeong', '2018-10-10', '여', '3', 'G3JA', '3a000000-0000-4000-a000-000000000005', '010-8736-8363', '(M) 010-8736-8363', '바이올린', true, null, null, '16호', 'E', 'August 25, 2025', 'active', null),
(66, '이서현', 'Elizabeth Lee', '2018-03-12', '여', '3', 'G3JA', '3a000000-0000-4000-a000-000000000005', '010-8908-4893', '(M) 010-8908-4893 (Gm) 010-9151-4893', '바이올린', true, null, null, '16호', 'E', 'March 4, 2025', 'active', null),
(67, '김재이', 'Jay Kim', '2018-09-27', '여', '3', 'G3JA', '3a000000-0000-4000-a000-000000000005', '010-4569-0657', '010-4569-0657', '우쿨렐레', true, null, null, '17호', 'E', 'March 4, 2025', 'active', null),
(68, '정겨울', 'Wynter Jeong', '2018-01-13', '여', '3', 'G3JA', '3a000000-0000-4000-a000-000000000005', '010-3819-2137', '(F) 010-6825-2515 (M) 010-3819-2137', '바이올린', true, null, null, '16호', 'E', 'March 4, 2025', 'active', null),
(69, 'Maya Amelia Dowding', 'Maya Amelia Dowding', '2018-05-19', '여', '3', 'G3JA', '3a000000-0000-4000-a000-000000000005', '010-5302-2929', '(M) 010-5302-2929 (F) 010-4657-8467', '바이올린', true, null, null, '16호', 'E', 'March 4, 2025', 'active', null),
(70, '곽호율', 'James Kwak', '2017-10-04', '남', '4', 'G4R', '3a000000-0000-4000-a000-000000000006', '010-6602-2947', '(M) 010-6602-2947', '바이올린', true, null, null, '18호', 'E', 'March 4, 2024', 'active', null),
(71, '유재이', 'Jay Yu', '2017-12-12', '남', '4', 'G4R', '3a000000-0000-4000-a000-000000000006', '010-4181-3216', '(M) 010-4181-3216 (F) 010-4082-2942', '바이올린', true, null, '유하이 (Heather Yu)', '18호', 'E', 'March 4, 2024', 'active', null),
(72, '고이건', 'Eagon Koh', '2017-07-19', '남', '4', 'G4R', '3a000000-0000-4000-a000-000000000006', '010-9098-9949', '(M) 010-9098-9949', '첼로', true, null, null, '18호', 'E', 'March 4, 2026', 'active', null),
(73, '홍동은', 'Jaden Hong', '2017-11-01', '남', '4', 'G4R', '3a000000-0000-4000-a000-000000000006', '010-3239-9213', '(M) 010-3239-9213', '플룻', false, 'Fur', 'Allergy: Fur', '18호', 'N/A', 'March 4, 2024', 'active', null),
(74, '조장훈', 'Janghoon Cho', '2017-09-16', '남', '4', 'G4R', '3a000000-0000-4000-a000-000000000006', '010-3251-0300', '(M) 010-3251-0300 (F) 010-9686-0304', '바이올린', false, null, null, '18호', 'N/A', 'April 3, 2025', 'active', null),
(75, '김태오', 'Theo Kim', '2017-07-17', '남', '4', 'G4R', '3a000000-0000-4000-a000-000000000006', '010-8947-2001', '(M) 010-8947-2001', '클라리넷', true, null, null, '18호', 'TTH', 'March 4, 2024', 'active', null),
(76, '정하임', 'Hayim (Peyton) Jung', '2017-05-22', '여', '4', 'G4R', '3a000000-0000-4000-a000-000000000006', '010-4754-6919', '(M) 010-4754-6919 (이모님) 010-8299-8837', '우쿨렐레', true, null, null, '16호', 'MTWF', 'March 4, 2024', 'active', null),
(77, '김서이', 'Victoria Kim', '2017-10-28', '여', '4', 'G4R', '3a000000-0000-4000-a000-000000000006', '010-8582-7165', '(M) 010-8582-7165', '바이올린', true, null, '김단우(2020), GIA 유치원', '17호', 'TTHF', 'March 4, 2024', 'active', null),
(78, '김지민', 'Jimin Kim', '2017-05-26', '여', '4', 'G4R', '3a000000-0000-4000-a000-000000000006', '010-5100-7847', '010-5100-7847', '바이올린', true, null, null, '17호', 'E', 'March 4, 2024', 'active', null),
(79, '남가인', 'Gahin Nam', '2017-10-21', '여', '4', 'G4R', '3a000000-0000-4000-a000-000000000006', '010-5485-3270', '(M) 010-5485-3270', '우쿨렐레', true, null, null, '17호', 'E', 'March 4, 2026', 'active', null),
(80, '권수호', 'Teddy Kwon', '2017-06-27', '남', '4', 'G4S', '3a000000-0000-4000-a000-000000000007', '010-2748-9949', '010-2748-9949', '바이올린', true, null, null, '18호', 'E', 'August 25, 2025', 'active', null),
(81, '김동하', 'Dongha Kim', '2017-01-11', '남', '4', 'G4S', '3a000000-0000-4000-a000-000000000007', '010-8554-3130', '010-8554-3130', '우쿨렐레', true, null, null, '18호', 'E', 'August 26, 2024', 'active', null),
(82, '황준호', 'June Hwang', '2017-12-11', '남', '4', 'G4S', '3a000000-0000-4000-a000-000000000007', '010-2264-1478', '(M) 010-2264-1478 (F) 010-6654-7857', '우쿨렐레', true, null, null, '18호', 'E', 'March 4, 2025', 'active', null),
(83, '김서진', 'Seojin Kim', '2017-01-28', '남', '4', 'G4S', '3a000000-0000-4000-a000-000000000007', '010-5047-7094', '(M) 010-5047-7094', '플룻', true, null, null, '18호', 'MWTH', 'March 4, 2026', 'active', null),
(84, '임선우', 'Sunwoo Lim', '2017-09-16', '남', '4', 'G4S', '3a000000-0000-4000-a000-000000000007', '010-3165-8055', '(M) 010-3165-8055 (F) 010-8716-8602', '우쿨렐레', true, 'Peanut', 'Allergy: Peanut', '18호', 'Mon', 'August 26, 2024', 'active', null),
(85, '홍선우', 'Sunwoo Hong', '2016-11-02', '남', '4', 'G4S', '3a000000-0000-4000-a000-000000000007', '010-6804-1165', '010-6804-1165', '클라리넷', false, null, null, null, 'N/A', 'August 24, 2026', 'active', null),
(86, '정서우', 'Stella Jung', '2017-10-23', '여', '4', 'G4S', '3a000000-0000-4000-a000-000000000007', '010-9406-2143', '(M) 010-9406-2143', '우쿨렐레', true, null, null, '17호', 'E', 'March 4, 2024', 'active', null),
(87, '강하라', 'Hara Kang', '2017-08-30', '여', '4', 'G4S', '3a000000-0000-4000-a000-000000000007', '010-7678-2718', '(M) 010-7678-2718 (F)01071832357', '우쿨렐레', true, 'Cat fur, Honey [ESL After School]', 'ESL/ Allergy: Cat fur, Honey [ESL After School]', '18호', 'E', 'March 4, 2024', 'active', null),
(88, '마리아 파즈 마누키안', 'Maria Paz Manoukian', '2017-08-17', '여', '4', 'G4S', '3a000000-0000-4000-a000-000000000007', '010-2718-9975', '(M) 010-2718-9975', '우쿨렐레', true, null, null, '18호', 'E', 'March 16, 2026', 'active', null),
(89, '임하임', 'Blaire Lim', '2017-04-17', '여', '4', 'G4S', '3a000000-0000-4000-a000-000000000007', '010-9389-6648', '(M) 010-9389-6648', '우쿨렐레', true, 'Milk', 'Allergy: Milk', '17호', 'E', 'March 4, 2025', 'active', null),
(90, '임지효', 'Jihyo Yim', '2016-07-27', '여', '5', 'G5E', '3a000000-0000-4000-a000-000000000008', '010-6347-0288', '(M) 010-6347-0288 (F) 010-8986-0289', '바이올린', true, null, null, '18호', 'E', 'March 2, 2023', 'active', null),
(91, '최서연', 'Seoyeon Choi', '2016-12-02', '여', '5', 'G5E', '3a000000-0000-4000-a000-000000000008', '010-4254-3565', '010-4254-3565', '바이올린', true, null, null, 'S', 'E', 'March 2, 2023', 'active', null),
(92, '강예성', 'Yesung Kang', '2016-02-05', '남', '5', 'G5E', '3a000000-0000-4000-a000-000000000008', '010-4114-3788', '(M)010-4114-3788', '첼로', true, 'Wasabi', 'Allergy: Wasabi', 'S', 'E', 'February 10, 2025', 'active', null),
(93, '이한범', 'Danny Lee', '2016-04-02', '남', '5', 'G5E', '3a000000-0000-4000-a000-000000000008', '010-7722-2879', '010-7722-2879', '첼로', true, null, null, 'S', 'E', 'March 2, 2023', 'active', null),
(94, '김리안', 'Rian Kim', '2016-06-02', '여', '5', 'G5E', '3a000000-0000-4000-a000-000000000008', '010-8760-9264', '010-8760-9264', '바이올린', true, null, null, '18호', 'E', 'March 2, 2023', 'active', null),
(95, '강하늘', 'Skye (Haneul) Kang', '2016-10-14', '여', '5', 'G5E', '3a000000-0000-4000-a000-000000000008', '010-2900-6454', '(M) 010-2900-6454', '바이올린', true, null, '강하엘 (Hael Kang)', '17호', 'E', 'February 24, 2025', 'active', null),
(96, '김태윤', 'Teddy Kim', '2016-12-05', '남', '5', 'G5E', '3a000000-0000-4000-a000-000000000008', '010-9125-7874', '(M) 010-9125-7874', '바이올린', true, 'Nut, Shellfish, Crustaceans, Squid, Octopus', 'Allergy: Nut, Shellfish, Crustaceans, Squid, Octopus', 'S', 'E', 'April 21, 2025', 'active', null),
(97, '이온유', 'Roy Lee', '2016-10-25', '남', '5', 'G5E', '3a000000-0000-4000-a000-000000000008', '01072937118', '(M) 01072937118 (F) 010-7239-8383', '바이올린', true, null, '2023년 입학 했다가 퇴소, 뉴질랜드 어학 연수 다녀와서 재입학', 'L', 'E', 'March 9, 2026', 'active', null),
(98, '송우진', 'Daniel Song', '2016-07-08', '남', '5', 'G5E', '3a000000-0000-4000-a000-000000000008', '010-9142-9438', '010-9142-9438', '플룻', true, null, null, null, 'E', 'August 24, 2026', 'active', null),
(99, '김요한', 'John Kim', '2015-11-16', '남', '5', 'G5E', '3a000000-0000-4000-a000-000000000008', '010-3549-1402', '010-3549-1402', '바이올린', true, null, null, 'S', 'E', 'August 24, 2026', 'active', null),
(100, '도윤서', 'Yoonseo Doh', '2016-06-01', '여', '5', 'G5E', '3a000000-0000-4000-a000-000000000008', '010-3395-6988', '010-3395-6988', '바이올린', true, null, 'ESL', '17호', 'E', 'August 25, 2025', 'active', null),
(101, '정연우', 'Jayden Jung', '2016-11-21', '남', null, null, null, '010-2049-9227', '010-2049-9227', '바이올린', true, null, null, null, 'E', 'March 2, 2023', 'inactive', '2025-08-25'),
(102, '이도헌', 'Do Hun Lee', '2017-05-11', '남', null, null, null, '010-6551-2888', '(F) 010-6551-2888 (Grandma) 010-4298-8845', '바이올린', false, null, null, null, 'N/A', 'September 2, 2025', 'inactive', '2025-10-14'),
(103, '박예서', 'Yeseo Park', '2017-02-06', null, null, null, null, '010-4153-7399', '(M) 010-4153-7399', '바이올린', true, null, null, null, 'E', 'August 25, 2025', 'inactive', '2025-10-29'),
(104, '윤별', 'Stella Yoon', '2018-09-11', '여', null, null, null, '010-4117-0984', '(M) 010-4117-0984 (F) 010-9767-8691', '우쿨렐레', false, null, null, null, 'N/A', 'March 4, 2025', 'inactive', '2025-12-01'),
(105, '조안나 아문', 'Joanna Amoon', '2015-02-26', '여', null, null, null, '010-2912-2209', '010-2912-2209', '바이올린', true, null, null, null, 'E', 'March 2, 2022', 'inactive', '2025-12-19'),
(106, '강민진', 'MJ Kang', '2018-03-02', '여', null, null, null, '010-9121-4054', '010-9121-4054', '바이올린', true, null, null, null, 'E', 'March 4, 2025', 'inactive', '2025-12-19'),
(107, '김아린', 'Alyn Kim', '2018-04-06', '여', null, null, null, '010-9563-6993', '(M) 010-9563-6993', '바이올린', false, null, null, null, 'N/A', 'August 25, 2025', 'inactive', '2025-12-19'),
(108, '윤노아', 'Noah Yoon', '2017-03-30', '남', null, null, null, '010-9887-8047', '(M) 010-9887-8047', '바이올린', false, null, null, null, 'N/A', 'March 4, 2024', 'inactive', '2025-12-19'),
(109, '김서연', 'Chelsea Kim', '2017-01-25', '여', null, null, null, '010-7106-0967', '(M) 010-7106-0967', '우쿨렐레', true, null, null, null, 'E', null, 'inactive', '2026-01-30'),
(110, '장윤아', 'Yuna Jang', '2017-09-05', '여', null, null, null, '010-3477-8378', '(M) 010-3477-8378 (F) 010-8940-9615', '바이올린', true, null, null, null, 'E', 'March 4, 2024', 'inactive', '2026-02-13'),
(111, '김재이', 'Jae E Kim', '2017-10-23', '여', null, null, null, '010-4787-6876', '(M) 010-4787-6876', '바이올린', true, null, null, null, 'E', null, 'inactive', '2026-02-27'),
(112, '최리안', 'Lian Choi', '2017-01-05', '여', null, null, null, '010-6750-0209', '(F) 010-3158-1112 (M) 010-6750-0209', '바이올린', true, null, null, null, 'E', null, 'inactive', '2026-02-27'),
(113, '이상유', 'Sangyoo Rhie', '2018-05-30', '남', null, null, null, '010-5269-8876', '(M) 010-5269-8876 (F) 010-9196-0911', '바이올린', true, null, null, null, 'E', null, 'inactive', '2026-02-27'),
(114, '이진용', 'Jeanyong Lee', '2018-08-08', '남', null, null, null, '010-8831-5443', '010-8831-5443', '우쿨렐레', true, null, null, null, 'E', null, 'inactive', '2026-02-27'),
(115, '고유준', 'June Ko', '2018-06-20', '남', null, null, null, '010-6214-0283', '010-6214-0283', '바이올린', true, null, null, null, 'MTTHF', null, 'inactive', '2026-02-27'),
(116, '조여람', 'Elly Cho', '2015-08-02', '여', null, null, null, '010-2528-8616', '010-2528-8616', '우쿨렐레', true, null, null, null, 'E', null, 'inactive', '2026-02-27'),
(117, '최백두', 'Baekdu Choi', '2019-03-14', '남', null, null, null, '010-9235-3534', '(M) 010-9235-3534', '바이올린', true, null, null, null, 'E', 'March 3, 2026', 'inactive', '2026-03-20'),
(118, '강하담', 'Joshua Kang', '2019-10-10', '남', null, null, null, '010-3179-1578', '(F) 010-9475-1124 (M) 010-3179-1578 010-5798-5323', null, true, null, null, null, 'E E', 'March 3, 2026', 'inactive', '2026-06-15'),
(119, '정채윤', 'Olivia Jung', '2015-09-10', '여', null, null, null, '010-3179-1578', '(F) 010-9475-1124 (M) 010-3179-1578 010-5798-5323', null, true, null, null, null, 'E E', 'February 17, 2025', 'inactive', '2026-06-15'),
(120, '정채린', 'Serena Jung', '2017-02-06', '여', null, null, null, '010-5798-5323', '010-5798-5323', '바이올린', true, null, null, null, 'E', 'February 17, 2025', 'inactive', '2026-06-15'),
(121, '김태리', 'Terry Kim', '2017-08-02', '여', null, null, null, '010-6408-0089', '(M) 010-6408-0089 (F) 010-5293-7856', '플룻', true, null, null, null, 'E', 'April 7, 2025', 'inactive', '2026-06-15'),
(122, '김태지', 'Teji Kim', '2016-05-21', '여', null, null, null, '010-6408-0089', '(M) 010-6408-0089 (F) 010-5293-7856', '클라리넷', true, null, null, null, 'E', 'April 7, 2025', 'inactive', '2026-06-15'),
(123, '박도하', 'Doha Park', '2019-10-05', '남', null, null, null, '010-2782-1069', '(M) 010-2782-1069 (F) 010-4140-1683', null, true, null, null, null, 'E', null, 'inactive', '2026-06-29'),
(124, '김시준', 'Leo Kim', '2015-09-11', '남', null, null, null, '010-4614-9929', '(M) 010-4614-9929 (F) 010-7258-3110', '바이올린', false, null, null, null, 'N/A', 'August 26, 2026', 'inactive', '2026-06-29'),
(125, '김시아', 'Joy Kim', '2015-09-11', '여', null, null, null, '010-4614-9929', '(M) 010-4614-9929 (F) 010-7258-3110', '바이올린', false, null, null, null, 'N/A', 'August 26, 2026', 'inactive', '2026-06-29'),
(126, '이예준', 'Isaac Lee', '2019-09-28', '남', null, null, null, '010-9902-0725', '(M) 010-9902-0725', '플룻', false, null, null, null, 'N/A', 'March 3, 2026', 'inactive', '2026-06-29');
-- ── ④ 학생 매칭 후 반영 ─────────────────────────────────────────────────────
-- 이름과 생년월일로 기존 학생을 찾습니다. 사람이 봐야 하는 상황은 건너뛰고 기록만 남깁니다 -
-- 애매한 채로 덮어쓰면 다른 학생의 기록이 섞여버리는데, 그건 되돌리기가 매우 어렵습니다.
do $import$
declare
  r record;
  target uuid;
  cnt int;
  cnt_other int;
begin
  for r in select * from _roster order by seq loop
    target := null;

    if r.birth_date is not null then
      select count(*) into cnt from wr_students s
       where s.is_demo = false and s.name = r.name and s.birth_date = r.birth_date;

      if cnt > 1 then
        insert into wr_import_issues (source, kind, student_name, detail)
        values ('26-27 Primary Roster', '동명이인', r.name,
                format('이름과 생년월일(%s)이 모두 같은 학생이 이미 %s명 있습니다. 어느 쪽인지 사람이 확인해야 해서 이번 자료는 반영하지 않았습니다.', r.birth_date, cnt));
        continue;
      elsif cnt = 1 then
        select s.id into target from wr_students s
         where s.is_demo = false and s.name = r.name and s.birth_date = r.birth_date limit 1;
      else
        -- 생년월일이 아직 비어 있는 같은 이름 학생이 딱 한 명이면 그 학생으로 봅니다.
        select count(*) into cnt from wr_students s
         where s.is_demo = false and s.name = r.name and s.birth_date is null;
        if cnt = 1 then
          select s.id into target from wr_students s
           where s.is_demo = false and s.name = r.name and s.birth_date is null limit 1;
        elsif cnt > 1 then
          insert into wr_import_issues (source, kind, student_name, detail)
          values ('26-27 Primary Roster', '동명이인', r.name,
                  format('생년월일이 비어 있는 동명이인이 %s명 있어 누구인지 정할 수 없었습니다. 이번 자료는 새 학생으로 등록했습니다.', cnt));
        else
          -- 이름은 같은데 생년월일이 다른 학생이 있으면, 새로 만들되 확인하시라고 남깁니다.
          select count(*) into cnt_other from wr_students s
           where s.is_demo = false and s.name = r.name;
          if cnt_other > 0 then
            insert into wr_import_issues (source, kind, student_name, detail)
            values ('26-27 Primary Roster', '생년월일불일치', r.name,
                    format('같은 이름의 학생이 이미 %s명 있지만 생년월일이 명부(%s)와 다릅니다. 동명이인으로 보고 새로 등록했습니다 - 같은 학생이면 한쪽을 지워주세요.', cnt_other, r.birth_date));
          end if;
        end if;
      end if;
    else
      -- 명부에 생년월일이 없는 학생(신입 등) - 이름만으로 찾습니다.
      select count(*) into cnt from wr_students s where s.is_demo = false and s.name = r.name;
      if cnt = 1 then
        select s.id into target from wr_students s where s.is_demo = false and s.name = r.name limit 1;
      elsif cnt > 1 then
        insert into wr_import_issues (source, kind, student_name, detail)
        values ('26-27 Primary Roster', '동명이인', r.name,
                format('명부에 생년월일이 없고 같은 이름이 %s명 있어 반영하지 않았습니다. 생년월일을 채워주시면 다음 적용 때 자동으로 이어집니다.', cnt));
        continue;
      end if;
      insert into wr_import_issues (source, kind, student_name, detail)
      values ('26-27 Primary Roster', '생년월일없음', r.name,
              '명부에 생년월일이 비어 있습니다. 학생 관리 화면에서 채워주세요(다음 학기 명부와 자동으로 이어지려면 필요합니다).');
    end if;

    if target is not null then
      update wr_students set
        name_en    = coalesce(nullif(r.name_en, ''), name_en),
        birth_date = coalesce(r.birth_date, birth_date),
        gender     = coalesce(r.gender, gender),
        grade      = coalesce(r.grade, grade),
        class_name = coalesce(r.class_name, class_name),
        class_id   = coalesce(r.class_id, class_id),
        department = '초등부',
        parent_phone = coalesce(r.parent_phone, parent_phone),
        instrument = coalesce(r.instrument, instrument),
        afterschool = r.afterschool,
        allergies  = coalesce(nullif(r.allergies, ''), allergies),
        status     = r.status,
        left_on    = coalesce(r.left_on, left_on),
        -- 특이사항은 덮어쓰지 않고 덧붙입니다. 앱에서 선생님이 적어둔 관찰 내용이 사라지면 안 됩니다.
        note = case
                 when r.note is null or r.note = '' then note
                 when note is null or note = '' then r.note
                 when position(r.note in note) > 0 then note
                 else note || chr(10) || r.note
               end,
        custom_fields = coalesce(custom_fields, '{}'::jsonb) || jsonb_strip_nulls(jsonb_build_object(
          '교복사이즈', r.uniform, '방과후요일', r.after_days, '입학일', r.start_day, '보호자연락처원문', r.phone_raw))
      where id = target;
    else
      insert into wr_students (name, name_en, birth_date, gender, grade, class_name, class_id, department,
        parent_phone, instrument, afterschool, allergies, note, status, left_on, custom_fields, is_demo)
      values (r.name, nullif(r.name_en, ''), r.birth_date, r.gender, r.grade, r.class_name, r.class_id, '초등부',
        r.parent_phone, r.instrument, r.afterschool, nullif(r.allergies, ''), nullif(r.note, ''), r.status, r.left_on,
        jsonb_strip_nulls(jsonb_build_object(
          '교복사이즈', r.uniform, '방과후요일', r.after_days, '입학일', r.start_day, '보호자연락처원문', r.phone_raw)),
        false);
    end if;
  end loop;
end
$import$;

-- ── ⑤ 이번 학기 수강 등록 ───────────────────────────────────────────────────
-- 학생이 "이번 학기에 어느 반이었는지"를 따로 남겨둡니다. 다음 학기에 반이 바뀌어도 지난 학기
-- 기록을 그 학기의 반으로 되짚어볼 수 있습니다.
insert into wr_enrollments (student_id, term_id, grade, class_id)
select s.id, '3a000000-0000-4000-9000-000000000003', s.grade, s.class_id
  from wr_students s
 where s.is_demo = false and s.status = 'active' and s.department = '초등부' and s.class_id is not null
on conflict (student_id, term_id) do update
  set grade = excluded.grade, class_id = excluded.class_id;


-- ── ⑥ 교시 ─────────────────────────────────────────────────────────────────
-- 초등부 7교시. 8개 반 시간표가 모두 같은 시간표를 쓰고 있어 부서 단위로 한 벌만 둡니다.
insert into wr_periods (department, period_no, label, start_time, end_time)
values ('초등부', 1, '1교시', '08:50', '09:35')
on conflict (department, period_no) do update
  set label = excluded.label, start_time = excluded.start_time, end_time = excluded.end_time;
insert into wr_periods (department, period_no, label, start_time, end_time)
values ('초등부', 2, '2교시', '09:45', '10:30')
on conflict (department, period_no) do update
  set label = excluded.label, start_time = excluded.start_time, end_time = excluded.end_time;
insert into wr_periods (department, period_no, label, start_time, end_time)
values ('초등부', 3, '3교시', '10:40', '11:25')
on conflict (department, period_no) do update
  set label = excluded.label, start_time = excluded.start_time, end_time = excluded.end_time;
insert into wr_periods (department, period_no, label, start_time, end_time)
values ('초등부', 4, '4교시', '12:25', '13:10')
on conflict (department, period_no) do update
  set label = excluded.label, start_time = excluded.start_time, end_time = excluded.end_time;
insert into wr_periods (department, period_no, label, start_time, end_time)
values ('초등부', 5, '5교시', '13:25', '14:10')
on conflict (department, period_no) do update
  set label = excluded.label, start_time = excluded.start_time, end_time = excluded.end_time;
insert into wr_periods (department, period_no, label, start_time, end_time)
values ('초등부', 6, '6교시', '14:20', '15:05')
on conflict (department, period_no) do update
  set label = excluded.label, start_time = excluded.start_time, end_time = excluded.end_time;
insert into wr_periods (department, period_no, label, start_time, end_time)
values ('초등부', 7, '7교시', '15:15', '16:00')
on conflict (department, period_no) do update
  set label = excluded.label, start_time = excluded.start_time, end_time = excluded.end_time;

-- ── ⑦ 과목 ─────────────────────────────────────────────────────────────────
-- 시간표에 나오는 과목을 그대로 등록합니다. 담당 선생님은 아직 가입 전이라 이름만 넣어두고,
-- 가입할 때 본인이 담당 과목을 고르면 연결됩니다.
insert into wr_subjects (name, teacher_name)
select 'Art', null
 where not exists (select 1 from wr_subjects where name = 'Art');
insert into wr_subjects (name, teacher_name)
select 'Chinese', 'Eunji Park / 박은지'
 where not exists (select 1 from wr_subjects where name = 'Chinese');
insert into wr_subjects (name, teacher_name)
select 'Computer Science', 'Eamonn'
 where not exists (select 1 from wr_subjects where name = 'Computer Science');
insert into wr_subjects (name, teacher_name)
select 'ELA', null
 where not exists (select 1 from wr_subjects where name = 'ELA');
insert into wr_subjects (name, teacher_name)
select 'Fencing', null
 where not exists (select 1 from wr_subjects where name = 'Fencing');
insert into wr_subjects (name, teacher_name)
select 'Ice Hockey', null
 where not exists (select 1 from wr_subjects where name = 'Ice Hockey');
insert into wr_subjects (name, teacher_name)
select 'Korean History', 'Joseph Cho / 조진형'
 where not exists (select 1 from wr_subjects where name = 'Korean History');
insert into wr_subjects (name, teacher_name)
select 'Math', null
 where not exists (select 1 from wr_subjects where name = 'Math');
insert into wr_subjects (name, teacher_name)
select 'Music', null
 where not exists (select 1 from wr_subjects where name = 'Music');
insert into wr_subjects (name, teacher_name)
select 'Music Theory', null
 where not exists (select 1 from wr_subjects where name = 'Music Theory');
insert into wr_subjects (name, teacher_name)
select 'Novel Studies', null
 where not exists (select 1 from wr_subjects where name = 'Novel Studies');
insert into wr_subjects (name, teacher_name)
select 'PBL', null
 where not exists (select 1 from wr_subjects where name = 'PBL');
insert into wr_subjects (name, teacher_name)
select 'PE', null
 where not exists (select 1 from wr_subjects where name = 'PE');
insert into wr_subjects (name, teacher_name)
select 'Science', null
 where not exists (select 1 from wr_subjects where name = 'Science');
insert into wr_subjects (name, teacher_name)
select 'Social Studies', null
 where not exists (select 1 from wr_subjects where name = 'Social Studies');
insert into wr_subjects (name, teacher_name)
select 'WSC', null
 where not exists (select 1 from wr_subjects where name = 'WSC');

-- ── ⑧ 반별 시간표 ──────────────────────────────────────────────────────────
-- 요일 1=월 ... 5=금. 같은 반·요일·교시가 이미 있으면 과목만 갈아끼웁니다.
-- G2J (Ms. Jaime)
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000001', 1, p.id, 'PE', null
  from wr_periods p where p.department = '초등부' and p.period_no = 1
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000001', 2, p.id, 'PE', null
  from wr_periods p where p.department = '초등부' and p.period_no = 1
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000001', 3, p.id, 'Art', null
  from wr_periods p where p.department = '초등부' and p.period_no = 1
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000001', 4, p.id, 'Chinese', 'Eunji Park / 박은지'
  from wr_periods p where p.department = '초등부' and p.period_no = 1
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000001', 5, p.id, 'Korean History', 'Joseph Cho / 조진형'
  from wr_periods p where p.department = '초등부' and p.period_no = 1
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000001', 1, p.id, 'Korean History', 'Joseph Cho / 조진형'
  from wr_periods p where p.department = '초등부' and p.period_no = 2
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000001', 2, p.id, 'Music Theory', null
  from wr_periods p where p.department = '초등부' and p.period_no = 2
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000001', 3, p.id, 'ELA', null
  from wr_periods p where p.department = '초등부' and p.period_no = 2
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000001', 4, p.id, 'ELA', null
  from wr_periods p where p.department = '초등부' and p.period_no = 2
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000001', 5, p.id, 'Social Studies', null
  from wr_periods p where p.department = '초등부' and p.period_no = 2
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000001', 1, p.id, 'Computer Science', 'Eamonn'
  from wr_periods p where p.department = '초등부' and p.period_no = 3
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000001', 2, p.id, 'Music', null
  from wr_periods p where p.department = '초등부' and p.period_no = 3
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000001', 3, p.id, 'Computer Science', 'Eamonn'
  from wr_periods p where p.department = '초등부' and p.period_no = 3
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000001', 4, p.id, 'Computer Science', 'Eamonn'
  from wr_periods p where p.department = '초등부' and p.period_no = 3
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000001', 5, p.id, 'PE', null
  from wr_periods p where p.department = '초등부' and p.period_no = 3
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000001', 1, p.id, 'Math', null
  from wr_periods p where p.department = '초등부' and p.period_no = 4
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000001', 2, p.id, 'Social Studies', null
  from wr_periods p where p.department = '초등부' and p.period_no = 4
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000001', 3, p.id, 'Math', null
  from wr_periods p where p.department = '초등부' and p.period_no = 4
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000001', 4, p.id, 'Math', null
  from wr_periods p where p.department = '초등부' and p.period_no = 4
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000001', 5, p.id, 'Science', null
  from wr_periods p where p.department = '초등부' and p.period_no = 4
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000001', 1, p.id, 'Social Studies', null
  from wr_periods p where p.department = '초등부' and p.period_no = 5
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000001', 2, p.id, 'Math', null
  from wr_periods p where p.department = '초등부' and p.period_no = 5
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000001', 3, p.id, 'Science', null
  from wr_periods p where p.department = '초등부' and p.period_no = 5
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000001', 4, p.id, 'Science', null
  from wr_periods p where p.department = '초등부' and p.period_no = 5
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000001', 5, p.id, 'ELA', null
  from wr_periods p where p.department = '초등부' and p.period_no = 5
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000001', 1, p.id, 'Novel Studies', null
  from wr_periods p where p.department = '초등부' and p.period_no = 6
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000001', 2, p.id, 'WSC', null
  from wr_periods p where p.department = '초등부' and p.period_no = 6
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000001', 3, p.id, 'Novel Studies', null
  from wr_periods p where p.department = '초등부' and p.period_no = 6
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000001', 4, p.id, 'WSC', null
  from wr_periods p where p.department = '초등부' and p.period_no = 6
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000001', 5, p.id, 'Novel Studies', null
  from wr_periods p where p.department = '초등부' and p.period_no = 6
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000001', 1, p.id, 'Novel Studies', null
  from wr_periods p where p.department = '초등부' and p.period_no = 7
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000001', 2, p.id, 'WSC', null
  from wr_periods p where p.department = '초등부' and p.period_no = 7
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000001', 3, p.id, 'Novel Studies', null
  from wr_periods p where p.department = '초등부' and p.period_no = 7
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000001', 4, p.id, 'WSC', null
  from wr_periods p where p.department = '초등부' and p.period_no = 7
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000001', 5, p.id, 'Novel Studies', null
  from wr_periods p where p.department = '초등부' and p.period_no = 7
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
-- G2C (Ms. Carina)
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000002', 1, p.id, 'Art', null
  from wr_periods p where p.department = '초등부' and p.period_no = 1
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000002', 2, p.id, 'Korean History', 'Joseph Cho / 조진형'
  from wr_periods p where p.department = '초등부' and p.period_no = 1
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000002', 3, p.id, 'Computer Science', 'Eamonn'
  from wr_periods p where p.department = '초등부' and p.period_no = 1
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000002', 4, p.id, 'Math', null
  from wr_periods p where p.department = '초등부' and p.period_no = 1
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000002', 5, p.id, 'Science', null
  from wr_periods p where p.department = '초등부' and p.period_no = 1
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000002', 1, p.id, 'Science', null
  from wr_periods p where p.department = '초등부' and p.period_no = 2
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000002', 2, p.id, 'Social Studies', null
  from wr_periods p where p.department = '초등부' and p.period_no = 2
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000002', 3, p.id, 'Korean History', 'Joseph Cho / 조진형'
  from wr_periods p where p.department = '초등부' and p.period_no = 2
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000002', 4, p.id, 'PE', null
  from wr_periods p where p.department = '초등부' and p.period_no = 2
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000002', 5, p.id, 'Chinese', 'Eunji Park / 박은지'
  from wr_periods p where p.department = '초등부' and p.period_no = 2
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000002', 1, p.id, 'PE', null
  from wr_periods p where p.department = '초등부' and p.period_no = 3
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000002', 2, p.id, 'Music', null
  from wr_periods p where p.department = '초등부' and p.period_no = 3
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000002', 3, p.id, 'PE', null
  from wr_periods p where p.department = '초등부' and p.period_no = 3
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000002', 4, p.id, 'Social Studies', null
  from wr_periods p where p.department = '초등부' and p.period_no = 3
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000002', 5, p.id, 'Computer Science', 'Eamonn'
  from wr_periods p where p.department = '초등부' and p.period_no = 3
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000002', 1, p.id, 'Math', null
  from wr_periods p where p.department = '초등부' and p.period_no = 4
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000002', 2, p.id, 'Music Theory', null
  from wr_periods p where p.department = '초등부' and p.period_no = 4
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000002', 3, p.id, 'Math', null
  from wr_periods p where p.department = '초등부' and p.period_no = 4
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000002', 4, p.id, 'Science', null
  from wr_periods p where p.department = '초등부' and p.period_no = 4
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000002', 5, p.id, 'ELA', null
  from wr_periods p where p.department = '초등부' and p.period_no = 4
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000002', 1, p.id, 'ELA', null
  from wr_periods p where p.department = '초등부' and p.period_no = 5
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000002', 2, p.id, 'Math', null
  from wr_periods p where p.department = '초등부' and p.period_no = 5
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000002', 3, p.id, 'ELA', null
  from wr_periods p where p.department = '초등부' and p.period_no = 5
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000002', 4, p.id, 'Computer Science', 'Eamonn'
  from wr_periods p where p.department = '초등부' and p.period_no = 5
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000002', 5, p.id, 'Social Studies', null
  from wr_periods p where p.department = '초등부' and p.period_no = 5
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000002', 1, p.id, 'Novel Studies', null
  from wr_periods p where p.department = '초등부' and p.period_no = 6
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000002', 2, p.id, 'WSC', null
  from wr_periods p where p.department = '초등부' and p.period_no = 6
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000002', 3, p.id, 'Novel Studies', null
  from wr_periods p where p.department = '초등부' and p.period_no = 6
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000002', 4, p.id, 'WSC', null
  from wr_periods p where p.department = '초등부' and p.period_no = 6
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000002', 5, p.id, 'Novel Studies', null
  from wr_periods p where p.department = '초등부' and p.period_no = 6
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000002', 1, p.id, 'Novel Studies', null
  from wr_periods p where p.department = '초등부' and p.period_no = 7
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000002', 2, p.id, 'WSC', null
  from wr_periods p where p.department = '초등부' and p.period_no = 7
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000002', 3, p.id, 'Novel Studies', null
  from wr_periods p where p.department = '초등부' and p.period_no = 7
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000002', 4, p.id, 'WSC', null
  from wr_periods p where p.department = '초등부' and p.period_no = 7
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000002', 5, p.id, 'Novel Studies', null
  from wr_periods p where p.department = '초등부' and p.period_no = 7
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
-- G2A (Ms. Aimie)
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000003', 1, p.id, 'Music Theory', null
  from wr_periods p where p.department = '초등부' and p.period_no = 1
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000003', 2, p.id, 'Math', null
  from wr_periods p where p.department = '초등부' and p.period_no = 1
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000003', 3, p.id, 'Math', null
  from wr_periods p where p.department = '초등부' and p.period_no = 1
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000003', 4, p.id, 'Computer Science', 'Eamonn'
  from wr_periods p where p.department = '초등부' and p.period_no = 1
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000003', 5, p.id, 'Chinese', 'Eunji Park / 박은지'
  from wr_periods p where p.department = '초등부' and p.period_no = 1
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000003', 1, p.id, 'ELA', null
  from wr_periods p where p.department = '초등부' and p.period_no = 2
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000003', 2, p.id, 'Korean History', 'Joseph Cho / 조진형'
  from wr_periods p where p.department = '초등부' and p.period_no = 2
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000003', 3, p.id, 'PE', null
  from wr_periods p where p.department = '초등부' and p.period_no = 2
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000003', 4, p.id, 'Social Studies', null
  from wr_periods p where p.department = '초등부' and p.period_no = 2
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000003', 5, p.id, 'Korean History', 'Joseph Cho / 조진형'
  from wr_periods p where p.department = '초등부' and p.period_no = 2
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000003', 1, p.id, 'Science', null
  from wr_periods p where p.department = '초등부' and p.period_no = 3
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000003', 2, p.id, 'Music', null
  from wr_periods p where p.department = '초등부' and p.period_no = 3
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000003', 3, p.id, 'Art', null
  from wr_periods p where p.department = '초등부' and p.period_no = 3
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000003', 4, p.id, 'PE', null
  from wr_periods p where p.department = '초등부' and p.period_no = 3
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000003', 5, p.id, 'Science', null
  from wr_periods p where p.department = '초등부' and p.period_no = 3
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000003', 1, p.id, 'Computer Science', 'Eamonn'
  from wr_periods p where p.department = '초등부' and p.period_no = 4
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000003', 2, p.id, 'Social Studies', null
  from wr_periods p where p.department = '초등부' and p.period_no = 4
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000003', 3, p.id, 'ELA', null
  from wr_periods p where p.department = '초등부' and p.period_no = 4
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000003', 4, p.id, 'Science', null
  from wr_periods p where p.department = '초등부' and p.period_no = 4
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000003', 5, p.id, 'ELA', null
  from wr_periods p where p.department = '초등부' and p.period_no = 4
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000003', 1, p.id, 'Math', null
  from wr_periods p where p.department = '초등부' and p.period_no = 5
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000003', 2, p.id, 'PE', null
  from wr_periods p where p.department = '초등부' and p.period_no = 5
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000003', 3, p.id, 'Social Studies', null
  from wr_periods p where p.department = '초등부' and p.period_no = 5
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000003', 4, p.id, 'Math', null
  from wr_periods p where p.department = '초등부' and p.period_no = 5
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000003', 5, p.id, 'Computer Science', 'Eamonn'
  from wr_periods p where p.department = '초등부' and p.period_no = 5
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000003', 1, p.id, 'Novel Studies', null
  from wr_periods p where p.department = '초등부' and p.period_no = 6
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000003', 2, p.id, 'WSC', null
  from wr_periods p where p.department = '초등부' and p.period_no = 6
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000003', 3, p.id, 'Novel Studies', null
  from wr_periods p where p.department = '초등부' and p.period_no = 6
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000003', 4, p.id, 'WSC', null
  from wr_periods p where p.department = '초등부' and p.period_no = 6
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000003', 5, p.id, 'Novel Studies', null
  from wr_periods p where p.department = '초등부' and p.period_no = 6
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000003', 1, p.id, 'Novel Studies', null
  from wr_periods p where p.department = '초등부' and p.period_no = 7
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000003', 2, p.id, 'WSC', null
  from wr_periods p where p.department = '초등부' and p.period_no = 7
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000003', 3, p.id, 'Novel Studies', null
  from wr_periods p where p.department = '초등부' and p.period_no = 7
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000003', 4, p.id, 'WSC', null
  from wr_periods p where p.department = '초등부' and p.period_no = 7
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000003', 5, p.id, 'Novel Studies', null
  from wr_periods p where p.department = '초등부' and p.period_no = 7
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
-- G3JU (Ms. June)
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000004', 1, p.id, 'Chinese', 'Eunji Park / 박은지'
  from wr_periods p where p.department = '초등부' and p.period_no = 1
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000004', 2, p.id, 'Music', null
  from wr_periods p where p.department = '초등부' and p.period_no = 1
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000004', 3, p.id, 'Science', null
  from wr_periods p where p.department = '초등부' and p.period_no = 1
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000004', 4, p.id, 'Korean History', 'Joseph Cho / 조진형'
  from wr_periods p where p.department = '초등부' and p.period_no = 1
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000004', 5, p.id, 'Math', null
  from wr_periods p where p.department = '초등부' and p.period_no = 1
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000004', 1, p.id, 'Math', null
  from wr_periods p where p.department = '초등부' and p.period_no = 2
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000004', 2, p.id, 'PE', null
  from wr_periods p where p.department = '초등부' and p.period_no = 2
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000004', 3, p.id, 'Art', null
  from wr_periods p where p.department = '초등부' and p.period_no = 2
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000004', 4, p.id, 'PBL', null
  from wr_periods p where p.department = '초등부' and p.period_no = 2
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000004', 5, p.id, 'Fencing', null
  from wr_periods p where p.department = '초등부' and p.period_no = 2
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000004', 1, p.id, 'ELA', null
  from wr_periods p where p.department = '초등부' and p.period_no = 3
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000004', 2, p.id, 'PBL', null
  from wr_periods p where p.department = '초등부' and p.period_no = 3
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000004', 3, p.id, 'PBL', null
  from wr_periods p where p.department = '초등부' and p.period_no = 3
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000004', 4, p.id, 'Social Studies', null
  from wr_periods p where p.department = '초등부' and p.period_no = 3
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000004', 5, p.id, 'Science', null
  from wr_periods p where p.department = '초등부' and p.period_no = 3
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000004', 1, p.id, 'Music Theory', null
  from wr_periods p where p.department = '초등부' and p.period_no = 4
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000004', 2, p.id, 'Social Studies', null
  from wr_periods p where p.department = '초등부' and p.period_no = 4
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000004', 3, p.id, 'ELA', null
  from wr_periods p where p.department = '초등부' and p.period_no = 4
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000004', 4, p.id, 'Math', null
  from wr_periods p where p.department = '초등부' and p.period_no = 4
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000004', 5, p.id, 'Computer Science', 'Eamonn'
  from wr_periods p where p.department = '초등부' and p.period_no = 4
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000004', 1, p.id, 'Social Studies', null
  from wr_periods p where p.department = '초등부' and p.period_no = 5
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000004', 2, p.id, 'Math', null
  from wr_periods p where p.department = '초등부' and p.period_no = 5
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000004', 3, p.id, 'PE', null
  from wr_periods p where p.department = '초등부' and p.period_no = 5
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000004', 4, p.id, 'Science', null
  from wr_periods p where p.department = '초등부' and p.period_no = 5
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000004', 5, p.id, 'ELA', null
  from wr_periods p where p.department = '초등부' and p.period_no = 5
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000004', 1, p.id, 'WSC', null
  from wr_periods p where p.department = '초등부' and p.period_no = 6
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000004', 2, p.id, 'Novel Studies', null
  from wr_periods p where p.department = '초등부' and p.period_no = 6
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000004', 3, p.id, 'WSC', null
  from wr_periods p where p.department = '초등부' and p.period_no = 6
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000004', 4, p.id, 'Novel Studies', null
  from wr_periods p where p.department = '초등부' and p.period_no = 6
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000004', 5, p.id, 'WSC', null
  from wr_periods p where p.department = '초등부' and p.period_no = 6
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000004', 1, p.id, 'WSC', null
  from wr_periods p where p.department = '초등부' and p.period_no = 7
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000004', 2, p.id, 'Novel Studies', null
  from wr_periods p where p.department = '초등부' and p.period_no = 7
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000004', 3, p.id, 'WSC', null
  from wr_periods p where p.department = '초등부' and p.period_no = 7
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000004', 4, p.id, 'Novel Studies', null
  from wr_periods p where p.department = '초등부' and p.period_no = 7
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000004', 5, p.id, 'WSC', null
  from wr_periods p where p.department = '초등부' and p.period_no = 7
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
-- G3JA (Ms. Janelle)
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000005', 1, p.id, 'Social Studies', null
  from wr_periods p where p.department = '초등부' and p.period_no = 1
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000005', 2, p.id, 'Music', null
  from wr_periods p where p.department = '초등부' and p.period_no = 1
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000005', 3, p.id, 'ELA', null
  from wr_periods p where p.department = '초등부' and p.period_no = 1
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000005', 4, p.id, 'PBL', null
  from wr_periods p where p.department = '초등부' and p.period_no = 1
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000005', 5, p.id, 'PBL', null
  from wr_periods p where p.department = '초등부' and p.period_no = 1
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000005', 1, p.id, 'Art', null
  from wr_periods p where p.department = '초등부' and p.period_no = 2
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000005', 2, p.id, 'Science', null
  from wr_periods p where p.department = '초등부' and p.period_no = 2
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000005', 3, p.id, 'Chinese', 'Eunji Park / 박은지'
  from wr_periods p where p.department = '초등부' and p.period_no = 2
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000005', 4, p.id, 'Korean History', 'Joseph Cho / 조진형'
  from wr_periods p where p.department = '초등부' and p.period_no = 2
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000005', 5, p.id, 'Math', null
  from wr_periods p where p.department = '초등부' and p.period_no = 2
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000005', 1, p.id, 'Music Theory', null
  from wr_periods p where p.department = '초등부' and p.period_no = 3
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000005', 2, p.id, 'ELA', null
  from wr_periods p where p.department = '초등부' and p.period_no = 3
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000005', 3, p.id, 'Science', null
  from wr_periods p where p.department = '초등부' and p.period_no = 3
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000005', 4, p.id, 'Social Studies', null
  from wr_periods p where p.department = '초등부' and p.period_no = 3
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000005', 5, p.id, 'Fencing', null
  from wr_periods p where p.department = '초등부' and p.period_no = 3
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000005', 1, p.id, 'PBL', null
  from wr_periods p where p.department = '초등부' and p.period_no = 4
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000005', 2, p.id, 'Math', null
  from wr_periods p where p.department = '초등부' and p.period_no = 4
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000005', 3, p.id, 'Social Studies', null
  from wr_periods p where p.department = '초등부' and p.period_no = 4
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000005', 4, p.id, 'ELA', null
  from wr_periods p where p.department = '초등부' and p.period_no = 4
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000005', 5, p.id, 'Science', null
  from wr_periods p where p.department = '초등부' and p.period_no = 4
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000005', 1, p.id, 'Math', null
  from wr_periods p where p.department = '초등부' and p.period_no = 5
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000005', 2, p.id, 'Computer Science', 'Eamonn'
  from wr_periods p where p.department = '초등부' and p.period_no = 5
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000005', 3, p.id, 'Math', null
  from wr_periods p where p.department = '초등부' and p.period_no = 5
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000005', 4, p.id, 'PE', null
  from wr_periods p where p.department = '초등부' and p.period_no = 5
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000005', 5, p.id, 'PE', null
  from wr_periods p where p.department = '초등부' and p.period_no = 5
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000005', 1, p.id, 'WSC', null
  from wr_periods p where p.department = '초등부' and p.period_no = 6
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000005', 2, p.id, 'Novel Studies', null
  from wr_periods p where p.department = '초등부' and p.period_no = 6
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000005', 3, p.id, 'WSC', null
  from wr_periods p where p.department = '초등부' and p.period_no = 6
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000005', 4, p.id, 'Novel Studies', null
  from wr_periods p where p.department = '초등부' and p.period_no = 6
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000005', 5, p.id, 'WSC', null
  from wr_periods p where p.department = '초등부' and p.period_no = 6
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000005', 1, p.id, 'WSC', null
  from wr_periods p where p.department = '초등부' and p.period_no = 7
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000005', 2, p.id, 'Novel Studies', null
  from wr_periods p where p.department = '초등부' and p.period_no = 7
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000005', 3, p.id, 'WSC', null
  from wr_periods p where p.department = '초등부' and p.period_no = 7
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000005', 4, p.id, 'Novel Studies', null
  from wr_periods p where p.department = '초등부' and p.period_no = 7
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000005', 5, p.id, 'WSC', null
  from wr_periods p where p.department = '초등부' and p.period_no = 7
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
-- G4R (Ms. Rachel)
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000006', 1, p.id, 'Korean History', 'Joseph Cho / 조진형'
  from wr_periods p where p.department = '초등부' and p.period_no = 1
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000006', 2, p.id, 'PBL', null
  from wr_periods p where p.department = '초등부' and p.period_no = 1
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000006', 3, p.id, 'Math', null
  from wr_periods p where p.department = '초등부' and p.period_no = 1
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000006', 4, p.id, 'Math', null
  from wr_periods p where p.department = '초등부' and p.period_no = 1
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000006', 5, p.id, 'Ice Hockey', null
  from wr_periods p where p.department = '초등부' and p.period_no = 1
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000006', 1, p.id, 'Chinese', 'Eunji Park / 박은지'
  from wr_periods p where p.department = '초등부' and p.period_no = 2
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000006', 2, p.id, 'Music', null
  from wr_periods p where p.department = '초등부' and p.period_no = 2
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000006', 3, p.id, 'PBL', null
  from wr_periods p where p.department = '초등부' and p.period_no = 2
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000006', 4, p.id, 'Social Studies', null
  from wr_periods p where p.department = '초등부' and p.period_no = 2
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000006', 5, p.id, 'Ice Hockey', null
  from wr_periods p where p.department = '초등부' and p.period_no = 2
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000006', 1, p.id, 'Science', null
  from wr_periods p where p.department = '초등부' and p.period_no = 3
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000006', 2, p.id, 'Music Theory', null
  from wr_periods p where p.department = '초등부' and p.period_no = 3
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000006', 3, p.id, 'Social Studies', null
  from wr_periods p where p.department = '초등부' and p.period_no = 3
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000006', 4, p.id, 'Science', null
  from wr_periods p where p.department = '초등부' and p.period_no = 3
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000006', 5, p.id, 'Ice Hockey', null
  from wr_periods p where p.department = '초등부' and p.period_no = 3
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000006', 1, p.id, 'Math', null
  from wr_periods p where p.department = '초등부' and p.period_no = 4
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000006', 2, p.id, 'Science', null
  from wr_periods p where p.department = '초등부' and p.period_no = 4
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000006', 3, p.id, 'Art', null
  from wr_periods p where p.department = '초등부' and p.period_no = 4
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000006', 4, p.id, 'Computer Science', 'Eamonn'
  from wr_periods p where p.department = '초등부' and p.period_no = 4
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000006', 5, p.id, 'Math', null
  from wr_periods p where p.department = '초등부' and p.period_no = 4
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000006', 1, p.id, 'ELA', null
  from wr_periods p where p.department = '초등부' and p.period_no = 5
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000006', 2, p.id, 'Social Studies', null
  from wr_periods p where p.department = '초등부' and p.period_no = 5
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000006', 3, p.id, 'ELA', null
  from wr_periods p where p.department = '초등부' and p.period_no = 5
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000006', 4, p.id, 'ELA', null
  from wr_periods p where p.department = '초등부' and p.period_no = 5
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000006', 5, p.id, 'PBL', null
  from wr_periods p where p.department = '초등부' and p.period_no = 5
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000006', 1, p.id, 'WSC', null
  from wr_periods p where p.department = '초등부' and p.period_no = 6
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000006', 2, p.id, 'Novel Studies', null
  from wr_periods p where p.department = '초등부' and p.period_no = 6
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000006', 3, p.id, 'WSC', null
  from wr_periods p where p.department = '초등부' and p.period_no = 6
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000006', 4, p.id, 'Novel Studies', null
  from wr_periods p where p.department = '초등부' and p.period_no = 6
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000006', 5, p.id, 'WSC', null
  from wr_periods p where p.department = '초등부' and p.period_no = 6
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000006', 1, p.id, 'WSC', null
  from wr_periods p where p.department = '초등부' and p.period_no = 7
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000006', 2, p.id, 'Novel Studies', null
  from wr_periods p where p.department = '초등부' and p.period_no = 7
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000006', 3, p.id, 'WSC', null
  from wr_periods p where p.department = '초등부' and p.period_no = 7
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000006', 4, p.id, 'Novel Studies', null
  from wr_periods p where p.department = '초등부' and p.period_no = 7
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000006', 5, p.id, 'WSC', null
  from wr_periods p where p.department = '초등부' and p.period_no = 7
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
-- G4S (Ms. Song)
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000007', 1, p.id, 'PBL', null
  from wr_periods p where p.department = '초등부' and p.period_no = 1
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000007', 2, p.id, 'Math', null
  from wr_periods p where p.department = '초등부' and p.period_no = 1
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000007', 3, p.id, 'Chinese', 'Eunji Park / 박은지'
  from wr_periods p where p.department = '초등부' and p.period_no = 1
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000007', 4, p.id, 'ELA', null
  from wr_periods p where p.department = '초등부' and p.period_no = 1
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000007', 5, p.id, 'Ice Hockey', null
  from wr_periods p where p.department = '초등부' and p.period_no = 1
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000007', 1, p.id, 'Music Theory', null
  from wr_periods p where p.department = '초등부' and p.period_no = 2
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000007', 2, p.id, 'Music', null
  from wr_periods p where p.department = '초등부' and p.period_no = 2
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000007', 3, p.id, 'ELA', null
  from wr_periods p where p.department = '초등부' and p.period_no = 2
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000007', 4, p.id, 'Math', null
  from wr_periods p where p.department = '초등부' and p.period_no = 2
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000007', 5, p.id, 'Ice Hockey', null
  from wr_periods p where p.department = '초등부' and p.period_no = 2
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000007', 1, p.id, 'ELA', null
  from wr_periods p where p.department = '초등부' and p.period_no = 3
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000007', 2, p.id, 'Science', null
  from wr_periods p where p.department = '초등부' and p.period_no = 3
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000007', 3, p.id, 'Social Studies', null
  from wr_periods p where p.department = '초등부' and p.period_no = 3
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000007', 4, p.id, 'Social Studies', null
  from wr_periods p where p.department = '초등부' and p.period_no = 3
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000007', 5, p.id, 'Ice Hockey', null
  from wr_periods p where p.department = '초등부' and p.period_no = 3
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000007', 1, p.id, 'Art', null
  from wr_periods p where p.department = '초등부' and p.period_no = 4
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000007', 2, p.id, 'Computer Science', 'Eamonn'
  from wr_periods p where p.department = '초등부' and p.period_no = 4
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000007', 3, p.id, 'Math', null
  from wr_periods p where p.department = '초등부' and p.period_no = 4
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000007', 4, p.id, 'Science', null
  from wr_periods p where p.department = '초등부' and p.period_no = 4
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000007', 5, p.id, 'Science', null
  from wr_periods p where p.department = '초등부' and p.period_no = 4
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000007', 1, p.id, 'Social Studies', null
  from wr_periods p where p.department = '초등부' and p.period_no = 5
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000007', 2, p.id, 'PBL', null
  from wr_periods p where p.department = '초등부' and p.period_no = 5
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000007', 3, p.id, 'PBL', null
  from wr_periods p where p.department = '초등부' and p.period_no = 5
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000007', 4, p.id, 'Korean History', 'Joseph Cho / 조진형'
  from wr_periods p where p.department = '초등부' and p.period_no = 5
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000007', 5, p.id, 'Math', null
  from wr_periods p where p.department = '초등부' and p.period_no = 5
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000007', 1, p.id, 'WSC', null
  from wr_periods p where p.department = '초등부' and p.period_no = 6
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000007', 2, p.id, 'Novel Studies', null
  from wr_periods p where p.department = '초등부' and p.period_no = 6
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000007', 3, p.id, 'WSC', null
  from wr_periods p where p.department = '초등부' and p.period_no = 6
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000007', 4, p.id, 'Novel Studies', null
  from wr_periods p where p.department = '초등부' and p.period_no = 6
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000007', 5, p.id, 'WSC', null
  from wr_periods p where p.department = '초등부' and p.period_no = 6
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000007', 1, p.id, 'WSC', null
  from wr_periods p where p.department = '초등부' and p.period_no = 7
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000007', 2, p.id, 'Novel Studies', null
  from wr_periods p where p.department = '초등부' and p.period_no = 7
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000007', 3, p.id, 'WSC', null
  from wr_periods p where p.department = '초등부' and p.period_no = 7
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000007', 4, p.id, 'Novel Studies', null
  from wr_periods p where p.department = '초등부' and p.period_no = 7
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000007', 5, p.id, 'WSC', null
  from wr_periods p where p.department = '초등부' and p.period_no = 7
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
-- G5E (Mr. Eugene)
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000008', 1, p.id, 'Math', null
  from wr_periods p where p.department = '초등부' and p.period_no = 1
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000008', 2, p.id, 'Music Theory', null
  from wr_periods p where p.department = '초등부' and p.period_no = 1
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000008', 3, p.id, 'Korean History', 'Joseph Cho / 조진형'
  from wr_periods p where p.department = '초등부' and p.period_no = 1
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000008', 4, p.id, 'Science', null
  from wr_periods p where p.department = '초등부' and p.period_no = 1
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000008', 5, p.id, 'Ice Hockey', null
  from wr_periods p where p.department = '초등부' and p.period_no = 1
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000008', 1, p.id, 'ELA', null
  from wr_periods p where p.department = '초등부' and p.period_no = 2
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000008', 2, p.id, 'Math', null
  from wr_periods p where p.department = '초등부' and p.period_no = 2
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000008', 3, p.id, 'Math', null
  from wr_periods p where p.department = '초등부' and p.period_no = 2
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000008', 4, p.id, 'Chinese', 'Eunji Park / 박은지'
  from wr_periods p where p.department = '초등부' and p.period_no = 2
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000008', 5, p.id, 'Ice Hockey', null
  from wr_periods p where p.department = '초등부' and p.period_no = 2
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000008', 1, p.id, 'Art', null
  from wr_periods p where p.department = '초등부' and p.period_no = 3
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000008', 2, p.id, 'Science', null
  from wr_periods p where p.department = '초등부' and p.period_no = 3
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000008', 3, p.id, 'ELA', null
  from wr_periods p where p.department = '초등부' and p.period_no = 3
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000008', 4, p.id, 'ELA', null
  from wr_periods p where p.department = '초등부' and p.period_no = 3
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000008', 5, p.id, 'Ice Hockey', null
  from wr_periods p where p.department = '초등부' and p.period_no = 3
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000008', 1, p.id, 'Science', null
  from wr_periods p where p.department = '초등부' and p.period_no = 4
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000008', 2, p.id, 'Music', null
  from wr_periods p where p.department = '초등부' and p.period_no = 4
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000008', 3, p.id, 'Computer Science', 'Eamonn'
  from wr_periods p where p.department = '초등부' and p.period_no = 4
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000008', 4, p.id, 'Social Studies', null
  from wr_periods p where p.department = '초등부' and p.period_no = 4
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000008', 5, p.id, 'PBL', null
  from wr_periods p where p.department = '초등부' and p.period_no = 4
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000008', 1, p.id, 'PBL', null
  from wr_periods p where p.department = '초등부' and p.period_no = 5
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000008', 2, p.id, 'PBL', null
  from wr_periods p where p.department = '초등부' and p.period_no = 5
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000008', 3, p.id, 'Social Studies', null
  from wr_periods p where p.department = '초등부' and p.period_no = 5
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000008', 4, p.id, 'Math', null
  from wr_periods p where p.department = '초등부' and p.period_no = 5
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000008', 5, p.id, 'Social Studies', null
  from wr_periods p where p.department = '초등부' and p.period_no = 5
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000008', 1, p.id, 'WSC', null
  from wr_periods p where p.department = '초등부' and p.period_no = 6
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000008', 2, p.id, 'Novel Studies', null
  from wr_periods p where p.department = '초등부' and p.period_no = 6
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000008', 3, p.id, 'WSC', null
  from wr_periods p where p.department = '초등부' and p.period_no = 6
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000008', 4, p.id, 'Novel Studies', null
  from wr_periods p where p.department = '초등부' and p.period_no = 6
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000008', 5, p.id, 'WSC', null
  from wr_periods p where p.department = '초등부' and p.period_no = 6
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000008', 1, p.id, 'WSC', null
  from wr_periods p where p.department = '초등부' and p.period_no = 7
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000008', 2, p.id, 'Novel Studies', null
  from wr_periods p where p.department = '초등부' and p.period_no = 7
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000008', 3, p.id, 'WSC', null
  from wr_periods p where p.department = '초등부' and p.period_no = 7
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000008', 4, p.id, 'Novel Studies', null
  from wr_periods p where p.department = '초등부' and p.period_no = 7
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);
insert into wr_timetable (class_id, weekday, period_id, subject_name, teacher_name)
select '3a000000-0000-4000-a000-000000000008', 5, p.id, 'WSC', null
  from wr_periods p where p.department = '초등부' and p.period_no = 7
on conflict (class_id, weekday, period_id) do update
  set subject_name = excluded.subject_name,
      teacher_name = coalesce(excluded.teacher_name, wr_timetable.teacher_name);

drop table if exists _roster;