-- 26-27 정규학기 하원 셔틀 명단 재세팅(사용자 원문 명단 1-1호~31호 그대로).
-- 규칙: (요일)이름=그 요일만 탑승 / 이름(요일x)=그 요일 제외 / (G2A) 등은 동명이인 구분.
-- 이준서·이준우 형제(중등)는 4-2호(학원)·9호(집·기업은행) 양쪽에 등록 - 당일 하원 때 물어보고
-- 체크표의 '오늘 한정 노선 이동'으로 확정하는 운영 방식입니다. 7호 이준서는 초등(다른 학생).
begin;

-- ① 하원·정규학기 기존 배정 전체 삭제(오늘 탑승기록은 함께 삭제됨 - cascade)
delete from shuttle_assignments where stop_id in (
  select st.id from shuttle_stops st join shuttle_routes r on r.id = st.route_id
  where r.direction='하원' and r.term='정규학기');

-- ── 1-1호 (2명) ──
insert into shuttle_routes (direction, term, route_no, name, sort_order, active) select '하원','정규학기','1-1','1-1호',999,true where not exists (select 1 from shuttle_routes where direction='하원' and term='정규학기' and route_no='1-1');
update shuttle_routes set active=true where direction='하원' and term='정규학기' and route_no='1-1';
insert into shuttle_stops (route_id, seq, address) select r.id, 0, '미지정' from shuttle_routes r where r.direction='하원' and r.term='정규학기' and r.route_no='1-1' and not exists (select 1 from shuttle_stops st where st.route_id=r.id);
insert into shuttle_assignments (stop_id, student_name_raw, weekdays)
  select st.id, '김단우', '{1,2,3,4,5}'::int[]
  from shuttle_stops st join shuttle_routes r on r.id=st.route_id
  where r.direction='하원' and r.term='정규학기' and r.route_no='1-1'
  order by st.seq limit 1;
insert into shuttle_assignments (stop_id, student_name_raw, weekdays)
  select st.id, '이연우', '{1,2,3,4,5}'::int[]
  from shuttle_stops st join shuttle_routes r on r.id=st.route_id
  where r.direction='하원' and r.term='정규학기' and r.route_no='1-1'
  order by st.seq limit 1;
-- ── 1-2호 (1명) ──
insert into shuttle_routes (direction, term, route_no, name, sort_order, active) select '하원','정규학기','1-2','1-2호',999,true where not exists (select 1 from shuttle_routes where direction='하원' and term='정규학기' and route_no='1-2');
update shuttle_routes set active=true where direction='하원' and term='정규학기' and route_no='1-2';
insert into shuttle_stops (route_id, seq, address) select r.id, 0, '미지정' from shuttle_routes r where r.direction='하원' and r.term='정규학기' and r.route_no='1-2' and not exists (select 1 from shuttle_stops st where st.route_id=r.id);
insert into shuttle_assignments (stop_id, student_name_raw, weekdays)
  select st.id, '김서진', '{1,3,5}'::int[]
  from shuttle_stops st join shuttle_routes r on r.id=st.route_id
  where r.direction='하원' and r.term='정규학기' and r.route_no='1-2'
  order by st.seq limit 1;
-- ── 2-1호 (1명) ──
insert into shuttle_routes (direction, term, route_no, name, sort_order, active) select '하원','정규학기','2-1','2-1호',999,true where not exists (select 1 from shuttle_routes where direction='하원' and term='정규학기' and route_no='2-1');
update shuttle_routes set active=true where direction='하원' and term='정규학기' and route_no='2-1';
insert into shuttle_stops (route_id, seq, address) select r.id, 0, '미지정' from shuttle_routes r where r.direction='하원' and r.term='정규학기' and r.route_no='2-1' and not exists (select 1 from shuttle_stops st where st.route_id=r.id);
insert into shuttle_assignments (stop_id, student_name_raw, weekdays)
  select st.id, '정레인', '{1,2,3,4,5}'::int[]
  from shuttle_stops st join shuttle_routes r on r.id=st.route_id
  where r.direction='하원' and r.term='정규학기' and r.route_no='2-1'
  order by st.seq limit 1;
-- ── 3호 (2명) ──
insert into shuttle_routes (direction, term, route_no, name, sort_order, active) select '하원','정규학기','3','3호',999,true where not exists (select 1 from shuttle_routes where direction='하원' and term='정규학기' and route_no='3');
update shuttle_routes set active=true where direction='하원' and term='정규학기' and route_no='3';
insert into shuttle_stops (route_id, seq, address) select r.id, 0, '미지정' from shuttle_routes r where r.direction='하원' and r.term='정규학기' and r.route_no='3' and not exists (select 1 from shuttle_stops st where st.route_id=r.id);
insert into shuttle_assignments (stop_id, student_name_raw, weekdays)
  select st.id, '곽세린', '{1,2,3,4,5}'::int[]
  from shuttle_stops st join shuttle_routes r on r.id=st.route_id
  where r.direction='하원' and r.term='정규학기' and r.route_no='3'
  order by st.seq limit 1;
insert into shuttle_assignments (stop_id, student_name_raw, weekdays)
  select st.id, '도윤서', '{1,2,3,4,5}'::int[]
  from shuttle_stops st join shuttle_routes r on r.id=st.route_id
  where r.direction='하원' and r.term='정규학기' and r.route_no='3'
  order by st.seq limit 1;
-- ── 4호 (3명) ──
insert into shuttle_routes (direction, term, route_no, name, sort_order, active) select '하원','정규학기','4','4호',999,true where not exists (select 1 from shuttle_routes where direction='하원' and term='정규학기' and route_no='4');
update shuttle_routes set active=true where direction='하원' and term='정규학기' and route_no='4';
insert into shuttle_stops (route_id, seq, address) select r.id, 0, '미지정' from shuttle_routes r where r.direction='하원' and r.term='정규학기' and r.route_no='4' and not exists (select 1 from shuttle_stops st where st.route_id=r.id);
insert into shuttle_assignments (stop_id, student_name_raw, weekdays)
  select st.id, '연하윤', '{1,2,3,4,5}'::int[]
  from shuttle_stops st join shuttle_routes r on r.id=st.route_id
  where r.direction='하원' and r.term='정규학기' and r.route_no='4'
  order by st.seq limit 1;
insert into shuttle_assignments (stop_id, student_name_raw, weekdays, note)
  select st.id, '김재이(G3J)', '{4}'::int[], '목요일만 4호(평소 26-1호)'
  from shuttle_stops st join shuttle_routes r on r.id=st.route_id
  where r.direction='하원' and r.term='정규학기' and r.route_no='4'
  order by st.seq limit 1;
insert into shuttle_assignments (stop_id, student_name_raw, weekdays)
  select st.id, '전준백', '{1,2,3,4,5}'::int[]
  from shuttle_stops st join shuttle_routes r on r.id=st.route_id
  where r.direction='하원' and r.term='정규학기' and r.route_no='4'
  order by st.seq limit 1;
-- ── 4-2호 (4명) ──
insert into shuttle_routes (direction, term, route_no, name, sort_order, active) select '하원','정규학기','4-2','4-2호',999,true where not exists (select 1 from shuttle_routes where direction='하원' and term='정규학기' and route_no='4-2');
update shuttle_routes set active=true where direction='하원' and term='정규학기' and route_no='4-2';
insert into shuttle_stops (route_id, seq, address) select r.id, 0, '미지정' from shuttle_routes r where r.direction='하원' and r.term='정규학기' and r.route_no='4-2' and not exists (select 1 from shuttle_stops st where st.route_id=r.id);
insert into shuttle_assignments (stop_id, student_name_raw, weekdays)
  select st.id, '이서아', '{1,2,3,4,5}'::int[]
  from shuttle_stops st join shuttle_routes r on r.id=st.route_id
  where r.direction='하원' and r.term='정규학기' and r.route_no='4-2'
  order by st.seq limit 1;
