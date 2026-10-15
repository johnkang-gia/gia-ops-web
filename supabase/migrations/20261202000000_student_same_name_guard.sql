-- ===== 같은 이름의 학생은 사람이 «다른 학생»으로 확인해야만 새로 생깁니다 =====
--
-- 학생을 새로 만드는 길이 넷(학생 관리 한 명·붙여넣기, 학교 가져오기, 구글시트 명부 반영)이었고, 셋은 같은 이름이
-- 이미 있는지 보지 않았습니다. 같은 아이가 두 줄로 생기면 출결·청구가 두 줄에 나뉘어 쌓이고, 명부 점검에서 발견할
-- 때는 이미 합치기(되돌릴 수 없음)밖에 남지 않습니다.
--
-- 코드는 이제 `src/lib/studentAdd.ts` 하나로 모았습니다. 이 문지기는 그 함수를 안 거친 **새 길**이 생겨도 막습니다 -
-- 코드 검사는 나쁜 모양만 잡고, 다음 사고는 새 모양으로 옵니다(CLAUDE.md 2-4-9 와 같은 이유).
--
-- 김재이처럼 정말 다른 아이가 있으므로 막기만 하지 않습니다. 사람이 확인한 줄은 `homonym_ok = true` 를 달고 들어옵니다.
-- 데모 학생은 따로 사는 명단이라 보지 않습니다. 이미 있는 줄은 건드리지 않습니다(넣을 때만 봅니다).

alter table public.wr_students add column if not exists homonym_ok boolean not null default false;
comment on column public.wr_students.homonym_ok is
  '만들 때 같은 이름의 학생이 이미 있었고, 사람이 «다른 학생»으로 확인했습니다. 문지기 guard_student_same_name 이 이 표시 없는 같은 이름 줄을 거절합니다.';

-- 명부 점검·학생 추가 코드의 normName 과 같은 규칙: NFC → 소문자 → 공백·가운뎃점·마침표·쉼표·작은따옴표·붙임표 제거.
create or replace function public.student_name_key(n text)
returns text
language sql
immutable
as $$
  select regexp_replace(lower(normalize(coalesce(n, ''), NFC)), '[[:space:]·.,''-]', '', 'g');
$$;

create or replace function public.guard_student_same_name()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  hits text;
begin
  if coalesce(new.is_demo, false) or coalesce(new.homonym_ok, false) then
    return new;
  end if;
  if public.student_name_key(new.name) = '' then
    return new;
  end if;
  select string_agg(
           s.name || '(' || concat_ws(' · ', nullif(s.grade, ''), nullif(s.class_name, ''), coalesce('생일 ' || s.birth_date::text, '생일 없음'), s.status) || ')',
           ', ')
    into hits
    from public.wr_students s
   where s.is_demo = false
     and s.id is distinct from new.id
     and public.student_name_key(s.name) = public.student_name_key(new.name);
  if hits is not null then
    raise exception using
      errcode = '23505',
      message = format('같은 이름의 학생이 이미 있습니다: %s. 다른 학생이면 학생 추가 화면에서 «다른 학생»을 골라 주세요.', hits);
  end if;
  return new;
end;
$$;

drop trigger if exists wr_students_same_name_guard on public.wr_students;
create trigger wr_students_same_name_guard
  before insert on public.wr_students
  for each row execute function public.guard_student_same_name();

-- ── 아직 아무도 판단하지 않은 같은 이름 묶음 ────────────────────────────────────
--
-- 명부 점검(/school/data-check)과 같은 범위(재학·보류)와 같은 열쇠(번호를 정렬해 «|»로 이음)입니다. 사람이 «다른
-- 아이로 확인»한 묶음(student_dup_dismissals)은 빠집니다. 비어 있어야 정상입니다.
create or replace view public.student_same_name_open as
with g as (
  select public.student_name_key(s.name) as name_key,
         min(s.name) as name,
         count(*) as n,
         string_agg(s.id::text, '|' order by s.id::text collate "C") as group_key,
         string_agg(concat_ws(' ', s.name, nullif(s.class_name, ''), s.birth_date::text), ' · ' order by s.created_at) as people
    from public.wr_students s
   where s.is_demo = false
     and s.status in ('active', '보류')
     and public.student_name_key(s.name) <> ''
   group by 1
  having count(*) > 1
)
select g.name, g.n, g.people, g.group_key
  from g
 where not exists (select 1 from public.student_dup_dismissals d where d.group_key = g.group_key);

alter view public.student_same_name_open set (security_invoker = on);
revoke all on public.student_same_name_open from anon;

notify pgrst, 'reload schema';
