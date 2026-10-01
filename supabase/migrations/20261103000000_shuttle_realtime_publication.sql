-- 하원 셔틀명단에서 학생을 넣었는데 옆 탭 하원 체크표에 안 떴습니다.
--
-- 체크표는 `shuttle_assignments` 의 실시간 변경을 받아 다시 읽게 되어 있습니다. 그런데 실시간은
-- 표가 `supabase_realtime` 발행 목록에 들어 있어야 옵니다. 그 목록은 대시보드에서 손으로 켜는
-- 것이라 코드에는 흔적이 없고, 어떤 표는 켜져 있고 어떤 표는 안 켜져 있어도 화면에는 오류가 아니라
-- 「그냥 안 바뀌는 화면」으로 보입니다.
--
-- 하원 세 화면이 듣는 표(`src/lib/shuttleLive.ts` 의 SHUTTLE_LIVE_TABLES)를 전부 발행 목록에
-- 넣습니다. 이미 들어 있으면 건너뜁니다.
do $$
declare t text;
begin
  foreach t in array array[
    'shuttle_assignments', 'shuttle_boardings', 'shuttle_stops', 'shuttle_routes',
    'student_dismissal_plans', 'shuttle_persistent_notes', 'shuttle_run_events'
  ] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