insert into shuttle_assignments (stop_id, student_name_raw, weekdays, note)
  select st.id, '임지효', '{2,3,4}'::int[], '월금은 10호'
  from shuttle_stops st join shuttle_routes r on r.id=st.route_id
  where r.direction='하원' and r.term='정규학기' and r.route_no='4-2'
  order by st.seq limit 1;
insert into shuttle_assignments (stop_id, student_name_raw, weekdays, note)
  select st.id, '이준서(중등)', '{1,2,3,4,5}'::int[], '형제-학원이면 4-2호/집·기업은행이면 9호(당일 확인)'
  from shuttle_stops st join shuttle_routes r on r.id=st.route_id
  where r.direction='하원' and r.term='정규학기' and r.route_no='4-2'
  order by st.seq limit 1;
insert into shuttle_assignments (stop_id, student_name_raw, weekdays, note)
  select st.id, '이준우', '{1,2,3,4,5}'::int[], '형제-학원이면 4-2호/집·기업은행이면 9호(당일 확인)'
  from shuttle_stops st join shuttle_routes r on r.id=st.route_id
  where r.direction='하원' and r.term='정규학기' and r.route_no='4-2'
  order by st.seq limit 1;
-- ── 5호 (3명) ──
insert into shuttle_routes (direction, term, route_no, name, sort_order, active) select '하원','정규학기','5','5호',999,true where not exists (select 1 from shuttle_routes where direction='하원' and term='정규학기' and route_no='5');
update shuttle_routes set active=true where direction='하원' and term='정규학기' and route_no='5';
insert into shuttle_stops (route_id, seq, address) select r.id, 0, '미지정' from shuttle_routes r where r.direction='하원' and r.term='정규학기' and r.route_no='5' and not exists (select 1 from shuttle_stops st where st.route_id=r.id);
insert into shuttle_assignments (stop_id, student_name_raw, weekdays)
  select st.id, '이서준', '{1,2,3,4,5}'::int[]
  from shuttle_stops st join shuttle_routes r on r.id=st.route_id
  where r.direction='하원' and r.term='정규학기' and r.route_no='5'
  order by st.seq limit 1;
insert into shuttle_assignments (stop_id, student_name_raw, weekdays)
  select st.id, '김도율', '{1,2,3,4,5}'::int[]
  from shuttle_stops st join shuttle_routes r on r.id=st.route_id
  where r.direction='하원' and r.term='정규학기' and r.route_no='5'
  order by st.seq limit 1;
insert into shuttle_assignments (stop_id, student_name_raw, weekdays)
  select st.id, '임예나', '{1,2,3,4,5}'::int[]
  from shuttle_stops st join shuttle_routes r on r.id=st.route_id
  where r.direction='하원' and r.term='정규학기' and r.route_no='5'
  order by st.seq limit 1;
-- ── 7호 (3명) ──
insert into shuttle_routes (direction, term, route_no, name, sort_order, active) select '하원','정규학기','7','7호',999,true where not exists (select 1 from shuttle_routes where direction='하원' and term='정규학기' and route_no='7');
update shuttle_routes set active=true where direction='하원' and term='정규학기' and route_no='7';
insert into shuttle_stops (route_id, seq, address) select r.id, 0, '미지정' from shuttle_routes r where r.direction='하원' and r.term='정규학기' and r.route_no='7' and not exists (select 1 from shuttle_stops st where st.route_id=r.id);
insert into shuttle_assignments (stop_id, student_name_raw, weekdays)
  select st.id, '고진우', '{1,2,3,4,5}'::int[]
  from shuttle_stops st join shuttle_routes r on r.id=st.route_id
  where r.direction='하원' and r.term='정규학기' and r.route_no='7'
  order by st.seq limit 1;
insert into shuttle_assignments (stop_id, student_name_raw, weekdays, note)
  select st.id, '이준서', '{1,2,3,4,5}'::int[], '초등학생(동명이인, 4-2·9호 이준서와 다름)'
  from shuttle_stops st join shuttle_routes r on r.id=st.route_id
  where r.direction='하원' and r.term='정규학기' and r.route_no='7'
  order by st.seq limit 1;
insert into shuttle_assignments (stop_id, student_name_raw, weekdays)
  select st.id, '강예성', '{1,2,3,4,5}'::int[]
  from shuttle_stops st join shuttle_routes r on r.id=st.route_id
  where r.direction='하원' and r.term='정규학기' and r.route_no='7'
  order by st.seq limit 1;
-- ── 8호 (2명) ──
insert into shuttle_routes (direction, term, route_no, name, sort_order, active) select '하원','정규학기','8','8호',999,true where not exists (select 1 from shuttle_routes where direction='하원' and term='정규학기' and route_no='8');
update shuttle_routes set active=true where direction='하원' and term='정규학기' and route_no='8';
insert into shuttle_stops (route_id, seq, address) select r.id, 0, '미지정' from shuttle_routes r where r.direction='하원' and r.term='정규학기' and r.route_no='8' and not exists (select 1 from shuttle_stops st where st.route_id=r.id);
insert into shuttle_assignments (stop_id, student_name_raw, weekdays)
  select st.id, '홍서형', '{1,2,3,4,5}'::int[]
  from shuttle_stops st join shuttle_routes r on r.id=st.route_id
  where r.direction='하원' and r.term='정규학기' and r.route_no='8'
  order by st.seq limit 1;
insert into shuttle_assignments (stop_id, student_name_raw, weekdays)
  select st.id, '김샤론', '{1,3}'::int[]
  from shuttle_stops st join shuttle_routes r on r.id=st.route_id
  where r.direction='하원' and r.term='정규학기' and r.route_no='8'
  order by st.seq limit 1;
-- ── 9호 (3명) ──
insert into shuttle_routes (direction, term, route_no, name, sort_order, active) select '하원','정규학기','9','9호',999,true where not exists (select 1 from shuttle_routes where direction='하원' and term='정규학기' and route_no='9');
update shuttle_routes set active=true where direction='하원' and term='정규학기' and route_no='9';
insert into shuttle_stops (route_id, seq, address) select r.id, 0, '미지정' from shuttle_routes r where r.direction='하원' and r.term='정규학기' and r.route_no='9' and not exists (select 1 from shuttle_stops st where st.route_id=r.id);
insert into shuttle_assignments (stop_id, student_name_raw, weekdays, note)
  select st.id, '황이안', '{1,2,3,5}'::int[], '목요일 안탐'
  from shuttle_stops st join shuttle_routes r on r.id=st.route_id
  where r.direction='하원' and r.term='정규학기' and r.route_no='9'
  order by st.seq limit 1;
insert into shuttle_assignments (stop_id, student_name_raw, weekdays, note)
  select st.id, '이준서(중등)', '{1,2,3,4,5}'::int[], '형제-집·기업은행이면 9호/학원이면 4-2호(당일 확인)'
  from shuttle_stops st join shuttle_routes r on r.id=st.route_id
  where r.direction='하원' and r.term='정규학기' and r.route_no='9'
  order by st.seq limit 1;
insert into shuttle_assignments (stop_id, student_name_raw, weekdays, note)
  select st.id, '이준우', '{1,2,3,4,5}'::int[], '형제-집·기업은행이면 9호/학원이면 4-2호(당일 확인)'
  from shuttle_stops st join shuttle_routes r on r.id=st.route_id
  where r.direction='하원' and r.term='정규학기' and r.route_no='9'
  order by st.seq limit 1;
