-- 주간 관찰기록: 대량 입력을 미리 겪어보기
--
-- 담당자: "다음 주부터 담임 선생님들이 대거 (...) 대량의 데이터가 들어가게 될 텐데
--          오류가 없었으면 좋겠어. 더미 자료로 테스트도 해보고."
--
-- 이 파일은 **넣어보고 → 재보고 → 지웁니다.** 실제 기록은 건드리지 않습니다.
-- 더미는 teacher_note가 '[부하테스트]'로 시작하는 줄뿐이고, ⑥에서 그것만 지웁니다.
--
-- ※ 먼저 20260828000000_wr_reports_scale.sql 을 실행해 주세요. 유일 인덱스가 없으면
--    ③에서 42P10으로 멈추는데, 그게 바로 다음 주에 모든 선생님이 겪을 오류입니다.

-- ── ① 지금 상태 ──────────────────────────────────────────────────────────
select count(*)                                   as "지금 기록 수",
       count(distinct student_id)                 as "학생 수",
       count(distinct subject)                    as "과목 수",
       pg_size_pretty(pg_total_relation_size('public.wr_reports')) as "표 크기"
  from public.wr_reports;

-- ── ② 유일 인덱스가 제대로 있는지 (없으면 아래가 전부 실패합니다) ────────
select coalesce(
         (select '✅ ' || indexname
            from pg_indexes
           where schemaname = 'public' and tablename = 'wr_reports'
             and indexdef ilike '%unique%'
             and indexdef ilike '%student_id%' and indexdef ilike '%subject%' and indexdef ilike '%report_date%'
             and indexdef not ilike '%where%'
           limit 1),
         '🔴 없음 - 20260828000000_wr_reports_scale.sql 을 먼저 실행하세요'
       ) as "저장 규칙";

-- ── ③ 더미 넣기: 재적 학생 전원 × 8과목 × 4주 ────────────────────────────
--
-- 137명 × 8과목 × 4주 = 약 4,400줄. 다음 주 한 달치에 해당합니다.
-- 앱과 **똑같은 방식(on conflict)** 으로 넣어, 실제로 겹칠 때 묶이는지까지 봅니다.
explain (analyze, buffers)
insert into public.wr_reports
  (student_id, term_id, class_id, grade, subject, academic, improvement, participation,
   behavior, social, teacher_note, eval_badges, status, report_date)
select s.id,
       (select id from public.terms order by start_date desc limit 1),
       s.class_id,
       s.grade,
       sub.name,
       '[부하테스트] 수업 태도가 안정적입니다. ' || repeat('내용 ', 20),
       '[부하테스트] 발표를 조금 더 하면 좋겠습니다. ' || repeat('내용 ', 20),
       '[부하테스트] 모둠 활동에 적극적입니다.',
       '[부하테스트] 규칙을 잘 지킵니다.',
       '[부하테스트] 친구들과 두루 지냅니다.',
       '[부하테스트] 이 줄은 테스트용이며 ⑥에서 지워집니다.',
       '{"academic":["excellent"],"behavior":["good"]}'::jsonb,
       case when random() < 0.7 then 'published' else 'draft' end,
       (current_date - (wk.n * 7))
  from public.wr_students s
 cross join (values ('국어'),('영어'),('수학'),('과학'),('사회'),('음악'),('미술'),('체육')) as sub(name)
 cross join generate_series(0, 3) as wk(n)
 where s.status = 'active'
   and coalesce(s.is_demo, false) = false
on conflict (student_id, subject, report_date) do nothing;

-- ── ④ 화면이 실제로 쓰는 조회를 재봅니다 ─────────────────────────────────
-- 인덱스를 타는지(Index Scan) 아니면 표 전체를 훑는지(Seq Scan)를 봅니다.

-- ④-1 통계 화면: 이번 주 전체
explain (analyze, buffers)
select student_id, status, eval_badges
  from public.wr_reports
 where term_id = (select id from public.terms order by start_date desc limit 1)
   and report_date >= current_date - 7
   and report_date <= current_date;

-- ④-2 학생 프로필: 한 학생의 전체 기록
explain (analyze, buffers)
select *
  from public.wr_reports
 where student_id = (select id from public.wr_students where status = 'active' limit 1)
 order by report_date desc;

-- ── ⑤ 결과 요약 ──────────────────────────────────────────────────────────
select count(*)                                   as "더미 포함 총 기록",
       count(*) filter (where teacher_note like '[부하테스트]%') as "더미",
       pg_size_pretty(pg_total_relation_size('public.wr_reports')) as "표 크기",
       -- 한 줄당 평균 크기로 한 학기(20주) 예상치를 냅니다.
       pg_size_pretty(
         (pg_total_relation_size('public.wr_reports') / greatest(1, count(*)) * 137 * 8 * 20)::bigint
       )                                          as "한 학기(137명×8과목×20주) 예상"
  from public.wr_reports;

-- ── ⑥ 더미 지우기 (반드시 실행) ──────────────────────────────────────────
delete from public.wr_reports where teacher_note like '[부하테스트]%';

select count(*) as "정리 후 남은 기록(원래 개수와 같아야 함)" from public.wr_reports;
