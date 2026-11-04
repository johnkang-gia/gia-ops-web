-- 직원 활동 기록: 로그인한 직원이 앱에서 한 일(답함·처리 완료·담당 지정·업무·쪽지·학생 메모·하원 체크표…)을
-- 한 표에 자동으로 남기고, 모든 직원이 봅니다.
--
-- 화면마다 「기록 남기기」를 코드로 부르면 새 화면을 만들 때마다 빠뜨립니다. 그래서 **표에 트리거**를
-- 답니다 - 어느 화면·어느 경로로 고쳐도 기록됩니다. 누가 했는지는 로그인 열쇠(auth.jwt 의 email)로
-- 정하고, 서버가 대신 고친 경우(서비스 키)에는 그 줄에 적힌 사람 칸(answered_by 등)을 씁니다.
-- 둘 다 없으면 기계가 한 일이라 남기지 않습니다 - 사람이 한 일만 보는 기록입니다.
--
-- 지우지 않습니다(직원도 고치거나 지울 수 없습니다). 180일이 지난 줄은 매일 정리 크론이 지웁니다.

create table if not exists public.staff_activity_log (
  id uuid primary key default gen_random_uuid(),
  at timestamptz not null default now(),
  actor_email text,
  actor_name text not null,
  area text not null,       -- 문의 · 업무 · 쪽지 · 학생 메모 · 하원 체크표 · 셔틀 메모 · 출결
  action text not null,     -- 답함 · 처리 완료 · 담당 지정 · 업무 등록 …
  summary text,             -- 무엇에 대해(한 줄)
  student_id uuid,
  ref_table text,
  ref_id uuid
);

create index if not exists staff_activity_log_at_idx on public.staff_activity_log (at desc);
create index if not exists staff_activity_log_actor_idx on public.staff_activity_log (actor_email, at desc);

alter table public.staff_activity_log enable row level security;
drop policy if exists staff_activity_log_read on public.staff_activity_log;
-- 모든 교직원이 읽습니다. 쓰기 정책은 두지 않습니다 - 트리거(security definer)만 씁니다.
create policy staff_activity_log_read on public.staff_activity_log
  for select to authenticated using (public.is_giamicro_user());
revoke all on public.staff_activity_log from anon;

-- 열린 화면에 바로 뜨도록 실시간 발행 목록에 넣습니다.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
        where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'staff_activity_log'
     ) then
    alter publication supabase_realtime add table public.staff_activity_log;
  end if;
end $$;