-- ── 9-1호 (1명) ──
insert into shuttle_routes (direction, term, route_no, name, sort_order, active) select '하원','정규학기','9-1','9-1호',999,true where not exists (select 1 from shuttle_routes where direction='하원' and term='정규학기' and route_no='9-1');
update shuttle_routes set active=true where direction='하원' and term='정규학기' and route_no='9-1';
insert into shuttle_stops (route_id, seq, address) select r.id, 0, '미지정' from shuttle_routes r where r.direction='하원' and r.term='정규학기' and r.route_no='9-1' and not exists (select 1 from shuttle_stops st where st.route_id=r.id);
insert into shuttle_assignments (stop_id, student_name_raw, weekdays)
  select st.id, '김서이', '{1,2,3,4,5}'::int[]
  from shuttle_stops st join shuttle_routes r on r.id=st.route_id
  where r.direction='하원' and r.term='정규학기' and r.route_no='9-1'
  order by st.seq limit 1;
-- ── 9-2호 (1명) ──
insert into shuttle_routes (direction, term, route_no, name, sort_order, active) select '하원','정규학기','9-2','9-2호',999,true where not exists (select 1 from shuttle_routes where direction='하원' and term='정규학기' and route_no='9-2');
update shuttle_routes set active=true where direction='하원' and term='정규학기' and route_no='9-2';
insert into shuttle_stops (route_id, seq, address) select r.id, 0, '미지정' from shuttle_routes r where r.direction='하원' and r.term='정규학기' and r.route_no='9-2' and not exists (select 1 from shuttle_stops st where st.route_id=r.id);
insert into shuttle_assignments (stop_id, student_name_raw, weekdays)
  select st.id, '김나율', '{1,2,3,4,5}'::int[]
  from shuttle_stops st join shuttle_routes r on r.id=st.route_id
  where r.direction='하원' and r.term='정규학기' and r.route_no='9-2'
  order by st.seq limit 1;
-- ── 10호 (2명) ──
insert into shuttle_routes (direction, term, route_no, name, sort_order, active) select '하원','정규학기','10','10호',999,true where not exists (select 1 from shuttle_routes where direction='하원' and term='정규학기' and route_no='10');
update shuttle_routes set active=true where direction='하원' and term='정규학기' and route_no='10';
insert into shuttle_stops (route_id, seq, address) select r.id, 0, '미지정' from shuttle_routes r where r.direction='하원' and r.term='정규학기' and r.route_no='10' and not exists (select 1 from shuttle_stops st where st.route_id=r.id);
insert into shuttle_assignments (stop_id, student_name_raw, weekdays, note)
  select st.id, '임지효', '{1,5}'::int[], '화수목은 4-2호'
  from shuttle_stops st join shuttle_routes r on r.id=st.route_id
  where r.direction='하원' and r.term='정규학기' and r.route_no='10'
  order by st.seq limit 1;
insert into shuttle_assignments (stop_id, student_name_raw, weekdays)
  select st.id, '유재이', '{2,4,5}'::int[]
  from shuttle_stops st join shuttle_routes r on r.id=st.route_id
  where r.direction='하원' and r.term='정규학기' and r.route_no='10'
  order by st.seq limit 1;
-- ── 11호 (3명) ──
insert into shuttle_routes (direction, term, route_no, name, sort_order, active) select '하원','정규학기','11','11호',999,true where not exists (select 1 from shuttle_routes where direction='하원' and term='정규학기' and route_no='11');
update shuttle_routes set active=true where direction='하원' and term='정규학기' and route_no='11';
insert into shuttle_stops (route_id, seq, address) select r.id, 0, '미지정' from shuttle_routes r where r.direction='하원' and r.term='정규학기' and r.route_no='11' and not exists (select 1 from shuttle_stops st where st.route_id=r.id);
insert into shuttle_assignments (stop_id, student_name_raw, weekdays)
  select st.id, '이준원', '{1,2,3,4,5}'::int[]
  from shuttle_stops st join shuttle_routes r on r.id=st.route_id
  where r.direction='하원' and r.term='정규학기' and r.route_no='11'
  order by st.seq limit 1;
insert into shuttle_assignments (stop_id, student_name_raw, weekdays)
  select st.id, '이신원', '{1,2,3,4,5}'::int[]
  from shuttle_stops st join shuttle_routes r on r.id=st.route_id
  where r.direction='하원' and r.term='정규학기' and r.route_no='11'
  order by st.seq limit 1;
insert into shuttle_assignments (stop_id, student_name_raw, weekdays, note)
  select st.id, '마야', '{1,2,3,4,5}'::int[], 'Maya Amelia Dowding'
  from shuttle_stops st join shuttle_routes r on r.id=st.route_id
  where r.direction='하원' and r.term='정규학기' and r.route_no='11'
  order by st.seq limit 1;
-- ── 12호 (4명) ──
insert into shuttle_routes (direction, term, route_no, name, sort_order, active) select '하원','정규학기','12','12호',999,true where not exists (select 1 from shuttle_routes where direction='하원' and term='정규학기' and route_no='12');
update shuttle_routes set active=true where direction='하원' and term='정규학기' and route_no='12';
insert into shuttle_stops (route_id, seq, address) select r.id, 0, '미지정' from shuttle_routes r where r.direction='하원' and r.term='정규학기' and r.route_no='12' and not exists (select 1 from shuttle_stops st where st.route_id=r.id);
insert into shuttle_assignments (stop_id, student_name_raw, weekdays)
  select st.id, '차봄', '{1,3,5}'::int[]
  from shuttle_stops st join shuttle_routes r on r.id=st.route_id
  where r.direction='하원' and r.term='정규학기' and r.route_no='12'
  order by st.seq limit 1;
insert into shuttle_assignments (stop_id, student_name_raw, weekdays)
  select st.id, '황준호', '{1,2,3,4,5}'::int[]
  from shuttle_stops st join shuttle_routes r on r.id=st.route_id
  where r.direction='하원' and r.term='정규학기' and r.route_no='12'
  order by st.seq limit 1;
insert into shuttle_assignments (stop_id, student_name_raw, weekdays)
  select st.id, '황라원', '{1,2,3,4,5}'::int[]
  from shuttle_stops st join shuttle_routes r on r.id=st.route_id
  where r.direction='하원' and r.term='정규학기' and r.route_no='12'
  order by st.seq limit 1;
insert into shuttle_assignments (stop_id, student_name_raw, weekdays)
  select st.id, '황라윤', '{1,2,3,4,5}'::int[]
  from shuttle_stops st join shuttle_routes r on r.id=st.route_id
  where r.direction='하원' and r.term='정규학기' and r.route_no='12'
  order by st.seq limit 1;
-- ── 12-1호 (3명) ──
insert into shuttle_routes (direction, term, route_no, name, sort_order, active) select '하원','정규학기','12-1','12-1호',999,true where not exists (select 1 from shuttle_routes where direction='하원' and term='정규학기' and route_no='12-1');
update shuttle_routes set active=true where direction='하원' and term='정규학기' and route_no='12-1';
insert into shuttle_stops (route_id, seq, address) select r.id, 0, '미지정' from shuttle_routes r where r.direction='하원' and r.term='정규학기' and r.route_no='12-1' and not exists (select 1 from shuttle_stops st where st.route_id=r.id);
insert into shuttle_assignments (stop_id, student_name_raw, weekdays, note)
  select st.id, '남가인', '{1,3,4,5}'::int[], '화요일은 26-1호'
  from shuttle_stops st join shuttle_routes r on r.id=st.route_id
  where r.direction='하원' and r.term='정규학기' and r.route_no='12-1'
  order by st.seq limit 1;
