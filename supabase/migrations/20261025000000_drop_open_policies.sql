-- `using (true)` 정책이 로그인 안 한 사람까지 들여보내고 있었습니다.
--
-- ── 무엇이 문제였나 ──────────────────────────────────────────────────
--
-- 앞 마이그레이션이 여섯 개 표에 「교직원만 읽기」 정책을 붙였는데, 점검 화면은 그중 넷이
-- **여전히 열려 있다**고 말했습니다. 정책이 안 걸린 것이 아니라, **옛 정책이 그대로 남아
-- 있었습니다.**
--
-- 포스트그레스의 RLS 정책은 여럿이면 **OR** 로 묶입니다. 새로 붙인 「교직원만」과 옛
-- 「누구나」가 나란히 있으면 결과는 언제나 「누구나」입니다. 자물쇠를 하나 더 채워도 옆에
-- 열린 문이 있으면 소용이 없습니다.
--
-- 옛 정책들은 이렇게 적혀 있었습니다.
--
--   create policy ..._all on ... for all using (true) with check (true);
--
-- 주석에는 「로그인한 사용자는 읽고 쓸 수 있습니다」라고 적혀 있었지만, `to authenticated`
-- 를 빼면 **`anon`(로그인 안 한 열쇠)도 포함**됩니다. 적힌 뜻과 실제가 달랐고, 화면에는
-- 아무 차이도 안 나타났습니다.
--
-- ── 무엇을 하나 ──────────────────────────────────────────────────────
--
-- 열린 정책을 지우고 교직원 범위로 다시 답니다. 서버(크론·API)는 서비스 키로 돌아 이
-- 정책을 지나가므로 지금 동작에는 변화가 없습니다.

drop policy if exists board_revisions_read on public.board_revisions;
drop policy if exists version_broadcasts_read on public.version_broadcasts;
drop policy if exists wr_term_class_snapshots_all on public.wr_term_class_snapshots;
drop policy if exists academic_checklist_meetings_all on public.academic_checklist_meetings;

-- 같은 모양으로 적힌 나머지도 함께 좁힙니다. 이 둘은 지금 줄이 없어 점검에 안 걸렸을 뿐,
-- 줄이 생기는 날 똑같이 열립니다 - 비어 있는 것과 잠긴 것은 다릅니다.
drop policy if exists day_reminders_all on public.day_reminders;
drop policy if exists wr_subject_colors_all on public.wr_subject_colors;

do $$
declare
  t text;
begin
  foreach t in array array[
    'board_revisions',
    'version_broadcasts',
    'wr_term_class_snapshots',
    'academic_checklist_meetings',
    'day_reminders',
    'wr_subject_colors'
  ] loop
    if to_regclass('public.' || t) is null then
      continue;
    end if;
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_staff_all', t);
    -- 읽기·쓰기를 나누지 않습니다. 이 표들을 쓰는 화면은 전부 교직원 화면이고, 읽기만 되는
    -- 사람을 위한 화면이 따로 없는데 정책만 나누면 쓰이지 않는 규칙이 하나 늘 뿐입니다.
    execute format(
      'create policy %I on public.%I for all to authenticated using (public.is_giamicro_user()) with check (public.is_giamicro_user())',
      t || '_staff_all', t
    );
  end loop;
end $$;

-- rls-ok: 이 파일은 표를 만들지 않습니다. 이미 있던 표의 정책만 좁힙니다.
