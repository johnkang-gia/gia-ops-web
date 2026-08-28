-- 토들은 긁어오는데 업무보드·업무 대시보드에 안 뜰 때.
--
-- 담당자: "토들 긁어오는데 업무보드, 업무 대시보드에 반영이 안 돼."
--
-- 토들 글이 화면에 뜨기까지 **네 개의 문**을 지납니다. 어느 문에서 막혔는지 봐야 합니다.
--
--   ① 수집기가 서버에 보냈는가          → pickup_requests에 줄이 생겼는가
--   ② AI가 무엇으로 분류했는가          → kind(픽업/문의/기타) · status
--   ③ 학생과 연결됐는가                 → student_id
--   ④ 화면 조건에 맞는가                → 날짜·부서·is_demo·status
--
-- 가장 흔한 것은 ②와 ④입니다. '기타'로 분류되면 아무 화면에도 안 뜨고, service_date가
-- 오늘이 아니면 오늘 대시보드에는 안 뜹니다(업무보드 문의함에는 뜹니다).

-- ── ① 최근 24시간에 들어온 토들 글 ───────────────────────────────────────
select to_char(r.received_at at time zone 'Asia/Seoul', 'MM-DD HH24:MI') as "받은 때",
       r.source                                   as "출처",
       r.kind                                     as "분류",
       r.status                                   as "상태",
       r.service_date                             as "대상일",
       coalesce(r.matched_name, r.ai_student_name, '(학생 못 찾음)') as "학생",
       case when r.student_id is null then '🔴 연결 안 됨' else '✅' end as "명부 연결",
       coalesce(r.is_demo, false)                 as "데모",
       round(coalesce(r.ai_confidence, 0)::numeric, 2) as "확신도",
       left(coalesce(r.raw_text, r.summary, ''), 50)   as "원문 앞부분"
  from public.pickup_requests r
 where r.received_at >= now() - interval '24 hours'
 order by r.received_at desc
 limit 50;

-- ── ② 분류별 집계 (최근 7일) ─────────────────────────────────────────────
-- '기타'가 많으면 AI가 대부분을 버리고 있다는 뜻입니다.
select r.kind      as "분류",
       r.status    as "상태",
       count(*)    as "건수"
  from public.pickup_requests r
 where r.received_at >= now() - interval '7 days'
 group by r.kind, r.status
 order by count(*) desc;

-- ── ③ 업무보드 문의함에 뜨는 조건에 맞는 것 ──────────────────────────────
-- 업무보드는 kind='문의'를 최근 14일치 봅니다.
select count(*) as "문의함에 떠야 할 건수"
  from public.pickup_requests r
 where r.kind = '문의'
   and coalesce(r.is_demo, false) = false
   and r.received_at >= now() - interval '14 days';

-- ── ④ 오늘 대시보드에 뜨는 조건에 맞는 것 ────────────────────────────────
-- 대시보드는 "대상일 = 오늘"인 픽업만 봅니다.
select count(*) as "오늘 대시보드에 떠야 할 픽업"
  from public.pickup_requests r
 where r.kind = '픽업'
   and coalesce(r.is_demo, false) = false
   and r.status <> '무시'
   and r.service_date = (now() at time zone 'Asia/Seoul')::date;

-- ── ⑤ 수집기가 살아 있는가 ───────────────────────────────────────────────
-- 마지막으로 토들 글이 들어온 시각. 몇 시간째 비어 있으면 사무실 PC의 크롬 확장이
-- 꺼졌거나 로그아웃됐을 가능성이 큽니다(컴퓨터가 켜져 있어야 동작합니다).
select max(received_at) at time zone 'Asia/Seoul'                 as "마지막 수집",
       round(extract(epoch from (now() - max(received_at))) / 60)  as "몇 분 전",
       count(*) filter (where received_at >= now() - interval '24 hours') as "최근 24시간 건수"
  from public.pickup_requests
 where source = '토들';

-- ── ⑥ 서버가 남긴 오류 (최근 24시간) ─────────────────────────────────────
select to_char(created_at at time zone 'Asia/Seoul', 'MM-DD HH24:MI') as "언제",
       route                                                          as "어디",
       left(message, 120)                                             as "내용"
  from public.error_logs
 where created_at >= now() - interval '24 hours'
   and (route ilike '%pickup%' or route ilike '%ingest%' or route ilike '%attendance%')
 order by created_at desc
 limit 20;