insert into shuttle_assignments (stop_id, student_name_raw, weekdays, note)
  select st.id, '정서우', '{1}'::int[], '화수목금은 22호'
  from shuttle_stops st join shuttle_routes r on r.id=st.route_id
  where r.direction='하원' and r.term='정규학기' and r.route_no='12-1'
  order by st.seq limit 1;
insert into shuttle_assignments (stop_id, student_name_raw, weekdays)
  select st.id, '강하라', '{1}'::int[]
  from shuttle_stops st join shuttle_routes r on r.id=st.route_id
  where r.direction='하원' and r.term='정규학기' and r.route_no='12-1'
  order by st.seq limit 1;
-- ── 13호 (4명) ──
insert into shuttle_routes (direction, term, route_no, name, sort_order, active) select '하원','정규학기','13','13호',999,true where not exists (select 1 from shuttle_routes where direction='하원' and term='정규학기' and route_no='13');
update shuttle_routes set active=true where direction='하원' and term='정규학기' and route_no='13';
insert into shuttle_stops (route_id, seq, address) select r.id, 0, '미지정' from shuttle_routes r where r.direction='하원' and r.term='정규학기' and r.route_no='13' and not exists (select 1 from shuttle_stops st where st.route_id=r.id);
insert into shuttle_assignments (stop_id, student_name_raw, weekdays)
  select st.id, '권태이', '{1,2,3,4,5}'::int[]
  from shuttle_stops st join shuttle_routes r on r.id=st.route_id
  where r.direction='하원' and r.term='정규학기' and r.route_no='13'
  order by st.seq limit 1;
insert into shuttle_assignments (stop_id, student_name_raw, weekdays)
  select st.id, '이하은', '{1,2,3,4,5}'::int[]
  from shuttle_stops st join shuttle_routes r on r.id=st.route_id
  where r.direction='하원' and r.term='정규학기' and r.route_no='13'
  order by st.seq limit 1;
insert into shuttle_assignments (stop_id, student_name_raw, weekdays)
  select st.id, '최온유', '{1,2,3,4,5}'::int[]
  from shuttle_stops st join shuttle_routes r on r.id=st.route_id
  where r.direction='하원' and r.term='정규학기' and r.route_no='13'
  order by st.seq limit 1;
insert into shuttle_assignments (stop_id, student_name_raw, weekdays)
  select st.id, '위준완', '{1,2,3,4,5}'::int[]
  from shuttle_stops st join shuttle_routes r on r.id=st.route_id
  where r.direction='하원' and r.term='정규학기' and r.route_no='13'
  order by st.seq limit 1;
-- ── 14호 (2명) ──
insert into shuttle_routes (direction, term, route_no, name, sort_order, active) select '하원','정규학기','14','14호',999,true where not exists (select 1 from shuttle_routes where direction='하원' and term='정규학기' and route_no='14');
update shuttle_routes set active=true where direction='하원' and term='정규학기' and route_no='14';
insert into shuttle_stops (route_id, seq, address) select r.id, 0, '미지정' from shuttle_routes r where r.direction='하원' and r.term='정규학기' and r.route_no='14' and not exists (select 1 from shuttle_stops st where st.route_id=r.id);
insert into shuttle_assignments (stop_id, student_name_raw, weekdays, note)
  select st.id, '박준후', '{2,3,5}'::int[], '월목은 21호'
  from shuttle_stops st join shuttle_routes r on r.id=st.route_id
  where r.direction='하원' and r.term='정규학기' and r.route_no='14'
  order by st.seq limit 1;
insert into shuttle_assignments (stop_id, student_name_raw, weekdays)
  select st.id, '김요한', '{1,2,3,4,5}'::int[]
  from shuttle_stops st join shuttle_routes r on r.id=st.route_id
  where r.direction='하원' and r.term='정규학기' and r.route_no='14'
  order by st.seq limit 1;
-- ── 15호 (1명) ──
insert into shuttle_routes (direction, term, route_no, name, sort_order, active) select '하원','정규학기','15','15호',999,true where not exists (select 1 from shuttle_routes where direction='하원' and term='정규학기' and route_no='15');
update shuttle_routes set active=true where direction='하원' and term='정규학기' and route_no='15';
insert into shuttle_stops (route_id, seq, address) select r.id, 0, '미지정' from shuttle_routes r where r.direction='하원' and r.term='정규학기' and r.route_no='15' and not exists (select 1 from shuttle_stops st where st.route_id=r.id);
insert into shuttle_assignments (stop_id, student_name_raw, weekdays)
  select st.id, '심규민', '{1,3,4}'::int[]
  from shuttle_stops st join shuttle_routes r on r.id=st.route_id
  where r.direction='하원' and r.term='정규학기' and r.route_no='15'
  order by st.seq limit 1;
-- ── 16호 (1명) ──
insert into shuttle_routes (direction, term, route_no, name, sort_order, active) select '하원','정규학기','16','16호',999,true where not exists (select 1 from shuttle_routes where direction='하원' and term='정규학기' and route_no='16');
update shuttle_routes set active=true where direction='하원' and term='정규학기' and route_no='16';
insert into shuttle_stops (route_id, seq, address) select r.id, 0, '미지정' from shuttle_routes r where r.direction='하원' and r.term='정규학기' and r.route_no='16' and not exists (select 1 from shuttle_stops st where st.route_id=r.id);
insert into shuttle_assignments (stop_id, student_name_raw, weekdays)
  select st.id, '김승후', '{1,2,3,4,5}'::int[]
  from shuttle_stops st join shuttle_routes r on r.id=st.route_id
  where r.direction='하원' and r.term='정규학기' and r.route_no='16'
  order by st.seq limit 1;
-- ── 16-1호 (5명) ──
insert into shuttle_routes (direction, term, route_no, name, sort_order, active) select '하원','정규학기','16-1','16-1호',999,true where not exists (select 1 from shuttle_routes where direction='하원' and term='정규학기' and route_no='16-1');
update shuttle_routes set active=true where direction='하원' and term='정규학기' and route_no='16-1';
insert into shuttle_stops (route_id, seq, address) select r.id, 0, '미지정' from shuttle_routes r where r.direction='하원' and r.term='정규학기' and r.route_no='16-1' and not exists (select 1 from shuttle_stops st where st.route_id=r.id);
insert into shuttle_assignments (stop_id, student_name_raw, weekdays)
  select st.id, '김재이(G2A)', '{1,2,3,4,5}'::int[]
  from shuttle_stops st join shuttle_routes r on r.id=st.route_id
  where r.direction='하원' and r.term='정규학기' and r.route_no='16-1'
  order by st.seq limit 1;
insert into shuttle_assignments (stop_id, student_name_raw, weekdays)
  select st.id, '최서아', '{2}'::int[]
  from shuttle_stops st join shuttle_routes r on r.id=st.route_id
  where r.direction='하원' and r.term='정규학기' and r.route_no='16-1'
  order by st.seq limit 1;
insert into shuttle_assignments (stop_id, student_name_raw, weekdays)
  select st.id, '문수민', '{1,2,3,4,5}'::int[]
  from shuttle_stops st join shuttle_routes r on r.id=st.route_id
  where r.direction='하원' and r.term='정규학기' and r.route_no='16-1'
  order by st.seq limit 1;
insert into shuttle_assignments (stop_id, student_name_raw, weekdays)
  select st.id, '노다은', '{1,2,3,4,5}'::int[]
  from shuttle_stops st join shuttle_routes r on r.id=st.route_id
  where r.direction='하원' and r.term='정규학기' and r.route_no='16-1'
  order by st.seq limit 1;
