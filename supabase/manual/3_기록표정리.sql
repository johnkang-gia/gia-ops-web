-- ============================================================================
--  GIA 운영앱 - 손으로 적용하는 SQL 3/3 : 마이그레이션 기록표 정리
-- ============================================================================
--  ▶ Supabase 대시보드 → SQL Editor → New query → 이 파일 전체 붙여넣기 → Run
--  ▶ 순서대로 1 → 2 → 3 을 각각 실행해주세요.
--  ▶ 여러 번 실행해도 안전합니다.
-- ============================================================================


create schema if not exists supabase_migrations;
create table if not exists supabase_migrations.schema_migrations (
  version text primary key, statements text[], name text
);
alter table supabase_migrations.schema_migrations add column if not exists statements text[];
alter table supabase_migrations.schema_migrations add column if not exists name text;
insert into supabase_migrations.schema_migrations (version, name) values
  ('20260811000000', 'shuttle_auto_depart'),
  ('20260813000000', 'shuttle_traccar_tracking'),
  ('20260820000000', 'work_notices'),
  ('20260820120000', 'ops_board_timetable'),
  ('20260820180000', 'department_column'),
  ('20260820200000', 'ensure_base_columns'),
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
