-- 중고등부는 학년이 곧 반입니다
--
-- 중고등부(6학년 이상) 재학생 36명이 반 연결 없이 남아 있었습니다. 중고등부는 학년마다 반이
-- 하나라 따로 반을 나누지 않는데, 명부에는 반이 없으니 반 배정·반별 청구·출석부에서 이 아이들이
-- 전부 「미배정」으로 빠졌습니다.
--
-- 학년마다 반을 하나씩 만들고(G6 … G12, G12+) 학년에 따라 넣습니다. 앞으로 학년이 바뀌면
-- 반도 **트리거가 따라 바꿉니다** - 진급·명부 반영·직접 수정 어느 길로 바뀌어도 같은 답이
-- 나와야 하고, 코드로 맞추면 길 하나는 반드시 빠집니다(CLAUDE.md §2-5 와 같은 이유).

-- 학년 글자에서 첫 숫자만 읽습니다. 「6」「6학년」「G6」「12+」 → 6, 6, 6, 12
create or replace function public.grade_number(g text)
returns int
language sql immutable
as $$
  select nullif(substring(coalesce(g, '') from '([0-9]+)'), '')::int
$$;

-- 중고등부 반 이름. 「12+」는 12학년과 다른 반입니다(졸업 후 과정) - 「+」를 지우지 않습니다.
create or replace function public.secondary_class_name(g text)
returns text
language sql immutable
as $$
  select 'G' || regexp_replace(coalesce(g, ''), '[^0-9+]', '', 'g')
$$;

-- ── 1. 반 만들기 (재학생이 있는 학년만) ─────────────────────────────────
insert into public.wr_classes (grade, class_name, department, is_demo)
select distinct s.grade, public.secondary_class_name(s.grade), '중고등부', s.is_demo
from public.wr_students s
where s.status = 'active'
  and public.grade_number(s.grade) >= 6
  and not exists (
    select 1 from public.wr_classes c
    where c.is_demo = s.is_demo
      and c.class_name = public.secondary_class_name(s.grade)
  );

-- ── 2. 학생을 학년 반에 넣기 ──────────────────────────────────────────
update public.wr_students s
set class_id = c.id,
    class_name = c.class_name,
    department = '중고등부'
from public.wr_classes c
where s.status = 'active'
  and public.grade_number(s.grade) >= 6
  and c.is_demo = s.is_demo
  and c.class_name = public.secondary_class_name(s.grade)
  and (s.class_id is distinct from c.id or s.class_name is distinct from c.class_name);

-- ── 3. 앞으로: 학년이 바뀌면 반도 함께 ────────────────────────────────
--
-- 반이 없으면 만듭니다. 중고등부 반은 학년에서 정해지는 것이라 오타로 생길 일이 없습니다
-- (초등부는 반을 만들어내지 않습니다 - §2-5).
--
-- security definer: 학생을 고칠 수 있는 직원이 반 표에 넣을 권한까지 있다고 볼 수 없습니다.
-- 권한이 없어 반 만들기가 실패하면 학생 저장 전체가 실패합니다.
create or replace function public.secondary_class_follow_grade()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text;
  v_id uuid;
begin
  if public.grade_number(new.grade) is null or public.grade_number(new.grade) < 6 then
    return new;
  end if;

  v_name := public.secondary_class_name(new.grade);

  select id into v_id from public.wr_classes
  where is_demo = new.is_demo and class_name = v_name
  limit 1;

  if v_id is null then
    insert into public.wr_classes (grade, class_name, department, is_demo)
    values (new.grade, v_name, '중고등부', new.is_demo)
    returning id into v_id;
  end if;

  new.class_id := v_id;
  new.class_name := v_name;
  new.department := '중고등부';
  return new;
end;
$$;

drop trigger if exists wr_students_secondary_class on public.wr_students;
create trigger wr_students_secondary_class
  before insert or update of grade, class_id, class_name, department on public.wr_students
  for each row execute function public.secondary_class_follow_grade();

comment on function public.secondary_class_follow_grade() is
  '중고등부(6학년 이상)는 학년이 곧 반입니다. 학년이 바뀌면 반(G학년)도 따라 바뀝니다.';

notify pgrst, 'reload schema';