insert into shuttle_assignments (stop_id, student_name_raw, weekdays)
  select st.id, '노다혜', '{1,2,3,4,5}'::int[]
  from shuttle_stops st join shuttle_routes r on r.id=st.route_id
  where r.direction='하원' and r.term='정규학기' and r.route_no='16-1'
  order by st.seq limit 1;
-- ── 18호 (2명) ──
insert into shuttle_routes (direction, term, route_no, name, sort_order, active) select '하원','정규학기','18','18호',999,true where not exists (select 1 from shuttle_routes where direction='하원' and term='정규학기' and route_no='18');
update shuttle_routes set active=true where direction='하원' and term='정규학기' and route_no='18';
insert into shuttle_stops (route_id, seq, address) select r.id, 0, '미지정' from shuttle_routes r where r.direction='하원' and r.term='정규학기' and r.route_no='18' and not exists (select 1 from shuttle_stops st where st.route_id=r.id);
insert into shuttle_assignments (stop_id, student_name_raw, weekdays)
  select st.id, '주이안', '{1,2,3,4,5}'::int[]
  from shuttle_stops st join shuttle_routes r on r.id=st.route_id
  where r.direction='하원' and r.term='정규학기' and r.route_no='18'
  order by st.seq limit 1;
insert into shuttle_assignments (stop_id, student_name_raw, weekdays)
  select st.id, '이도후', '{1,2,3,4,5}'::int[]
  from shuttle_stops st join shuttle_routes r on r.id=st.route_id
  where r.direction='하원' and r.term='정규학기' and r.route_no='18'
  order by st.seq limit 1;
-- ── 19호 (2명) ──
insert into shuttle_routes (direction, term, route_no, name, sort_order, active) select '하원','정규학기','19','19호',999,true where not exists (select 1 from shuttle_routes where direction='하원' and term='정규학기' and route_no='19');
update shuttle_routes set active=true where direction='하원' and term='정규학기' and route_no='19';
insert into shuttle_stops (route_id, seq, address) select r.id, 0, '미지정' from shuttle_routes r where r.direction='하원' and r.term='정규학기' and r.route_no='19' and not exists (select 1 from shuttle_stops st where st.route_id=r.id);
insert into shuttle_assignments (stop_id, student_name_raw, weekdays, note)
  select st.id, '곽호율', '{1,2,4}'::int[], '수금 안탐, 금은 20호'
  from shuttle_stops st join shuttle_routes r on r.id=st.route_id
  where r.direction='하원' and r.term='정규학기' and r.route_no='19'
  order by st.seq limit 1;
insert into shuttle_assignments (stop_id, student_name_raw, weekdays, note)
  select st.id, '고서윤', '{2,3,4,5}'::int[], '월요일 안탐'
  from shuttle_stops st join shuttle_routes r on r.id=st.route_id
  where r.direction='하원' and r.term='정규학기' and r.route_no='19'
  order by st.seq limit 1;
-- ── 20호 (5명) ──
insert into shuttle_routes (direction, term, route_no, name, sort_order, active) select '하원','정규학기','20','20호',999,true where not exists (select 1 from shuttle_routes where direction='하원' and term='정규학기' and route_no='20');
update shuttle_routes set active=true where direction='하원' and term='정규학기' and route_no='20';
insert into shuttle_stops (route_id, seq, address) select r.id, 0, '미지정' from shuttle_routes r where r.direction='하원' and r.term='정규학기' and r.route_no='20' and not exists (select 1 from shuttle_stops st where st.route_id=r.id);
insert into shuttle_assignments (stop_id, student_name_raw, weekdays)
  select st.id, '김재이(G2C)', '{1,2,3,4,5}'::int[]
  from shuttle_stops st join shuttle_routes r on r.id=st.route_id
  where r.direction='하원' and r.term='정규학기' and r.route_no='20'
  order by st.seq limit 1;
insert into shuttle_assignments (stop_id, student_name_raw, weekdays)
  select st.id, '이서현', '{1,2,3,4,5}'::int[]
  from shuttle_stops st join shuttle_routes r on r.id=st.route_id
  where r.direction='하원' and r.term='정규학기' and r.route_no='20'
  order by st.seq limit 1;
insert into shuttle_assignments (stop_id, student_name_raw, weekdays, note)
  select st.id, '지수', '{1,2,4,5}'::int[], '수요일 안탐'
  from shuttle_stops st join shuttle_routes r on r.id=st.route_id
  where r.direction='하원' and r.term='정규학기' and r.route_no='20'
  order by st.seq limit 1;
insert into shuttle_assignments (stop_id, student_name_raw, weekdays, note)
  select st.id, '박지음', '{2,3,4,5}'::int[], '월요일은 26-1호'
  from shuttle_stops st join shuttle_routes r on r.id=st.route_id
  where r.direction='하원' and r.term='정규학기' and r.route_no='20'
  order by st.seq limit 1;
insert into shuttle_assignments (stop_id, student_name_raw, weekdays, note)
  select st.id, '곽호율', '{5}'::int[], '금요일만 20호'
  from shuttle_stops st join shuttle_routes r on r.id=st.route_id
  where r.direction='하원' and r.term='정규학기' and r.route_no='20'
  order by st.seq limit 1;
-- ── 21호 (4명) ──
insert into shuttle_routes (direction, term, route_no, name, sort_order, active) select '하원','정규학기','21','21호',999,true where not exists (select 1 from shuttle_routes where direction='하원' and term='정규학기' and route_no='21');
update shuttle_routes set active=true where direction='하원' and term='정규학기' and route_no='21';
insert into shuttle_stops (route_id, seq, address) select r.id, 0, '미지정' from shuttle_routes r where r.direction='하원' and r.term='정규학기' and r.route_no='21' and not exists (select 1 from shuttle_stops st where st.route_id=r.id);
insert into shuttle_assignments (stop_id, student_name_raw, weekdays)
  select st.id, '김지민', '{1,2,3,4,5}'::int[]
  from shuttle_stops st join shuttle_routes r on r.id=st.route_id
  where r.direction='하원' and r.term='정규학기' and r.route_no='21'
  order by st.seq limit 1;
insert into shuttle_assignments (stop_id, student_name_raw, weekdays)
  select st.id, '강서후', '{1,2,3,4,5}'::int[]
  from shuttle_stops st join shuttle_routes r on r.id=st.route_id
  where r.direction='하원' and r.term='정규학기' and r.route_no='21'
  order by st.seq limit 1;
insert into shuttle_assignments (stop_id, student_name_raw, weekdays, note)
  select st.id, '이현우', '{1,3,4,5}'::int[], '화요일 안탐'
  from shuttle_stops st join shuttle_routes r on r.id=st.route_id
  where r.direction='하원' and r.term='정규학기' and r.route_no='21'
  order by st.seq limit 1;
insert into shuttle_assignments (stop_id, student_name_raw, weekdays, note)
  select st.id, '박준후', '{1,4}'::int[], '화수금은 14호'
  from shuttle_stops st join shuttle_routes r on r.id=st.route_id
  where r.direction='하원' and r.term='정규학기' and r.route_no='21'
  order by st.seq limit 1;
