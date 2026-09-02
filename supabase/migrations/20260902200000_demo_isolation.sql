-- 데모(오리엔테이션용 가짜) 자료를 실제 명부에서 떼어놓기
--
-- 가짜 학생·가짜 반이 실제 표에 함께 들어 있고 `is_demo` 칸 하나로만 갈립니다. 표를 따로
-- 두지 않은 이유는 화면을 두 벌 만들지 않기 위해서였는데, 그 대가로 **읽는 곳마다 is_demo 를
-- 빠뜨리면 안 된다**는 조건이 생겼습니다. 읽는 곳은 이미 일흔 곳이 넘습니다.
--
-- 코드 쪽은 빌드 검사(scripts/check-demo-isolation.mjs)가 봅니다. 여기서는 **데이터 쪽**을
-- 잠급니다 - 실수로 데모 표시가 뒤집히거나, 데모 학생이 실제 자료에 엮이는 것을 막습니다.

-- ── 1. 데모 표시는 만든 뒤에 바꿀 수 없습니다 ──────────────────────────
--
-- 실제 학생을 데모로 바꾸면 그 아이가 명부에서 조용히 사라지고, 반대로 바꾸면 가짜 학생이
-- 실제 명단에 나타납니다. 둘 다 화면에는 오류로 보이지 않습니다.
create or replace function public.lock_is_demo()
returns trigger
language plpgsql
as $$
begin
  if new.is_demo is distinct from old.is_demo then
    raise exception '데모 표시(is_demo)는 바꿀 수 없습니다. 실제 학생과 연습용 학생이 섞이면 되돌리기 어렵습니다.';
  end if;
  return new;
end;
$$;

drop trigger if exists wr_students_lock_is_demo on public.wr_students;
create trigger wr_students_lock_is_demo
  before update on public.wr_students
  for each row execute function public.lock_is_demo();

drop trigger if exists wr_classes_lock_is_demo on public.wr_classes;
create trigger wr_classes_lock_is_demo
  before update on public.wr_classes
  for each row execute function public.lock_is_demo();

-- ── 2. 섞였는지 언제든 확인 ────────────────────────────────────────────
--
-- 데모 학생이 실제 운영 자료(셔틀 배정·청구서·사진 등)에 엮여 있으면 여기 잡힙니다.
-- 0 이 아닌 줄이 하나라도 있으면 어딘가에서 데모 학생을 실제처럼 다룬 것입니다.
create or replace view public.demo_isolation_check as
select '데모 학생 수' as 항목, count(*)::bigint as 건수 from public.wr_students where is_demo
union all
select '데모 반 수', count(*) from public.wr_classes where is_demo
union all
select '데모 학생에게 붙은 셔틀 배정', count(*)
  from public.shuttle_assignments a join public.wr_students s on s.id = a.student_id where s.is_demo
union all
select '데모 학생에게 붙은 청구서', count(*)
  from public.invoices i join public.wr_students s on s.id = i.student_id where s.is_demo
union all
select '데모 학생에게 붙은 학비외 항목', count(*)
  from public.student_fee_items f join public.wr_students s on s.id = f.student_id where s.is_demo
union all
select '데모 학생에게 붙은 사진', count(*)
  from public.wr_students where is_demo and photo_path is not null
union all
select '데모 학생에게 붙은 하원수단', count(*)
  from public.student_dismissal_plans p join public.wr_students s on s.id = p.student_id where s.is_demo;

comment on view public.demo_isolation_check is
  '데모 학생이 실제 운영 자료에 엮여 있는지. 아래 세 줄 말고는 전부 0이어야 합니다.';

revoke all on public.demo_isolation_check from anon;
grant select on public.demo_isolation_check to authenticated;
