-- 마무리 정리 SQL (요청: 정서안은 안 다니므로 제외)
-- ① 하원 셔틀 명단(22호)에서 정서안 제거
-- ② 학생 명부에서 정서안이 재학으로 남아있다면 보관(inactive) 처리
-- ③ 보너스: 파싱 때 잘렸을 수 있는 '마누키안' 이름을 원래대로(마리아 파즈 마누키안) 보정
begin;

-- ① 22호(하원·정규학기) 배정에서 정서안 제거
delete from shuttle_assignments
where student_name_raw = '정서안'
  and stop_id in (
    select st.id from shuttle_stops st
    join shuttle_routes r on r.id = st.route_id
    where r.direction = '하원' and r.term = '정규학기'
  );

-- ② 명부: 정서안이 재학(active)으로 남아있으면 보관 처리(재학생 명단·카운트에서 제외)
update wr_students set status = 'inactive', class_name = null, class_id = null
where name = '정서안' and is_demo = false and status = 'active';

-- ③ 이름 보정: '마누키안'으로 잘려 들어간 초등 G4S 학생 → 마리아 파즈 마누키안
update wr_students set name = '마리아 파즈 마누키안'
where name = '마누키안' and is_demo = false;

commit;