-- ── 22호 (2명) ──
insert into shuttle_routes (direction, term, route_no, name, sort_order, active) select '하원','정규학기','22','22호',999,true where not exists (select 1 from shuttle_routes where direction='하원' and term='정규학기' and route_no='22');
update shuttle_routes set active=true where direction='하원' and term='정규학기' and route_no='22';
insert into shuttle_stops (route_id, seq, address) select r.id, 0, '미지정' from shuttle_routes r where r.direction='하원' and r.term='정규학기' and r.route_no='22' and not exists (select 1 from shuttle_stops st where st.route_id=r.id);
insert into shuttle_assignments (stop_id, student_name_raw, weekdays, note)
  select st.id, '정서우', '{2,3,4,5}'::int[], '월요일은 12-1호'
  from shuttle_stops st join shuttle_routes r on r.id=st.route_id
  where r.direction='하원' and r.term='정규학기' and r.route_no='22'
  order by st.seq limit 1;
insert into shuttle_assignments (stop_id, student_name_raw, weekdays)
  select st.id, '정서안', '{1,2,3,4,5}'::int[]
  from shuttle_stops st join shuttle_routes r on r.id=st.route_id
  where r.direction='하원' and r.term='정규학기' and r.route_no='22'
  order by st.seq limit 1;
-- ── 23-1호 (2명) ──
insert into shuttle_routes (direction, term, route_no, name, sort_order, active) select '하원','정규학기','23-1','23-1호',999,true where not exists (select 1 from shuttle_routes where direction='하원' and term='정규학기' and route_no='23-1');
update shuttle_routes set active=true where direction='하원' and term='정규학기' and route_no='23-1';
insert into shuttle_stops (route_id, seq, address) select r.id, 0, '미지정' from shuttle_routes r where r.direction='하원' and r.term='정규학기' and r.route_no='23-1' and not exists (select 1 from shuttle_stops st where st.route_id=r.id);
insert into shuttle_assignments (stop_id, student_name_raw, weekdays, note)
  select st.id, '민송희', '{2,3,4,5}'::int[], '월요일은 26-1호'
  from shuttle_stops st join shuttle_routes r on r.id=st.route_id
  where r.direction='하원' and r.term='정규학기' and r.route_no='23-1'
  order by st.seq limit 1;
insert into shuttle_assignments (stop_id, student_name_raw, weekdays)
  select st.id, '심재이', '{1,2,3,4,5}'::int[]
  from shuttle_stops st join shuttle_routes r on r.id=st.route_id
  where r.direction='하원' and r.term='정규학기' and r.route_no='23-1'
  order by st.seq limit 1;
-- ── 23-2호 (1명) ──
insert into shuttle_routes (direction, term, route_no, name, sort_order, active) select '하원','정규학기','23-2','23-2호',999,true where not exists (select 1 from shuttle_routes where direction='하원' and term='정규학기' and route_no='23-2');
update shuttle_routes set active=true where direction='하원' and term='정규학기' and route_no='23-2';
insert into shuttle_stops (route_id, seq, address) select r.id, 0, '미지정' from shuttle_routes r where r.direction='하원' and r.term='정규학기' and r.route_no='23-2' and not exists (select 1 from shuttle_stops st where st.route_id=r.id);
insert into shuttle_assignments (stop_id, student_name_raw, weekdays)
  select st.id, '서민준', '{1,2,3,4,5}'::int[]
  from shuttle_stops st join shuttle_routes r on r.id=st.route_id
  where r.direction='하원' and r.term='정규학기' and r.route_no='23-2'
  order by st.seq limit 1;
-- ── 24호 (3명) ──
insert into shuttle_routes (direction, term, route_no, name, sort_order, active) select '하원','정규학기','24','24호',999,true where not exists (select 1 from shuttle_routes where direction='하원' and term='정규학기' and route_no='24');
update shuttle_routes set active=true where direction='하원' and term='정규학기' and route_no='24';
insert into shuttle_stops (route_id, seq, address) select r.id, 0, '미지정' from shuttle_routes r where r.direction='하원' and r.term='정규학기' and r.route_no='24' and not exists (select 1 from shuttle_stops st where st.route_id=r.id);
insert into shuttle_assignments (stop_id, student_name_raw, weekdays)
  select st.id, '이온유', '{1,2,3,4,5}'::int[]
  from shuttle_stops st join shuttle_routes r on r.id=st.route_id
  where r.direction='하원' and r.term='정규학기' and r.route_no='24'
  order by st.seq limit 1;
insert into shuttle_assignments (stop_id, student_name_raw, weekdays)
  select st.id, '강여명', '{1,2,3,4,5}'::int[]
  from shuttle_stops st join shuttle_routes r on r.id=st.route_id
  where r.direction='하원' and r.term='정규학기' and r.route_no='24'
  order by st.seq limit 1;
insert into shuttle_assignments (stop_id, student_name_raw, weekdays)
  select st.id, '강이제', '{1,2,3,4,5}'::int[]
  from shuttle_stops st join shuttle_routes r on r.id=st.route_id
  where r.direction='하원' and r.term='정규학기' and r.route_no='24'
  order by st.seq limit 1;
-- ── 26호 (1명) ──
insert into shuttle_routes (direction, term, route_no, name, sort_order, active) select '하원','정규학기','26','26호',999,true where not exists (select 1 from shuttle_routes where direction='하원' and term='정규학기' and route_no='26');
update shuttle_routes set active=true where direction='하원' and term='정규학기' and route_no='26';
insert into shuttle_stops (route_id, seq, address) select r.id, 0, '미지정' from shuttle_routes r where r.direction='하원' and r.term='정규학기' and r.route_no='26' and not exists (select 1 from shuttle_stops st where st.route_id=r.id);
insert into shuttle_assignments (stop_id, student_name_raw, weekdays)
  select st.id, '전지완', '{1,3,5}'::int[]
  from shuttle_stops st join shuttle_routes r on r.id=st.route_id
  where r.direction='하원' and r.term='정규학기' and r.route_no='26'
  order by st.seq limit 1;
-- ── 26-1호 (8명) ──
insert into shuttle_routes (direction, term, route_no, name, sort_order, active) select '하원','정규학기','26-1','26-1호',999,true where not exists (select 1 from shuttle_routes where direction='하원' and term='정규학기' and route_no='26-1');
update shuttle_routes set active=true where direction='하원' and term='정규학기' and route_no='26-1';
insert into shuttle_stops (route_id, seq, address) select r.id, 0, '미지정' from shuttle_routes r where r.direction='하원' and r.term='정규학기' and r.route_no='26-1' and not exists (select 1 from shuttle_stops st where st.route_id=r.id);
insert into shuttle_assignments (stop_id, student_name_raw, weekdays, note)
  select st.id, '민송희', '{1}'::int[], '화~금은 23-1호'
  from shuttle_stops st join shuttle_routes r on r.id=st.route_id
  where r.direction='하원' and r.term='정규학기' and r.route_no='26-1'
  order by st.seq limit 1;
insert into shuttle_assignments (stop_id, student_name_raw, weekdays, note)
  select st.id, '김재이(G3J)', '{1,2,3,5}'::int[], '목요일은 4호'
  from shuttle_stops st join shuttle_routes r on r.id=st.route_id
  where r.direction='하원' and r.term='정규학기' and r.route_no='26-1'
  order by st.seq limit 1;
insert into shuttle_assignments (stop_id, student_name_raw, weekdays, note)
  select st.id, '남가인', '{2}'::int[], '그 외는 12-1호'
  from shuttle_stops st join shuttle_routes r on r.id=st.route_id
  where r.direction='하원' and r.term='정규학기' and r.route_no='26-1'
  order by st.seq limit 1;
insert into shuttle_assignments (stop_id, student_name_raw, weekdays, note)
  select st.id, '박지음', '{1}'::int[], '화~금은 20호'
  from shuttle_stops st join shuttle_routes r on r.id=st.route_id
  where r.direction='하원' and r.term='정규학기' and r.route_no='26-1'
  order by st.seq limit 1;
