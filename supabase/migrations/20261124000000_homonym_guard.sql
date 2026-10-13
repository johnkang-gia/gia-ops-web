-- 동명이인을 번호 없이 저장하지 못하게 — 데이터베이스가 막습니다
--
-- 배경
--   동명이인 사고가 일곱 번 났고 가르는 규칙은 매번 멀쩡했습니다. 사고는 언제나 **규칙을 거치지
--   않은 자리**(화면·자동 등록)에서 났고, 그런 자리는 새 기능마다 하나씩 늘어납니다. 코드 검사는
--   «나쁜 모양»만 잡아서 다음 사고는 늘 새 모양으로 왔습니다.
--
--   그래서 마지막 관문을 데이터베이스에 둡니다. 어느 화면·크론·SQL 이 넣든 **동명이인 이름인데
--   학생 번호가 없는 줄**은 들어가지 않습니다. 오류는 그 자리에서 사람에게 보입니다 - 조용히
--   엉뚱한 아이에게 붙는 것보다 낫습니다.
--
-- 함께 고친 것
--   출결 등록표(attendance_entries)는 「확인필요」 줄에도 번호를 요구했습니다. 그래서 자동 등록이
--   김재이 셋 중 누구인지 못 정했을 때 **이름으로 첫 번째 김재이를 골라** 넣었습니다(실측 58줄이
--   근거 없이 동명이인에게 붙어 있었습니다). 「확인필요」는 번호를 비울 수 있게 하고, 「등록」은
--   계속 번호를 요구합니다 - 사람이 고르기 전에는 등록될 수 없습니다.

-- ── 0. 같은 이름의 재학생 수 ─────────────────────────────────────────────────
-- 괄호 뒤(반·영문 이름)와 공백을 떼고 견줍니다. 화면의 nameKey 와 같은 규칙입니다.
create or replace function public.homonym_count(p_name text)
returns int
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::int
  from public.wr_students s
  where s.status = 'active'
    and coalesce(s.is_demo, false) = false
    and regexp_replace(split_part(s.name, '(', 1), '\s', '', 'g')
      = regexp_replace(split_part(coalesce(p_name, ''), '(', 1), '\s', '', 'g')
    and coalesce(p_name, '') <> '';
$$;

revoke all on function public.homonym_count(text) from anon;

-- ── 1. 문지기 ────────────────────────────────────────────────────────────────
-- TG_ARGV[0] 이름 칸 · TG_ARGV[1] 예외를 가르는 칸(없으면 '') · TG_ARGV[2..] 그 칸이 이 값이면 예외
-- 예외 값 '*' 는 «그 칸이 비어 있지 않으면 예외»입니다(셔틀 배정의 unlinked_reason).
create or replace function public.guard_homonym_without_id()
returns trigger
language plpgsql
as $$
declare
  rec       jsonb := to_jsonb(new);
  name_col  text := tg_argv[0];
  skip_col  text := nullif(tg_argv[1], '');
  nm        text;
  skip_val  text;
  i         int;
begin
  if rec->>'student_id' is not null then
    return new;
  end if;
  if skip_col is not null then
    skip_val := rec->>skip_col;
    for i in 2 .. coalesce(tg_nargs, 0) - 1 loop
      if tg_argv[i] = '*' and skip_val is not null and skip_val <> '' then
        return new;
      end if;
      if skip_val = tg_argv[i] then
        return new;
      end if;
    end loop;
  end if;
  nm := rec->>name_col;
  if public.homonym_count(nm) > 1 then
    raise exception '「%」은(는) 같은 이름의 학생이 여럿이라 학생 번호 없이 저장할 수 없습니다. 누구인지 골라주세요.', split_part(nm, '(', 1)
      using errcode = 'P0001', hint = 'homonym_needs_student_id';
  end if;
  return new;
end;
$$;

-- 출결 등록: 「확인필요」·「무시」는 번호가 비어도 됩니다(사람이 고를 줄). 「등록」은 안 됩니다.
alter table public.attendance_entries
  drop constraint if exists attendance_entries_student_required;
alter table public.attendance_entries
  add constraint attendance_entries_student_required
  check (state in ('무시', '확인필요') or student_id is not null);

