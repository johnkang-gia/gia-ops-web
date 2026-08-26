-- 셔틀 배정 전체를 명부와 대조해 한 번에 연결합니다.
--
-- 담당자: "전체 데이터 훑어서 매칭시켜줘."
--
-- 브라우저로 API를 두 번 여는 대신 여기서 한 번에 끝냅니다. 규칙은 API와 같습니다.
--
--   1) 명부(재학 중, 초등·중고등 137명)가 절대 기준
--   2) 이름 정규화(공백·괄호 제거, 소문자) 후 정확히 한 명이면 연결
--   3) 별칭(attendance_learning_rules)도 이름표에 포함 - '마야' → Maya
--   4) 반 이름이 유치부 형식이면 '유치부'
--   5) 유치부도 아닌데 명부에 없으면 '퇴소'
--   6) 동명이인은 손대지 않고 '확인필요'로 남김
--
-- **이미 연결된 줄은 건드리지 않습니다.** 사람이 화면에서 손으로 지정한 것을 덮어쓰지
-- 않기 위해서입니다. 여러 번 실행해도 결과가 같습니다.

-- 필요한 칸을 스스로 만듭니다.
--
-- 앞선 마이그레이션(20260827110000)을 먼저 돌려야 하는 구조였는데, 순서를 지켜야 하는 SQL이
-- 여러 개면 결국 하나는 빠집니다(실제로 여기서 막혔습니다). 이 파일 하나만 돌려도 되도록
-- 필요한 것을 여기서 다 갖춥니다.
alter table public.shuttle_assignments
  add column if not exists unlinked_reason text;

comment on column public.shuttle_assignments.unlinked_reason is
  '학생과 연결되지 않은 이유. ''유치부''=별도 운영이라 연결하지 않음 / ''퇴소''=명부에 없는(나간) 아이 / ''확인필요''=동명이인 등 사람이 봐야 함. student_id가 있으면 비어 있어야 합니다.';

-- 반 이름 → 부서. 화면(shuttleDivision.ts)과 같은 규칙입니다.
create or replace function public.shuttle_class_department(cls text)
returns text language sql immutable as $$
  select case
    when cls is null or btrim(cls) = ''            then null
    when cls like '%학교%'                          then '초등부'
    -- 숫자 뒤 서수 어미가 단어로 끊길 때만 중고등부.
    -- (이 조건이 없으면 '5Starling'의 '5St'가 서수로 걸립니다.)
    when cls ~* '\y\d+\s*(st|nd|rd|th)\y'          then '중고등부'
    when cls ~* '\yg\s*\d+\s*[a-z]{1,2}\y'         then '초등부'
    when cls ~* '[a-z]{2,}'                        then '유치부'
    else null
  end;
$$;

-- 이름 대조용 정규화. 공백·괄호를 없애고 소문자로.
create or replace function public.norm_name(s text)
returns text language sql immutable as $$
  select lower(regexp_replace(coalesce(s, ''), '[\s()（）]', '', 'g'));
$$;

do $$
declare
  n_linked int; n_kinder int; n_left int; n_dup int; n_roster int;
begin
  -- 명부 검산. 137이 아니면 멈춥니다 - 흐트러진 명부로 연결하면 엉뚱한 학생에게 붙습니다.
  select count(*) into n_roster
  from public.wr_students
  where status = 'active' and is_demo = false
    and coalesce(department, '') <> '유치부'
    and coalesce(public.shuttle_class_department(class_name), '') <> '유치부';

  raise notice '명부 대조대상: %명', n_roster;
  if n_roster <> 137 then
    raise exception '명부가 137명이 아닙니다(현재 %명). 명부를 먼저 정리해주세요.', n_roster;
  end if;

  -- 이름표: 명부 이름 + 영문명 + 별칭
  create temp table _names on commit drop as
    select public.norm_name(name) as key, id from public.wr_students
      where status = 'active' and is_demo = false
    union all
    select public.norm_name(name_en), id from public.wr_students
      where status = 'active' and is_demo = false and name_en is not null and name_en <> ''
    union all
    select public.norm_name(r.pattern), r.student_id
      from public.attendance_learning_rules r
     where r.kind = 'alias' and r.student_id is not null;

  -- 한 이름에 한 명일 때만 씁니다. 동명이인은 여기서 빠집니다.
  create temp table _unique on commit drop as
    select key, min(id::text)::uuid as student_id
      from _names group by key having count(distinct id) = 1;

  -- ① 연결
  with hit as (
    select a.id as aid, u.student_id
      from public.shuttle_assignments a
      join _unique u on u.key = public.norm_name(a.student_name_raw)
     where a.student_id is null
  )
  update public.shuttle_assignments a
     set student_id = h.student_id, unlinked_reason = null
    from hit h where a.id = h.aid;
  get diagnostics n_linked = row_count;

  -- ② 유치부
  update public.shuttle_assignments
     set unlinked_reason = '유치부'
   where student_id is null
     and public.shuttle_class_department(class_raw) = '유치부';
  get diagnostics n_kinder = row_count;

  -- ③ 동명이인은 사람이 봐야 합니다. 먼저 표시해 두고, 남은 것만 퇴소로 넘깁니다.
  update public.shuttle_assignments a
     set unlinked_reason = '확인필요'
   where a.student_id is null
     and coalesce(a.unlinked_reason, '') <> '유치부'
     and exists (
       select 1 from _names n
        where n.key = public.norm_name(a.student_name_raw)
        group by n.key having count(distinct n.id) > 1
     );
  get diagnostics n_dup = row_count;

  -- ④ 나머지 = 유치부도 아니고 명부에도 없음 → 퇴소
  update public.shuttle_assignments
     set unlinked_reason = '퇴소'
   where student_id is null
     and coalesce(unlinked_reason, '') not in ('유치부', '확인필요');
  get diagnostics n_left = row_count;

  raise notice '연결 %건 · 유치부 %건 · 확인필요 %건 · 퇴소 %건', n_linked, n_kinder, n_dup, n_left;
end $$;

-- 이제 "말 없이 비어 있는 줄"이 없으므로 제약을 겁니다.
--
-- student_id가 있으면 이유는 비어 있어야 하고, 없으면 반드시 이유가 있어야 합니다.
-- NOT NULL을 걸 수 없는 표(유치부 줄은 정당하게 학생과 안 붙습니다)에서 같은 보장을
-- 얻는 방법입니다.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'shuttle_assignments_link_ok'
      and conrelid = 'public.shuttle_assignments'::regclass
  ) then
    alter table public.shuttle_assignments
      add constraint shuttle_assignments_link_ok check (
        (student_id is not null and unlinked_reason is null)
        or (student_id is null and unlinked_reason is not null)
      );
  end if;

  if not exists (
    select 1
    from information_schema.table_constraints tc
    join information_schema.key_column_usage k
      on k.constraint_name = tc.constraint_name
     and k.constraint_schema = tc.constraint_schema
    where tc.constraint_schema = 'public'
      and tc.table_name = 'shuttle_assignments'
      and tc.constraint_type = 'FOREIGN KEY'
      and k.column_name = 'student_id'
  ) then
    alter table public.shuttle_assignments
      add constraint shuttle_assignments_student_id_fkey
      foreign key (student_id) references public.wr_students(id) on delete restrict;
  end if;
end $$;

create index if not exists shuttle_assignments_student_id_idx
  on public.shuttle_assignments (student_id);

-- 결과
select
  case when student_id is not null then '✅ 명부연결' else unlinked_reason end as "상태",
  count(*)                                                                    as "건수"
from public.shuttle_assignments
group by 1
order by 2 desc;