insert into shuttle_assignments (stop_id, student_name_raw, weekdays)
  select st.id, '김도은', '{1,2,3,4,5}'::int[]
  from shuttle_stops st join shuttle_routes r on r.id=st.route_id
  where r.direction='하원' and r.term='정규학기' and r.route_no='26-1'
  order by st.seq limit 1;
insert into shuttle_assignments (stop_id, student_name_raw, weekdays, note)
  select st.id, '이한범', '{1,2,3,4}'::int[], '금요일은 28호'
  from shuttle_stops st join shuttle_routes r on r.id=st.route_id
  where r.direction='하원' and r.term='정규학기' and r.route_no='26-1'
  order by st.seq limit 1;
insert into shuttle_assignments (stop_id, student_name_raw, weekdays)
  select st.id, '원세빈', '{1,2,3,4,5}'::int[]
  from shuttle_stops st join shuttle_routes r on r.id=st.route_id
  where r.direction='하원' and r.term='정규학기' and r.route_no='26-1'
  order by st.seq limit 1;
insert into shuttle_assignments (stop_id, student_name_raw, weekdays, note)
  select st.id, '권수호', '{1,2,4,5}'::int[], '수요일 안탐'
  from shuttle_stops st join shuttle_routes r on r.id=st.route_id
  where r.direction='하원' and r.term='정규학기' and r.route_no='26-1'
  order by st.seq limit 1;
-- ── 26-2호 (4명) ──
insert into shuttle_routes (direction, term, route_no, name, sort_order, active) select '하원','정규학기','26-2','26-2호',999,true where not exists (select 1 from shuttle_routes where direction='하원' and term='정규학기' and route_no='26-2');
update shuttle_routes set active=true where direction='하원' and term='정규학기' and route_no='26-2';
insert into shuttle_stops (route_id, seq, address) select r.id, 0, '미지정' from shuttle_routes r where r.direction='하원' and r.term='정규학기' and r.route_no='26-2' and not exists (select 1 from shuttle_stops st where st.route_id=r.id);
insert into shuttle_assignments (stop_id, student_name_raw, weekdays)
  select st.id, '황시원', '{1,2,3,4,5}'::int[]
  from shuttle_stops st join shuttle_routes r on r.id=st.route_id
  where r.direction='하원' and r.term='정규학기' and r.route_no='26-2'
  order by st.seq limit 1;
insert into shuttle_assignments (stop_id, student_name_raw, weekdays)
  select st.id, '황이준', '{1,2,3,4,5}'::int[]
  from shuttle_stops st join shuttle_routes r on r.id=st.route_id
  where r.direction='하원' and r.term='정규학기' and r.route_no='26-2'
  order by st.seq limit 1;
insert into shuttle_assignments (stop_id, student_name_raw, weekdays)
  select st.id, '이예나', '{1,2,3,4,5}'::int[]
  from shuttle_stops st join shuttle_routes r on r.id=st.route_id
  where r.direction='하원' and r.term='정규학기' and r.route_no='26-2'
  order by st.seq limit 1;
insert into shuttle_assignments (stop_id, student_name_raw, weekdays)
  select st.id, '고이건', '{1,2,3,4,5}'::int[]
  from shuttle_stops st join shuttle_routes r on r.id=st.route_id
  where r.direction='하원' and r.term='정규학기' and r.route_no='26-2'
  order by st.seq limit 1;
-- ── 27호 (3명) ──
insert into shuttle_routes (direction, term, route_no, name, sort_order, active) select '하원','정규학기','27','27호',999,true where not exists (select 1 from shuttle_routes where direction='하원' and term='정규학기' and route_no='27');
update shuttle_routes set active=true where direction='하원' and term='정규학기' and route_no='27';
insert into shuttle_stops (route_id, seq, address) select r.id, 0, '미지정' from shuttle_routes r where r.direction='하원' and r.term='정규학기' and r.route_no='27' and not exists (select 1 from shuttle_stops st where st.route_id=r.id);
insert into shuttle_assignments (stop_id, student_name_raw, weekdays, note)
  select st.id, '이예온', '{1,2,4}'::int[], '수금은 28호'
  from shuttle_stops st join shuttle_routes r on r.id=st.route_id
  where r.direction='하원' and r.term='정규학기' and r.route_no='27'
  order by st.seq limit 1;
insert into shuttle_assignments (stop_id, student_name_raw, weekdays)
  select st.id, '임하임', '{1,2,3,4,5}'::int[]
  from shuttle_stops st join shuttle_routes r on r.id=st.route_id
  where r.direction='하원' and r.term='정규학기' and r.route_no='27'
  order by st.seq limit 1;
insert into shuttle_assignments (stop_id, student_name_raw, weekdays)
  select st.id, '강하영', '{1,2,3,4,5}'::int[]
  from shuttle_stops st join shuttle_routes r on r.id=st.route_id
  where r.direction='하원' and r.term='정규학기' and r.route_no='27'
  order by st.seq limit 1;
-- ── 28호 (5명) ──
insert into shuttle_routes (direction, term, route_no, name, sort_order, active) select '하원','정규학기','28','28호',999,true where not exists (select 1 from shuttle_routes where direction='하원' and term='정규학기' and route_no='28');
update shuttle_routes set active=true where direction='하원' and term='정규학기' and route_no='28';
insert into shuttle_stops (route_id, seq, address) select r.id, 0, '미지정' from shuttle_routes r where r.direction='하원' and r.term='정규학기' and r.route_no='28' and not exists (select 1 from shuttle_stops st where st.route_id=r.id);
insert into shuttle_assignments (stop_id, student_name_raw, weekdays, note)
  select st.id, '이예온', '{3,5}'::int[], '월화목은 27호'
  from shuttle_stops st join shuttle_routes r on r.id=st.route_id
  where r.direction='하원' and r.term='정규학기' and r.route_no='28'
  order by st.seq limit 1;
insert into shuttle_assignments (stop_id, student_name_raw, weekdays, note)
  select st.id, '이한범', '{5}'::int[], '월~목은 26-1호'
  from shuttle_stops st join shuttle_routes r on r.id=st.route_id
  where r.direction='하원' and r.term='정규학기' and r.route_no='28'
  order by st.seq limit 1;
insert into shuttle_assignments (stop_id, student_name_raw, weekdays, note)
  select st.id, '문준연', '{1,4,5}'::int[], '화수 안탐'
  from shuttle_stops st join shuttle_routes r on r.id=st.route_id
  where r.direction='하원' and r.term='정규학기' and r.route_no='28'
  order by st.seq limit 1;
insert into shuttle_assignments (stop_id, student_name_raw, weekdays)
  select st.id, '송우진', '{1,2,3,4,5}'::int[]
  from shuttle_stops st join shuttle_routes r on r.id=st.route_id
  where r.direction='하원' and r.term='정규학기' and r.route_no='28'
  order by st.seq limit 1;
insert into shuttle_assignments (stop_id, student_name_raw, weekdays)
  select st.id, '송윤진', '{1,2,3,4,5}'::int[]
  from shuttle_stops st join shuttle_routes r on r.id=st.route_id
  where r.direction='하원' and r.term='정규학기' and r.route_no='28'
  order by st.seq limit 1;
