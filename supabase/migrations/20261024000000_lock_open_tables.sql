-- 로그인 없이 읽히던 표 여섯 개를 잠급니다 — **점검 화면이 찾아낸 것들입니다.**
--
-- ── 무엇이 문제였나 ──────────────────────────────────────────────────
--
-- 앞 마이그레이션이 뷰를 전부 잠근 뒤, 개발자 점검 화면(🧪 점검)이 **로그인 안 한 열쇠로
-- 164개를 하나씩 물어봤습니다.** 여섯 개가 그대로 열려 있었습니다.
--
--   · wr_students_name_backup_20260827      — 학생 이름 137줄
--   · shuttle_assignments_backup_20260826   — 셔틀 배정 108줄
--   · wr_term_class_snapshots               — 학기별 반 소속
--   · academic_checklist_meetings           — 회의록
--   · board_revisions                       — 업무보드 배치 이력
--   · version_broadcasts                    — 새로고침 안내를 띄운 기록
--
-- 앞의 둘은 **손으로 만든 백업 표**입니다. 자료를 고치기 전에 한 벌 떠 둔 것이라 마이그레이션
-- 폴더에 만든 기록이 없고, 그래서 `check-rls.mjs` 의 검사에도 안 걸렸습니다 - 그 검사는
-- 「마이그레이션이 만든 표」만 봅니다. **검사에 안 걸린다는 사실 자체가 어디에도 안
-- 나타났습니다.**
--
-- 백업 표는 원본과 **똑같이 민감합니다.** 이름이 `_backup_` 으로 끝난다고 덜 중요한 것이
-- 아니라, 오히려 지우는 것을 잊어 오래 남습니다.
--
-- ── 무엇을 하나 ──────────────────────────────────────────────────────
--
-- 여섯 개 모두 **읽기는 교직원, 쓰기는 담당자**로 잠급니다. 서버(크론·API)는 서비스 키로
-- 돌아 이 정책을 지나가므로 지금 동작에는 변화가 없습니다.
--
-- 없는 표는 건너뜁니다 - 있는 것만 잠그고, 없는 것 때문에 전체가 멈추지 않게 합니다.

do $$
declare
  t text;
begin
  foreach t in array array[
    'wr_students_name_backup_20260827',
    'shuttle_assignments_backup_20260826',
    'wr_term_class_snapshots',
    'academic_checklist_meetings',
    'board_revisions',
    'version_broadcasts'
  ] loop
    if to_regclass('public.' || t) is null then
      continue;
    end if;
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_staff_read', t);
    execute format('drop policy if exists %I on public.%I', t || '_manager_write', t);
    -- 켜기와 정책은 **한 마이그레이션에서 같이** 합니다. 켜기만 하면 아무도 못 읽는데,
    -- 그건 오류로 안 보이고 「자료가 없습니다」로 보입니다(§2-8).
    execute format(
      'create policy %I on public.%I for select using (public.is_giamicro_user())',
      t || '_staff_read', t
    );
    execute format(
      'create policy %I on public.%I for all using (public.is_wr_manager()) with check (public.is_wr_manager())',
      t || '_manager_write', t
    );
  end loop;
end $$;

-- rls-ok: 이 파일은 표를 만들지 않습니다. 이미 있던 표에 자물쇠를 채우기만 합니다.
