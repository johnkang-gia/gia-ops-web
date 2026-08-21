-- ===== 96-b. 선행 보정 - 뒤 마이그레이션이 기대하는 칸을 먼저 채웁니다 =====
--
-- 왜 필요한가요?
--   실서버 DB는 마이그레이션 자동화를 만들기 전까지 "채팅으로 드린 SQL을 Supabase SQL Editor에
--   직접 붙여넣는" 방식으로 만들어져 왔습니다. 그러다 보니 중간에 빠뜨린 블록이 생겼고, 실제로
--   wr_students.gender 칸이 실서버에 없었습니다. 그런데 그 뒤에 만든 공용 명부 뷰
--   (wr_students_basic)가 그 칸을 읽으려 해서 다음 오류로 멈췄습니다.
--
--     ERROR: column s.gender does not exist (SQLSTATE 42703)
--
--   마이그레이션은 하나가 실패하면 그 뒤 파일이 전부 멈추기 때문에, 이 한 칸 때문에 3학기 학생
--   명부·반·시간표가 통째로 들어가지 못했습니다.
--
-- 이 파일이 하는 일
--   앞으로 실행될 마이그레이션들이 읽거나 쓰는 칸을 전부 "없으면 만들기"로 한 번씩 훑습니다.
--   이미 있으면 아무 일도 일어나지 않으므로, 실서버든 새 DB든 같은 결과가 됩니다. 앞으로도 손으로
--   넣은 SQL과 어긋나는 부분이 있으면 여기서 먼저 메워집니다.
--
-- 정의는 schema.sql(전체 구조 참고 문서)에 적힌 것과 글자 그대로 같게 맞췄습니다 - 타입이나
-- 기본값이 조금이라도 다르면 나중에 더 찾기 어려운 문제가 됩니다.

-- ── 학생 ────────────────────────────────────────────────────────────────────
alter table wr_students add column if not exists student_no text;
alter table wr_students add column if not exists birth_date date;
alter table wr_students add column if not exists phone text;
alter table wr_students add column if not exists address text;
alter table wr_students add column if not exists class_id uuid references wr_classes(id) on delete set null;
alter table wr_students add column if not exists name_en text;
alter table wr_students add column if not exists parent_email text;
alter table wr_students add column if not exists gender text check (gender in ('남', '여'));
alter table wr_students add column if not exists allergies text;
alter table wr_students add column if not exists custom_fields jsonb not null default '{}'::jsonb;
alter table wr_students add column if not exists shuttle_mode text not null default '없음'
  check (shuttle_mode in ('없음', '등원', '하원', '등하원'));
alter table wr_students add column if not exists lat double precision;
alter table wr_students add column if not exists lng double precision;
alter table wr_students add column if not exists geocoded_at timestamptz;

-- ── 반 ──────────────────────────────────────────────────────────────────────
-- 계정이 아직 없는 담임·부담임의 이름을 임시로 적어두는 칸입니다. 3학기 명부를 넣을 때
-- 선생님들이 가입 전이라 이 칸에 이름만 들어갑니다.
alter table wr_classes add column if not exists teacher_name text;
alter table wr_classes add column if not exists sub_teacher_name text;

-- ── 셔틀 ────────────────────────────────────────────────────────────────────
-- 하원 체크표에서 학생을 다른 차로 옮길 때 쓰는 칸입니다(영구 변경은 배정표, 오늘만 변경은
-- 탑승 기록에 남습니다). 공용 배정표 뷰가 이 칸을 읽습니다.
alter table shuttle_assignments add column if not exists override_route_id uuid references shuttle_routes(id) on delete set null;
alter table shuttle_boardings add column if not exists override_route_id uuid references shuttle_routes(id) on delete set null;
alter table shuttle_boardings add column if not exists alighted_at timestamptz;

-- ── 계정 ────────────────────────────────────────────────────────────────────
alter table app_users add column if not exists name text;
alter table app_users add column if not exists department text;
alter table app_users add column if not exists position text;
alter table app_users add column if not exists avatar_url text;
alter table app_users add column if not exists theme text not null default 'light';
alter table app_users add column if not exists hire_date date;
alter table app_users add column if not exists leave_date date;

-- ── 학기별 반 배정 기록 ─────────────────────────────────────────────────────
-- 3학기 명부를 넣을 때 "이 학생이 이번 학기에 어느 반이었는지"를 여기에 남깁니다. 다음 학기에
-- 반이 바뀌어도 지난 학기 기록을 그 학기의 반으로 되짚어볼 수 있습니다.
create table if not exists wr_enrollments (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references wr_students(id) on delete cascade,
  term_id uuid references terms(id) on delete set null,
  grade text,
  class_id uuid references wr_classes(id) on delete set null,
  homeroom_teacher_email text,
  created_at timestamptz not null default now(),
  unique (student_id, term_id)
);
alter table wr_enrollments enable row level security;
drop policy if exists "giamicro_all_wr_enrollments" on wr_enrollments;
create policy "giamicro_all_wr_enrollments" on wr_enrollments
  for all using (is_giamicro_user()) with check (is_giamicro_user());

-- ── 공통 함수 ───────────────────────────────────────────────────────────────
-- updated_at을 자동으로 갱신하는 트리거 함수입니다. 뒤에서 여러 표가 이 함수를 씁니다.
create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