-- ── 29호 (1명) ──
insert into shuttle_routes (direction, term, route_no, name, sort_order, active) select '하원','정규학기','29','29호',999,true where not exists (select 1 from shuttle_routes where direction='하원' and term='정규학기' and route_no='29');
update shuttle_routes set active=true where direction='하원' and term='정규학기' and route_no='29';
insert into shuttle_stops (route_id, seq, address) select r.id, 0, '미지정' from shuttle_routes r where r.direction='하원' and r.term='정규학기' and r.route_no='29' and not exists (select 1 from shuttle_stops st where st.route_id=r.id);
insert into shuttle_assignments (stop_id, student_name_raw, weekdays)
  select st.id, '노유겸', '{1,2,3,4,5}'::int[]
  from shuttle_stops st join shuttle_routes r on r.id=st.route_id
  where r.direction='하원' and r.term='정규학기' and r.route_no='29'
  order by st.seq limit 1;
-- ── 30호 (4명) ──
insert into shuttle_routes (direction, term, route_no, name, sort_order, active) select '하원','정규학기','30','30호',999,true where not exists (select 1 from shuttle_routes where direction='하원' and term='정규학기' and route_no='30');
update shuttle_routes set active=true where direction='하원' and term='정규학기' and route_no='30';
insert into shuttle_stops (route_id, seq, address) select r.id, 0, '미지정' from shuttle_routes r where r.direction='하원' and r.term='정규학기' and r.route_no='30' and not exists (select 1 from shuttle_stops st where st.route_id=r.id);
insert into shuttle_assignments (stop_id, student_name_raw, weekdays)
  select st.id, '이아인', '{1,2,3,4,5}'::int[]
  from shuttle_stops st join shuttle_routes r on r.id=st.route_id
  where r.direction='하원' and r.term='정규학기' and r.route_no='30'
  order by st.seq limit 1;
insert into shuttle_assignments (stop_id, student_name_raw, weekdays)
  select st.id, '한우영', '{1,2,3,4,5}'::int[]
  from shuttle_stops st join shuttle_routes r on r.id=st.route_id
  where r.direction='하원' and r.term='정규학기' and r.route_no='30'
  order by st.seq limit 1;
insert into shuttle_assignments (stop_id, student_name_raw, weekdays, note)
  select st.id, '김리안', '{1,2,3,4}'::int[], '금요일 안탐'
  from shuttle_stops st join shuttle_routes r on r.id=st.route_id
  where r.direction='하원' and r.term='정규학기' and r.route_no='30'
  order by st.seq limit 1;
insert into shuttle_assignments (stop_id, student_name_raw, weekdays, note)
  select st.id, '김현수', '{1,2,3,4}'::int[], '금요일 안탐'
  from shuttle_stops st join shuttle_routes r on r.id=st.route_id
  where r.direction='하원' and r.term='정규학기' and r.route_no='30'
  order by st.seq limit 1;
-- ── 30-1호 (3명) ──
insert into shuttle_routes (direction, term, route_no, name, sort_order, active) select '하원','정규학기','30-1','30-1호',999,true where not exists (select 1 from shuttle_routes where direction='하원' and term='정규학기' and route_no='30-1');
update shuttle_routes set active=true where direction='하원' and term='정규학기' and route_no='30-1';
insert into shuttle_stops (route_id, seq, address) select r.id, 0, '미지정' from shuttle_routes r where r.direction='하원' and r.term='정규학기' and r.route_no='30-1' and not exists (select 1 from shuttle_stops st where st.route_id=r.id);
insert into shuttle_assignments (stop_id, student_name_raw, weekdays)
  select st.id, '백서아', '{1,2,3}'::int[]
  from shuttle_stops st join shuttle_routes r on r.id=st.route_id
  where r.direction='하원' and r.term='정규학기' and r.route_no='30-1'
  order by st.seq limit 1;
insert into shuttle_assignments (stop_id, student_name_raw, weekdays)
  select st.id, '이라엘', '{1,4,5}'::int[]
  from shuttle_stops st join shuttle_routes r on r.id=st.route_id
  where r.direction='하원' and r.term='정규학기' and r.route_no='30-1'
  order by st.seq limit 1;
insert into shuttle_assignments (stop_id, student_name_raw, weekdays)
  select st.id, '박진우', '{2,4}'::int[]
  from shuttle_stops st join shuttle_routes r on r.id=st.route_id
  where r.direction='하원' and r.term='정규학기' and r.route_no='30-1'
  order by st.seq limit 1;
-- ── 31호 (5명) ──
insert into shuttle_routes (direction, term, route_no, name, sort_order, active) select '하원','정규학기','31','31호',999,true where not exists (select 1 from shuttle_routes where direction='하원' and term='정규학기' and route_no='31');
update shuttle_routes set active=true where direction='하원' and term='정규학기' and route_no='31';
insert into shuttle_stops (route_id, seq, address) select r.id, 0, '미지정' from shuttle_routes r where r.direction='하원' and r.term='정규학기' and r.route_no='31' and not exists (select 1 from shuttle_stops st where st.route_id=r.id);
insert into shuttle_assignments (stop_id, student_name_raw, weekdays, note)
  select st.id, '에이바(일라이아나)', '{1,2,3,4,5}'::int[], 'Elliana Ma'
  from shuttle_stops st join shuttle_routes r on r.id=st.route_id
  where r.direction='하원' and r.term='정규학기' and r.route_no='31'
  order by st.seq limit 1;
insert into shuttle_assignments (stop_id, student_name_raw, weekdays, note)
  select st.id, '제이콥', '{1,2,3,4,5}'::int[], 'Jacob Dylan Ma'
  from shuttle_stops st join shuttle_routes r on r.id=st.route_id
  where r.direction='하원' and r.term='정규학기' and r.route_no='31'
  order by st.seq limit 1;
insert into shuttle_assignments (stop_id, student_name_raw, weekdays)
  select st.id, '장하영', '{1,2,3,4,5}'::int[]
  from shuttle_stops st join shuttle_routes r on r.id=st.route_id
  where r.direction='하원' and r.term='정규학기' and r.route_no='31'
  order by st.seq limit 1;
insert into shuttle_assignments (stop_id, student_name_raw, weekdays)
  select st.id, '강하늘', '{1,2,3,4,5}'::int[]
  from shuttle_stops st join shuttle_routes r on r.id=st.route_id
  where r.direction='하원' and r.term='정규학기' and r.route_no='31'
  order by st.seq limit 1;
insert into shuttle_assignments (stop_id, student_name_raw, weekdays)
  select st.id, '강하엘', '{1,2,3,4,5}'::int[]
  from shuttle_stops st join shuttle_routes r on r.id=st.route_id
  where r.direction='하원' and r.term='정규학기' and r.route_no='31'
  order by st.seq limit 1;

-- ② 고등부 학년 채우기(중고등 명부 Grade 컬럼: G9/G10/G11/G12/G12+)
update wr_students set grade='9' where name='김에스더' and department='중고등부' and status='active';
update wr_students set grade='9' where name='이하은' and department='중고등부' and status='active';
update wr_students set grade='9' where name='이준서' and department='중고등부' and status='active';
update wr_students set grade='10' where name='정에린' and department='중고등부' and status='active';
update wr_students set grade='10' where name='노다은' and department='중고등부' and status='active';
update wr_students set grade='11' where name='장하영' and department='중고등부' and status='active';
update wr_students set grade='11' where name='정하담' and department='중고등부' and status='active';
update wr_students set grade='12' where name='한이준' and department='중고등부' and status='active';
update wr_students set grade='12' where name='김태훈' and department='중고등부' and status='active';
update wr_students set grade='12+' where name='신혁' and department='중고등부' and status='active';
update wr_students set grade='12+' where name='강윤영' and department='중고등부' and status='active';
update wr_students set grade='10' where name_en='Mohammed Adam' and department='중고등부' and status='active';
update wr_students set grade='9' where name_en='Joshua Min' and department='중고등부' and status='active';

commit;