drop trigger if exists attendance_entries_homonym_guard on public.attendance_entries;
create trigger attendance_entries_homonym_guard
  before insert or update of student_id, student_name, state on public.attendance_entries
  for each row execute function public.guard_homonym_without_id('student_name', 'state', '확인필요', '무시');

-- 지속 특이사항: 예외 없음. 하원 체크표가 이 줄로 아이를 빼고 넣습니다.
drop trigger if exists shuttle_persistent_notes_homonym_guard on public.shuttle_persistent_notes;
create trigger shuttle_persistent_notes_homonym_guard
  before insert or update of student_id, student_name on public.shuttle_persistent_notes
  for each row execute function public.guard_homonym_without_id('student_name', '');

-- 동승 요청: 「확인대기」·「취소」는 사람이 고르기 전이거나 끝난 줄입니다.
drop trigger if exists shuttle_ride_alongs_homonym_guard on public.shuttle_ride_alongs;
create trigger shuttle_ride_alongs_homonym_guard
  before insert or update of student_id, student_surface, status on public.shuttle_ride_alongs
  for each row execute function public.guard_homonym_without_id('student_surface', 'status', '확인대기', '취소');

-- 셔틀 배정: 연결하지 않은 이유(유치부·퇴소)가 적혀 있으면 예외입니다.
drop trigger if exists shuttle_assignments_homonym_guard on public.shuttle_assignments;
create trigger shuttle_assignments_homonym_guard
  before insert or update of student_id, student_name_raw, unlinked_reason on public.shuttle_assignments
  for each row execute function public.guard_homonym_without_id('student_name_raw', 'unlinked_reason', '*');

-- ── 2. 점검 뷰 — 비어 있어야 정상 ─────────────────────────────────────────────
-- 문지기는 **새로 넣는 줄**만 막습니다. 문지기 전에 들어온 줄과, 번호는 있지만 근거 없이 붙은
-- 최근 출결 줄을 사람이 볼 수 있게 개발자 진단 화면에 띄웁니다(src/lib/integrityViews.ts).
create or replace view public.homonym_unresolved as
  select 'attendance_entries'::text as tbl, e.id::text as row_id, e.student_name as name,
         e.date_from::text as at, '등록인데 번호 없음'::text as why
  from public.attendance_entries e
  where e.student_id is null and e.state = '등록' and public.homonym_count(e.student_name) > 1
  union all
  select 'attendance_entries', e.id::text, e.student_name, e.date_from::text,
         '근거 없이 동명이인에게 붙음(최근 14일·앞날)'
  from public.attendance_entries e
  join public.wr_students s on s.id = e.student_id
  where e.state = '등록'
    and e.touched_by_human = false
    and coalesce(e.date_to, e.date_from) >= (now() at time zone 'Asia/Seoul')::date - 14
    and public.homonym_count(s.name) > 1
    and position('(' in coalesce(e.student_name, '')) = 0
  union all
  select 'shuttle_persistent_notes', n.id::text, n.student_name, n.effect_from::text, '특이사항에 번호 없음'
  from public.shuttle_persistent_notes n
  where n.student_id is null and coalesce(n.active, true) and public.homonym_count(n.student_name) > 1
  union all
  select 'shuttle_ride_alongs', r.id::text, r.student_surface, r.service_date::text, '확정된 동승에 번호 없음'
  from public.shuttle_ride_alongs r
  where r.student_id is null and r.status = '확정' and public.homonym_count(r.student_surface) > 1
  union all
  select 'shuttle_assignments', a.id::text, a.student_name_raw, null, '셔틀 배정에 번호 없음'
  from public.shuttle_assignments a
  where a.student_id is null and a.unlinked_reason is null and public.homonym_count(a.student_name_raw) > 1;

alter view public.homonym_unresolved set (security_invoker = on);
revoke all on public.homonym_unresolved from anon;

comment on view public.homonym_unresolved is
  '동명이인인데 학생 번호가 없거나 근거 없이 붙은 줄. 비어 있어야 정상입니다. 개발자 › 진단에 뜹니다.';

notify pgrst, 'reload schema';
