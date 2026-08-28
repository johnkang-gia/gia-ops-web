-- 이준서의 배정 3개(4-2호·7호·9호)가 각각 무엇인지 자세히 봅니다.
--
-- 앞선 결과에서 두 가지가 걸립니다.
--   ① 이준서만 배정이 3개입니다(이준우는 2개). 7호가 무엇인지 확인이 필요합니다.
--   ② 이준서의 정류장 주소가 **셋 다 비어 있습니다(null)**. 주소가 없으면 기사님이
--      어디서 내려줘야 하는지 모르고, 정류장 좌표도 못 잡아 GPS 도착 기록도 안 찍힙니다.

select r.route_no                              as "호차",
       r.direction                             as "등원/하원",
       r.term                                  as "학기",
       r.active                                as "쓰는 노선인가",
       s.seq                                   as "정류장 순번",
       coalesce(s.address, '(주소 없음)')       as "정류장 주소",
       s.stop_time::text                       as "정류장 시각",
       case when s.lat is null then '❌' else '✅' end as "좌표",
       a.weekdays                              as "타는 요일",
       a.class_raw                             as "반",
       a.note                                  as "메모",
       a.created_at                            as "언제 만들어졌나"
  from public.shuttle_assignments a
  join public.shuttle_stops  s on s.id = a.stop_id
  join public.shuttle_routes r on r.id = s.route_id
 where a.student_name_raw like '%이준서%'
 order by a.created_at;

-- 참고: 같은 정류장을 쓰는 다른 학생들. 7호가 진짜 쓰는 정류장인지 가늠하는 데 씁니다.
-- (이준서 혼자만 있는 정류장이면 잘못 들어간 줄일 가능성이 높습니다.)
select r.route_no                      as "호차",
       coalesce(s.address, '(주소 없음)') as "정류장",
       count(*)                        as "이 정류장 학생 수",
       string_agg(a2.student_name_raw, ', ' order by a2.student_name_raw) as "누가 타나"
  from public.shuttle_assignments a
  join public.shuttle_stops  s  on s.id = a.stop_id
  join public.shuttle_routes r  on r.id = s.route_id
  join public.shuttle_assignments a2 on a2.stop_id = s.id
 where a.student_name_raw like '%이준서%'
 group by r.route_no, s.address, s.id
 order by r.route_no;
