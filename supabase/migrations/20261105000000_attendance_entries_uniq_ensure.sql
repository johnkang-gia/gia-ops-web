-- 출결 등록표의 유일 인덱스가 **앱이 쓰는 열쇠와 같은 모양인지** 확인하고, 아니면 맞춥니다.
--
-- 20261022 에서 날짜를 더한 인덱스로 바꿨는데, 앱의 upsert 일곱 곳 중 한 곳만 따라 바뀌어
-- 나머지가 42P10 으로 실패했습니다. 앱 쪽은 상수 하나(ATTENDANCE_ENTRY_KEY)로 모았습니다.
-- 이 파일은 데이터베이스 쪽이 그 상수와 같은 다섯 칸인지 모양으로 확인합니다 - 이름만 보고
-- `if not exists` 로 넘어가면, 옛 네 칸짜리가 같은 이름으로 남아 있을 때 조용히 건너뜁니다.
do $$
declare
  def text;
begin
  select indexdef into def
    from pg_indexes
   where schemaname = 'public'
     and tablename = 'attendance_entries'
     and indexname = 'attendance_entries_source_uniq';

  if def is not null and def like '%date_from%' and def not like '%WHERE%' then
    raise notice '출결 유일 인덱스 이미 다섯 칸 · 건너뜀';
    return;
  end if;

  drop index if exists public.attendance_entries_source_uniq;

  -- 네 칸 열쇠로 넣던 동안 같은 날짜 줄이 중복으로 들어갔을 수 있습니다. 먼저 들어온 것을 남깁니다.
  delete from public.attendance_entries a
   using public.attendance_entries b
   where a.source = b.source
     and a.source_message_id is not distinct from b.source_message_id
     and a.student_name = b.student_name
     and a.status = b.status
     and a.date_from is not distinct from b.date_from
     and a.created_at > b.created_at;

  create unique index attendance_entries_source_uniq
    on public.attendance_entries (source, source_message_id, student_name, status, date_from);
end $$;
