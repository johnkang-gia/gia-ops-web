-- 인박스 표를 실시간 발행목록에 넣습니다.
--
-- 증상: "토들에서 긁어올 때 업무대시보드에는 뜨는데, 정작 업무보드에는 새로고침을 해야 떠."
--
-- 원인: 업무보드(ParentInquiryPanel)는 pickup_requests를 postgres_changes로 **구독하고
-- 있었습니다.** 코드는 처음부터 맞았습니다. 그런데 그 표가 supabase_realtime 발행목록에
-- 들어 있지 않아서, 구독은 성립하는데 **소식이 한 번도 오지 않는** 상태였습니다.
-- 조용히 아무 일도 안 일어나는 종류의 고장이라 알아채기 어려웠습니다.
--
-- 반면 업무대시보드는 30초마다 스스로 다시 불러오는 화면이라 멀쩡히 떴습니다.
-- 그래서 "뷰어인 대시보드가 메인인 업무보드보다 빠른" 뒤집힌 상태가 됐습니다.
--
-- 다른 표들(work_notices, lib_loans, shuttle_stop_arrivals, attendance_learning_rules)은
-- 만들 때 각자 발행목록에 넣었는데, pickup_requests와 google_chat_mirror_messages는
-- 그 단계가 빠져 있었습니다.

do $$
declare
  t text;
  targets text[] := array[
    'pickup_requests',           -- 토들 학부모 문의·픽업
    'google_chat_mirror_messages', -- 구글챗 출결알림
    'attendance_entries'         -- 출결 등록 상태(인박스 ✅/❓ 배지)
  ];
begin
  foreach t in array targets loop
    if to_regclass('public.' || t) is null then
      raise notice '건너뜀 · 표 없음 : %', t;
      continue;
    end if;
    if exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      raise notice '이미 있음 : %', t;
      continue;
    end if;
    execute format('alter publication supabase_realtime add table public.%I', t);
    raise notice '추가 완료 : %', t;
  end loop;
end $$;

-- 확인 — 인박스 관련 표가 전부 실시간으로 잡히는지.
select
  t.tablename                                                    as "표",
  case when p.tablename is null then '⬜ 안 됨' else '✅ 실시간' end as "상태"
from (values
  ('pickup_requests'), ('google_chat_mirror_messages'), ('attendance_entries'),
  ('work_notices'), ('tasks'), ('attendance_learning_rules')
) as t(tablename)
left join pg_publication_tables p
  on p.pubname = 'supabase_realtime'
 and p.schemaname = 'public'
 and p.tablename = t.tablename
order by "상태", "표";
