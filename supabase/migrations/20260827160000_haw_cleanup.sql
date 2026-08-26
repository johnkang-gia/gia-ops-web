-- 하원 배정 정리 - 진짜 없는 아이만 지웁니다.
--
-- 담당자: "우리 명단에 없다면 과감하게 없애줘. 이번 학기가 기준 학기가 되어서 명부도 셔틀도
--          기준점을 삼아 학기가 지날수록 데이터를 축적해갈게."
--
-- 방향에 동의합니다. 다만 보내주신 목록을 **그대로 지우면 실제 학생이 사라집니다.**
--
--   호차 4·16-1·20·26-1 의 "김재이"  → 명부에 김재이가 3명 있습니다
--   호차 4-2·7·9 의 "이준서"         → 명부에 이준서가 2명 있습니다
--   호차 26 의 "이지원"              → 명부에 이지원이 2명 있습니다
--
-- 이 아이들은 명부에 **없어서** 연결이 안 된 게 아니라, **여럿이어서** 어느 쪽인지 기계가
-- 정하지 못한 것입니다. 지우면 그 아이는 차를 못 타게 됩니다.
--
-- 그래서 셋으로 나눠 처리합니다.
--   ① 파싱 쓰레기("등교", "중구")           → 지웁니다. 엑셀 제목 글자가 이름칸에 섞인 것입니다.
--   ② 명부에 여러 명인 이름(동명이인)        → '확인필요'로 남깁니다. 화면에서 골라주세요.
--   ③ 명부에 아예 없는 이름                 → 지웁니다(요청대로).

begin;

-- ① 제목 글자가 이름으로 섞인 줄
delete from shuttle_assignments a
 using shuttle_stops s, shuttle_routes r
 where a.stop_id = s.id and s.route_id = r.id
   and r.direction = '하원' and r.term = '정규학기'
   and (a.student_name_raw in ('등교','중구','하원','건대','담당')
        or a.class_raw like '등교%' or a.class_raw like '하원%');

-- ② 동명이인은 살려두고 '확인필요'로
update shuttle_assignments a
   set unlinked_reason = '확인필요'
  from shuttle_stops s, shuttle_routes r
 where a.stop_id = s.id and s.route_id = r.id
   and r.direction = '하원' and r.term = '정규학기'
   and a.student_id is null
   and (select count(distinct w.id) from wr_students w
         where w.status = 'active' and w.is_demo = false
           and public.norm_name(w.name) = public.norm_name(a.student_name_raw)) > 1;

-- ③ 명부에 아예 없는 이름은 지웁니다.
--    이번 학기 명부를 기준점으로 삼는다는 방침에 따른 것이고, 지운 뒤에는 명부에 그 아이를
--    추가해야만 셔틀에 다시 올릴 수 있습니다. 그게 "명부가 절대 기준"의 뜻입니다.
delete from shuttle_assignments a
 using shuttle_stops s, shuttle_routes r
 where a.stop_id = s.id and s.route_id = r.id
   and r.direction = '하원' and r.term = '정규학기'
   and a.student_id is null
   and coalesce(a.unlinked_reason,'') <> '유치부'
   and not exists (
     select 1 from wr_students w
      where w.status = 'active' and w.is_demo = false
        and public.norm_name(w.name) = public.norm_name(a.student_name_raw))
   and not exists (
     select 1 from attendance_learning_rules ru
      where ru.kind = 'alias' and ru.student_id is not null
        and public.norm_name(ru.pattern) = public.norm_name(a.student_name_raw));

commit;

select coalesce(a.unlinked_reason,'명부연결') as "상태", count(*) as "건수"
  from shuttle_assignments a
  join shuttle_stops s on s.id = a.stop_id
  join shuttle_routes r on r.id = s.route_id and r.direction='하원' and r.term='정규학기'
 group by 1 order by 2 desc;

-- 남은 '확인필요' - 화면에서 이름을 눌러 어느 아이인지 골라주세요.
select r.route_no as "호차", a.student_name_raw as "이름",
       (select string_agg(coalesce(w.grade,'?') || '학년', ', ')
          from wr_students w
         where w.status='active' and w.is_demo=false
           and public.norm_name(w.name)=public.norm_name(a.student_name_raw)) as "명부 후보"
  from shuttle_assignments a
  join shuttle_stops s on s.id=a.stop_id
  join shuttle_routes r on r.id=s.route_id and r.direction='하원' and r.term='정규학기'
 where a.unlinked_reason = '확인필요'
 order by r.sort_order;
