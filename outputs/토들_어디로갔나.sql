-- 최근 24시간에 들어온 토들 31건이 **어느 칸에 들어갔는지**.
--
-- 화면이 보는 조건은 딱 두 가지입니다.
--   · 업무보드 문의함    : kind = '문의'   (날짜 제한 없음)
--   · 업무 대시보드 픽업 : kind = '픽업' + 대상일 = 오늘 + 상태 ≠ 무시
--
-- 그러니 31건이 '기타'로 갔다면 두 화면 어디에도 안 뜹니다. 그게 가장 흔한 경우입니다.

select coalesce(r.kind, '(빈칸)')      as "분류",
       coalesce(r.status, '(빈칸)')    as "상태",
       count(*)                        as "건수",
       count(*) filter (where r.student_id is null)              as "학생 미연결",
       count(*) filter (where coalesce(r.is_demo, false))        as "데모",
       count(*) filter (where r.service_date = (now() at time zone 'Asia/Seoul')::date) as "대상일=오늘",
       round(avg(coalesce(r.ai_confidence, 0))::numeric, 2)      as "평균 확신도",
       -- 어떤 글들이 이 칸에 들어갔는지 두 개만 맛보기로.
       left(string_agg(coalesce(r.raw_text, r.summary, ''), ' ⏐ ' order by r.received_at desc), 160) as "예시"
  from public.pickup_requests r
 where r.received_at >= now() - interval '24 hours'
 group by r.kind, r.status
 order by count(*) desc;
