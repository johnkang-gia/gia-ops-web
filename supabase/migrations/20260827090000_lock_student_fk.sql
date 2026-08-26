-- 학생 연결 잠그기 1단계 — 이미 깨끗한 표들
--
-- 배경: 실측 결과 아래 표들은 미연결 0, 고아 0이었습니다. 지금이 잠그기 가장 쉬운 순간입니다.
-- 특히 비어 있는 표(lib_visits, lib_loans, wr_comments, attendance_records, attendance_entries)는
-- **첫 행이 들어가기 전이 유일하게 공짜인 순간**입니다. 데이터가 쌓인 뒤엔 같은 작업이
-- 며칠짜리가 됩니다.
--
-- 이 마이그레이션이 하는 일:
--   student_id 를 NOT NULL + wr_students(id) 외래키로 잠급니다.
--   → 학생과 연결되지 않은 행은 **저장 자체가 안 됩니다.**
--   → 앱이 잊을 여지도, SQL로 직접 넣을 여지도, 나중에 다른 사람이 기능을 붙일 여지도 없습니다.
--      규칙이 아니라 구조가 됩니다.
--
-- ON DELETE RESTRICT 를 쓴 이유:
--   CASCADE 로 두면 학생 한 명을 지울 때 그 아이의 기록이 통째로 조용히 사라집니다.
--   6년치 성장기록을 남기는 것이 이 시스템의 목적인데, 그 목적과 정면으로 어긋납니다.
--   RESTRICT 면 기록이 있는 학생은 지워지지 않습니다 - 지우려면 기록을 먼저 어떻게 할지
--   결정해야 하고, 그 결정을 사람이 하게 됩니다. (퇴학·전학은 status 칸으로 다루고 있어서
--   실제로 행을 지울 일은 거의 없습니다.)
--
-- 안전장치:
--   표마다 잠그기 직전에 미연결·고아를 다시 셉니다. 하나라도 있으면 그 표는 **건너뜁니다.**
--   실측한 뒤로 데이터가 바뀌었더라도 이 스크립트가 실패하거나 무언가를 망가뜨리지 않습니다.
--   여러 번 실행해도 결과가 같습니다.

do $$
declare
  t        text;
  targets  text[] := array[
    'attendance_entries',
    'attendance_records',
    'wr_comments',
    'wr_reports',
    'incident_students',
    'lib_visits',
    'lib_loans'
  ];
  bad      bigint;
  fk       text;
begin
  foreach t in array targets loop
    -- 표가 아직 없으면 조용히 넘어갑니다(환경마다 있는 표가 다를 수 있음).
    if to_regclass('public.' || t) is null then
      raise notice '건너뜀 · 표 없음 : %', t;
      continue;
    end if;

    if not exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = t and column_name = 'student_id'
    ) then
      raise notice '건너뜀 · student_id 칸 없음 : %', t;
      continue;
    end if;

    -- 미연결(비어 있음) 또는 고아(명부에 없는 학생을 가리킴)가 하나라도 있으면 잠그지 않습니다.
    execute format(
      'select count(*) from public.%I x
         where x.student_id is null
            or not exists (select 1 from public.wr_students s where s.id = x.student_id)', t
    ) into bad;

    if bad > 0 then
      raise notice '건너뜀 · 미연결/고아 %개 남음 : %', bad, t;
      continue;
    end if;

    -- 외래키가 없으면 추가합니다.
    fk := t || '_student_id_fkey';
    if not exists (
      select 1
      from information_schema.table_constraints tc
      join information_schema.key_column_usage k
        on k.constraint_name = tc.constraint_name
       and k.constraint_schema = tc.constraint_schema
      where tc.constraint_schema = 'public'
        and tc.table_name = t
        and tc.constraint_type = 'FOREIGN KEY'
        and k.column_name = 'student_id'
    ) then
      execute format(
        'alter table public.%I add constraint %I
           foreign key (student_id) references public.wr_students(id) on delete restrict', t, fk
      );
    end if;

    -- 비어 있어도 되던 칸을 반드시 채워야 하는 칸으로 바꿉니다.
    execute format('alter table public.%I alter column student_id set not null', t);

    -- 학생별 조회가 이 표들의 주된 질의가 됩니다(타임라인·상세 화면).
    execute format(
      'create index if not exists %I on public.%I (student_id)', t || '_student_id_idx', t
    );

    raise notice '잠금 완료 : %', t;
  end loop;
end $$;

-- 결과 확인 — 이 표가 지금 상태입니다.
select
  c.table_name                                              as "표",
  case when c.is_nullable = 'NO' then '✅' else '⬜' end     as "NOT NULL",
  case when exists (
    select 1
    from information_schema.table_constraints tc
    join information_schema.key_column_usage k
      on k.constraint_name = tc.constraint_name
     and k.constraint_schema = tc.constraint_schema
    where tc.constraint_schema = 'public'
      and tc.table_name = c.table_name
      and tc.constraint_type = 'FOREIGN KEY'
      and k.column_name = 'student_id'
  ) then '✅' else '⬜' end                                  as "외래키",
  (xpath('/row/c/text()',
    query_to_xml(format('select count(*) as c from public.%I', c.table_name), false, true, '')
  ))[1]::text::bigint                                       as "행 수"
from information_schema.columns c
where c.table_schema = 'public'
  and c.column_name = 'student_id'
order by "NOT NULL" desc, c.table_name;