-- 누가: 로그인 열쇠의 이메일 → 없으면 줄에 적힌 사람(이메일이거나 이름).
create or replace function public.activity_log_write(
  p_area text, p_action text, p_summary text, p_student uuid, p_table text, p_id uuid, p_fallback text
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_email text := nullif(coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email', ''), '');
  v_who text;
  v_name text;
begin
  v_who := coalesce(v_email, nullif(btrim(coalesce(p_fallback, '')), ''));
  if v_who is null then
    return; -- 기계가 한 일
  end if;
  select name into v_name from public.app_users where email = v_who limit 1;
  insert into public.staff_activity_log (actor_email, actor_name, area, action, summary, student_id, ref_table, ref_id)
  values (
    case when position('@' in v_who) > 0 then v_who else null end,
    coalesce(v_name, v_who),
    p_area, p_action, left(p_summary, 160), p_student, p_table, p_id
  );
exception when others then
  -- 기록이 실패해도 본래 일(저장)은 막지 않습니다.
  raise warning 'staff_activity_log: %', sqlerrm;
end $$;

-- ── 문의(pickup_requests) ────────────────────────────────────────────────────
create or replace function public.trg_activity_pickup() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  s text := coalesce(new.summary, left(new.raw_text, 60), new.channel_label, '');
begin
  if new.replied_at is not null and old.replied_at is null then
    if coalesce(new.replied_via, '') = '토들 답글' then
      perform public.activity_log_write('문의', '답함(토들 답글)', s, new.student_id, 'pickup_requests', new.id, new.replied_by);
    else
      perform public.activity_log_write('문의', '답함', s, new.student_id, 'pickup_requests', new.id, new.replied_by);
    end if;
  elsif new.replied_at is null and old.replied_at is not null then
    perform public.activity_log_write('문의', '답함 되돌림', s, new.student_id, 'pickup_requests', new.id, null);
  end if;

  if new.answered_at is not null and old.answered_at is null then
    perform public.activity_log_write('문의', '처리 완료', s, new.student_id, 'pickup_requests', new.id, new.answered_by);
  elsif new.answered_at is null and old.answered_at is not null then
    perform public.activity_log_write('문의', '처리 완료 되돌림', s, new.student_id, 'pickup_requests', new.id, null);
  end if;

  if coalesce(new.assignees, '{}') is distinct from coalesce(old.assignees, '{}') then
    perform public.activity_log_write(
      '문의', '담당 지정',
      s || ' → ' || coalesce((select string_agg(coalesce(u.name, a), ', ') from unnest(new.assignees) a left join public.app_users u on u.email = a), '없음'),
      new.student_id, 'pickup_requests', new.id, new.assigned_by);
  end if;

  if coalesce(new.badges, '{}') is distinct from coalesce(old.badges, '{}') and old.badges <> '{}' then
    perform public.activity_log_write('문의', '분류 수정', s || ' · ' || array_to_string(new.badges, '·'), new.student_id, 'pickup_requests', new.id, null);
  end if;

  if new.student_id is distinct from old.student_id and new.student_id is not null then
    perform public.activity_log_write('문의', '학생 연결', s, new.student_id, 'pickup_requests', new.id, null);
  end if;

  if new.status is distinct from old.status and new.kind = '픽업' then
    perform public.activity_log_write('픽업', '픽업 ' || new.status, s, new.student_id, 'pickup_requests', new.id,
      case when new.resolved_by = 'AI' then null else new.resolved_by end);
  end if;
  return new;
exception when others then
  -- 기록 쪽 오류로 본래 저장이 막히면 안 됩니다.
  raise warning 'staff activity trigger: %', sqlerrm;
  return new;
end $$;

drop trigger if exists activity_pickup on public.pickup_requests;
create trigger activity_pickup after update on public.pickup_requests
  for each row execute function public.trg_activity_pickup();

-- ── 업무(tasks) ─────────────────────────────────────────────────────────────
create or replace function public.trg_activity_tasks() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform public.activity_log_write('업무', '업무 등록', new.title, null, 'tasks', new.id, new.owner_email);
  else
    if new.deleted_at is not null and old.deleted_at is null then
      perform public.activity_log_write('업무', '업무 삭제', new.title, null, 'tasks', new.id, new.updated_by);
    elsif new.status is distinct from old.status then
      perform public.activity_log_write('업무', '업무 ' || new.status, new.title, null, 'tasks', new.id, new.updated_by);
    end if;
  end if;
  return new;
exception when others then
  -- 기록 쪽 오류로 본래 저장이 막히면 안 됩니다.
  raise warning 'staff activity trigger: %', sqlerrm;
  return new;
end $$;

drop trigger if exists activity_tasks on public.tasks;
create trigger activity_tasks after insert or update on public.tasks
  for each row execute function public.trg_activity_tasks();

-- ── 쪽지(board_notes) ───────────────────────────────────────────────────────
create or replace function public.trg_activity_board_notes() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.activity_log_write('쪽지', '쪽지 남김', new.content, null, 'board_notes', new.id, new.author_email);
  return new;
exception when others then
  -- 기록 쪽 오류로 본래 저장이 막히면 안 됩니다.
  raise warning 'staff activity trigger: %', sqlerrm;
  return new;
end $$;

drop trigger if exists activity_board_notes on public.board_notes;
create trigger activity_board_notes after insert on public.board_notes
  for each row execute function public.trg_activity_board_notes();

-- ── 학생 메모(student_day_notes) ────────────────────────────────────────────
create or replace function public.trg_activity_day_notes() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform public.activity_log_write('학생 메모', '메모 남김(' || new.kind || ')', new.content, new.student_id, 'student_day_notes', new.id, new.created_by);
  elsif new.deleted_at is not null and old.deleted_at is null then
    perform public.activity_log_write('학생 메모', '메모 지움', new.content, new.student_id, 'student_day_notes', new.id, new.deleted_by);
  end if;
  return new;
exception when others then
  -- 기록 쪽 오류로 본래 저장이 막히면 안 됩니다.
  raise warning 'staff activity trigger: %', sqlerrm;
  return new;
end $$;

drop trigger if exists activity_day_notes on public.student_day_notes;
create trigger activity_day_notes after insert or update on public.student_day_notes
  for each row execute function public.trg_activity_day_notes();

-- ── 하원 체크표(shuttle_checklist_log 는 이미 사람이 한 일의 기록입니다) ─────────
create or replace function public.trg_activity_checklist() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.activity_log_write(
    '하원 체크표', new.action,
    new.student_name || coalesce(' · ' || nullif(new.before_value, '') || ' → ', ' · ') || coalesce(new.after_value, ''),
    null, 'shuttle_checklist_log', new.id, new.actor_email);
  return new;
exception when others then
  -- 기록 쪽 오류로 본래 저장이 막히면 안 됩니다.
  raise warning 'staff activity trigger: %', sqlerrm;
  return new;
end $$;

drop trigger if exists activity_checklist on public.shuttle_checklist_log;
create trigger activity_checklist after insert on public.shuttle_checklist_log
  for each row execute function public.trg_activity_checklist();

-- ── 셔틀 메모(shuttle_day_memos) ────────────────────────────────────────────
create or replace function public.trg_activity_shuttle_memos() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform public.activity_log_write('셔틀 메모', '메모 남김', new.content, null, 'shuttle_day_memos', new.id, new.author);
  elsif new.checked_at is not null and old.checked_at is null then
    perform public.activity_log_write('셔틀 메모', '메모 확인', new.content, null, 'shuttle_day_memos', new.id, new.checked_by);
  end if;
  return new;
exception when others then
  -- 기록 쪽 오류로 본래 저장이 막히면 안 됩니다.
  raise warning 'staff activity trigger: %', sqlerrm;
  return new;
end $$;

drop trigger if exists activity_shuttle_memos on public.shuttle_day_memos;
create trigger activity_shuttle_memos after insert or update on public.shuttle_day_memos
  for each row execute function public.trg_activity_shuttle_memos();

-- ── 출결(attendance_entries) — 사람이 등록·무시로 바꾼 것 ─────────────────────
create or replace function public.trg_activity_attendance() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  span text := case when new.date_from = new.date_to then to_char(new.date_from, 'MM/DD')
                    else to_char(new.date_from, 'MM/DD') || '~' || to_char(new.date_to, 'MM/DD') end;
begin
  if tg_op = 'INSERT' then
    if new.source = 'manual' then
      perform public.activity_log_write('출결', new.status || ' 등록', new.student_name || ' ' || span, new.student_id, 'attendance_entries', new.id, new.registered_by);
    end if;
  elsif new.state is distinct from old.state then
    perform public.activity_log_write('출결', new.status || ' ' || new.state, new.student_name || ' ' || span, new.student_id, 'attendance_entries', new.id,
      case when new.touched_by_human then new.registered_by else null end);
  end if;
  return new;
exception when others then
  -- 기록 쪽 오류로 본래 저장이 막히면 안 됩니다.
  raise warning 'staff activity trigger: %', sqlerrm;
  return new;
end $$;

drop trigger if exists activity_attendance on public.attendance_entries;
create trigger activity_attendance after insert or update on public.attendance_entries
  for each row execute function public.trg_activity_attendance();

notify pgrst, 'reload schema';
