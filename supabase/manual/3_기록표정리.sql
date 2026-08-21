-- ============================================================================
--  GIA 운영앱 - 손으로 적용하는 SQL 3/3 : 마이그레이션 기록표 정리
-- ============================================================================
--  ▶ 사용법 - Supabase 대시보드 → SQL Editor → New query → 이 파일 전체 붙여넣기 → Run
--  ▶ 순서대로 1 → 2 → 3 을 각각 실행해주세요.
--  ▶ 빨간 오류가 나면 그 문구를 그대로 알려주세요. 어디서 막혔는지 바로 알 수 있습니다.
--  ▶ 여러 번 실행해도 안전합니다 - 모든 문장이 "없으면 만들고 있으면 갱신"하는 방식입니다.
-- ============================================================================


-- 위 1·2번을 손으로 실행했으므로, Supabase CLI가 다음에 또 실행하지 않도록 "반영 완료"로
-- 적어둡니다. 이걸 해두지 않으면 GitHub Actions가 매번 같은 파일을 처음부터 다시 돌리려 합니다.
create schema if not exists supabase_migrations;
create table if not exists supabase_migrations.schema_migrations (
  version text primary key,
  statements text[],
  name text
);
alter table supabase_migrations.schema_migrations add column if not exists statements text[];
alter table supabase_migrations.schema_migrations add column if not exists name text;

insert into supabase_migrations.schema_migrations (version, name) values
  ('20260811000000', 'shuttle_auto_depart'),
  ('20260813000000', 'shuttle_traccar_tracking'),
  ('20260820000000', 'work_notices'),
  ('20260820120000', 'ops_board_timetable'),
  ('20260820180000', 'department_column'),
  ('20260820210000', 'student_roster_sharing'),
  ('20260820230000', 'guardian_phone_restrict'),
  ('20260821000000', 'library_system'),
  ('20260821120000', 'library_locations_cards'),
  ('20260821200000', 'demo_account_orientation'),
  ('20260821230000', 'ops_board_short_code'),
  ('20260822000000', 'ops_board_dismissal_end'),
  ('20260822120000', 'term3_school_data'),
  ('20260822180000', 'duty_roster')
on conflict (version) do nothing;

-- 끝났습니다. 앱에서 [학교 > 명부 점검]을 열어 숫자를 확인해주세요.
-- 기대값: 재학생 100 · 퇴원 26 · 반 8 · 교시 7 · 시간표 280 · 과목 16
