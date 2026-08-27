-- 출결 등록표(attendance_entries)의 유일 인덱스를 '부분'에서 '전체'로 바꿉니다.
--
-- 왜 필요한가
-- ───────────
-- 원래 인덱스는 이렇게 걸려 있었습니다.
--
--   create unique index ... on attendance_entries (source, source_message_id, student_name, status)
--     where source_message_id is not null;      ← 이 줄이 문제였습니다
--
-- 앱은 이 네 칸을 열쇠로 upsert(있으면 두고, 없으면 만들기)를 합니다. 그런데 Postgres는
-- **조건이 붙은(부분) 유일 인덱스**를 쓸 때, 명령문에도 똑같은 조건을 적어줘야 그 인덱스를
-- 찾아냅니다. Supabase의 upsert는 열쇠 칸 이름만 보내고 조건은 못 보냅니다. 그래서 매번
--
--   42P10: there is no unique or exclusion constraint matching the ON CONFLICT specification
--
-- 로 실패했습니다. 그리고 두 곳 모두 **오류를 조용히 삼키고 있었습니다.**
--
-- 결과로 담당자가 본 증상
--   · 출결내역이 전부 ⬜  → 자동 스캔이 한 줄도 못 만들었습니다(등록표가 계속 비어 있었음)
--   · ✕를 눌러도 안 사라짐 → '무시'로 남길 줄도 못 만들었습니다
--
-- 조건을 떼도 안전한 이유
--   Postgres에서 NULL끼리는 서로 다른 값으로 봅니다. 그래서 source_message_id가 비어 있는
--   수기 등록(manual)은 조건이 없어도 여러 줄이 그대로 허용됩니다. 원래 조건이 하려던 일과
--   결과가 같습니다.

drop index if exists public.attendance_entries_source_uniq;

create unique index if not exists attendance_entries_source_uniq
  on public.attendance_entries (source, source_message_id, student_name, status);

-- 확인: 조건(indpred)이 비어 있어야 합니다.
select indexname as "인덱스",
       case when indexdef like '%WHERE%' then '⚠️ 아직 조건이 붙어 있습니다' else '✅ 조건 없음' end as "상태"
  from pg_indexes
 where schemaname = 'public'
   and tablename = 'attendance_entries'
   and indexname = 'attendance_entries_source_uniq';
