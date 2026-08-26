-- 학생 연결 실측 — "지금 몇 개나 학생과 안 붙어 있나"
--
-- 이 값이 나와야 FK를 거는 게 며칠짜리인지 알 수 있습니다.
-- 아무것도 바꾸지 않고 **세기만 합니다.** 그냥 실행하셔도 안전합니다.
--
-- 읽는 법:
--   전체    : 그 표의 행 수
--   미연결  : student_id 가 비어 있는 행 수      → 채워야 잠글 수 있음
--   고아    : student_id 가 있는데 명부에 없는 학생을 가리키는 행 수 → 가장 위험
--   판정    : 지금 바로 잠글 수 있는지
--
-- '고아'가 왜 위험한가요? 미연결은 눈에 띄기라도 하는데, 고아는 값이 들어 있어서
-- 멀쩡해 보입니다. 그런데 그 학생은 명부에 없습니다(퇴학·삭제·오타로 만들어진 id).
-- 화면에는 빈칸으로 나오고 아무도 이유를 모릅니다.

with cols as (
  select
    c.table_name,
    bool_or(c.column_name = 'student_id')       as has_id,
    bool_or(c.column_name = 'student_name')     as has_name,
    bool_or(c.column_name = 'ai_student_name')  as has_ai_name
  from information_schema.columns c
  join information_schema.tables t
    on t.table_schema = c.table_schema
   and t.table_name   = c.table_name
   and t.table_type   = 'BASE TABLE'
  where c.table_schema = 'public'
  group by c.table_name
  having bool_or(c.column_name in ('student_id', 'student_name', 'ai_student_name'))
),
counted as (
  select
    table_name,
    has_id,
    case
      when has_id      then 'student_id'
      when has_name    then 'student_name (문자열)'
      else                  'ai_student_name (문자열)'
    end as link_col,
    (xpath(
      '/row/c/text()',
      query_to_xml(format('select count(*) as c from public.%I', table_name), false, true, '')
    ))[1]::text::bigint as total,
    case when has_id then (xpath(
      '/row/c/text()',
      query_to_xml(format('select count(*) as c from public.%I where student_id is null', table_name), false, true, '')
    ))[1]::text::bigint end as unlinked,
    case when has_id then (xpath(
      '/row/c/text()',
      query_to_xml(format(
        'select count(*) as c from public.%I x where x.student_id is not null'
        || ' and not exists (select 1 from public.wr_students s where s.id = x.student_id)',
        table_name), false, true, '')
    ))[1]::text::bigint end as orphan
  from cols
)
select
  table_name                      as "표",
  link_col                        as "연결칸",
  total                           as "전체",
  coalesce(unlinked::text, '-')   as "미연결",
  coalesce(orphan::text,  '-')    as "고아",
  case
    when not has_id                             then '❌ ID 없음 — 문자열로만 붙어 있음'
    when total = 0                              then '⬜ 비어 있음 — 지금 바로 잠글 수 있음'
    when unlinked = 0 and orphan = 0            then '✅ 지금 바로 잠글 수 있음'
    when orphan > 0                             then '⚠️ 고아 먼저 정리 필요'
    else                                             '🔧 미연결 채우면 잠글 수 있음'
  end                             as "판정"
from counted
order by
  case
    when not has_id then 1
    when orphan > 0 then 2
    when unlinked > 0 then 3
    else 4
  end,
  total desc;
