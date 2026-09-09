-- 중앙 대시보드에 「바뀌었다」를 알리는 자리
--
-- ── 무엇이 문제였나 ─────────────────────────────────────────────────────────
--
-- 대시보드는 사무실 모니터에 하루 종일 켜져 있고, 30초마다(도착체크·안내보드는 3초마다)
-- 스스로 다시 물어봅니다. 그때마다 서버가 **처음부터 전부 다시 계산**했습니다 - 명부,
-- 반, 교시, 시간표, 출결, 픽업, 체크표, 쪽지, 문의, 업무를 매번 통째로 읽었습니다.
--
-- 그런데 대부분의 30초 동안 **아무것도 안 바뀝니다.** 안 바뀐 것을 다시 계산해서 다시
-- 실어 보내는 일이 하루 1,500번 넘게 일어났고, 그것이 Supabase 무료 한도(월 5GB)를
-- 통째로 먹었습니다.
--
-- ── 어떻게 바꾸나 ───────────────────────────────────────────────────────────
--
-- 자료가 바뀌면 여기 **번호가 하나 올라갑니다.** 대시보드는 자기가 들고 있는 번호를 함께
-- 보내고, 번호가 같으면 서버는 「안 바뀌었습니다」 한 줄만 돌려줍니다. 계산도 안 하고
-- 자료도 안 읽습니다.
--
-- 대시보드는 **뷰어**가 되고, 알리는 일은 자료를 바꾸는 쪽이 합니다.
--
-- ── 왜 코드가 아니라 트리거인가 ─────────────────────────────────────────────
--
-- 「바뀌었다고 알리기」를 코드에서 부르면 **언젠가 한 곳을 빠뜨립니다.** 빠뜨리면 화면이
-- 안 바뀌는데, 그건 오류로 안 보이고 「왜 반영이 안 되지」로만 보입니다. 이 저장소에서
-- 같은 모양의 사고가 여러 번 났습니다.
--
-- 표에 트리거를 걸면 어느 길로 바뀌든(화면·크론·손으로 넣은 SQL) 빠짐없이 올라갑니다.

create table if not exists public.board_revisions (
  -- 무엇에 대한 번호인가. 'ops'(중앙 대시보드) · 'shuttle'(도착체크·안내보드) ·
  -- 'timetable'(수업 시간표). 화면마다 보는 자료가 달라서 따로 셉니다 - 하나로 묶으면
  -- 시간표 한 줄 고쳤는데 도착체크까지 전부 다시 계산합니다.
  key text primary key,

  -- 바뀔 때마다 하나씩. 비교만 하면 되므로 뜻은 없습니다.
  revision bigint not null default 1,

  updated_at timestamptz not null default now()
);

insert into public.board_revisions (key) values ('ops'), ('shuttle'), ('timetable')
on conflict (key) do nothing;

-- 번호를 올립니다. 없으면 만들면서 시작합니다.
create or replace function public.bump_board_revision(p_key text)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.board_revisions (key, revision, updated_at)
  values (p_key, 1, now())
  on conflict (key) do update
    set revision = public.board_revisions.revision + 1,
        updated_at = now();
$$;

-- 트리거에서 부를 껍데기들. 표마다 어느 번호를 올릴지가 다릅니다.
create or replace function public.bump_ops() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.bump_board_revision('ops');
  return null;
end;
$$;

create or replace function public.bump_shuttle() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  -- 셔틀 자료는 중앙 대시보드에도 뜹니다(오늘 픽업·하원수단). 둘 다 올립니다.
  perform public.bump_board_revision('shuttle');
  perform public.bump_board_revision('ops');
  return null;
end;
$$;

create or replace function public.bump_timetable() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.bump_board_revision('timetable');
  perform public.bump_board_revision('ops');
  return null;
end;
$$;

-- ── 어느 표가 바뀌면 알릴 것인가 ────────────────────────────────────────────
--
-- **문장 단위(for each statement)로 겁니다.** 줄마다 부르면 명부를 통째로 고칠 때
-- 137번 올라갑니다 - 번호가 몇이든 상관없지만, 쓸데없이 표를 두드립니다.
do $$
declare
  t text;
  ops_tables text[] := array[
    'attendance_entries', 'attendance_records', 'pickup_requests', 'pickup_schedules',
    'classroom_notes', 'tasks', 'events', 'wr_students', 'wr_classes'
  ];
  shuttle_tables text[] := array[
    'shuttle_boardings', 'shuttle_assignments', 'shuttle_routes', 'shuttle_stops',
    'shuttle_run_events', 'student_dismissal_plans'
  ];
  tt_tables text[] := array['wr_timetable', 'wr_periods'];
begin
  foreach t in array ops_tables loop
    if to_regclass('public.' || t) is not null then
      execute format('drop trigger if exists %I on public.%I', 'bump_ops_' || t, t);
      execute format(
        'create trigger %I after insert or update or delete on public.%I for each statement execute function public.bump_ops()',
        'bump_ops_' || t, t
      );
    end if;
  end loop;

  foreach t in array shuttle_tables loop
    if to_regclass('public.' || t) is not null then
      execute format('drop trigger if exists %I on public.%I', 'bump_shuttle_' || t, t);
      execute format(
        'create trigger %I after insert or update or delete on public.%I for each statement execute function public.bump_shuttle()',
        'bump_shuttle_' || t, t
      );
    end if;
  end loop;

  foreach t in array tt_tables loop
    if to_regclass('public.' || t) is not null then
      execute format('drop trigger if exists %I on public.%I', 'bump_tt_' || t, t);
      execute format(
        'create trigger %I after insert or update or delete on public.%I for each statement execute function public.bump_timetable()',
        'bump_tt_' || t, t
      );
    end if;
  end loop;
end $$;

alter table public.board_revisions enable row level security;

-- 번호에는 아무 내용이 없습니다(무엇이 바뀌었는지도 안 담깁니다). 로그인 없는 대시보드
-- 화면들이 읽어야 해서 읽기는 열어 둡니다. 쓰는 것은 트리거(security definer)만 합니다.
drop policy if exists board_revisions_read on public.board_revisions;
create policy board_revisions_read on public.board_revisions for select using (true);
