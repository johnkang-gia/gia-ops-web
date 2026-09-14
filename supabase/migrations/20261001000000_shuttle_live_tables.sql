-- 하원 세 화면이 같은 표 목록을 보게 맞춥니다.
--
-- ── 무엇이 문제였나 ─────────────────────────────────────────────────────────
--
-- 하원 명단은 세 화면이 동시에 봅니다 - 체크표(행정실) · 셔틀명단(옆 탭) · 차량 도착·출발
-- 체크(현장 QR). 앞의 둘은 실시간 구독으로, 뒤의 하나는 「번호가 바뀌었는가」로 갱신합니다.
--
-- 그 번호를 올리는 트리거가 `shuttle_persistent_notes` 에는 안 걸려 있었습니다. 지속
-- 특이사항으로 셔틀이 바뀌면(「매주 수요일은 학원차」) 체크표는 바로 반영되는데 **현장
-- 화면만 모릅니다.** 오류가 아니라 그냥 옛 명단이라, 그 차이는 아이가 차에 탄 뒤에야
-- 드러납니다.
--
-- 코드 쪽 목록은 `src/lib/shuttleLive.ts` 의 `SHUTTLE_LIVE_TABLES` 이고,
-- `scripts/check-shuttle-live.mjs` 가 이 파일과 그 목록이 어긋나면 빌드를 멈춥니다.

-- rls-ok: 트리거만 겁니다. 새 표를 만들지 않습니다.
do $$
declare
  t text;
  shuttle_tables text[] := array[
    'shuttle_assignments', 'shuttle_boardings', 'shuttle_stops', 'shuttle_routes',
    'student_dismissal_plans', 'shuttle_persistent_notes', 'shuttle_run_events'
  ];
begin
  foreach t in array shuttle_tables loop
    if to_regclass('public.' || t) is not null then
      execute format('drop trigger if exists %I on public.%I', 'bump_shuttle_' || t, t);
      execute format(
        'create trigger %I after insert or update or delete on public.%I for each statement execute function public.bump_shuttle()',
        'bump_shuttle_' || t, t
      );
    end if;
  end loop;
end $$;
