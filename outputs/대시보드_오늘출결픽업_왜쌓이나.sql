-- 업무 대시보드의 오늘 출결·픽업이 어디서 오는지 낱낱이 봅니다.
--
-- 담당자: "출결과 픽업이 하루마다 갱신되지 않고 축적되는 것 같아. 오늘 출결은 태이만 있고."
--
-- 대시보드는 세 곳에서 이름을 모읍니다. 어느 쪽이 오래된 것을 붙들고 있는지 봐야 합니다.
--   ⓐ attendance_entries  — "기간이 오늘을 품는" 등록 건
--   ⓑ pickup_requests     — 오늘 날짜의 픽업 문의
--   ⓒ shuttle_boardings   — 오늘 체크표에서 찍은 픽업
--
-- 가장 흔한 원인은 ⓐ입니다. 한 글에서 뽑은 **기간이 잘못 길면** 그 아이가 매일 남습니다.

-- ── ⓐ 오늘 올라오는 등록 건 (기간과 원문까지) ────────────────────────────
select e.student_name                                   as "학생",
       e.status                                         as "종류",
       e.date_from                                      as "시작",
       e.date_to                                        as "끝",
       (e.date_to - e.date_from) + 1                    as "며칠짜리",
       case when (e.date_to - e.date_from) >= 3 then '⚠️ 기간이 깁니다 - 매일 뜹니다' else '' end as "진단",
       e.registered_by                                  as "등록",
       left(coalesce(e.raw_text, ''), 60)               as "원문 앞부분"
  from public.attendance_entries e
 where e.state = '등록'
   and e.date_from <= (now() at time zone 'Asia/Seoul')::date
   and e.date_to   >= (now() at time zone 'Asia/Seoul')::date
 order by (e.date_to - e.date_from) desc, e.student_name;

-- ── ⓐ-2 기간이 3일을 넘는 등록 건 전부(오늘이 아니어도) ──────────────────
-- 여기 있는 것들이 앞으로 며칠 동안 계속 뜰 예정입니다.
select e.student_name as "학생",
       e.status       as "종류",
       e.date_from    as "시작",
       e.date_to      as "끝",
       (e.date_to - e.date_from) + 1 as "며칠짜리",
       left(coalesce(e.raw_text, ''), 80) as "원문 앞부분"
  from public.attendance_entries e
 where e.state = '등록'
   and (e.date_to - e.date_from) >= 3
   and e.date_to >= (now() at time zone 'Asia/Seoul')::date
 order by (e.date_to - e.date_from) desc;

-- ── ⓑ 오늘 픽업 문의 ─────────────────────────────────────────────────────
select coalesce(r.matched_name, r.ai_student_name, '(이름 없음)') as "학생",
       r.source        as "출처",
       r.kind          as "종류",
       r.status        as "상태",
       to_char(r.received_at at time zone 'Asia/Seoul', 'MM-DD HH24:MI') as "받은 때",
       r.service_date  as "대상일",
       left(coalesce(r.raw_text, r.summary, ''), 60) as "원문 앞부분"
  from public.pickup_requests r
 where r.service_date = (now() at time zone 'Asia/Seoul')::date
   and coalesce(r.is_demo, false) = false
   and r.status <> '무시'
 order by r.received_at desc;

-- ── ⓒ 오늘 체크표에서 찍은 픽업·결석 ─────────────────────────────────────
select a.student_name_raw as "학생",
       b.status           as "종류",
       r.route_no         as "호차",
       b.checked_by       as "누가",
       to_char(b.checked_at at time zone 'Asia/Seoul', 'HH24:MI') as "언제"
  from public.shuttle_boardings b
  join public.shuttle_assignments a on a.id = b.assignment_id
  left join public.shuttle_stops s on s.id = a.stop_id
  left join public.shuttle_routes r on r.id = s.route_id
 where b.service_date = (now() at time zone 'Asia/Seoul')::date
   and b.status in ('픽업', '결석')
 order by b.status, a.student_name_raw;

-- ── 요약 ─────────────────────────────────────────────────────────────────
select to_char(now() at time zone 'Asia/Seoul', 'YYYY-MM-DD HH24:MI') as "지금(한국)",
       (select count(*) from public.attendance_entries e
         where e.state = '등록'
           and e.date_from <= (now() at time zone 'Asia/Seoul')::date
           and e.date_to   >= (now() at time zone 'Asia/Seoul')::date)          as "ⓐ 오늘 출결",
       (select count(*) from public.attendance_entries e
         where e.state = '등록' and (e.date_to - e.date_from) >= 3
           and e.date_to >= (now() at time zone 'Asia/Seoul')::date)            as "ⓐ 그중 기간 긴 것",
       (select count(*) from public.pickup_requests r
         where r.service_date = (now() at time zone 'Asia/Seoul')::date
           and coalesce(r.is_demo, false) = false and r.status <> '무시')       as "ⓑ 오늘 픽업 문의",
       (select count(*) from public.shuttle_boardings b
         where b.service_date = (now() at time zone 'Asia/Seoul')::date
           and b.status = '픽업')                                               as "ⓒ 체크표 픽업";
