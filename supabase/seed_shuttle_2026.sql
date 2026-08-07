-- 2026BUS.pdf에서 자동 변환한 셔틀 노선/정류장/배정 데이터입니다.
-- 다시 실행해도 중복이 쌓이지 않도록 셔틀 데이터만 먼저 비우고 새로 넣습니다.
-- (탑승 체크 기록/운행 이벤트는 노선 삭제 시 함께 정리됩니다.)
delete from shuttle_routes;

with r0 as (
  insert into shuttle_routes (direction, route_no, name, driver_name, driver_phone, teacher_name, teacher_phone, depart_time, sort_order)
  values ('등원', '1', '잠원', '박찬원', '010-7170-9725', '유지연 Jenny Yoo', '010-5014-2484', '08:00', 0)
  returning id
)
, s0 as (
  insert into shuttle_stops (route_id, seq, stop_time, address, gate)
  select r0.id, v.seq, v.stop_time, v.address, v.gate
  from r0, (values
    (0, '8:27', '서초구 잠원로 46-38 브라운스톤 잠원', null),
    (1, '8:27', '서초구 잠원로 60 신반포자이 (30분에 미리 탑승)', null),
    (2, '8:36', '서초구 잠원로 60 신반포자이 106동', null),
    (3, '8:36', '아크로리버뷰', null),
    (4, '8:45', null, null),
    (5, '8:51', '서초구 잠원동 161 신반포 래미안 리오센트 106동', null),
    (6, '8:53', '서초구 잠원로 202-11 잠원훼미리아파트', null),
    (7, '8:56', '서초구 잠원로14길 23 롯데캐슬아파트 205-704 (롯데캐슬 2차 건너편)', null)
  ) as v(seq, stop_time, address, gate)
  returning id, seq
)
insert into shuttle_assignments (stop_id, student_name_raw, class_raw, weekdays, guardian_phone)
select s0.id, a.name, a.klass, a.wd, a.phone
from s0, (values
    (0, '신유안', '5 Nightingale', '{1,2,3,4,5}'::int[], '010-2770-9178'),
    (1, '김연우A', '6 Seahawk', '{1,2,3,4,5}'::int[], '010-3701-8260'),
    (2, '최시원', '4 Goldfinch', '{1,2,3,4,5}'::int[], '010-9276-5875'),
    (3, '윤이서', '7 Albatross', '{1,2,3,4,5}'::int[], '010-5025-7631'),
    (4, '윤서연', '7 Crane', '{1,2,3,4,5}'::int[], '010-6619-4508'),
    (5, '정이준', '4 Sparrow', '{1,2,3,4,5}'::int[], '010-4004-6571'),
    (6, '임서원', '7 Eagle', '{1,2,3,4,5}'::int[], '010-6600-2674'),
    (7, '박다겸', '6 Seahawk', '{1,2,3,4,5}'::int[], '010-7375-8350')
) as a(seq, name, klass, wd, phone)
where s0.seq = a.seq;

with r1 as (
  insert into shuttle_routes (direction, route_no, name, driver_name, driver_phone, teacher_name, teacher_phone, depart_time, sort_order)
  values ('등원', '1-1', '메이플자이 Gate2', '최종진', '010-5201-9498', '이정현 Jessie', '010-3774-4820', '08:00', 1)
  returning id
)
, s1 as (
  insert into shuttle_stops (route_id, seq, stop_time, address, gate)
  select r1.id, v.seq, v.stop_time, v.address, v.gate
  from r1, (values
    (0, '8:40/gate 2-2', '메이플자이 205동', null),
    (1, '8:40/gate 2-2', '메이플자이 203동', null),
    (2, '8:40/gate 2-2', '메이플자이 205동 이우빈', null),
    (3, '8:40/gate 2-2', '메이플자이 205동', null),
    (4, '8:40/gate 2-2', '메이플자이 201동 김연우B', null),
    (5, '8:40/gate 2-2', '메이플자이 205동', null),
    (6, '8:40/gate 2-2', '메이플자이 205동', null),
    (7, '8:40/gate 2-2', '메이플자이 207동', null),
    (8, '8:43/ gate2-1', '메이플자이 209동', null),
    (9, '8:43/ gate2-1', '메이플자이 213동', null),
    (10, '8:43/ gate2-1', '메이플자이 207동', null),
    (11, '8:43/ gate2-1', '메이플자이 213동', null)
  ) as v(seq, stop_time, address, gate)
  returning id, seq
)
insert into shuttle_assignments (stop_id, student_name_raw, class_raw, weekdays, guardian_phone)
select s1.id, a.name, a.klass, a.wd, a.phone
from s1, (values
    (0, '박준서', '5 Starling', '{1,2,3,4,5}'::int[], '010-3080-4762'),
    (1, '박하온', '6 Owl', '{1,2,3,4,5}'::int[], '010-6482-0946'),
    (2, '이수빈', 'Albatross/ 5 Wren', '{1,2,3,4,5}'::int[], '010-3030-3443'),
    (3, '김해주', '5 Wren', '{1,2,3,4,5}'::int[], '010-9272-6663'),
    (4, '김연서', '6 Swan/4 Pelican', '{1,2,3,4,5}'::int[], '010-3442-0078'),
    (5, '천재현', '7 Eagle', '{1,2,3,4,5}'::int[], '010-3762-1185'),
    (6, '박연재', '4 Magpie', '{1,2,3,4,5}'::int[], '010-4363-4314'),
    (7, '윤소희', '6 Owl', '{1,2,3,4,5}'::int[], '010-7181-1397'),
    (8, '김재이', '5 Starling', '{1,2,3,4,5}'::int[], '010-3499-4343'),
    (9, '방아원', '5 Cardinal', '{1,2,3,4,5}'::int[], '010-4092-0678'),
    (10, '표연서', '5 Toucan', '{1,2,3,4,5}'::int[], '010-7494-9829'),
    (11, '조규온', '7 Crane', '{1,2,3,4,5}'::int[], '010-8447-3875')
) as a(seq, name, klass, wd, phone)
where s1.seq = a.seq;

with r2 as (
  insert into shuttle_routes (direction, route_no, name, driver_name, driver_phone, teacher_name, teacher_phone, depart_time, sort_order)
  values ('등원', '1-2', '메이플자이 Gate1', '김경태', '010-6251-9833', '김소희 Sohee', '010-3325-5305', '08:00', 2)
  returning id
)
, s2 as (
  insert into shuttle_stops (route_id, seq, stop_time, address, gate)
  select r2.id, v.seq, v.stop_time, v.address, v.gate
  from r2, (values
    (0, '8:38', '서초구 신반포로 33길 15 잠원동아파트', null),
    (1, '8:43/gate 1-1', '메이플자이 107동', null),
    (2, '8:43/gate 1-1', '메이플자이 114동', null),
    (3, '8:43/gate 1-1', '메이플자이 114동', null),
    (4, '8:43/gate 1-1', '메이플자이 109동', null),
    (5, '8:43/gate 1-1', '메이플자이 110동', null),
    (6, '8:50/gate 1-2', '메이플자이 105동', null),
    (7, '8:50/gate 1-2', '메이플자이 106동', null),
    (8, '8:50/gate 1-2', '메이플자이 103동', null),
    (9, '8:50/gate 1-2', '메이플자이 106동', null)
  ) as v(seq, stop_time, address, gate)
  returning id, seq
)
insert into shuttle_assignments (stop_id, student_name_raw, class_raw, weekdays, guardian_phone)
select s2.id, a.name, a.klass, a.wd, a.phone
from s2, (values
    (0, '이준명', '5 Parrot', '{1,2,3,4,5}'::int[], '010-3398-9012'),
    (1, '장윤우', '7 Eagle', '{1,2,3,4,5}'::int[], '010-7328-8856'),
    (2, '정윤아', '6 Swan', '{1,2,3,4,5}'::int[], '010-4508-9251'),
    (3, '이아린', '5 Wren', '{1,2,3,4,5}'::int[], '010-2699-8090'),
    (4, '구가빈', '5 Starling', '{1,2,3,4,5}'::int[], '010-3389-5115'),
    (5, '서해인', '3 Robin', '{1,2,3,4,5}'::int[], '010-7176-5017'),
    (6, '박채이', '5 Parrot', '{1,2,3,4,5}'::int[], '010-5466-1211'),
    (7, '정건우', '6 Swan', '{1,2,3,4,5}'::int[], '010-5886-2653'),
    (8, '문서호', '5 Starling', '{1,2,3,4,5}'::int[], '010-9270-4238'),
    (9, '조이솔', '5 Starling', '{1,2,3,4,5}'::int[], '010-3842-9601')
) as a(seq, name, klass, wd, phone)
where s2.seq = a.seq;

with r3 as (
  insert into shuttle_routes (direction, route_no, name, driver_name, driver_phone, teacher_name, teacher_phone, depart_time, sort_order)
  values ('등원', '2', '반포자이', '최상균', '010-5522-2479', '최재은 Jenny Choi', '010-6381-8903', '08:00', 3)
  returning id
)
, s3 as (
  insert into shuttle_stops (route_id, seq, stop_time, address, gate)
  select r3.id, v.seq, v.stop_time, v.address, v.gate
  from r3, (values
    (0, '8:43', '서초구 신반포로 270 반포자이 112동', null),
    (1, '8:45', '서초구 신반포로 270 반포자이 120동', null),
    (2, '8:45', '서초구 신반포로 270 반포자이 127동 김예원', null),
    (3, '8:47', '서초구 신반포로 270 반포자이 129동', null),
    (4, '8:48', '서초구 신반포로 270 반포자이 137동', null),
    (5, '8:48', '서초구 신반포로 270 반포자이 133동', null),
    (6, '8:49', '서초구 신반포로 270 반포자이 139동', null),
    (7, '8:49', '서초구 신반포로 270 반포자이 140동', null),
    (8, '8:50', '서초구 신반포로 270 반포자이 118동', null)
  ) as v(seq, stop_time, address, gate)
  returning id, seq
)
insert into shuttle_assignments (stop_id, student_name_raw, class_raw, weekdays, guardian_phone)
select s3.id, a.name, a.klass, a.wd, a.phone
from s3, (values
    (0, '김주원', '6 Swan', '{1,2,3,4,5}'::int[], '010-7382-1023'),
    (1, '김태율', '6 Kite', '{1,2,3,4,5}'::int[], '010-2205-3420'),
    (2, '김주원', null, '{1,2,3,4,5}'::int[], '010-4078-2887'),
    (3, '김사랑', '4 Dove', '{1,2,3,4,5}'::int[], '010-4288-2028'),
    (4, '정은우', '7 Emu', '{1,2,3,4,5}'::int[], '010-7139-7519'),
    (5, '안제니', '3 Robin', '{1,2,3,4,5}'::int[], '010-9942-5436'),
    (6, '김문준', '7 Carne', '{1,2,3,4,5}'::int[], '010-9900-8739'),
    (7, '홍은석', '4 Magpie', '{1,2,3,4,5}'::int[], '010-3527-4083'),
    (8, '김유하', '6 Owl', '{1,2,3,4,5}'::int[], '010-2997-9801')
) as a(seq, name, klass, wd, phone)
where s3.seq = a.seq;

with r4 as (
  insert into shuttle_routes (direction, route_no, name, driver_name, driver_phone, teacher_name, teacher_phone, depart_time, sort_order)
  values ('등원', '3', '반포1', '정재오', '010-8353-2170', '양정민 Lenny', '010-3917-7728', '08:00', 4)
  returning id
)
, s4 as (
  insert into shuttle_stops (route_id, seq, stop_time, address, gate)
  select r4.id, v.seq, v.stop_time, v.address, v.gate
  from r4, (values
    (0, '8:30에 타야함', '서초구 서초중앙로 220 반포래미안아이파크', null),
    (1, '8:30에 타야함', '서초구 고무래로 89 반포써밋 101동(정문)', null),
    (2, '8:30에 타야함', '서초구 고무래로 89 반포써밋 101동(정문)', null),
    (3, '8:30에 타야함', '서초구 고무래로 94 서초현대 4차 201동', null),
    (4, '8:40', '서초구 서초중앙로 24길 57 롯데캐슬프레지던트 103동', null),
    (5, '8:45', '서초구 서초중앙로 188 아크로비스타 B동', null)
  ) as v(seq, stop_time, address, gate)
  returning id, seq
)
insert into shuttle_assignments (stop_id, student_name_raw, class_raw, weekdays, guardian_phone)
select s4.id, a.name, a.klass, a.wd, a.phone
from s4, (values
    (0, '김하진A', '7 Crane', '{1,2,3,4,5}'::int[], '010-5368-7500'),
    (1, '김아인', 'Pelican 4', '{1,2,3,4,5}'::int[], '010-8653-2837'),
    (2, '강선우', '3 Skylark', '{1,2,3,4,5}'::int[], '010-9745-2245'),
    (3, '박이현', null, '{1,2,3,4,5}'::int[], '010-2514-0900'),
    (4, '김시연', '5 Starling', '{1,2,3,4,5}'::int[], '010-2370-6608'),
    (5, '손재이', '5 Nightingale', '{1,2,3,4,5}'::int[], '010-3301-6307')
) as a(seq, name, klass, wd, phone)
where s4.seq = a.seq;

with r5 as (
  insert into shuttle_routes (direction, route_no, name, driver_name, driver_phone, teacher_name, teacher_phone, depart_time, sort_order)
  values ('등원', '4', '반포2', '성호준', '010-3231-6887', '이연실 Jay', '010-5792-8379', '08:00', 5)
  returning id
)
, s5 as (
  insert into shuttle_stops (route_id, seq, stop_time, address, gate)
  select r5.id, v.seq, v.stop_time, v.address, v.gate
  from r5, (values
    (0, null, '서초구 반포대로 275 래미안퍼스티지 121동', null),
    (1, '8:35', '서초구 반포대로 275 래미안퍼스티지 113동', null),
    (2, '8:35', '서초구 반포대로 275 래미안 퍼스티지 119동 주이솔', null),
    (3, '8:36', '서초구 반포대로 275 래미안 퍼스티지 117동 정서우', null),
    (4, '8:36', '서초구 반포대로 275 래미안퍼스티지 110동', null),
    (5, '8:37', '서초구 반포대로 275 래미안퍼스티지 111동', null),
    (6, '8:44', '서초구 신반포로 15길 19 아크로리버파크 113동', null),
    (7, '8:45', '서초구 신반포로 15길 19 아크로리버파크 103동', null),
    (8, '8:45', '서초구 신반포로 15길 1 래미안 원펜타스 105동', null),
    (9, '8:46', '서초구 신반포로 15길 1 래미안 원펜타스', null),
    (10, '8:54', '서초구 신반포로 23길 23 반포르엘 1차 105동', null)
  ) as v(seq, stop_time, address, gate)
  returning id, seq
)
insert into shuttle_assignments (stop_id, student_name_raw, class_raw, weekdays, guardian_phone)
select s5.id, a.name, a.klass, a.wd, a.phone
from s5, (values
    (0, '전수정', '4 Sparrow', '{1,2,3,4,5}'::int[], '010-3050-8681'),
    (1, '유태우', '7 Crane', '{1,2,3,4,5}'::int[], '010-6809-6678'),
    (2, '주다솔', 'Swan/', '{1,2,3,4,5}'::int[], '010-2229-3639'),
    (3, '정서원', '3 Robin', '{1,2,3,4,5}'::int[], '010-9095-4522'),
    (4, '최희윤', '7 Albatross', '{1,2,3,4,5}'::int[], '010-5409-6694'),
    (5, '조안나', '6 Owl', '{1,2,3,4,5}'::int[], '010-3562-4610'),
    (6, '노윤우', '4 Sparrow', '{1,2,3,4,5}'::int[], '010-9196-2876'),
    (7, '김지수', '5 Falcon', '{1,2,3,4,5}'::int[], '010-9212-0714'),
    (8, '김태민', '4 Dove', '{1,2,3,4,5}'::int[], '010-3387-1370'),
    (9, '이도현', '7 Eagle', '{1,2,3,4,5}'::int[], '010-2218-6878'),
    (10, '김윤우', 'Goldfinch 4', '{1,2,3,4,5}'::int[], '010-3389-2511')
) as a(seq, name, klass, wd, phone)
where s5.seq = a.seq;

with r6 as (
  insert into shuttle_routes (direction, route_no, name, driver_name, driver_phone, teacher_name, teacher_phone, depart_time, sort_order)
  values ('등원', '5', '반포3', '박광득', '010-3256-6014', '이정은  (외부)', '010-3661-1586', '08:00', 6)
  returning id
)
, s6 as (
  insert into shuttle_stops (route_id, seq, stop_time, address, gate)
  select r6.id, v.seq, v.stop_time, v.address, v.gate
  from r6, (values
    (0, null, '서초구 서초중앙로 220 반포래미안아이파크 107동', null),
    (1, '8:43', '서초구 서초중앙로 220 반포래미안아이파크 106동', null),
    (2, '8:43', '서초구 사평대로 240 반포미도 2차 503동', null),
    (3, '8:43', '서초구 잠원로8길 35 래미안신반포팰리스 106동', null),
    (4, '9:00', '서초구 잠원로8길 35 래미안신반포팰리스 107동', null),
    (5, '9:00', '서초구 잠원로8길 35 래미안신반포팰리스 107동', null)
  ) as v(seq, stop_time, address, gate)
  returning id, seq
)
insert into shuttle_assignments (stop_id, student_name_raw, class_raw, weekdays, guardian_phone)
select s6.id, a.name, a.klass, a.wd, a.phone
from s6, (values
    (0, '박지안', '5 Toucan', '{1,2,3,4,5}'::int[], '010-2075-4171'),
    (1, '신유준', '7 Eagle', '{1,2,3,4,5}'::int[], '010-3524-5200'),
    (2, '조시헌', '5 Nightingale', '{1,2,3,4,5}'::int[], '010-8793-1633'),
    (3, '임서진', '6 Kite', '{1,2,3,4,5}'::int[], '010-9145-8817'),
    (4, '황아림', '6 Kite', '{1,2,3,4,5}'::int[], '010-7736-0569'),
    (5, '최한빈', '5 Starling', '{1,2,3,4,5}'::int[], '010-9593-6527')
) as a(seq, name, klass, wd, phone)
where s6.seq = a.seq;

with r7 as (
  insert into shuttle_routes (direction, route_no, name, driver_name, driver_phone, teacher_name, teacher_phone, depart_time, sort_order)
  values ('등원', '6', '서초1', '엄영희', '010-8216-5146', '김다운 Bona', '010-8350-1843', '08:00', 7)
  returning id
)
, s7 as (
  insert into shuttle_stops (route_id, seq, stop_time, address, gate)
  select r7.id, v.seq, v.stop_time, v.address, v.gate
  from r7, (values
    (0, '8:28', '서초구 효령로68길 33 서초아이파크 102동 홍한울', null),
    (1, '8:28', '102동', null),
    (2, '8:33', '서초그랑자이 101동 송도휘', null),
    (3, '8:33', '103동', null),
    (4, '8:33', '101동', null),
    (5, '8:33', '101동', null),
    (6, '8:38', '서초래미안리더스원 104동 서초래미안리더스원', null),
    (7, '8:38', '104동', null),
    (8, '8:38', '111동', null),
    (9, '8:38', '서초구 서운로 107 래미안에스티지', null),
    (10, '8:45', '서초래미안에스티지에스 204동 임세나', null)
  ) as v(seq, stop_time, address, gate)
  returning id, seq
)
insert into shuttle_assignments (stop_id, student_name_raw, class_raw, weekdays, guardian_phone)
select s7.id, a.name, a.klass, a.wd, a.phone
from s7, (values
    (0, '홍한결', '7 Crane/ 7 Emu', '{1,2,3,4,5}'::int[], '010-8988-0618'),
    (1, '국서호', '5 Wren', '{1,2,3,4,5}'::int[], '010-9261-4108'),
    (2, '송도아', '5 Parrot/ 3Robin', '{1,2,3,4,5}'::int[], '010-5251-0420'),
    (3, '김선후', '4 Pelican', '{1,2,3,4,5}'::int[], '010-9002-5695'),
    (4, '박서연', '6 Seahawk', '{1,2,3,4,5}'::int[], '010-9695-3570'),
    (5, '이솔', '4 Magpie', '{1,2,3,4,5}'::int[], '010-6750-2410'),
    (6, '김선아', '5 Parrot', '{1,2,3,4,5}'::int[], '010-2499-0282'),
    (7, '박시아', '5 Falcon', '{1,2,3,4,5}'::int[], '010-3280-6767'),
    (8, '정주원', '5 Starling', '{1,2,3,4,5}'::int[], '010-8960-7552'),
    (9, '강리안', 'Emu 7', '{1,2,3,4,5}'::int[], '010-9608-0149'),
    (10, '임동하', '6 Swan/ 3 Kiwi', '{1,2,3,4,5}'::int[], '010-9901-7999')
) as a(seq, name, klass, wd, phone)
where s7.seq = a.seq;

with r8 as (
  insert into shuttle_routes (direction, route_no, name, driver_name, driver_phone, teacher_name, teacher_phone, depart_time, sort_order)
  values ('등원', '7', '서초2', '김진현', '010-3818-0095', '임지연 Winnie', '010-3934-9429', '08:00', 8)
  returning id
)
, s8 as (
  insert into shuttle_stops (route_id, seq, stop_time, address, gate)
  select r8.id, v.seq, v.stop_time, v.address, v.gate
  from r8, (values
    (0, null, '서초구 서운로 197 롯데캐슬 106-1202 이지오', null),
    (1, null, '서초구 서운로 201 푸르지오써밋 지하 1차 104-1005', null),
    (2, null, null, null),
    (3, null, '서초구 강남대로 455 강남태영데시앙루브 B동', null),
    (4, null, '서초구 서운로 221 래미안 서초스위트 103동', null)
  ) as v(seq, stop_time, address, gate)
  returning id, seq
)
insert into shuttle_assignments (stop_id, student_name_raw, class_raw, weekdays, guardian_phone)
select s8.id, a.name, a.klass, a.wd, a.phone
from s8, (values
    (0, '이재니', '6 Emu/ 4 Dove', '{1,2,3,4,5}'::int[], '010-3872-5326'),
    (1, '이도호', '7 Albatross', '{1,2,3,4,5}'::int[], '010-5342-3659'),
    (2, '최윤정', '6 Owl', '{1,2,3,4,5}'::int[], '010-3919-2102'),
    (3, '서엘린', '3 Skylark', '{1,2,3,4,5}'::int[], '010-9310-6934'),
    (4, '강리안B', '5 Cardinal', '{1,2,3,4,5}'::int[], '010-6543-1465')
) as a(seq, name, klass, wd, phone)
where s8.seq = a.seq;

with r9 as (
  insert into shuttle_routes (direction, route_no, name, driver_name, driver_phone, teacher_name, teacher_phone, depart_time, sort_order)
  values ('등원', '8', '방배', '양월한', '010-5247-7492', '김영서 Bay', '010-8518-7522', '08:00', 9)
  returning id
)
, s9 as (
  insert into shuttle_stops (route_id, seq, stop_time, address, gate)
  select r9.id, v.seq, v.stop_time, v.address, v.gate
  from r9, (values
    (0, '8:35', '서초구 방배동 467-20', null),
    (1, '8:43', '동작구 사당로 300 이수 자이 101동', null),
    (2, '8:50', '서초구 방배로1길 9 방배신동아럭스빌 1301호', null),
    (3, '8:55', '서초구 반포대로 58 서초아트자이 104동', null),
    (4, '9:02', '서초구 사임당로 17길 116 서초삼성래미안 101동', null),
    (5, '9:02', '서초구 서초중앙로 24길 33 서초교대 e편한세상 105동', null),
    (6, '9:08', '서초구 서초중앙로 24길 33 서초교대 e편한세상 105동', null)
  ) as v(seq, stop_time, address, gate)
  returning id, seq
)
insert into shuttle_assignments (stop_id, student_name_raw, class_raw, weekdays, guardian_phone)
select s9.id, a.name, a.klass, a.wd, a.phone
from s9, (values
    (0, '김로이A', '6 Flamingo', '{1,2,3,4,5}'::int[], '010-2588-4452'),
    (1, '김호윤', '3 Skylark', '{1,2,3,4,5}'::int[], '010-4701-2888'),
    (2, '오로라', '5 Wren', '{1,2,3,4,5}'::int[], '010-9200-0130'),
    (3, '윤아인', '4 Goldfinch', '{1,2,3,4,5}'::int[], '010-7121-0483'),
    (4, '신지수', '4 Dove', '{1,2,3,4,5}'::int[], '010-9500-7199'),
    (5, '편해율', '5 Cardinal', '{1,2,3,4,5}'::int[], '010-6483-2316'),
    (6, '진리안', '6 Seahawk', '{1,2,3,4,5}'::int[], '010-2088-4556')
) as a(seq, name, klass, wd, phone)
where s9.seq = a.seq;

with r10 as (
  insert into shuttle_routes (direction, route_no, name, driver_name, driver_phone, teacher_name, teacher_phone, depart_time, sort_order)
  values ('등원', '9', '흑석', '허장섭', '010-3749-2878', '김종희', '010-2991-3806', '08:00', 10)
  returning id
)
, s10 as (
  insert into shuttle_stops (route_id, seq, stop_time, address, gate)
  select r10.id, v.seq, v.stop_time, v.address, v.gate
  from r10, (values
    (0, '8:20', '동작구 흑석한강로 27 흑석푸르지오 101동', null),
    (1, '8:20', '동작구 동작대로 41길 10 미양하이츠', null),
    (2, '8:40', '서초구 방배중앙로 204 방배리첸시아', null),
    (3, '8:40', '원페를라 103동', null),
    (4, '8:50', '원페를라 202동', null)
  ) as v(seq, stop_time, address, gate)
  returning id, seq
)
insert into shuttle_assignments (stop_id, student_name_raw, class_raw, weekdays, guardian_phone)
select s10.id, a.name, a.klass, a.wd, a.phone
from s10, (values
    (0, '전하루', '5 Starling', '{1,2,3,4,5}'::int[], '010-7140-9041'),
    (1, '김시아', '3 Kiwi', '{1,2,3,4,5}'::int[], '010-2125-2108'),
    (2, '양우진', '6 Swan', '{1,2,3,4,5}'::int[], '010-9069-0095'),
    (3, '김단우', '7 Albatross', '{1,2,3,4,5}'::int[], '010-8582-7165'),
    (4, '김유건', '5 Nightingale', '{1,2,3,4,5}'::int[], '010-3601-5175')
) as a(seq, name, klass, wd, phone)
where s10.seq = a.seq;

with r11 as (
  insert into shuttle_routes (direction, route_no, name, driver_name, driver_phone, teacher_name, teacher_phone, depart_time, sort_order)
  values ('등원', '9-1', '서초', '정홍균', '010-3690-7263', '박인숙', '010-7360-6880', '08:00', 11)
  returning id
)
, s11 as (
  insert into shuttle_stops (route_id, seq, stop_time, address, gate)
  select r11.id, v.seq, v.stop_time, v.address, v.gate
  from r11, (values
    (0, '8:40', '서초구 서초중앙로 15 현대슈퍼빌', null),
    (1, '8:50', '서초구 서초대로 38길 12 마제스타 힐스테이트 101동', null),
    (2, '8:50', '서초구 서초대로 65길 13-10 서초래미안 105동 1701호 임세나', null),
    (3, '8:50', '강남구 논현동 55 스위트캐슬', null)
  ) as v(seq, stop_time, address, gate)
  returning id, seq
)
insert into shuttle_assignments (stop_id, student_name_raw, class_raw, weekdays, guardian_phone)
select s11.id, a.name, a.klass, a.wd, a.phone
from s11, (values
    (0, '김채희', '4 Sparrow', '{1,2,3,4,5}'::int[], '010-9152-4378'),
    (1, '최유진', '5 Cardinal', '{1,2,3,4,5}'::int[], '010-5223-1709'),
    (2, '임동하', '6 Swan/3 Kiwi', '{1,2,3,4,5}'::int[], '010-9901-7999'),
    (3, '박리온', 'Flamingo 6', '{1,2,3,4,5}'::int[], '010-7111-4039')
) as a(seq, name, klass, wd, phone)
where s11.seq = a.seq;

with r12 as (
  insert into shuttle_routes (direction, route_no, name, driver_name, driver_phone, teacher_name, teacher_phone, depart_time, sort_order)
  values ('등원', '10', '서래마을', null, '010-9130-0547', '조은애 Chloe', '010-3905-1941', '08:00', 12)
  returning id
)
, s12 as (
  insert into shuttle_stops (route_id, seq, stop_time, address, gate)
  select r12.id, v.seq, v.stop_time, v.address, v.gate
  from r12, (values
    (0, null, '서초구 서초대로 33길 71', null),
    (1, null, '서초구 방배동 1-58', null),
    (2, null, '서초구 방배동 1-12 유림빌라', null),
    (3, null, '서초구 동광로27길 14', null),
    (4, null, '서초구 방배로42길 65', null),
    (5, null, '서초구 반포동 82-5', null),
    (6, null, '서초구 서래로8길 30', null)
  ) as v(seq, stop_time, address, gate)
  returning id, seq
)
insert into shuttle_assignments (stop_id, student_name_raw, class_raw, weekdays, guardian_phone)
select s12.id, a.name, a.klass, a.wd, a.phone
from s12, (values
    (0, '김지원', '6 Owl', '{1,2,3,4,5}'::int[], '010-2522-0119'),
    (1, '노희권', '7 Peacock', '{1,2,3,4,5}'::int[], '010-2909-2246'),
    (2, '신보석', '7 Peacock', '{1,2,3,4,5}'::int[], '010-4714-0729'),
    (3, '김이선', 'Swan 7', '{1,2,3,4,5}'::int[], '010-5384-2021'),
    (4, '김태은A', '7 Emu', '{1,2,3,4,5}'::int[], '010-4504-9451'),
    (5, '이우현', '3 Skylark', '{1,2,3,4,5}'::int[], '010-5416-9656'),
    (6, '김조이', '6 Seahawk', '{1,2,3,4,5}'::int[], '010-4787-6876')
) as a(seq, name, klass, wd, phone)
where s12.seq = a.seq;

with r13 as (
  insert into shuttle_routes (direction, route_no, name, driver_name, driver_phone, teacher_name, teacher_phone, depart_time, sort_order)
  values ('등원', '11', '용산/이태원', '송영기', '010-3899-3936', '나정희 Jen', '010-2886-2212', '08:00', 13)
  returning id
)
, s13 as (
  insert into shuttle_stops (route_id, seq, stop_time, address, gate)
  select r13.id, v.seq, v.stop_time, v.address, v.gate
  from r13, (values
    (0, '8:37', '서초구 반포대로 333 래미안 원베일리 113동', null),
    (1, '8:37', '서초구 반포대로 333 래미안 원베일리 106동', null),
    (2, '8:39', '서초구 반포대로 333 래미안 원베일리 106동', null),
    (3, '8:40', '서초구 반포대로 333 래미안 원베일리 105동', null),
    (4, '8:41', '서초구 반포대로 333 래미안 원베일리 103동 전우현', null),
    (5, '8:42', '서초구 반포대로 333 래미안 원베일리 104동', null),
    (6, '8:43', '서초구 반포대로 333 래미안 원베일리 117동', null),
    (7, '8:45', '서초구 반포대로 333 래미안 원베일리 118동', null)
  ) as v(seq, stop_time, address, gate)
  returning id, seq
)
insert into shuttle_assignments (stop_id, student_name_raw, class_raw, weekdays, guardian_phone)
select s13.id, a.name, a.klass, a.wd, a.phone
from s13, (values
    (0, '신제이', '5 Toucan', '{1,2,3,4,5}'::int[], '010-5115-5165'),
    (1, '박채린', '6 Kite', '{1,2,3,4,5}'::int[], '010-7110-8584'),
    (2, '김규민', '4 Magpie', '{1,2,3,4,5}'::int[], '010-6618-6277'),
    (3, '권태훈', '4 Goldfinch', '{1,2,3,4,5}'::int[], '010-2021-5037'),
    (4, '전우진', '6 Flamingo/4 Magpie', '{1,2,3,4,5}'::int[], '010-3466-1064'),
    (5, '허은서', '6 Swan', '{1,2,3,4,5}'::int[], '010-6886-0213'),
    (6, '김서진A', '5 Toucan', '{1,2,3,4,5}'::int[], '010-7115-0800'),
    (7, '오윤', '6 Kite', '{1,2,3,4,5}'::int[], '010-9100-1717')
) as a(seq, name, klass, wd, phone)
where s13.seq = a.seq;

with r14 as (
  insert into shuttle_routes (direction, route_no, name, driver_name, driver_phone, teacher_name, teacher_phone, depart_time, sort_order)
  values ('등원', '12', '한남/논현', '김상진', '010-3790-7933', '임재인 Jane', '010-4045-8399', '08:00', 14)
  returning id
)
, s14 as (
  insert into shuttle_stops (route_id, seq, stop_time, address, gate)
  select r14.id, v.seq, v.stop_time, v.address, v.gate
  from r14, (values
    (0, null, '용산구 녹사평대로 46길 84 마운틴뷰', null),
    (1, null, '용산구 한남동 809 대성 이태리하우스', null),
    (2, null, '강남구 논현동 22 논현아파트 101동', null),
    (3, null, '강남구 논현동 22 논현아파트 102동', null),
    (4, null, '강남구 논현동 22 논현아파트 105동', null),
    (5, null, '강남구 학동로11길 13 브라운스톤 유소이', null)
  ) as v(seq, stop_time, address, gate)
  returning id, seq
)
insert into shuttle_assignments (stop_id, student_name_raw, class_raw, weekdays, guardian_phone)
select s14.id, a.name, a.klass, a.wd, a.phone
from s14, (values
    (0, '지젤', '7 Emu', '{1,2,3,4,5}'::int[], '010-5302-2929'),
    (1, '김이준B', '5 Parrot', '{1,2,3,4,5}'::int[], '010-2772-2018'),
    (2, '김아론', '7 Emu', '{1,2,3,4,5}'::int[], '010-6802-1105'),
    (3, '박태린', '3 Robin', '{1,2,3,4,5}'::int[], '010-6414-1640'),
    (4, '권사윤', '4 Dove', '{1,2,3,4,5}'::int[], '010-4206-4221'),
    (5, '유채이', '7 Emu/ 5 Falcon', '{1,2,3,4,5}'::int[], '010-4181-3216')
) as a(seq, name, klass, wd, phone)
where s14.seq = a.seq;

with r15 as (
  insert into shuttle_routes (direction, route_no, name, driver_name, driver_phone, teacher_name, teacher_phone, depart_time, sort_order)
  values ('등원', '13', '이촌', '이정복', '010-4745-1047', '박예림 Rayna', '010-3342-2155', '08:00', 15)
  returning id
)
, s15 as (
  insert into shuttle_stops (route_id, seq, stop_time, address, gate)
  select r15.id, v.seq, v.stop_time, v.address, v.gate
  from r15, (values
    (0, null, '용산구 서빙고로 17 센트럴파크해링턴스퀘어 101동', null),
    (1, '8:40', '5월부터 용산구 서빙고로 35 용산시티파크 103동', null),
    (2, '8:45', '용산구 이촌로 174 동부센트레빌 102동', null),
    (3, '8:45', '용산구 이촌로71길 10 한가람아파트 210동 (주민센터앞 )', null),
    (4, '8:50', '용산구 이촌로71길 10 한가람아파트 212동', null),
    (5, '8:55', '용산구 이촌로 310 첼리투스 103동', null)
  ) as v(seq, stop_time, address, gate)
  returning id, seq
)
insert into shuttle_assignments (stop_id, student_name_raw, class_raw, weekdays, guardian_phone)
select s15.id, a.name, a.klass, a.wd, a.phone
from s15, (values
    (0, '정윤서', '6 Kite', '{1,2,3,4,5}'::int[], '010-8795-1121'),
    (1, '박제이', '3 Kiwi', '{1,2,3,4,5}'::int[], '010-3952-1025'),
    (2, '하이안', '4 Pelican', '{1,2,3,4,5}'::int[], '010-6797-4401'),
    (3, '서인우', '7 Albatorss', '{1,2,3,4,5}'::int[], '010-9407-2104'),
    (4, '김권', '5 Parrot', '{1,2,3,4,5}'::int[], '010-3686-3978'),
    (5, '여이서', '4 Sparrow', '{1,2,3,4,5}'::int[], '010-8896-7130')
) as a(seq, name, klass, wd, phone)
where s15.seq = a.seq;

with r16 as (
  insert into shuttle_routes (direction, route_no, name, driver_name, driver_phone, teacher_name, teacher_phone, depart_time, sort_order)
  values ('등원', '14', '용산', '이창구', '010-5137-3597', null, null, '08:00', 16)
  returning id
)
select * from r16;

with r17 as (
  insert into shuttle_routes (direction, route_no, name, driver_name, driver_phone, teacher_name, teacher_phone, depart_time, sort_order)
  values ('등원', '15', '옥수1', '이종근', '010-3335-1591', '김민지', '010-9488-0938', '08:00', 17)
  returning id
)
, s17 as (
  insert into shuttle_stops (route_id, seq, stop_time, address, gate)
  select r17.id, v.seq, v.stop_time, v.address, v.gate
  from r17, (values
    (0, null, '성동구 매봉길 24 금호브라운스톤아파트 103동', null),
    (1, null, '성동구 매봉길 50 옥수파크힐스 116동', null),
    (2, null, '성동구 매봉길 50 옥수파크힐스 114동', null),
    (3, '8:40-47', '성동구 매봉길 50 옥수파크힐스 114동', null),
    (4, '8:40-47', '성동구 매봉길 50 옥수파크힐스 104동', null),
    (5, '8:40-47', '성동구 매봉길 50 옥수파크힐스 109동', null),
    (6, '8:40-47', '성동구 매봉길 15 래미안 리버젠 108동', null),
    (7, '9:10', '강남구 압구정로 151 신현대 116동', null)
  ) as v(seq, stop_time, address, gate)
  returning id, seq
)
insert into shuttle_assignments (stop_id, student_name_raw, class_raw, weekdays, guardian_phone)
select s17.id, a.name, a.klass, a.wd, a.phone
from s17, (values
    (0, '이유하A', '6 Flamingo', '{1,2,3,4,5}'::int[], '010-9755-3911'),
    (1, '조아정', '5 Cardinal', '{1,2,3,4,5}'::int[], '010-6667-8952'),
    (2, '심지민', '5 Parrot', '{1,2,3,4,5}'::int[], '010-7794-4865'),
    (3, '권하린', '7 Carne', '{1,2,3,4,5}'::int[], '010-4555-8103'),
    (4, '천리안', '5 Toucan', '{1,2,3,4,5}'::int[], '010-9214-1532'),
    (5, '배윤', '7 Eagle', '{1,2,3,4,5}'::int[], '010-5174-4723'),
    (6, '이수호', '6 Swan', '{1,2,3,4,5}'::int[], '010-4993-9586'),
    (7, '이하윤', '4 Pelican', '{1,2,3,4,5}'::int[], '010-6634-4085')
) as a(seq, name, klass, wd, phone)
where s17.seq = a.seq;

with r18 as (
  insert into shuttle_routes (direction, route_no, name, driver_name, driver_phone, teacher_name, teacher_phone, depart_time, sort_order)
  values ('등원', '15-1', '옥수2', '이장복', '010-3234-7443', '곽수린 Rebecca', '010-9578-0091', '08:00', 18)
  returning id
)
, s18 as (
  insert into shuttle_stops (route_id, seq, stop_time, address, gate)
  select r18.id, v.seq, v.stop_time, v.address, v.gate
  from r18, (values
    (0, null, '용산구 독서당로 111 한남더힐 124동', null),
    (1, '8:35', '용산구 유엔빌리지길 3길 2-24 한강빌라', null),
    (2, '8:38', '용산구 한남동 15-12 코번하우스', null),
    (3, '8:45', '성동구 독서당로 154 레미테지', null)
  ) as v(seq, stop_time, address, gate)
  returning id, seq
)
insert into shuttle_assignments (stop_id, student_name_raw, class_raw, weekdays, guardian_phone)
select s18.id, a.name, a.klass, a.wd, a.phone
from s18, (values
    (0, '서아루', '7 Albatross', '{1,2,3,4,5}'::int[], '010-5221-1275'),
    (1, '현이나', '5 Wren', '{1,2,3,4,5}'::int[], '010-6862-0669'),
    (2, '유시연', '7 Albatross', '{1,2,3,4,5}'::int[], '010-8786-0409'),
    (3, '정조이', '7 Albatross', '{1,2,3,4,5}'::int[], '010-9271-5770')
) as a(seq, name, klass, wd, phone)
where s18.seq = a.seq;

with r19 as (
  insert into shuttle_routes (direction, route_no, name, driver_name, driver_phone, teacher_name, teacher_phone, depart_time, sort_order)
  values ('등원', '16', '금호', '문병혁', '010-3015-5767', '추수미 Sumi', '010-8212-5527', '08:00', 19)
  returning id
)
, s19 as (
  insert into shuttle_stops (route_id, seq, stop_time, address, gate)
  select r19.id, v.seq, v.stop_time, v.address, v.gate
  from r19, (values
    (0, '8:40', '성동구 행당로 82 행당한진 아파트 110동', null),
    (1, '8:45', '성동구 금호로 173 신금호파크자이 101동', null),
    (2, '8:45', '성동구 금호로 140 금호파크힐스 112동', null),
    (3, '8:50', '성동구 금호로 140 금호파크힐스 103동', null),
    (4, '8:50', '성동구 금호로 140 금호파크힐스 107-1204', null)
  ) as v(seq, stop_time, address, gate)
  returning id, seq
)
insert into shuttle_assignments (stop_id, student_name_raw, class_raw, weekdays, guardian_phone)
select s19.id, a.name, a.klass, a.wd, a.phone
from s19, (values
    (0, '선해린', '5 Wren', '{1,2,3,4,5}'::int[], '010-8506-4477'),
    (1, '김서진B', '5 Falcon', '{1,2,3,4,5}'::int[], '010-4535-7355'),
    (2, '최이서', '6 Swan', '{1,2,3,4,5}'::int[], '010-7543-0643'),
    (3, '황은우', '5 Toucan', '{1,2,3,4,5}'::int[], '010-9344-6629'),
    (4, '이주환', '5 Wren', '{1,2,3,4,5}'::int[], '010-5236-7516')
) as a(seq, name, klass, wd, phone)
where s19.seq = a.seq;

with r20 as (
  insert into shuttle_routes (direction, route_no, name, driver_name, driver_phone, teacher_name, teacher_phone, depart_time, sort_order)
  values ('등원', '17', '서울숲1', '이종수', '010-5398-2343', '김주현 Julie', '010-4160-2474', '08:00', 20)
  returning id
)
, s20 as (
  insert into shuttle_stops (route_id, seq, stop_time, address, gate)
  select r20.id, v.seq, v.stop_time, v.address, v.gate
  from r20, (values
    (0, null, '성동구 옥수동 100 옥수하이츠', null),
    (1, '8:45', '성동구 독서당로 272 금호대우아파트 106동', null),
    (2, '8:45', '성동구 독서당로 344 힐스테이트서울숲리버 101-602 (후문주차장 )', null),
    (3, '8:50', '성동구 독서당로 344 힐스테이트서울숲리버 106-601', null),
    (4, '9:00', '성동구 독서당로 40길 37 옥수어울림 101동', null)
  ) as v(seq, stop_time, address, gate)
  returning id, seq
)
insert into shuttle_assignments (stop_id, student_name_raw, class_raw, weekdays, guardian_phone)
select s20.id, a.name, a.klass, a.wd, a.phone
from s20, (values
    (0, '정이나', '6 Seahawk', '{1,2,3,4,5}'::int[], '010-8631-4739'),
    (1, '이해나', '6 Owl', '{1,2,3,4,5}'::int[], '010-8780-9091'),
    (2, '이건우', '6 Swan', '{1,2,3,4,5}'::int[], '010-9934-4029'),
    (3, '류재이', '5 Wren', '{1,2,3,4,5}'::int[], '010-4196-1404'),
    (4, '최이든', '6 Flamingo', '{1,2,3,4,5}'::int[], '010-3719-1532')
) as a(seq, name, klass, wd, phone)
where s20.seq = a.seq;

with r21 as (
  insert into shuttle_routes (direction, route_no, name, driver_name, driver_phone, teacher_name, teacher_phone, depart_time, sort_order)
  values ('등원', '18', '서울숲2', '이남희', '010-7701-2481', '이서우 Jane', '010-8318-8600', '08:00', 21)
  returning id
)
, s21 as (
  insert into shuttle_stops (route_id, seq, stop_time, address, gate)
  select r21.id, v.seq, v.stop_time, v.address, v.gate
  from r21, (values
    (0, '8:40', '성동구 성수이로 137 성수동아이파크 107동', null),
    (1, '8:40', '성동구 성수동 2가 843번지 서울숲힐스테이트 101동', null),
    (2, '8:45', '성동구 성수동 2가 843번지 서울숲힐스테이트 101동', null),
    (3, '8:45', '성동구 성수일로 4길 26 서울숲 힐스테이트 101동', null),
    (4, '8:45', '9월부터 성동구 왕십리로 16 트리마제 104동', null),
    (5, '8:55', '성동구 왕십리로 83-21 아크로 서울포레스트 A동', null),
    (6, '8:58', '성동구 서울숲 32-14 갤러리아포레 101동', null)
  ) as v(seq, stop_time, address, gate)
  returning id, seq
)
insert into shuttle_assignments (stop_id, student_name_raw, class_raw, weekdays, guardian_phone)
select s21.id, a.name, a.klass, a.wd, a.phone
from s21, (values
    (0, '조수아', '5 Nightingale', '{1,2,3,4,5}'::int[], '010-6861-7698'),
    (1, '황이솔', '6 Flamingo', '{1,2,3,4,5}'::int[], '010-3362-7340'),
    (2, '정유하', '4 Dove', '{1,2,3,4,5}'::int[], '010-2491-3202'),
    (3, '박지아', '3 Skylark', '{1,2,3,4,5}'::int[], '010-4057-6575'),
    (4, '신이안', '3 Robin', '{1,2,3,4,5}'::int[], '010-6530-4896'),
    (5, '이리호', '5 Wren', '{1,2,3,4,5}'::int[], '010-2726-3698'),
    (6, '이태오', '6 Owl', '{1,2,3,4,5}'::int[], '010-8523-8610')
) as a(seq, name, klass, wd, phone)
where s21.seq = a.seq;

with r22 as (
  insert into shuttle_routes (direction, route_no, name, driver_name, driver_phone, teacher_name, teacher_phone, depart_time, sort_order)
  values ('등원', '18-1', '서울숲3', '이순신', '010-3215-4570', '최푸름 Kate', '010-4845-7949', '08:00', 22)
  returning id
)
, s22 as (
  insert into shuttle_stops (route_id, seq, stop_time, address, gate)
  select r22.id, v.seq, v.stop_time, v.address, v.gate
  from r22, (values
    (0, null, '성북구 보문로29다길 31 삼선대우푸르지오', null),
    (1, null, '성동구 왕십리로 241 서울숲 더샵 103동', null),
    (2, null, '성동구 왕십리로 241 서울숲 더샵 101동 고유안', null),
    (3, null, '성동구 왕십리로 241 서울숲 더샵 102동', null),
    (4, null, '서울숲아이파크리버포레 2차', null)
  ) as v(seq, stop_time, address, gate)
  returning id, seq
)
insert into shuttle_assignments (stop_id, student_name_raw, class_raw, weekdays, guardian_phone)
select s22.id, a.name, a.klass, a.wd, a.phone
from s22, (values
    (0, '이유하B', '3 Robin', '{1,2,3,4,5}'::int[], '010-4845-7949'),
    (1, '김태오', '5 Falcon', '{1,2,3,4,5}'::int[], '010-9476-3302'),
    (2, '고유민', '7Peacock/5Wren', '{1,2,3,4,5}'::int[], '010-4720-2881'),
    (3, '황희', '5Falcon', '{1,2,3,4,5}'::int[], '010-6669-5364'),
    (4, '신주오', '6Flamingo', '{1,2,3,4,5}'::int[], '010-6206-5308')
) as a(seq, name, klass, wd, phone)
where s22.seq = a.seq;

with r23 as (
  insert into shuttle_routes (direction, route_no, name, driver_name, driver_phone, teacher_name, teacher_phone, depart_time, sort_order)
  values ('등원', '19', '건대/청담', '김남규', '010-5771-1358', '조향 Nicole', '010-7490-9888', '08:00', 23)
  returning id
)
, s23 as (
  insert into shuttle_stops (route_id, seq, stop_time, address, gate)
  select r23.id, v.seq, v.stop_time, v.address, v.gate
  from r23, (values
    (0, '8:45', '광진구 광나루로 369 광진두산위브파크', null),
    (1, '8:45', '광진구 아차산로 262 더샾스타시티 김이준', null),
    (2, '8:50', '광진구 아차산로 262 더샾스타시티 D동', null),
    (3, '8:55', '광진구 능동로4길 40 이튼리버타워 5차 B동', null)
  ) as v(seq, stop_time, address, gate)
  returning id, seq
)
insert into shuttle_assignments (stop_id, student_name_raw, class_raw, weekdays, guardian_phone)
select s23.id, a.name, a.klass, a.wd, a.phone
from s23, (values
    (0, '이서온', '6Seahawk', '{1,2,3,4,5}'::int[], '010-4766-3896'),
    (1, '김로이', '7Crane/5Toucan', '{1,2,3,4,5}'::int[], '010-2850-0064'),
    (2, '홍리아', '4Dove', '{1,2,3,4,5}'::int[], '010-8922-1076'),
    (3, '김리아', '7 Peacock', '{1,2,3,4,5}'::int[], '010-5161-2510')
) as a(seq, name, klass, wd, phone)
where s23.seq = a.seq;

with r24 as (
  insert into shuttle_routes (direction, route_no, name, driver_name, driver_phone, teacher_name, teacher_phone, depart_time, sort_order)
  values ('등원', '20', '청담 1', '정영민', '010-5261-2051', '쉴라 Shiela', '010-2965-2756', '08:00', 24)
  returning id
)
, s24 as (
  insert into shuttle_stops (route_id, seq, stop_time, address, gate)
  select r24.id, v.seq, v.stop_time, v.address, v.gate
  from r24, (values
    (0, '9:00', '강남구 학동로 607 청담르엘', null),
    (1, '9:00', '강남구 학동로 607 청담르엘', null),
    (2, '9:03', '강남구 영동대로 138길 12 청담자이아파트 104동(지하주차장 )', null),
    (3, '9:03', '강남구 영동대로 138길 12 청담자이아파트 104동(지하주차장 )', null),
    (4, '9:10', '강남구 청담동 54-5 더갤러리파크 101호 안라엘', null),
    (5, '9:12', '강남구 청담동 67-1 린든그로브 103동 최지아', null),
    (6, '9:17', '강남구 청담동 64-1 어퍼하우스', null),
    (7, '9:17', '강남구 삼성동 65-4 상지리츠빌 카일룸 4차', null),
    (8, '9:22', null, null),
    (9, '9:22', null, null)
  ) as v(seq, stop_time, address, gate)
  returning id, seq
)
insert into shuttle_assignments (stop_id, student_name_raw, class_raw, weekdays, guardian_phone)
select s24.id, a.name, a.klass, a.wd, a.phone
from s24, (values
    (0, '박세훈', '5Parrot', '{1,2,3,4,5}'::int[], '010-8013-0403'),
    (1, '염시후', '6 Flamingo', '{1,2,3,4,5}'::int[], '010-3685-1459'),
    (2, '장슬예', '7Crane', '{1,2,3,4,5}'::int[], '010-5671-3304'),
    (3, '김리하', '5Nightingale', '{1,2,3,4,5}'::int[], '010-3396-0727'),
    (4, '안리엘', '5Toucan', '{1,2,3,4,5}'::int[], '010-6216-6292'),
    (5, '최서아', '3 kiwi', '{1,2,3,4,5}'::int[], '010-3777-0669'),
    (6, '이정우', '7Peacock', '{1,2,3,4,5}'::int[], '010-9143-8857'),
    (7, '김우진', '5 Toucan', '{1,2,3,4,5}'::int[], '010-3115-4447'),
    (8, '박지우', '3 Skylark', '{1,2,3,4,5}'::int[], '010-2017-3233')
) as a(seq, name, klass, wd, phone)
where s24.seq = a.seq;

with r25 as (
  insert into shuttle_routes (direction, route_no, name, driver_name, driver_phone, teacher_name, teacher_phone, depart_time, sort_order)
  values ('등원', '20-1', '청담/압구정', '이재남', '010-9152-2429', '손희정 Nancy', '010-8513-7209', '08:00', 25)
  returning id
)
, s25 as (
  insert into shuttle_stops (route_id, seq, stop_time, address, gate)
  select r25.id, v.seq, v.stop_time, v.address, v.gate
  from r25, (values
    (0, '9:05', '강남구 도산대로 83길 35 대우리츠카운티', null),
    (1, '9:06', '강남구 청담동 117-6 대우로얄카운티 3차', null),
    (2, '9:09', '강남구 도산대로 85길 50-13 에테르노 1001호', null),
    (3, '9:13', '강남구 청담동 115-5', null),
    (4, '9:15', '강남구 청담동 102-2 연세힐하우스', null),
    (5, '9:17', '강남구 압구정로 75길 27 청담101 A동', null),
    (6, '9:18', '강남구 청담동 116', null)
  ) as v(seq, stop_time, address, gate)
  returning id, seq
)
insert into shuttle_assignments (stop_id, student_name_raw, class_raw, weekdays, guardian_phone)
select s25.id, a.name, a.klass, a.wd, a.phone
from s25, (values
    (0, '정유준', '7emu', '{1,2,3,4,5}'::int[], '010-9098-3886'),
    (1, '이서이', '5Magpie', '{1,2,3,4,5}'::int[], '010-4811-0563'),
    (2, '황주원', '5 Parrot', '{1,2,3,4,5}'::int[], '010-4137-1006'),
    (3, '배서준', '7 Emu', '{1,2,3,4,5}'::int[], '010-6749-7271'),
    (4, '김이안', '5 Falcon', '{1,2,3,4,5}'::int[], '010-4827-7754'),
    (5, '장유안', '4 Sparrow', '{1,2,3,4,5}'::int[], '010-9435-6770'),
    (6, '이유', '7Peacock/4Magpie', '{1,2,3,4,5}'::int[], '010-5224-1024'),
    (6, '이호', '7Peacock/4Magpie', '{1,2,3,4,5}'::int[], '010-5224-1024')
) as a(seq, name, klass, wd, phone)
where s25.seq = a.seq;

with r26 as (
  insert into shuttle_routes (direction, route_no, name, driver_name, driver_phone, teacher_name, teacher_phone, depart_time, sort_order)
  values ('등원', '20-2', '청담/압구정', '김동도  9:10 매일 강남구 청담동 청담파라곤 2차 2단지 안솔민 3 Goldfinch (모)', '010-3743-4125', '진미선 Autumn  9:18 매일 강남구 압구정로 71길 28 청담101 A동1 이아린 Chloe 4Dove (모)', '010-4485-1757', '08:00', 26)
  returning id
)
, s26 as (
  insert into shuttle_stops (route_id, seq, stop_time, address, gate)
  select r26.id, v.seq, v.stop_time, v.address, v.gate
  from r26, (values
    (0, '8:57', '강남구 영동대로 640 아이파크 101동', null),
    (1, '8:57', '강남구 영동대로 128길 15 아크로삼성', null),
    (2, '9:00', '강남구 영동대로 128길 15 아크로삼성', null),
    (3, '9:07', '강남구 도산대로 101길 29 청담현대 3차 104동', null),
    (4, '9:11', '강남구 압구정로 347 한양 25동', null),
    (5, '9:17', '강남구 논현로160길 20 장자울아파트', null),
    (6, '9:17', null, null),
    (7, '9:17', null, null),
    (8, '9:17', null, null)
  ) as v(seq, stop_time, address, gate)
  returning id, seq
)
insert into shuttle_assignments (stop_id, student_name_raw, class_raw, weekdays, guardian_phone)
select s26.id, a.name, a.klass, a.wd, a.phone
from s26, (values
    (0, '김채윤', '5Parrot', '{1,2,3,4,5}'::int[], '010-8916-9537'),
    (1, '이세령', '6 Swan', '{1,2,3,4,5}'::int[], '010-9256-2590'),
    (2, '심지훈', '7 Albatross', '{1,2,3,4,5}'::int[], '010-9866-2187'),
    (3, '우하린', '3Skylark', '{1,2,3,4,5}'::int[], '010-4222-8337'),
    (4, '유태정', '4 Pelican', '{1,2,3,4,5}'::int[], '010-7153-3903'),
    (5, '장하은', '7 Eagle', '{1,2,3,4,5}'::int[], '010-8782-8105')
) as a(seq, name, klass, wd, phone)
where s26.seq = a.seq;

with r27 as (
  insert into shuttle_routes (direction, route_no, name, driver_name, driver_phone, teacher_name, teacher_phone, depart_time, sort_order)
  values ('등원', '21', '청담3', '김명하', '010-4717-0375', null, null, '08:00', 27)
  returning id
)
, s27 as (
  insert into shuttle_stops (route_id, seq, stop_time, address, gate)
  select r27.id, v.seq, v.stop_time, v.address, v.gate
  from r27, (values
    (0, null, '강남구 도산대로 70길25 청담2차이편한세상', null),
    (1, '9:10', '강남구 삼성로147길 65 하우스에딘브로우 B동 정서호', null),
    (2, '9:15', '강남구 삼성로 651 래미안 라클래시 104동', null),
    (3, '9:18', '강남구 선릉로130길 19 서광아파트 101동', null),
    (4, '(서광아파트정문)', '강남구 선릉로130길 20 래미안삼성 2차 101동', null),
    (5, '9:23', '강남구 논현동 68-4 동승 선생님: 사바 Saba 010-9865-7550', null)
  ) as v(seq, stop_time, address, gate)
  returning id, seq
)
insert into shuttle_assignments (stop_id, student_name_raw, class_raw, weekdays, guardian_phone)
select s27.id, a.name, a.klass, a.wd, a.phone
from s27, (values
    (0, '이주아', '4Pelican', '{1,2,3,4,5}'::int[], '010-7336-7418'),
    (1, '정혜아', '7 Albatross/5Wren', '{1,2,3,4,5}'::int[], '010-2025-3888'),
    (2, '정도율', '5 Falcon', '{1,2,3,4,5}'::int[], '010-8698-1559'),
    (3, '장벨라', '3 Kiwi', '{1,2,3,4,5}'::int[], '010-9131-1651'),
    (4, '박제이', '3 Kiwi', '{1,2,3,4,5}'::int[], '010-7312-2563'),
    (5, '김태윤', '7 Peacock', '{1,2,3,4,5}'::int[], '010-7575-9503')
) as a(seq, name, klass, wd, phone)
where s27.seq = a.seq;

with r28 as (
  insert into shuttle_routes (direction, route_no, name, driver_name, driver_phone, teacher_name, teacher_phone, depart_time, sort_order)
  values ('등원', '22', '청담 1', '안용해', '010-4326-4094', '임주경 Luna', '010-5543-5646', '08:00', 28)
  returning id
)
, s28 as (
  insert into shuttle_stops (route_id, seq, stop_time, address, gate)
  select r28.id, v.seq, v.stop_time, v.address, v.gate
  from r28, (values
    (0, null, '강남구 삼성로 651 래미안 라클래시 103동', null),
    (1, '8:35', '강남구 삼성로 651 래미안 라클래시 103동', null),
    (2, '8:35', '강남구 학동로68길 30 중앙하이츠빌리지 조효리', null),
    (3, '8:40', '강남구 학동로68길 30 중앙하이츠빌리지 103동', null),
    (4, '8:43', '강남구 학동로68길 29 힐스테이트 1단지', null),
    (5, '8:49', '강남구 삼성로111길 8 힐스테이트 2단지 210동', null)
  ) as v(seq, stop_time, address, gate)
  returning id, seq
)
insert into shuttle_assignments (stop_id, student_name_raw, class_raw, weekdays, guardian_phone)
select s28.id, a.name, a.klass, a.wd, a.phone
from s28, (values
    (0, '김지유', '6 Seahawk', '{1,2,3,4,5}'::int[], '010-5295-5489'),
    (1, '김우주', '7 crane', '{1,2,3,4,5}'::int[], '010-6490-2988'),
    (2, '조우주', '7 emu / 6 kite', '{1,2,3,4,5}'::int[], '010-9779-3577'),
    (3, '정재이', '5 cardinal', '{1,2,3,4,5}'::int[], '010-9883-2650'),
    (4, '이시우', '7 eagle', '{1,2,3,4,5}'::int[], '010-3032-0527'),
    (5, '염시후', '6 flamingo', '{1,2,3,4,5}'::int[], '010-3685-1459')
) as a(seq, name, klass, wd, phone)
where s28.seq = a.seq;

with r29 as (
  insert into shuttle_routes (direction, route_no, name, driver_name, driver_phone, teacher_name, teacher_phone, depart_time, sort_order)
  values ('등원', '23', '헬리오/잠실', '홍순철', '010-6206-6422', '김수민 Soomin', '010-2221-5965', '08:00', 29)
  returning id
)
, s29 as (
  insert into shuttle_stops (route_id, seq, stop_time, address, gate)
  select r29.id, v.seq, v.stop_time, v.address, v.gate
  from r29, (values
    (0, '8:23', '송파구 송파대로 345 헬리오시티 517동', null),
    (1, '8:45', '강남구 봉은사로 111길 26 삼부아파트 101동', null)
  ) as v(seq, stop_time, address, gate)
  returning id, seq
)
insert into shuttle_assignments (stop_id, student_name_raw, class_raw, weekdays, guardian_phone)
select s29.id, a.name, a.klass, a.wd, a.phone
from s29, (values
    (0, '박새얀', '5 starling', '{1,2,3,4,5}'::int[], '010-9140-1924'),
    (1, '이유성', '5 starling', '{1,2,3,4,5}'::int[], '010-9686-5961')
) as a(seq, name, klass, wd, phone)
where s29.seq = a.seq;

with r30 as (
  insert into shuttle_routes (direction, route_no, name, driver_name, driver_phone, teacher_name, teacher_phone, depart_time, sort_order)
  values ('등원', '23-1', '잠실', null, null, null, null, '08:00', 30)
  returning id
)
, s30 as (
  insert into shuttle_stops (route_id, seq, stop_time, address, gate)
  select r30.id, v.seq, v.stop_time, v.address, v.gate
  from r30, (values
    (0, '8:18', '올림픽선수기자촌 (올림픽공원역 )', null),
    (1, '8:27', '송파구 백제고분로 39길 21', null)
  ) as v(seq, stop_time, address, gate)
  returning id, seq
)
insert into shuttle_assignments (stop_id, student_name_raw, class_raw, weekdays, guardian_phone)
select s30.id, a.name, a.klass, a.wd, a.phone
from s30, (values
    (0, '김태리', '7 Emu', '{1,2,3,4,5}'::int[], '010-3129-1495'),
    (1, '손예진', '6 seahawk', '{1,2,3,4,5}'::int[], '010-5206-1973')
) as a(seq, name, klass, wd, phone)
where s30.seq = a.seq;

with r31 as (
  insert into shuttle_routes (direction, route_no, name, driver_name, driver_phone, teacher_name, teacher_phone, depart_time, sort_order)
  values ('등원', '22', '청담4', '지덕삼', '010-5297-4462', '정성경 Mary', '010-5871-5980', '08:00', 31)
  returning id
)
select * from r31;

with r32 as (
  insert into shuttle_routes (direction, route_no, name, driver_name, driver_phone, teacher_name, teacher_phone, depart_time, sort_order)
  values ('등원', '24', '역삼', '이기수', '010-8996-6170', '윤지영 July', '010-3711-0841', '08:00', 32)
  returning id
)
, s32 as (
  insert into shuttle_stops (route_id, seq, stop_time, address, gate)
  select r32.id, v.seq, v.stop_time, v.address, v.gate
  from r32, (values
    (0, '8:45', '강남구 선릉로115길 39', null),
    (1, '8:50', '강남구 봉은사로 307 이안논현', null),
    (2, '8:54', '강남구 언주로122길 6 현대넥서스 어연우', null),
    (3, '8:57', '강남구 언주로122길 25 두산위브 201동', null),
    (4, '9:00', '강남구 언주로130길 30 동양파라곤 102동', null)
  ) as v(seq, stop_time, address, gate)
  returning id, seq
)
insert into shuttle_assignments (stop_id, student_name_raw, class_raw, weekdays, guardian_phone)
select s32.id, a.name, a.klass, a.wd, a.phone
from s32, (values
    (0, '조아윤', '6 kite', '{1,2,3,4,5}'::int[], '010-8080-3546'),
    (1, '최유주', '5 parrot', '{1,2,3,4,5}'::int[], '010-6592-2468'),
    (2, '어준우', '6 seahwak/4pelican', '{1,2,3,4,5}'::int[], '010-4453-3566'),
    (3, '유주아', '6starling', '{1,2,3,4,5}'::int[], '010-7297-9643'),
    (4, '이건서', '4 sparrow', '{1,2,3,4,5}'::int[], '010-7587-8852')
) as a(seq, name, klass, wd, phone)
where s32.seq = a.seq;

with r33 as (
  insert into shuttle_routes (direction, route_no, name, driver_name, driver_phone, teacher_name, teacher_phone, depart_time, sort_order)
  values ('등원', '25', '양재/강남', '김천석', '010-5496-5881', '양희자  4/7', '010-8651-6337', '08:00', 33)
  returning id
)
, s33 as (
  insert into shuttle_stops (route_id, seq, stop_time, address, gate)
  select r33.id, v.seq, v.stop_time, v.address, v.gate
  from r33, (values
    (0, '8:45', '강남구 도곡동 153-2 현대밸라하우스 8층', null),
    (1, '8:50', '강남구 논현로 213 역삼럭키아파트 103동 강수빈', null),
    (2, '9:00', '강남구 테헤란로 14길 41', null),
    (3, '9:00', '강남구 논현로71길 46 블루밍코트아파트 101동', null),
    (4, '9:05', '강남구 논현로115길 14 필스트빌딩', null),
    (5, '9:08', '강남구 논현로111길 39 논현한화꿈에그린 101동 김제이', null),
    (6, '9:08', null, null),
    (7, '9:12', '강남구 강남대로 128길 44 501호', null),
    (8, '9:15', '강남구 논현동 148-18', null)
  ) as v(seq, stop_time, address, gate)
  returning id, seq
)
insert into shuttle_assignments (stop_id, student_name_raw, class_raw, weekdays, guardian_phone)
select s33.id, a.name, a.klass, a.wd, a.phone
from s33, (values
    (0, '박윤솔', '7 Eagle', '{1,2,3,4,5}'::int[], '010-2250-5702'),
    (1, '강수현', '7crane/5starling', '{1,2,3,4,5}'::int[], '010-2725-8758'),
    (2, '정윤호', '6 Owl', '{1,2,3,4,5}'::int[], '010-8838-4188'),
    (3, '양지유', '4 Goldfinch', '{1,2,3,4,5}'::int[], '010-9250-6585'),
    (4, '정소이', '7 eagle', '{1,2,3,4,5}'::int[], '010-3388-8836'),
    (5, '김주이', '6flamingo', '{1,2,3,4,5}'::int[], '010-6379-8616'),
    (7, '이온유', '7emu', '{1,2,3,4,5}'::int[], '010-2542-2202'),
    (8, '이지원', '7eagle', '{1,2,3,4,5}'::int[], '010-9194-1190')
) as a(seq, name, klass, wd, phone)
where s33.seq = a.seq;

with r34 as (
  insert into shuttle_routes (direction, route_no, name, driver_name, driver_phone, teacher_name, teacher_phone, depart_time, sort_order)
  values ('등원', '26', '일원/대치', '안치형', '010-5218-2985', '김효정 Anna', '010-5492-2747', '08:00', 34)
  returning id
)
, s34 as (
  insert into shuttle_stops (route_id, seq, stop_time, address, gate)
  select r34.id, v.seq, v.stop_time, v.address, v.gate
  from r34, (values
    (0, '8:45', '강남구 영동대로 210 쌍용아파트 3동', null),
    (1, '8:48', '강남구 영동대로 210 쌍용아파트 5동', null),
    (2, '9:00', '강남구 대치동 932-21', null),
    (3, '9:10', '강남구 역삼로 306 개나리래미안 105-801', null),
    (4, '9:10', '강남구 테헤란로 44길 26 강남센트럴아이파크 104동', null),
    (5, '9:12', '강남구 역삼동 713-11 역삼아이파크 202동', null),
    (6, '9:12', '강남구 역삼동 713-11 역삼아이파크', null),
    (7, '9:!2', '강남구 역삼로 314 개나리푸르지오', null),
    (8, '9:!2', null, null),
    (9, '9:16', '강남구 테헤란로 52길 16 테헤란아이파크 101동', null)
  ) as v(seq, stop_time, address, gate)
  returning id, seq
)
insert into shuttle_assignments (stop_id, student_name_raw, class_raw, weekdays, guardian_phone)
select s34.id, a.name, a.klass, a.wd, a.phone
from s34, (values
    (0, '이예온', '5 falcon', '{1,2,3,4,5}'::int[], '010-3700-8489'),
    (1, '문정민', '6 kite', '{1,2,3,4,5}'::int[], '010-9136-4946'),
    (2, '이세나', '7 albatross', '{1,2,3,4,5}'::int[], '010-2816-2079'),
    (3, '유아린', '6 flaming', '{1,2,3,4,5}'::int[], '010-4340-3303'),
    (4, '홍도경', '3 Skylark', '{1,2,3,4,5}'::int[], '010-9120-1025'),
    (5, '정아인', '4 dove', '{1,2,3,4,5}'::int[], '010-4003-1262'),
    (6, '허정원', '7 emu', '{1,2,3,4,5}'::int[], '010-6267-0125'),
    (7, '리아채터', '4 Magpie', '{1,2,3,4,5}'::int[], '010-8980-5816'),
    (9, '신예원', '4 pelican', '{1,2,3,4,5}'::int[], '010-7176-4730')
) as a(seq, name, klass, wd, phone)
where s34.seq = a.seq;

with r35 as (
  insert into shuttle_routes (direction, route_no, name, driver_name, driver_phone, teacher_name, teacher_phone, depart_time, sort_order)
  values ('등원', '27', '개포/도곡', '정재용', '010-5396-8109', '한지원 Jane', '010-4877-5208', '08:00', 35)
  returning id
)
, s35 as (
  insert into shuttle_stops (route_id, seq, stop_time, address, gate)
  select r35.id, v.seq, v.stop_time, v.address, v.gate
  from r35, (values
    (0, null, '강남구 언주로30길 26 타워팰리스 G동', null),
    (1, '8:35', '강남구 언주로30길 56 타워팰리스 E동', null),
    (2, '8:35', '강남구 언주로30길 56 타워팰리스 E동', null),
    (3, '8:40', '강남구 언주로30길 56 타워팰리스 C동', null),
    (4, '8:40', '강남구 삼성로51길 25 대치sk뷰', null),
    (5, '8:52', '강남구 도곡로 306 래미안 그레이튼 104동', null),
    (6, '9:00', '강남구 논현동 222', null)
  ) as v(seq, stop_time, address, gate)
  returning id, seq
)
insert into shuttle_assignments (stop_id, student_name_raw, class_raw, weekdays, guardian_phone)
select s35.id, a.name, a.klass, a.wd, a.phone
from s35, (values
    (0, '오석', '5 Nightingale', '{1,2,3,4,5}'::int[], '010-9007-6706'),
    (1, '김태은', '5 wren', '{1,2,3,4,5}'::int[], '010-9175-5822'),
    (2, '이해린', '3 robin', '{1,2,3,4,5}'::int[], '010-2779-0000'),
    (3, '오유준', '3 Kiwi', '{1,2,3,4,5}'::int[], '010-9090-7199'),
    (4, '강이준', '3 Skylark', '{1,2,3,4,5}'::int[], '010-9974-9592'),
    (5, '나유안', '7albatross', '{1,2,3,4,5}'::int[], '010-4149-3292'),
    (6, '바이시우', '3 Kiwi', '{1,2,3,4,5}'::int[], '010-7759-8878')
) as a(seq, name, klass, wd, phone)
where s35.seq = a.seq;

with r36 as (
  insert into shuttle_routes (direction, route_no, name, driver_name, driver_phone, teacher_name, teacher_phone, depart_time, sort_order)
  values ('등원', '28', '개포', '송창석', '010-5347-2433', '양영승 Cindy  매봉역 8:50', '010-2397-3815', '08:00', 36)
  returning id
)
, s36 as (
  insert into shuttle_stops (route_id, seq, stop_time, address, gate)
  select r36.id, v.seq, v.stop_time, v.address, v.gate
  from r36, (values
    (0, null, '강남구 삼성로 14 개포자이 프레지던스', null),
    (1, '8:45', '강남구 개포로 264 개포래미안포레스트 109동', null),
    (2, '8:50', '디에이치아이파크퍼스티어 아파트 143동', null),
    (3, '9:10', '강남구 삼성로 629 센트럴아이파크 304동', null),
    (4, '9:10', '강남구 학동로68길 29 힐스테이트 1단지', null),
    (5, '9:12', '강남구 학동로68길 29 힐스테이트 1단지 박수현', null),
    (6, '9:12', '강남구 삼성동 16-2 삼성힐스테이트 1단지', null)
  ) as v(seq, stop_time, address, gate)
  returning id, seq
)
insert into shuttle_assignments (stop_id, student_name_raw, class_raw, weekdays, guardian_phone)
select s36.id, a.name, a.klass, a.wd, a.phone
from s36, (values
    (0, '김연우', '6 Kite', '{1,2,3,4,5}'::int[], '010-2775-1534'),
    (1, '서창현', '7 emu', '{1,2,3,4,5}'::int[], '010-5175-3868'),
    (2, '강로완', '5 falcon', '{1,2,3,4,5}'::int[], '010-2326-0354'),
    (3, '박시온', '6 owl', '{1,2,3,4,5}'::int[], '010-9086-0531'),
    (4, '원서정', '5 cardinal', '{1,2,3,4,5}'::int[], '010-8606-7446'),
    (5, '박서현', '5 cardinal', '{1,2,3,4,5}'::int[], '010-8713-8519'),
    (6, '김도현', '6 Flamingo', '{1,2,3,4,5}'::int[], '010-9808-9355')
) as a(seq, name, klass, wd, phone)
where s36.seq = a.seq;

with r37 as (
  insert into shuttle_routes (direction, route_no, name, driver_name, driver_phone, teacher_name, teacher_phone, depart_time, sort_order)
  values ('등원', '29', '압구정', '손창기', '010-2889-2257', '서수진 Sylvia', '010-2339-4064', '08:00', 37)
  returning id
)
, s37 as (
  insert into shuttle_stops (route_id, seq, stop_time, address, gate)
  select r37.id, v.seq, v.stop_time, v.address, v.gate
  from r37, (values
    (0, null, '압구정 현대 24동', null),
    (1, null, '압구정 현대 25동', null),
    (2, null, '압구정 현대 25동', null),
    (3, '8:30', '압구정 현대 25동', null),
    (4, '8:30', '압구정 현대 63동', null),
    (5, '8:30', '압구정 현대 211동', null),
    (6, '8:30', '서초구 잠원로 213-10 한강아파트', null),
    (7, '8:40', '서초구 잠원로 213-10 한강아파트', null)
  ) as v(seq, stop_time, address, gate)
  returning id, seq
)
insert into shuttle_assignments (stop_id, student_name_raw, class_raw, weekdays, guardian_phone)
select s37.id, a.name, a.klass, a.wd, a.phone
from s37, (values
    (0, '조이안', '4 Goldfinch', '{1,2,3,4,5}'::int[], '010-8882-8688'),
    (1, '홍지아', '4 magpie', '{1,2,3,4,5}'::int[], '010-8981-6856'),
    (2, '배아린', '5 Nightingale', '{1,2,3,4,5}'::int[], '010-8702-5593'),
    (3, '장은호', '3robin', '{1,2,3,4,5}'::int[], '010-4643-9694'),
    (4, '이서아', '5 Nightingale', '{1,2,3,4,5}'::int[], '010-9173-6033'),
    (5, '정승준', '5 Cardinal', '{1,2,3,4,5}'::int[], '010-3136-0969'),
    (6, '김주완', '6 kite', '{1,2,3,4,5}'::int[], '010-4765-4880'),
    (7, '김용재', '6 kite', '{1,2,3,4,5}'::int[], '010-9911-7400')
) as a(seq, name, klass, wd, phone)
where s37.seq = a.seq;

with r38 as (
  insert into shuttle_routes (direction, route_no, name, driver_name, driver_phone, teacher_name, teacher_phone, depart_time, sort_order)
  values ('등원', '29-1', '중구', '정재선', '010-5387-9224', '김미경', '010-4274-7757', '08:00', 38)
  returning id
)
, s38 as (
  insert into shuttle_stops (route_id, seq, stop_time, address, gate)
  select r38.id, v.seq, v.stop_time, v.address, v.gate
  from r38, (values
    (0, '8:35', '중구 정동길 21-31 정동상림원 B동', null)
  ) as v(seq, stop_time, address, gate)
  returning id, seq
)
insert into shuttle_assignments (stop_id, student_name_raw, class_raw, weekdays, guardian_phone)
select s38.id, a.name, a.klass, a.wd, a.phone
from s38, (values
    (0, '심규원', '4 dove', '{1,2,3,4,5}'::int[], '010-3564-9153')
) as a(seq, name, klass, wd, phone)
where s38.seq = a.seq;

with r39 as (
  insert into shuttle_routes (direction, route_no, name, driver_name, driver_phone, teacher_name, teacher_phone, depart_time, sort_order)
  values ('하원', '1', '잠원', '문형신', '010-2526-9189', '유지연 Jenny', '010-5014-2484', '16:00', 39)
  returning id
)
, s39 as (
  insert into shuttle_stops (route_id, seq, stop_time, address, gate)
  select r39.id, v.seq, v.stop_time, v.address, v.gate
  from r39, (values
    (0, null, '서초구 잠원로 117 아크로리버뷰 (셔틀버스 정류장)', null),
    (1, '4:25', null, null),
    (2, '4:30', '서초구 잠원로14길 23 롯데캐슬아파트 204-704 (롯데캐슬 2차 건너편)', null),
    (3, '4:30', '서초구 잠원동 161 신반포 래미안 리오센트 106동', null),
    (4, '4:31', '서초구 잠원동 161 신반포 래미안 리오센트 103동', null),
    (5, '4:31', '서초구 신반포로 33길 15 잠원동아파트', null)
  ) as v(seq, stop_time, address, gate)
  returning id, seq
)
insert into shuttle_assignments (stop_id, student_name_raw, class_raw, weekdays, guardian_phone)
select s39.id, a.name, a.klass, a.wd, a.phone
from s39, (values
    (0, '윤이서', '7 Albatross', '{1,2,3,4,5}'::int[], '010-5025-7631'),
    (1, '정하이', '4 Pelican', '{1,2,3,4,5}'::int[], '010-9622-6962'),
    (2, '박다겸', '6 Seahawk', '{1,2,3,4,5}'::int[], '010-7375-8350'),
    (3, '정이준', '4 Sparrow', '{1,2,3,4,5}'::int[], '010-4004-6571'),
    (4, '조하윤', '6 Flamingo', '{1,2,3,4,5}'::int[], '010-8688-1511'),
    (5, '이준명', '5 Parrot', '{1,2,3,4,5}'::int[], '010-3398-9012')
) as a(seq, name, klass, wd, phone)
where s39.seq = a.seq;

with r40 as (
  insert into shuttle_routes (direction, route_no, name, driver_name, driver_phone, teacher_name, teacher_phone, depart_time, sort_order)
  values ('하원', '1-1', '메이플자이1', '최종진', '010-5201-9498', '신지연 Bonnie', '010-3444-7756', '16:00', 40)
  returning id
)
, s40 as (
  insert into shuttle_stops (route_id, seq, stop_time, address, gate)
  select r40.id, v.seq, v.stop_time, v.address, v.gate
  from r40, (values
    (0, '4:26/gate2-2', '메이플자이 203동', null),
    (1, '4:26/gate2-2', '메이플자이 205동', null),
    (2, '4:26/gate2-2', '메이플자이 205동 이우빈', null),
    (3, '4:26/gate2-2', '메이플자이 201동 김단우', null),
    (4, '4:26/gate2-2', '메이플자이 205동', null),
    (5, '4:26/gate2-2', '메이플자이 205동', null),
    (6, '4:26/gate2-2', '메이플자이 207동', null),
    (7, '4:26/gate2-2', '메이플자이 209동', null),
    (8, '4:26/gate2-2', '메이플자이 213동', null),
    (9, '4:30/gate2-1', '메이플자이 207동', null),
    (10, '4:30/gate2-1', '메이플자이 215동', null),
    (11, '4:30/gate2-1', '메이플자이 213동', null)
  ) as v(seq, stop_time, address, gate)
  returning id, seq
)
insert into shuttle_assignments (stop_id, student_name_raw, class_raw, weekdays, guardian_phone)
select s40.id, a.name, a.klass, a.wd, a.phone
from s40, (values
    (0, '박하온', '6 Owl', '{1,2,3,4,5}'::int[], '010-6482-0946'),
    (1, '박연재', '4 Magpie', '{1,2,3,4,5}'::int[], '010-4363-4314'),
    (2, '이수빈', 'Albatross/5 Wren', '{1,2,3,4,5}'::int[], '010-3030-3443'),
    (3, '김연우B', '학교/', '{1,2,3,4,5}'::int[], '010-3442-0078'),
    (3, '김연서', '학교/', '{1,2,3,4,5}'::int[], '010-3442-0078'),
    (4, '김해주', '5 Wren', '{1,2,3,4,5}'::int[], '010-9272-6663'),
    (5, '천재현', '7 Eagle', '{1,2,3,4,5}'::int[], '010-3762-1185'),
    (6, '윤소희', '6 Owl', '{1,2,3,4,5}'::int[], '010-7181-1397'),
    (7, '김재이', '5 Starling', '{1,2,3,4,5}'::int[], '010-3499-4343'),
    (8, '방아원', '5 Cardinal', '{1,2,3,4,5}'::int[], '010-4092-0678'),
    (9, '표연서', '5 Toucan', '{1,2,3,4,5}'::int[], '010-7494-9829'),
    (10, '이연우', '학교', '{1,2,3,4,5}'::int[], '010-5045-2915'),
    (11, '조규온', '7 Crane', '{1,2,3,4,5}'::int[], '010-8447-3875')
) as a(seq, name, klass, wd, phone)
where s40.seq = a.seq;

with r41 as (
  insert into shuttle_routes (direction, route_no, name, driver_name, driver_phone, teacher_name, teacher_phone, depart_time, sort_order)
  values ('하원', '1-2', '메이플자이2', '유완철', '010-7171-3575', '양정민 Lenny', '010-3917-7725', '16:00', 41)
  returning id
)
, s41 as (
  insert into shuttle_stops (route_id, seq, stop_time, address, gate)
  select r41.id, v.seq, v.stop_time, v.address, v.gate
  from r41, (values
    (0, '4:30', '서초구 잠원로14길 54 신화아파트 (신사쇼핑 건너편 횡단보도 )', null),
    (1, '4:33/gate1-2', '메이플자이 105동', null),
    (2, '4:33/gate1-2', '메이플자이 106동', null),
    (3, '4:33/gate1-2', '메이플자이 103동', null),
    (4, '4:33/gate1-2', '메이플자이 102동', null),
    (5, '4:33/gate1-2', '메이플자이 106동', null),
    (6, '8:43/gate 1-1', '메이플자이 110동', null),
    (7, '4:36/gate1-1', '메이플자이 107동', null),
    (8, '4:36/gate1-1', '메이플자이 104동', null),
    (9, '4:36/gate1-1', '메이플자이 114동', null),
    (10, '4:36/gate 1-1', '메이플자이 114동', null),
    (11, '4:36/gate1-1', '메이플자이 109동', null)
  ) as v(seq, stop_time, address, gate)
  returning id, seq
)
insert into shuttle_assignments (stop_id, student_name_raw, class_raw, weekdays, guardian_phone)
select s41.id, a.name, a.klass, a.wd, a.phone
from s41, (values
    (0, '박도하', '학교', '{1,2,3,4,5}'::int[], '010-4140-1683'),
    (1, '박채이', '5 Parrot', '{1,2,3,4,5}'::int[], '010-5466-1211'),
    (2, '정건우', '6 Swan', '{1,2,3,4,5}'::int[], '010-5886-2653'),
    (3, '문서호', '5 Starling', '{1,2,3,4,5}'::int[], '010-9270-4238'),
    (4, '김서진', '학교', '{1,2,3,4,5}'::int[], '010-5047-7094'),
    (5, '조이솔', '5 Starling', '{1,2,3,4,5}'::int[], '010-3842-9601'),
    (6, '서해인', '3 Robin', '{1,2,3,4,5}'::int[], '010-7176-5017'),
    (7, '장윤우', '7 Eagle', '{1,2,3,4,5}'::int[], '010-7328-8856'),
    (8, '이로이', '5 Nightingale', '{1,2,3,4,5}'::int[], '010-9789-6973'),
    (9, '정윤아', '6 Swan', '{1,2,3,4,5}'::int[], '010-4508-9251'),
    (10, '이아린', '5 Wren', '{1,2,3,4,5}'::int[], '010-2699-8090'),
    (11, '구가빈', '5 Starling', '{1,2,3,4,5}'::int[], '010-3389-5115')
) as a(seq, name, klass, wd, phone)
where s41.seq = a.seq;

with r42 as (
  insert into shuttle_routes (direction, route_no, name, driver_name, driver_phone, teacher_name, teacher_phone, depart_time, sort_order)
  values ('하원', '2', '반포자이', '최병로', '010-8877-2234', '송은경', '010-9011-9811', '16:00', 42)
  returning id
)
, s42 as (
  insert into shuttle_stops (route_id, seq, stop_time, address, gate)
  select r42.id, v.seq, v.stop_time, v.address, v.gate
  from r42, (values
    (0, null, '137동', null),
    (1, null, '140동', null),
    (2, null, '139동 반포자이', null),
    (3, '16:40-50', '118동', null),
    (4, '16:40-50', '129동', null),
    (5, '16:40-50', '120동', null)
  ) as v(seq, stop_time, address, gate)
  returning id, seq
)
insert into shuttle_assignments (stop_id, student_name_raw, class_raw, weekdays, guardian_phone)
select s42.id, a.name, a.klass, a.wd, a.phone
from s42, (values
    (0, '정은우', 'Emu 7', '{1,2,3,4,5}'::int[], '010-7139-7519'),
    (1, '홍은석', 'Magpie 4', '{1,2,3,4,5}'::int[], '010-3527-4083'),
    (2, '김문준', 'Crane 7', '{1,2,3,4,5}'::int[], '010-9900-8739'),
    (3, '김유하', 'Owl 6', '{1,2,3,4,5}'::int[], '010-2997-9801'),
    (4, '김사랑', 'Dove 4', '{1,2,3,4,5}'::int[], '010-4288-2028'),
    (5, '김태율', 'Kite 6', '{1,2,3,4,5}'::int[], '010-2205-3420')
) as a(seq, name, klass, wd, phone)
where s42.seq = a.seq;

with r43 as (
  insert into shuttle_routes (direction, route_no, name, driver_name, driver_phone, teacher_name, teacher_phone, depart_time, sort_order)
  values ('하원', '2-1', '자이/잠원', '고재현', '010-4522-6623', '이정현 Jessie', '010-3774-4820', '16:00', 43)
  returning id
)
, s43 as (
  insert into shuttle_stops (route_id, seq, stop_time, address, gate)
  select r43.id, v.seq, v.stop_time, v.address, v.gate
  from r43, (values
    (0, null, '서초구 신반포로 270 반포자이 102동 (셔틀정류장 )', null),
    (1, '4:30-35', '서초구 신반포로 270 반포자이 133동', null),
    (2, '4:30-35', '서초구 신반포로 270 반포자이 127동 김예원', null),
    (3, '4:30-35', '서초구 잠원로 46-38 브라운스톤 잠원', null),
    (4, '4:30-35', '서초구 잠원로 60 신반포자이 (지하)', null),
    (5, '4:40-45', '서초구 잠원로 60 신반포자이 (지하)', null),
    (6, '4:40-45', '서초구 잠원로 60 신반포자이 106동(지하)', null)
  ) as v(seq, stop_time, address, gate)
  returning id, seq
)
insert into shuttle_assignments (stop_id, student_name_raw, class_raw, weekdays, guardian_phone)
select s43.id, a.name, a.klass, a.wd, a.phone
from s43, (values
    (0, '김주원B', 'Swan 6', '{1,2,3,4,5}'::int[], '010-7382-1023'),
    (1, '안제니', '3 Robin', '{1,2,3,4,5}'::int[], '010-9942-5436'),
    (2, '김주원A', '7 / Peacock 7', '{1,2,3,4,5}'::int[], '010-4078-2887'),
    (3, '신유안', '5 Nightingale', '{1,2,3,4,5}'::int[], '010-2770-9178'),
    (4, '김연우A', 'Seahawk 6', '{1,2,3,4,5}'::int[], '010-3701-8260'),
    (5, '정레인', '학교', '{1,2,3,4,5}'::int[], null),
    (6, '최시원', 'Goldfinch 4', '{1,2,3,4,5}'::int[], '010-9276-5875')
) as a(seq, name, klass, wd, phone)
where s43.seq = a.seq;

with r44 as (
  insert into shuttle_routes (direction, route_no, name, driver_name, driver_phone, teacher_name, teacher_phone, depart_time, sort_order)
  values ('하원', '2-2', '잠원2', '손창기', '010-2889-2257', '최재은 Jenny Choi', '010-6381-8903', '16:00', 44)
  returning id
)
, s44 as (
  insert into shuttle_stops (route_id, seq, stop_time, address, gate)
  select r44.id, v.seq, v.stop_time, v.address, v.gate
  from r44, (values
    (0, null, '서초구 잠원로8길 35 래미안신반포팰리스 106동(지하)', null),
    (1, '4:20', '서초구 잠원로8길 35 래미안신반포팰리스 107동(지하)', null),
    (2, '4:20', '서초구 잠원로8길 35 래미안신반포팰리스 107동(지하)', null),
    (3, '4:25', '서초구 잠원로 202-11 잠원훼미리아파트 (정문)', null),
    (4, '4:25', '서초구 잠원로 213-10 한강아파트', null),
    (5, '4:30', '서초구 잠원로 213-10 한강아파트', null)
  ) as v(seq, stop_time, address, gate)
  returning id, seq
)
insert into shuttle_assignments (stop_id, student_name_raw, class_raw, weekdays, guardian_phone)
select s44.id, a.name, a.klass, a.wd, a.phone
from s44, (values
    (0, '임서진', 'Kite 6', '{1,2,3,4,5}'::int[], '010-9145-8817'),
    (1, '황아림', 'Kite 6', '{1,2,3,4,5}'::int[], '010-7736-0569'),
    (2, '최한빈', 'Starling 5', '{1,2,3,4,5}'::int[], '010-9593-6527'),
    (3, '임서원', 'Eagle 7', '{1,2,3,4,5}'::int[], '010-6600-2674'),
    (4, '김주완', 'Kite 6', '{1,2,3,4,5}'::int[], '010-4765-4880'),
    (5, '김용재', 'Kite 6', '{1,2,3,4,5}'::int[], '010-9911-7400')
) as a(seq, name, klass, wd, phone)
where s44.seq = a.seq;

with r45 as (
  insert into shuttle_routes (direction, route_no, name, driver_name, driver_phone, teacher_name, teacher_phone, depart_time, sort_order)
  values ('하원', '3', '반포1', '김연운', '010-8870-5238', '한혜정Grace', '010-2934-3661', '16:00', 45)
  returning id
)
, s45 as (
  insert into shuttle_stops (route_id, seq, stop_time, address, gate)
  select r45.id, v.seq, v.stop_time, v.address, v.gate
  from r45, (values
    (0, '4:30', '서초구 서초중앙로 24길 57 롯데캐슬프레지던트 103동', null),
    (1, '4:30', '서초구 서초중앙로 24길 57 롯데캐슬프레지던트 103동', null),
    (2, '4:30', '서초구 고무래로 89 반포써밋 101동(정문)', null),
    (3, '4:30', '서초구 고무래로 89 반포써밋 101동(정문)', null),
    (4, '4:30', '서초구 서초중앙로 220 반포래미안아이파크 106동', null),
    (5, '4:30', '서초구 서초중앙로 220 반포래미안아이파크 107동', null),
    (6, '4:48', '서초구 서초중앙로 220 반포래미안아이파크 108동', null),
    (7, '4:48', '서초구 고무래로 35 반포리체 101동 (후문)', null),
    (8, '4:48', '서초구 사평대로 240 반포미도 2차 503동', null),
    (9, '4:53', '서초구 서초중앙로 31길 14-11', null),
    (10, '5:00', '서초구 고무래로 10-6 책나무', null)
  ) as v(seq, stop_time, address, gate)
  returning id, seq
)
insert into shuttle_assignments (stop_id, student_name_raw, class_raw, weekdays, guardian_phone)
select s45.id, a.name, a.klass, a.wd, a.phone
from s45, (values
    (0, '김시연', 'Starling 5', '{1,2,3,4,5}'::int[], '010-2370-6608'),
    (1, '도윤서', '학교', '{1,2,3,4,5}'::int[], '010-3395-6988'),
    (2, '강선우', 'Skylark 3', '{1,2,3,4,5}'::int[], '010-9745-2245'),
    (3, '김아인', 'Pelican 4', '{1,2,3,4,5}'::int[], '010-8653-2837'),
    (4, '신유준', 'Eagle 7', '{1,2,3,4,5}'::int[], '010-3524-5200'),
    (5, '박지안', 'Toucan 5', '{1,2,3,4,5}'::int[], '010-2075-4171'),
    (6, '김하진A', 'Crane 7', '{1,5}'::int[], '010-5368-7500'),
    (7, '곽세린', '학교', '{1,2,3,4,5}'::int[], '010-8843-5196'),
    (8, '조시헌', '5 Nightingale', '{1,2,3,4,5}'::int[], '010-8793-1633'),
    (9, '황이안', null, '{2}'::int[], '010-3176-4702'),
    (10, '엄하율', null, '{1}'::int[], '010-3244-8902')
) as a(seq, name, klass, wd, phone)
where s45.seq = a.seq;

with r46 as (
  insert into shuttle_routes (direction, route_no, name, driver_name, driver_phone, teacher_name, teacher_phone, depart_time, sort_order)
  values ('하원', '4', '반포2', '김경택', '010-8331-8542', '김다운 Bona', '010-8350-1843', '16:00', 46)
  returning id
)
, s46 as (
  insert into shuttle_stops (route_id, seq, stop_time, address, gate)
  select r46.id, v.seq, v.stop_time, v.address, v.gate
  from r46, (values
    (0, null, '서초구 신반포로 15길 1 래미안 원펜타스 105동', null),
    (1, null, '서초구 신반포로 15길 1 래미안 원펜타스', null),
    (2, null, '서초구 신반포로 15길 19, 아크로리버파크 113동', null),
    (3, '4:25-30', '서초구 신반포로 15길 19, 아크로리버파크 112동', null),
    (4, '4:25-30', '서초구 신반포로 15길 19 아크로리버파크 103동', null),
    (5, '4:25-30', '서초구 신반포로 15길 19 아크로리버파크 103동', null),
    (6, '4:25-30', '서초구 반포대로 275 래미안퍼스티지 121동 전준백', null),
    (7, '4:25-30', '서초구 반포대로 275 래미안 퍼스티지 119동 주이솔', null),
    (8, '4:25-30', '서초구 반포대로 275 래미안 퍼스티지 117동 정서우', null),
    (9, '4:35-40', '서초구 반포대로 275 래미안 퍼스티지 113동', null),
    (10, '4:35-40', '서초구 반포대로 275 래미안퍼스티지 111동', null),
    (11, '4:35-40', '서초구 반포대로 275 래미안퍼스티지 110동', null)
  ) as v(seq, stop_time, address, gate)
  returning id, seq
)
insert into shuttle_assignments (stop_id, student_name_raw, class_raw, weekdays, guardian_phone)
select s46.id, a.name, a.klass, a.wd, a.phone
from s46, (values
    (0, '김태민', 'Dove 4', '{1,2,3,4,5}'::int[], '010-3387-1370'),
    (1, '이도현', 'Eagle 7', '{1,2,3,4,5}'::int[], '010-2218-6878'),
    (2, '노윤우', 'Sparrow 4', '{1,2,3,4,5}'::int[], '010-9196-2876'),
    (3, '연하윤', '학교', '{1,2,3,4,5}'::int[], '010-7121-9559'),
    (4, '김지수', 'Falcon 5', '{1,2,3,4,5}'::int[], '010-9212-0714'),
    (5, '김재이', '학교', '{1,2,3,4,5}'::int[], '010-4569-0657'),
    (6, '전수정', 'Sparrow 4', '{1,2,3,4,5}'::int[], '010-3050-8681'),
    (7, '주다솔', '6 / Goldfinch 4', '{1,2,3,4,5}'::int[], '010-2229-3639'),
    (8, '정서원', 'Robin 3', '{1,2,3,4,5}'::int[], '010-9095-4522'),
    (9, '유태우', 'Crane 7', '{1,2,3,4,5}'::int[], '010-6809-6678'),
    (10, '조안나', 'Owl 6', '{1,2,3,4,5}'::int[], '010-3562-4610'),
    (11, '최희윤', 'Albatross 7', '{1,2,3,4,5}'::int[], '010-5409-6694')
) as a(seq, name, klass, wd, phone)
where s46.seq = a.seq;

with r47 as (
  insert into shuttle_routes (direction, route_no, name, driver_name, driver_phone, teacher_name, teacher_phone, depart_time, sort_order)
  values ('하원', '4-1', '반포/이수', '최상락', '010-5343-7011', '나정희 Jen', '010-2886-2212', '16:00', 47)
  returning id
)
, s47 as (
  insert into shuttle_stops (route_id, seq, stop_time, address, gate)
  select r47.id, v.seq, v.stop_time, v.address, v.gate
  from r47, (values
    (0, null, '서초구 반포대로 333 래미안 원베일리 117-2906', null),
    (1, null, '서초구 반포대로 333 래미안 원베일리 104-1402', null),
    (2, null, '서초구 반포대로 333 래미안 원베일리 113동', null),
    (3, '16:45-55', '서초구 반포대로 333 래미안 원베일리 118동', null),
    (4, '16:45-55', '서초구 반포대로 333 래미안 원베일리 106동', null),
    (5, '16:45-55', '서초구 반포대로 333 래미안 원베일리 103동 전우현', null),
    (6, '16:45-55', '서초구 반포대로 333 래미안 원베일리 105동', null)
  ) as v(seq, stop_time, address, gate)
  returning id, seq
)
insert into shuttle_assignments (stop_id, student_name_raw, class_raw, weekdays, guardian_phone)
select s47.id, a.name, a.klass, a.wd, a.phone
from s47, (values
    (0, '김서진A', 'Toucan 5', '{1,2,3,4,5}'::int[], '010-7115-0800'),
    (1, '허은서', 'Swan 6', '{1,2,3,4,5}'::int[], '010-6886-0213'),
    (2, '신제이', 'Toucan 5', '{1,2,3,4,5}'::int[], '010-5115-5165'),
    (3, '오윤', 'Kite 6', '{1,2,3,4,5}'::int[], '010-9100-1717'),
    (4, '김규민', 'Magpie 4', '{1,2,3,4,5}'::int[], '010-6618-6277'),
    (5, '전우진', 'Flamingo 6/', '{1,2,3,4,5}'::int[], '010-3466-1064'),
    (6, '권태훈', '4 Goldfinch', '{1,2,3,4,5}'::int[], '010-2021-5037')
) as a(seq, name, klass, wd, phone)
where s47.seq = a.seq;

with r48 as (
  insert into shuttle_routes (direction, route_no, name, driver_name, driver_phone, teacher_name, teacher_phone, depart_time, sort_order)
  values ('하원', '4-2', '반포/사당', '전명섭', '010-4272-7120', 'Ana', '010-4727-3470', '16:00', 48)
  returning id
)
, s48 as (
  insert into shuttle_stops (route_id, seq, stop_time, address, gate)
  select r48.id, v.seq, v.stop_time, v.address, v.gate
  from r48, (values
    (0, '16:30', '서초구 신반포로 23길 23 반포르엘 1차 105동', null),
    (1, '16:40', '서초구 방배중앙로 204 방배리첸시아', null),
    (2, '16:40', null, null),
    (3, '16:45', '서초구 동광로 28 이준서,', null),
    (4, '16:50', '서초구 방배로42길 65', null),
    (5, '16:52', '서초구 서초대로 33길 71', null)
  ) as v(seq, stop_time, address, gate)
  returning id, seq
)
insert into shuttle_assignments (stop_id, student_name_raw, class_raw, weekdays, guardian_phone)
select s48.id, a.name, a.klass, a.wd, a.phone
from s48, (values
    (0, '김윤우', 'Goldfinch 4', '{1,2,3,4,5}'::int[], '010-3389-2511'),
    (1, '양우진', 'Swan 6', '{1,2,3,4,5}'::int[], '010-9069-0095'),
    (3, '이준우', '학교', '{3}'::int[], null),
    (3, '임지효', '학교', '{3}'::int[], null),
    (4, '김태은A', 'Emu 7', '{1,2,3,4,5}'::int[], '010-4504-9451'),
    (5, '김지원', 'Owl 6', '{1,2,3,4,5}'::int[], '010-2522-0119')
) as a(seq, name, klass, wd, phone)
where s48.seq = a.seq;

with r49 as (
  insert into shuttle_routes (direction, route_no, name, driver_name, driver_phone, teacher_name, teacher_phone, depart_time, sort_order)
  values ('하원', '5', '반포3', null, null, '선금희', '010-5475-8598', '16:00', 49)
  returning id
)
, s49 as (
  insert into shuttle_stops (route_id, seq, stop_time, address, gate)
  select r49.id, v.seq, v.stop_time, v.address, v.gate
  from r49, (values
    (0, null, '서초구 서초중앙로 24길 33 서초교대 e편한세상 105동', null),
    (1, null, '서초구 서초대로 65길 13-10 서초래미안', null),
    (2, null, '임예나', null),
    (3, null, '서초구 고무래로 94 서초현대 4차 201동', null),
    (4, null, '서초구 서초중앙로 188 아크로비스타 B동', null),
    (5, null, '서초구 서초중앙로 200 삼풍아파트 14동', null),
    (6, null, '서초구 서초대로 38길 12 마제스타 힐스테이트 101동', null)
  ) as v(seq, stop_time, address, gate)
  returning id, seq
)
insert into shuttle_assignments (stop_id, student_name_raw, class_raw, weekdays, guardian_phone)
select s49.id, a.name, a.klass, a.wd, a.phone
from s49, (values
    (0, '진리안', 'Seahawk 6', '{1,2,3,4,5}'::int[], '010-2088-4556'),
    (1, '이서준', '학교', '{1,2,3,4,5}'::int[], '010-4866-8100'),
    (2, '임세나', 'Swan / Kiwi', '{1,2,3,4,5}'::int[], '010-9901-7999'),
    (2, '임동하', 'Swan / Kiwi', '{1,2,3,4,5}'::int[], '010-9901-7999'),
    (2, '학교', 'Swan / Kiwi', '{1,2,3,4,5}'::int[], '010-9901-7999'),
    (3, '박이현', null, '{1,2,3,4,5}'::int[], '010-2514-0900'),
    (4, '손재이', 'Nightingale 5', '{1,2,3,4,5}'::int[], '010-3301-6306'),
    (5, '김도율', '학교', '{1,2,3,4,5}'::int[], '010-3729-8503'),
    (6, '최유진', 'Cardinal 5', '{1,2,3,4,5}'::int[], '010-5223-1709')
) as a(seq, name, klass, wd, phone)
where s49.seq = a.seq;

with r50 as (
  insert into shuttle_routes (direction, route_no, name, driver_name, driver_phone, teacher_name, teacher_phone, depart_time, sort_order)
  values ('하원', '6', '서초1', '김경태', '010-6251-9833', '김소희 Sohee', '010-3325-5305', '16:00', 50)
  returning id
)
, s50 as (
  insert into shuttle_stops (route_id, seq, stop_time, address, gate)
  select r50.id, v.seq, v.stop_time, v.address, v.gate
  from r50, (values
    (0, null, '서초구 서운로 221 래미안 서초스위트 103동', null),
    (1, '16:30', '서초구 서운로 212 푸르지오 써밋 2차 202동 손별', null),
    (2, '16:30', '104동', null),
    (3, '16:30', '104동', null),
    (4, '16:45', '래미안 리더스원 101동', null),
    (5, '16:45', '101동', null),
    (6, '16:45', '111동', null),
    (7, '16:45', '102동', null),
    (8, '16:46', '서초구 효령로 391 서초그랑자이 101동 송도휘', null),
    (9, '16:46', '103동', null),
    (10, '16:50', '서초구 효령로68길 33 서초아이파크 102동 홍한울', null)
  ) as v(seq, stop_time, address, gate)
  returning id, seq
)
insert into shuttle_assignments (stop_id, student_name_raw, class_raw, weekdays, guardian_phone)
select s50.id, a.name, a.klass, a.wd, a.phone
from s50, (values
    (0, '강리안B', 'Cardinal 5', '{1,2,3,4,5}'::int[], '010-6543-1465'),
    (1, '손유', '학교', '{1,2,3,4,5}'::int[], '010-2866-9849'),
    (2, '김선아', 'Parrot 5', '{1,2,3,4,5}'::int[], '010-2499-0282'),
    (3, '박시아', 'Falcon 5', '{1,2,3,4,5}'::int[], '010-2733-8991'),
    (4, '박서연', 'Seahawk 6', '{1,2,3,4,5}'::int[], '010-9695-3570'),
    (5, '이솔', 'Magpie 4', '{1,2,3,4,5}'::int[], '010-6750-2410'),
    (6, '정주원', 'Starling 5', '{1,2,3,4,5}'::int[], '010-8960-7552'),
    (7, '국서호', 'Wren 5', '{1,2,3,4,5}'::int[], '010-9261-4108'),
    (8, '송도아', 'Parrot 5/Robin 3', '{1,2,3,4,5}'::int[], '010-5251-0420'),
    (9, '김선후', 'Pelican 4', '{1,2,3,4,5}'::int[], '010-9002-5695'),
    (10, '홍한결', '5 Emu/ 4 Dove', '{1,2,3,4,5}'::int[], '010-8988-0618')
) as a(seq, name, klass, wd, phone)
where s50.seq = a.seq;

with r51 as (
  insert into shuttle_routes (direction, route_no, name, driver_name, driver_phone, teacher_name, teacher_phone, depart_time, sort_order)
  values ('하원', '7', '서초2', '김진현', '010-3818-0095', '임지연 Winnie', '010-3934-9429', '16:00', 51)
  returning id
)
, s51 as (
  insert into shuttle_stops (route_id, seq, stop_time, address, gate)
  select r51.id, v.seq, v.stop_time, v.address, v.gate
  from r51, (values
    (0, null, '서초구 강남대로 455 강남태영데시앙루브 B동', null),
    (1, '16:30', '서울시 서초구 서초4동 푸르지오 써밋', null),
    (2, '16:30', null, null),
    (3, '16:31', '서초구 서운로 197 롯데캐슬 106동 이지오', null),
    (4, '16:31', '서초구 서운로 107 래미안에스티지', null),
    (5, '16:31', '리더스원', null),
    (6, '16:40', '리더스원', null),
    (7, '16:50', '서초구 남부순환로 339길 20 삼안리젠시', null),
    (8, '16:52', '서초구 효령로68길 81 서초자이 102동', null)
  ) as v(seq, stop_time, address, gate)
  returning id, seq
)
insert into shuttle_assignments (stop_id, student_name_raw, class_raw, weekdays, guardian_phone)
select s51.id, a.name, a.klass, a.wd, a.phone
from s51, (values
    (0, '서엘린', 'Skylark 3', '{1,2,3,4,5}'::int[], '010-9310-6934'),
    (1, '이도호', 'Albatross 7', '{1,2,3,4,5}'::int[], '010-5342-3659'),
    (2, '최윤정', 'Owl 6', '{1,2,3,4,5}'::int[], '010-3919-2102'),
    (3, '이재니', 'Emu 7/ Dove 4', '{1,2,3,4,5}'::int[], '010-3872-5326'),
    (4, '강리안', 'Emu 7', '{1,2,3,4,5}'::int[], '010-9608-0149'),
    (5, '고진우', '학교', '{1,2,3,4,5}'::int[], '010-8972-2394'),
    (6, '이준서', '학교', '{1,2,3,4,5}'::int[], '010-4655-2574'),
    (7, '강예성', '학교', '{1,2,3,4,5}'::int[], '010-4114-3788'),
    (8, '편해율', '5 Cardinal', '{1,2,3,4,5}'::int[], '010-6483-2316')
) as a(seq, name, klass, wd, phone)
where s51.seq = a.seq;

with r52 as (
  insert into shuttle_routes (direction, route_no, name, driver_name, driver_phone, teacher_name, teacher_phone, depart_time, sort_order)
  values ('하원', '8', '역삼/대치', '김동도', '010-3743-4125', '손희정 Nancy', '010-8513-7209', '16:00', 52)
  returning id
)
, s52 as (
  insert into shuttle_stops (route_id, seq, stop_time, address, gate)
  select r52.id, v.seq, v.stop_time, v.address, v.gate
  from r52, (values
    (0, '16:20', '강남구 강남대로 128길 44, 501호', null),
    (1, '16:21', '강남구 학동로8길 16 현대빌라', null),
    (2, '16:23', '강남구 논현동 148-18', null),
    (3, '16:28', '메일 강남구 논현로111길 39 한화꿈에그린 김제이', null),
    (4, '16:31', '강남구 논현로115길 14, 필스트빌딩', null),
    (5, '16:31', '강남구 논현로71길 46 블루밍코트아파트 101동', null),
    (6, '16:45', '강남구 테헤란로 14길 41', null),
    (7, '16:45', '강남구 도곡로13길 19 롯데캐슬노블 102동', null)
  ) as v(seq, stop_time, address, gate)
  returning id, seq
)
insert into shuttle_assignments (stop_id, student_name_raw, class_raw, weekdays, guardian_phone)
select s52.id, a.name, a.klass, a.wd, a.phone
from s52, (values
    (0, '이온유', 'Emu 7', '{1,2,3,4,5}'::int[], '010-2542-2202'),
    (1, '홍서형', '학교', '{1,2,3,4,5}'::int[], '010-7176-5490'),
    (2, '이지원', 'Eagle 7', '{1,2,3,4,5}'::int[], '010-9194-1190'),
    (3, '김주이', '6Flamingo', '{1,2,3,4,5}'::int[], '010-5481-9667'),
    (4, '정소이', 'Eagle 7', '{1,2,3,4,5}'::int[], '010-3388-8836'),
    (5, '양지유', '4 Goldfinch', '{1,2,3,4,5}'::int[], '010-9250-6585'),
    (6, '정윤호', '6 Owl', '{1,2,3,4,5}'::int[], '010-8838-4188'),
    (7, '박세주', '학교', '{1,2,3,4,5}'::int[], '010-6380-8798')
) as a(seq, name, klass, wd, phone)
where s52.seq = a.seq;

with r53 as (
  insert into shuttle_routes (direction, route_no, name, driver_name, driver_phone, teacher_name, teacher_phone, depart_time, sort_order)
  values ('하원', '9', '방배', '정홍균', '010-3690-7263', '플루 Fulu', '010-4222-1996', '16:00', 53)
  returning id
)
, s53 as (
  insert into shuttle_stops (route_id, seq, stop_time, address, gate)
  select r53.id, v.seq, v.stop_time, v.address, v.gate
  from r53, (values
    (0, null, '강남구 논현동 55 스위트캐슬', null),
    (1, '16:48', '서초구 사임당로 17길 116 서초삼성래미안 101동', null),
    (2, '16:55', '서초구 반포대로 58 서초아트자이 104동', null),
    (3, '16:55', '서초구 서초 중앙로 15 현대슈퍼빌', null),
    (4, '17:00', '서초구 남부순환로 319길 24 씨티빌', null),
    (5, '17:05', '서초구 방배로1길 9 방배신동아럭스빌 1301호', null),
    (6, '17:15', '서초구 방배동 467-20', null),
    (7, '17:15', '서초구 서초중앙로 63 이준서', null)
  ) as v(seq, stop_time, address, gate)
  returning id, seq
)
insert into shuttle_assignments (stop_id, student_name_raw, class_raw, weekdays, guardian_phone)
select s53.id, a.name, a.klass, a.wd, a.phone
from s53, (values
    (0, '박리온', 'Flamingo 6', '{1,2,3,4,5}'::int[], '010-7111-4039'),
    (1, '신지수', 'Dove 4', '{1,2,3,4,5}'::int[], '010-9500-7199'),
    (2, '윤아인', 'Goldfinch 4', '{1,2,3,4,5}'::int[], '010-7121-0483'),
    (3, '김채희', '4 Sparrow', '{1,2,3,4,5}'::int[], '010-9152-4378'),
    (4, '황이안', '학교', '{1,2,3,4,5}'::int[], '010-3176-4702'),
    (5, '오로라', 'Nightingale 5', '{1,2,3,4,5}'::int[], '010-9200-0130'),
    (6, '김로이A', 'Flamingo 6', '{1,2,3,4,5}'::int[], '010-2588-4452'),
    (7, '이준우', '학교', '{1,5}'::int[], null)
) as a(seq, name, klass, wd, phone)
where s53.seq = a.seq;

with r54 as (
  insert into shuttle_routes (direction, route_no, name, driver_name, driver_phone, teacher_name, teacher_phone, depart_time, sort_order)
  values ('하원', '9-1', '방배/내방', '이재남  3 매일 동작구 동작대로 41길 10 미양하이츠 김시아 3 Kiwi (모)', '010-9152-2429', '임주경 Luna  4 매일 동작구 사당로 300 이수 자이 101동 김호윤 Skylark 3 (모)', '010-5543-5646', '16:00', 54)
  returning id
)
, s54 as (
  insert into shuttle_stops (route_id, seq, stop_time, address, gate)
  select r54.id, v.seq, v.stop_time, v.address, v.gate
  from r54, (values
    (0, null, '동작구 동작대로 41길 10 미양하이츠', null),
    (1, '16:45', '원페를라 103동 김서이', null),
    (2, '16:58', '원페를라 202동', null),
    (3, '17:05', '서초구 서초대로 34가길 36 신호나이스 302호', null),
    (4, '17:15', '동작구 사당로 300 이수 자이 101동', null)
  ) as v(seq, stop_time, address, gate)
  returning id, seq
)
insert into shuttle_assignments (stop_id, student_name_raw, class_raw, weekdays, guardian_phone)
select s54.id, a.name, a.klass, a.wd, a.phone
from s54, (values
    (0, '김시아', '3 Kiwi', '{1,2,3,4,5}'::int[], '010-2125-2108'),
    (1, '김단우', '학교/ Albatross 7', '{1,2,3,4,5}'::int[], '010-8582-7165'),
    (2, '김유건', 'Nightingale 5', '{1,2,3,4,5}'::int[], '010-3601-5175'),
    (3, '이서아', '학교', '{1,2,3,4,5}'::int[], '010-5703-2692'),
    (4, '김호윤', 'Skylark 3', '{1,2,3,4,5}'::int[], '010-4701-2888')
) as a(seq, name, klass, wd, phone)
where s54.seq = a.seq;

with r55 as (
  insert into shuttle_routes (direction, route_no, name, driver_name, driver_phone, teacher_name, teacher_phone, depart_time, sort_order)
  values ('하원', '9-2', '흑석', '마상훈', '010-9459-6543', '김영서 Bay', '010-8518-7522', '16:00', 55)
  returning id
)
, s55 as (
  insert into shuttle_stops (route_id, seq, stop_time, address, gate)
  select r55.id, v.seq, v.stop_time, v.address, v.gate
  from r55, (values
    (0, '16:20', '강남구 학동로11길 13 브라운스톤 유소이', null),
    (1, '16:20', '동작구 흑석한강로 27 흑석푸르지오 101동', null),
    (2, '16:40-45', '동작구 서달로 91 흑석한강센트레빌 2차', null)
  ) as v(seq, stop_time, address, gate)
  returning id, seq
)
insert into shuttle_assignments (stop_id, student_name_raw, class_raw, weekdays, guardian_phone)
select s55.id, a.name, a.klass, a.wd, a.phone
from s55, (values
    (0, '유채이', 'Emu 7/ Falcon 5', '{1,2,3,4,5}'::int[], '010-4181-3216'),
    (1, '전하루', 'Starling 5', '{1,2,3,4,5}'::int[], '010-7140-9041'),
    (2, '김나율', '학교', '{1,2,3,4,5}'::int[], '010-7389-0228')
) as a(seq, name, klass, wd, phone)
where s55.seq = a.seq;

with r56 as (
  insert into shuttle_routes (direction, route_no, name, driver_name, driver_phone, teacher_name, teacher_phone, depart_time, sort_order)
  values ('하원', '10', '서래마을', '이만기', '010-5357-2139', '조은애 Chloe', '010-3905-1941', '16:00', 56)
  returning id
)
, s56 as (
  insert into shuttle_stops (route_id, seq, stop_time, address, gate)
  select r56.id, v.seq, v.stop_time, v.address, v.gate
  from r56, (values
    (0, null, '서초구 서래로 8길 30 반포TS프리우스', null),
    (1, null, '서초구 사평대로 22길 51', null),
    (2, null, '서초구 반포동 82-5', null),
    (3, null, '서초구 동광로27길 14', null),
    (4, null, '서초구 방배동 1-12 유림빌라', null),
    (5, null, '서초구 동광로27길 60 프레스턴아파트', null),
    (6, null, '서초구 방배동 1-58', null)
  ) as v(seq, stop_time, address, gate)
  returning id, seq
)
insert into shuttle_assignments (stop_id, student_name_raw, class_raw, weekdays, guardian_phone)
select s56.id, a.name, a.klass, a.wd, a.phone
from s56, (values
    (0, '김조이', 'Seahawk 6', '{1,2,3,4,5}'::int[], '010-4787-6876'),
    (1, '유재이', '학교', '{2,4,5}'::int[], null),
    (2, '이우현', 'Skylark 3', '{1,2,3,4,5}'::int[], '010-5416-9656'),
    (3, '김이선', 'Robin 3', '{1,2,3,4,5}'::int[], '010-5384-2021'),
    (4, '신보석', 'Peacock 7', '{1,2,3,4,5}'::int[], '010-4714-0729'),
    (5, '임지효', '학교', '{1,2,3,4,5}'::int[], '010-6347-0288'),
    (6, '노희권', 'Peacock 7', '{1,2,3,4,5}'::int[], '010-2909-2246')
) as a(seq, name, klass, wd, phone)
where s56.seq = a.seq;

with r57 as (
  insert into shuttle_routes (direction, route_no, name, driver_name, driver_phone, teacher_name, teacher_phone, depart_time, sort_order)
  values ('하원', '11', '용산/이태원', '오천석', '010-7773-0331', 'Kirsty', '010-6797-8770', '16:00', 57)
  returning id
)
, s57 as (
  insert into shuttle_stops (route_id, seq, stop_time, address, gate)
  select r57.id, v.seq, v.stop_time, v.address, v.gate
  from r57, (values
    (0, null, '용산구 독서당로 111 한남더힐 124동', null),
    (1, '16:30', '용산구 한남대로 36길 12-13 신포빌라 이준원', null),
    (2, '16:35', '용산구 한남동 809 대성 이태리하우스', null),
    (3, '16:55', '용산구 녹사평대로 46길 84 마운틴뷰 Maya', null)
  ) as v(seq, stop_time, address, gate)
  returning id, seq
)
insert into shuttle_assignments (stop_id, student_name_raw, class_raw, weekdays, guardian_phone)
select s57.id, a.name, a.klass, a.wd, a.phone
from s57, (values
    (0, '서아루', '7 Eagle', '{1,2,3,4,5}'::int[], '010-5221-1275'),
    (1, '이신원', '학교', '{1,2,3,4,5}'::int[], '010-9282-2232'),
    (2, '김이준B', 'Parrot 5', '{1,2,3,4,5}'::int[], '010-2772-2018')
) as a(seq, name, klass, wd, phone)
where s57.seq = a.seq;

with r58 as (
  insert into shuttle_routes (direction, route_no, name, driver_name, driver_phone, teacher_name, teacher_phone, depart_time, sort_order)
  values ('하원', '12', '이촌1', '최상균', '010-5522-2479', '박예림 Rayna', '010-3342-2155', '16:00', 58)
  returning id
)
, s58 as (
  insert into shuttle_stops (route_id, seq, stop_time, address, gate)
  select r58.id, v.seq, v.stop_time, v.address, v.gate
  from r58, (values
    (0, '16:40', '용산구 이촌로 310 첼리투스 103-1504', null),
    (1, '16:40', '용산구 이촌로64길 61 장미맨션', null),
    (2, '16:45', '이세린', null),
    (3, '16:45', '용산구 이촌로71길 10 한가람아파트 215동 황준호', null),
    (4, '16:50', '용산구 이촌로71길 10 한가람아파트 210동', null),
    (5, '16:50', '용산구 이촌로71길 10 한가람아파트 212동', null)
  ) as v(seq, stop_time, address, gate)
  returning id, seq
)
insert into shuttle_assignments (stop_id, student_name_raw, class_raw, weekdays, guardian_phone)
select s58.id, a.name, a.klass, a.wd, a.phone
from s58, (values
    (0, '여이서', 'Sparrow 4', '{1,2,3,4,5}'::int[], '010-8896-7130'),
    (1, '차봄', '학교', '{1,2,3,4,5}'::int[], '010-2811-0707'),
    (2, '이세은', '학교', '{1,2,3,4,5}'::int[], '010-4939-6479'),
    (3, '황라원', '학교', '{1,2,3,4,5}'::int[], '010-2264-1478'),
    (3, '황라윤', '학교', '{1,2,3,4,5}'::int[], '010-2264-1478'),
    (4, '서인우', '7 Albatross', '{1,2,3,4,5}'::int[], '010-9407-2104'),
    (5, '김권', 'Parrot 5', '{1,2,3,4,5}'::int[], '010-3686-3978')
) as a(seq, name, klass, wd, phone)
where s58.seq = a.seq;

with r59 as (
  insert into shuttle_routes (direction, route_no, name, driver_name, driver_phone, teacher_name, teacher_phone, depart_time, sort_order)
  values ('하원', '12-1', '이촌2', '강호', '010-8744-3003', '진미선 Autumn', '010-4485-1757', '16:00', 59)
  returning id
)
, s59 as (
  insert into shuttle_stops (route_id, seq, stop_time, address, gate)
  select r59.id, v.seq, v.stop_time, v.address, v.gate
  from r59, (values
    (0, null, '용산구 서빙고로 413 하이페리온', null),
    (1, null, '용산구 서빙고로 413 하이페리온', null),
    (2, null, '용산구 서빙고로 413 하이페리온', null),
    (3, null, '용산구 한강대로 69 푸르지오써밋', null)
  ) as v(seq, stop_time, address, gate)
  returning id, seq
)
insert into shuttle_assignments (stop_id, student_name_raw, class_raw, weekdays, guardian_phone)
select s59.id, a.name, a.klass, a.wd, a.phone
from s59, (values
    (0, '남가인', '학교', '{1,2,3,4,5}'::int[], '010-5485-3268'),
    (1, '남가인', '학교', '{1,2,3,4,5}'::int[], '010-5485-3269'),
    (2, '남가인', '학교', '{1,2,3,4,5}'::int[], '010-5485-3270'),
    (3, '위준완', '학교', '{1,2,3,4,5}'::int[], '010-4946-9137')
) as a(seq, name, klass, wd, phone)
where s59.seq = a.seq;

with r60 as (
  insert into shuttle_routes (direction, route_no, name, driver_name, driver_phone, teacher_name, teacher_phone, depart_time, sort_order)
  values ('하원', '13', '마포/용산', '차명신', '010-8288-6503', '서수진', '010-9263-5936', '16:00', 60)
  returning id
)
, s60 as (
  insert into shuttle_stops (route_id, seq, stop_time, address, gate)
  select r60.id, v.seq, v.stop_time, v.address, v.gate
  from r60, (values
    (0, null, '강남구 논현동 22 논현아파트 101동', null),
    (1, null, null, null),
    (2, '16:30', '강남구 논현동 22 논현아파트 102동', null),
    (3, '16:30', '강남구 논현동 22 논현아파트 105동', null),
    (4, '16:50', '용산구 서빙고로 71길 32-1', null),
    (5, '17:00', '용산구 서빙고로 17 센트럴파크해링턴스퀘어 101동', null),
    (6, '17:00', '5월부터 용산구 서빙고로 35 용산시티파크 103동', null),
    (7, '17:15', '마포구 새창로 52 현대1차아파트 103동', null),
    (8, '17:15', null, null)
  ) as v(seq, stop_time, address, gate)
  returning id, seq
)
insert into shuttle_assignments (stop_id, student_name_raw, class_raw, weekdays, guardian_phone)
select s60.id, a.name, a.klass, a.wd, a.phone
from s60, (values
    (0, '김아론', 'Emu 7', '{1,2,3,4,5}'::int[], '010-6802-1105'),
    (2, '박태린', 'Robin 3', '{1,2,3,4,5}'::int[], '010-6414-1640'),
    (3, '권사윤', 'Dove 4', '{1,2,3,4,5}'::int[], '010-4206-4221'),
    (4, '이하은', '학교', '{1,2,3,4,5}'::int[], '010-9877-4057'),
    (5, '정윤서', 'Kite 4', '{1,2,3,4,5}'::int[], '010-8795-1121'),
    (6, '박제이', 'Kiwi 3', '{1,2,3,4,5}'::int[], '010-3952-1025'),
    (7, '최온유', '학교', '{1,2,3,4,5}'::int[], '010-4270-6404')
) as a(seq, name, klass, wd, phone)
where s60.seq = a.seq;

with r61 as (
  insert into shuttle_routes (direction, route_no, name, driver_name, driver_phone, teacher_name, teacher_phone, depart_time, sort_order)
  values ('하원', '14', '서울숲', '정재오', '010-8353-2170', '김주현 Julie', '010-4160-2474', '16:00', 61)
  returning id
)
, s61 as (
  insert into shuttle_stops (route_id, seq, stop_time, address, gate)
  select r61.id, v.seq, v.stop_time, v.address, v.gate
  from r61, (values
    (0, null, '성동구 독서당로 344 힐스테이트서울숲리버 107-702', null),
    (1, '16:45', '성동구 독서당로 344 힐스테이트서울숲리버 106-601', null),
    (2, '16:45', '성동구 왕십리로 241 서울숲 더샵 103동', null),
    (3, '16:55', '성동구 왕십리로 241 서울숲 더샵 101동 고유안', null),
    (4, '16:55', '성동구 왕십리로 241 서울숲 더샵 102동', null),
    (5, '16:55', '서울숲아이파크리버포레 2차', null),
    (6, '17:05', '서울숲아이파크리버포레 1차', null),
    (7, '17:05', '서울숲아이파크리버포레 1차', null)
  ) as v(seq, stop_time, address, gate)
  returning id, seq
)
insert into shuttle_assignments (stop_id, student_name_raw, class_raw, weekdays, guardian_phone)
select s61.id, a.name, a.klass, a.wd, a.phone
from s61, (values
    (0, '이건우', 'Swan 6', '{1,2,3,4,5}'::int[], '010-9934-4029'),
    (1, '류재이', 'Wren 5', '{1,2,3,4,5}'::int[], '010-4196-1404'),
    (2, '김태오', 'Falcon 5', '{1,2,3,4,5}'::int[], '010-9476-3302'),
    (3, '고유민', '7/ Wren 5', '{1,2,3,4,5}'::int[], '010-4720-2881'),
    (4, '황희', 'Falcon 5', '{1,2,3,4,5}'::int[], '010-6669-5364'),
    (5, '신주오', 'Flamingo 6', '{1,2,3,4,5}'::int[], '010-6206-5308'),
    (6, '박준후', '학교', '{1,2,3,4,5}'::int[], null),
    (7, '이도후', '학교', '{1,2,3,4,5}'::int[], '010-3772-3110')
) as a(seq, name, klass, wd, phone)
where s61.seq = a.seq;

with r62 as (
  insert into shuttle_routes (direction, route_no, name, driver_name, driver_phone, teacher_name, teacher_phone, depart_time, sort_order)
  values ('하원', '15', '옥수', '김천석', '010-5496-5881', '임재인 Jane', '010-4045-8399', '16:00', 62)
  returning id
)
, s62 as (
  insert into shuttle_stops (route_id, seq, stop_time, address, gate)
  select r62.id, v.seq, v.stop_time, v.address, v.gate
  from r62, (values
    (0, '16:30', '강남구 논현로160길 20 장자울아파트', null),
    (1, '16:30', '성동구 매봉길 50 옥수파크힐스 114동 심규민', null),
    (2, '16:30', '성동구 매봉길 50 옥수파크힐스 114동 권하린', null),
    (3, '16:30', '성동구 매봉길 50 옥수파크힐스 116동', null),
    (4, '16:40-45', '성동구 매봉길 50 옥수파크힐스 109동', null),
    (5, '16:40-45', '성동구 매봉길 15 래미안리버젠 108동', null),
    (6, '16:40-45', '성동구 매봉길 50 옥수파크힐스 104동', null)
  ) as v(seq, stop_time, address, gate)
  returning id, seq
)
insert into shuttle_assignments (stop_id, student_name_raw, class_raw, weekdays, guardian_phone)
select s62.id, a.name, a.klass, a.wd, a.phone
from s62, (values
    (0, '장하은', '7Eagle', '{1,2,3,4,5}'::int[], '010-8782-8105'),
    (1, '심지민', '5Parrot', '{1,2,3,4,5}'::int[], '010-7797-4865'),
    (2, '목요일안', '7Crane', '{1,2,3,4,5}'::int[], '010-4555-8103'),
    (3, '조아정', '5 Cadinal', '{1,2,3,4,5}'::int[], '010-6667-8952'),
    (4, '배윤', '7 Eagle', '{1,2,3,4,5}'::int[], '010-5174-4723'),
    (5, '이수호', '6 Swan', '{1,2,3,4,5}'::int[], '010-4993-9586'),
    (6, '천리안', '5 Toucan', '{1,2,3,4,5}'::int[], '010-9214-1532')
) as a(seq, name, klass, wd, phone)
where s62.seq = a.seq;

with r63 as (
  insert into shuttle_routes (direction, route_no, name, driver_name, driver_phone, teacher_name, teacher_phone, depart_time, sort_order)
  values ('하원', '16', '금호/왕십리', '김정남', '010-8276-9292', '곽수린 Rebecca', '010-9578-0091', '16:00', 63)
  returning id
)
, s63 as (
  insert into shuttle_stops (route_id, seq, stop_time, address, gate)
  select r63.id, v.seq, v.stop_time, v.address, v.gate
  from r63, (values
    (0, '16:35', '성동구 독서당로 272 금호대우아파트 106동', null),
    (1, '16:42', '성동구 금호로 173 신금호파크자이 101-1201', null),
    (2, '16:42', '성동구 금호로 140 금호파크힐스 103-505', null),
    (3, '16:47', '성동구 금호로 140 금호파크힐스 112-105', null),
    (4, '16:47', '성동구 금호로 140 금호파크힐스 107-1204', null),
    (5, '16:50', '성동구 행당로 82 행당한진아파트 110-1204', null),
    (6, '16:55', '성동구 행당로8길 8 행당두산위브', null)
  ) as v(seq, stop_time, address, gate)
  returning id, seq
)
insert into shuttle_assignments (stop_id, student_name_raw, class_raw, weekdays, guardian_phone)
select s63.id, a.name, a.klass, a.wd, a.phone
from s63, (values
    (0, '이해나', '6Owl', '{1,2,3,4,5}'::int[], '010-8780-9091'),
    (1, '김서진B', '5Falcon', '{1,2,3,4,5}'::int[], '010-4535-7355'),
    (2, '황은우', '5Toucan', '{1,2,3,4,5}'::int[], '010-9344-6629'),
    (3, '최이서', '6Swan', '{1,2,3,4,5}'::int[], '010-7543-0643'),
    (4, '이주환', '5Wren', '{1,2,3,4,5}'::int[], '010-5236-7516'),
    (5, '선해린', '5wren', '{1,2,3,4,5}'::int[], '010-8506-4477'),
    (6, '김승후', '학교', '{1,2,3,4,5}'::int[], '010-8010-4949')
) as a(seq, name, klass, wd, phone)
where s63.seq = a.seq;

with r64 as (
  insert into shuttle_routes (direction, route_no, name, driver_name, driver_phone, teacher_name, teacher_phone, depart_time, sort_order)
  values ('하원', '16-1', '한남/금호', '김인홍', '010-6288-0366', '양희자', '010-8651-6337', '16:00', 64)
  returning id
)
, s64 as (
  insert into shuttle_stops (route_id, seq, stop_time, address, gate)
  select r64.id, v.seq, v.stop_time, v.address, v.gate
  from r64, (values
    (0, null, '용산구 유엔빌리지길 3길 2-24 한강빌라', null),
    (1, null, '용산구 유엔빌리지길 89 힐미드빌라', null),
    (2, '16:30-40', '용산구 유엔빌리지길 62 한남리버힐 B동', null),
    (3, '16:30-40', '용산구 한남동 15-12 코번하우스 유한솔', null),
    (4, '16:45', '서울시 성동구 독서당로 218 노다은 : 성동구 독서당로 191 옥수극동아파트 2동 807호', null),
    (5, '16:50', ': 성동구 독서당로 220 바르다김선생', null),
    (6, '16:50', '성동구 옥수동 100 옥수하이츠', null)
  ) as v(seq, stop_time, address, gate)
  returning id, seq
)
insert into shuttle_assignments (stop_id, student_name_raw, class_raw, weekdays, guardian_phone)
select s64.id, a.name, a.klass, a.wd, a.phone
from s64, (values
    (0, '현이나', '5Wren', '{1,2,3,4,5}'::int[], '010-6862-0669'),
    (1, '김재이', '학교', '{1,2,3,4,5}'::int[], '010-9048-6336'),
    (2, '최서아', '학교', '{2,4}'::int[], '010-2723-2046'),
    (3, '유시연', '7Albatross', '{1,2,3,4,5}'::int[], '010-8786-0409'),
    (4, '노다혜', '학교', '{1,2,3,4,5}'::int[], '010-9703-6553'),
    (5, '문수민', null, '{1,2,3,4,5}'::int[], '010-2656-9604'),
    (6, '정이나', 'Seahawk 6', '{1,2,3,4,5}'::int[], '010-8631-4739')
) as a(seq, name, klass, wd, phone)
where s64.seq = a.seq;

with r65 as (
  insert into shuttle_routes (direction, route_no, name, driver_name, driver_phone, teacher_name, teacher_phone, depart_time, sort_order)
  values ('하원', '17', '옥수/금호', '이남희', '010-7701-2481', '김수민 Soomin', '010-2221-5965', '16:00', 65)
  returning id
)
, s65 as (
  insert into shuttle_stops (route_id, seq, stop_time, address, gate)
  select r65.id, v.seq, v.stop_time, v.address, v.gate
  from r65, (values
    (0, '16:35', '성동구 독서당로 154 레미테지', null),
    (1, '16:35', '성동구 매봉길 24 금호브라운스톤 103-801', null),
    (2, '16:40-45', null, null),
    (3, '16:40-45', '성동구 독서당로 40길 37 옥수어울림 101-1502', null),
    (4, '17:05', '성동구 성수이로 137 성수동아이파크 107동', null),
    (5, '17:05', '성동구 성수일로 4길 26 서울숲 힐스테이트 101동', null),
    (6, '17:10', '성동구 성수일로 4길 26 서울숲 힐스테이트 101동', null)
  ) as v(seq, stop_time, address, gate)
  returning id, seq
)
insert into shuttle_assignments (stop_id, student_name_raw, class_raw, weekdays, guardian_phone)
select s65.id, a.name, a.klass, a.wd, a.phone
from s65, (values
    (0, '정조이', '7Albatross', '{1,2,3,4,5}'::int[], '010-9271-5770'),
    (1, '이유하', '6Flamingo', '{1,2,3,4,5}'::int[], '010-9755-3911'),
    (3, '최이든', '6Flamingo', '{1,2,3,4,5}'::int[], '010-3719-1532'),
    (4, '조수아', '6Nightingale', '{1,2,3,4,5}'::int[], '010-6861-7698'),
    (5, '황이솔', '6Flamingo', '{1,2,3,4,5}'::int[], '010-3362-7340'),
    (6, '정유하', '4Dove', '{1,2,3,4,5}'::int[], '010-2491-3202')
) as a(seq, name, klass, wd, phone)
where s65.seq = a.seq;

with r66 as (
  insert into shuttle_routes (direction, route_no, name, driver_name, driver_phone, teacher_name, teacher_phone, depart_time, sort_order)
  values ('하원', '18', '서울숲2', '안용해  (모)', '010-4326-4094', '이서우', '010-8318-8600', '16:00', 66)
  returning id
)
, s66 as (
  insert into shuttle_stops (route_id, seq, stop_time, address, gate)
  select r66.id, v.seq, v.stop_time, v.address, v.gate
  from r66, (values
    (0, '16:50', '9월부터 성동구 왕십리로 16 트리마제 104동', null),
    (1, '16:55', '성동구 왕십리로 83-21 아크로 서울포레스트 A동 1902호', null),
    (2, '16:55', '6월부터 성동구 왕십리로 83-21 아크로 서울포레스트 A동', null),
    (3, '16:55', '6월부터 성동구 서울숲2길 32-14 갤러리아포레', null),
    (4, '16:55', null, null),
    (5, '16:55', '성동구 서울숲2길 32-14 갤러리아포레', null),
    (6, '17:00', '이태리', null),
    (7, '17:00', '성동구 성수일로 4길 26 서울숲 힐스테이트 101동', null)
  ) as v(seq, stop_time, address, gate)
  returning id, seq
)
insert into shuttle_assignments (stop_id, student_name_raw, class_raw, weekdays, guardian_phone)
select s66.id, a.name, a.klass, a.wd, a.phone
from s66, (values
    (0, '신이안', '3Robin', '{1,2,3,4,5}'::int[], '010-6530-4896'),
    (1, '이리호', '5Wren', '{1,2,3,4,5}'::int[], '010-2726-3698'),
    (2, '조이람', '4 Goldfinch', '{1,2,3,4,5}'::int[], '010-8654-3534'),
    (3, '정다우리', null, '{1,2,3,4,5}'::int[], '010-8748-0724'),
    (5, '주이안', '학교', '{1,2,3,4,5}'::int[], '010-9120-5718'),
    (6, '이태오', '6Owl', '{1,2,3,4,5}'::int[], '010-8523-8610'),
    (7, '박지아', '3Skylark', '{1,2,3,4,5}'::int[], '010-4057-6575')
) as a(seq, name, klass, wd, phone)
where s66.seq = a.seq;

with r67 as (
  insert into shuttle_routes (direction, route_no, name, driver_name, driver_phone, teacher_name, teacher_phone, depart_time, sort_order)
  values ('하원', '19', '청담1', '김복동', '010-4279-2176', '조 향 Nicole', '010-7490-9888', '16:00', 67)
  returning id
)
, s67 as (
  insert into shuttle_stops (route_id, seq, stop_time, address, gate)
  select r67.id, v.seq, v.stop_time, v.address, v.gate
  from r67, (values
    (0, '16:30', '강남구 논현동 68-4', null),
    (1, '16:30', '강남구 도산대로 230', null),
    (2, '16:38', '강남구 도산대로 410', null),
    (3, '16:38', '강남구 청담동 116 이호', null),
    (4, '16:38', '강남구 청담동 117-6 대우로얄카운티 3차', null),
    (5, '16:45-48', '강남구 도산대로 83길 35 대우리츠카운티', null),
    (6, '16:45-48', '강남구 청담동 117-22 대우리츠카운티 101동', null),
    (7, '16:50', '강남구 도산대로 85길 50-13 에테르노', null),
    (8, '16:52', '강남구 도산대로 101길 29 청담현대 3차', null)
  ) as v(seq, stop_time, address, gate)
  returning id, seq
)
insert into shuttle_assignments (stop_id, student_name_raw, class_raw, weekdays, guardian_phone)
select s67.id, a.name, a.klass, a.wd, a.phone
from s67, (values
    (0, '김태윤', '7Peacock', '{1,2,3,4,5}'::int[], '010-7575-9503'),
    (1, '권태이', '학교', '{1,2,3,4,5}'::int[], '010-8722-3060'),
    (1, '권주이', '학교', '{1,2,3,4,5}'::int[], '010-8722-3060'),
    (2, '곽호율', '학교', '{1,2,3,4,5}'::int[], '010-6602-2947'),
    (3, '이유', '/ 4 Magpie', '{1,2,3,4,5}'::int[], '010-5224-1024'),
    (4, '이서이', '4Magpie', '{1,2,3,4,5}'::int[], '010-4811-0563'),
    (5, '정유준', '7Emu', '{1,2,3,4,5}'::int[], '010-9098-3886'),
    (6, '고서윤', '학교', '{1,2,3,4,5}'::int[], '010-4173-7364'),
    (7, '황주원', '5Parrot', '{1,2,3,4,5}'::int[], '010-4137-1006'),
    (8, '우하린', '3Skylark', '{1,2,3,4,5}'::int[], '010-4222-8337')
) as a(seq, name, klass, wd, phone)
where s67.seq = a.seq;

with r68 as (
  insert into shuttle_routes (direction, route_no, name, driver_name, driver_phone, teacher_name, teacher_phone, depart_time, sort_order)
  values ('하원', '20', '청담2', '정재필', '010-5289-0441', '이연실 Jay', '010-5792-8379', '16:00', 68)
  returning id
)
, s68 as (
  insert into shuttle_stops (route_id, seq, stop_time, address, gate)
  select r68.id, v.seq, v.stop_time, v.address, v.gate
  from r68, (values
    (0, null, '서울특별시 강남구 언주로122길 34', null),
    (1, '16:30', '강남구 언주로116길 6 동부센트레빌', null),
    (2, '16:35', '강남구 선릉로130길 19 서광아파트 101동', null),
    (3, '16:35', '강남구 선릉로130길 20 래미안삼성 2차 101동', null),
    (4, '16:40-42', '강남구 선릉로126길 22 롯데캐슬프레미어 111동', null),
    (5, '16:40-42', '강남구 선릉로126길 22 롯데캐슬프레미어 105동', null),
    (6, '16:40-42', '강남구 삼성로 629 센트럴아이파크', null),
    (7, '16:48', '강남구 삼성로 629 센트럴아이파크 304동', null),
    (8, '16:48', '강남구 삼성로111길 8 힐스테이트 2차', null)
  ) as v(seq, stop_time, address, gate)
  returning id, seq
)
insert into shuttle_assignments (stop_id, student_name_raw, class_raw, weekdays, guardian_phone)
select s68.id, a.name, a.klass, a.wd, a.phone
from s68, (values
    (0, '이온유', null, '{1,2,3,4,5}'::int[], null),
    (1, '박지음', '학교', '{2,4,5}'::int[], '010-5160-9872'),
    (2, '장벨라', '3 Kiwi', '{1,2,3,4,5}'::int[], '010-9131-1651'),
    (3, '박제이', '3Kiwi', '{1,2,3,4,5}'::int[], '010-7312-2563'),
    (4, '김재이', '학교', '{1,2,3,4,5}'::int[], '010-5321-0324'),
    (5, '이서현', '학교', '{1,2,3,4,5}'::int[], '010-8908-4893'),
    (6, '지수', '학교', '{1,2,3,4,5}'::int[], '010-9087-8430'),
    (7, '박시온', '6 Owl', '{1,2,3,4,5}'::int[], '010-9086-0531'),
    (8, '황서준', '학교', '{1,2,3,4,5}'::int[], '010-2657-9828')
) as a(seq, name, klass, wd, phone)
where s68.seq = a.seq;

with r69 as (
  insert into shuttle_routes (direction, route_no, name, driver_name, driver_phone, teacher_name, teacher_phone, depart_time, sort_order)
  values ('하원', '20-1', null, '송창훈', '010-2228-8793', '김현주', '010-4755-9001', '16:00', 69)
  returning id
)
select * from r69;

with r70 as (
  insert into shuttle_routes (direction, route_no, name, driver_name, driver_phone, teacher_name, teacher_phone, depart_time, sort_order)
  values ('하원', '21', '청담3', '김진배', '010-3799-1486', '사바 Saba', '010-9865-7550', '16:00', 70)
  returning id
)
, s70 as (
  insert into shuttle_stops (route_id, seq, stop_time, address, gate)
  select r70.id, v.seq, v.stop_time, v.address, v.gate
  from r70, (values
    (0, '16:40', '강남구 삼성로147길 65 하우스에딘브로우 B동 정서호', null),
    (1, '16:40', '강남구 도산대로 70길25 청담2차이편한세상', null),
    (2, '월, 화', '강남구 선릉로132길 41 책나무', null),
    (3, '월, 화', '강남구 삼성로135길 47 한신오페라하우스 101동', null),
    (4, '16:42', '강남구 삼성로135길 47 한신오페라하우스 101동', null),
    (5, '16:47', '강남구 청담동 64-1 어퍼하우스 이현우', null)
  ) as v(seq, stop_time, address, gate)
  returning id, seq
)
insert into shuttle_assignments (stop_id, student_name_raw, class_raw, weekdays, guardian_phone)
select s70.id, a.name, a.klass, a.wd, a.phone
from s70, (values
    (0, '정혜아', '/ 5Wren', '{1,2,3,4,5}'::int[], '010-2025-3888'),
    (1, '이주아', '4Pelican', '{1,2,3,4,5}'::int[], '010-7336-7418'),
    (2, '박준후', '학교', '{1,2,3,4,5}'::int[], null),
    (3, '김지민', '학교', '{1,2,3,4,5}'::int[], '010-5100-7847'),
    (4, '강서후', '학교', '{1,2,3,4,5}'::int[], '010-6645-8648'),
    (5, '이정우', '7Peacock', '{1,2,3,4,5}'::int[], '010-9143-8857')
) as a(seq, name, klass, wd, phone)
where s70.seq = a.seq;

with r71 as (
  insert into shuttle_routes (direction, route_no, name, driver_name, driver_phone, teacher_name, teacher_phone, depart_time, sort_order)
  values ('하원', '22', '청담4', '박남홍', '010-5544-5003', '쉴라 Shiela', '010-2965-2756', '16:00', 71)
  returning id
)
, s71 as (
  insert into shuttle_stops (route_id, seq, stop_time, address, gate)
  select r71.id, v.seq, v.stop_time, v.address, v.gate
  from r71, (values
    (0, '4:30', '강남구 삼성동 16-2 삼성힐스테이트 1단지', null),
    (1, '4:38', '강남구 청담동 54-5 더갤러리파크 101호 안라엘', null),
    (2, '4:40', '강남구 청담동 67-1 린든그로브 103동 최지아', null),
    (3, '4:45', '강남구 영동대로 640 아이파크 101동', null),
    (4, '4:45', '강남구 영동대로 128길 15 아크로삼성', null),
    (5, '4:47', null, null),
    (6, '4:47', '강남구 영동대로 128길 15 아크로삼성', null),
    (7, '4:50', '강남구 영동대로 138길 12 청담자이아파트 104동', null),
    (8, '4:50', '강남구 영동대로 138길 12 청담자이아파트 104동', null),
    (9, '4:53', '강남구 영동대로 142길 21 청담마크힐스 2단지 정서우', null)
  ) as v(seq, stop_time, address, gate)
  returning id, seq
)
insert into shuttle_assignments (stop_id, student_name_raw, class_raw, weekdays, guardian_phone)
select s71.id, a.name, a.klass, a.wd, a.phone
from s71, (values
    (0, '김도현', '6 Flamingo', '{1,2,3,4,5}'::int[], '010-9808-9355'),
    (1, '안리엘', '5Toucan', '{1,2,3,4,5}'::int[], '010-6216-6292'),
    (2, '최서아', '3Kiwi', '{1,2,3,4,5}'::int[], '010-3777-0669'),
    (3, '김채윤', '5Parrot', '{1,2,3,4,5}'::int[], '010-8916-9537'),
    (4, '이세령', '6Swan', '{1,2,3,4,5}'::int[], '010-9256-2590'),
    (6, '심지훈', '7Albatross', '{1,2,3,4,5}'::int[], '010-9866-2187'),
    (7, '장슬예', '7Crane', '{1,2,3,4,5}'::int[], '010-5671-3304'),
    (8, '김리하', '5Nightingale', '{1,2,3,4,5}'::int[], '010-3396-0727'),
    (9, '정서안', '학교', '{1,2,3,4,5}'::int[], '010-9406-2143')
) as a(seq, name, klass, wd, phone)
where s71.seq = a.seq;

with r72 as (
  insert into shuttle_routes (direction, route_no, name, driver_name, driver_phone, teacher_name, teacher_phone, depart_time, sort_order)
  values ('하원', '23', '헬리오/잠실', '이종근', '010-3335-1591', 'Ms.Gabbie', '010-8095-8133', '16:00', 72)
  returning id
)
, s72 as (
  insert into shuttle_stops (route_id, seq, stop_time, address, gate)
  select r72.id, v.seq, v.stop_time, v.address, v.gate
  from r72, (values
    (0, null, '송파구 송파대로 345 헬리오시티 517동', null),
    (1, '17:00', '송파구 백제고분로 39길 21', null)
  ) as v(seq, stop_time, address, gate)
  returning id, seq
)
insert into shuttle_assignments (stop_id, student_name_raw, class_raw, weekdays, guardian_phone)
select s72.id, a.name, a.klass, a.wd, a.phone
from s72, (values
    (0, '박새얀', '5Starling', '{1,2,3,4,5}'::int[], '010-9140-1924'),
    (1, '손예진', '6Seahawk', '{1,2,3,4,5}'::int[], '010-5206-1973')
) as a(seq, name, klass, wd, phone)
where s72.seq = a.seq;

with r73 as (
  insert into shuttle_routes (direction, route_no, name, driver_name, driver_phone, teacher_name, teacher_phone, depart_time, sort_order)
  values ('하원', '23-1', '잠실/송파', '이종진', '010-3297-6117', '정성경 Mary', '010-5871-5980', '16:00', 73)
  returning id
)
, s73 as (
  insert into shuttle_stops (route_id, seq, stop_time, address, gate)
  select r73.id, v.seq, v.stop_time, v.address, v.gate
  from r73, (values
    (0, '16:50-55', '송파구 올림픽로 99 잠실엘스 124동', null),
    (1, '16:50-55', '잠실 리센츠 242동 정하준', null),
    (2, '16:50-55', '송파구 잠실로 62 트리지움 339동 (영동일고쪽정류소 )', null),
    (3, '17:00', '송파구 올림픽로 300 시그니엘', null)
  ) as v(seq, stop_time, address, gate)
  returning id, seq
)
insert into shuttle_assignments (stop_id, student_name_raw, class_raw, weekdays, guardian_phone)
select s73.id, a.name, a.klass, a.wd, a.phone
from s73, (values
    (0, '민송희', '학교', '{1,2,3,4,5}'::int[], '010-3151-2767'),
    (1, '정라원', '7Emu / 4Sparrow', '{1,2,3,4,5}'::int[], '010-8868-2860'),
    (2, '박서호', '5 Nightingale', '{1,2,3,4,5}'::int[], '010-8716-7706'),
    (3, '김정원', '5 Nightingale', '{1,2,3,4,5}'::int[], '010-5577-0033')
) as a(seq, name, klass, wd, phone)
where s73.seq = a.seq;

with r74 as (
  insert into shuttle_routes (direction, route_no, name, driver_name, driver_phone, teacher_name, teacher_phone, depart_time, sort_order)
  values ('하원', '23-2', '잠실/송파', '최재호', '010-3011-9353', 'Ms.Lan', '010-9818-8893', '16:00', 74)
  returning id
)
, s74 as (
  insert into shuttle_stops (route_id, seq, stop_time, address, gate)
  select r74.id, v.seq, v.stop_time, v.address, v.gate
  from r74, (values
    (0, '16:30', '강남구 언주로130길 30 동양파라곤 102동', null),
    (1, '16:30', '강남구 삼성동 103-22 래미안삼성 1차 303동 김시아', null),
    (2, '16:45', '강남구 봉은사로 111길 26 삼부 아파트 101동', null),
    (3, '16:45', '종합운동장사거리 버거킹앞', null),
    (4, '17:00', '송파구 올림픽로 212 갤러리아팰리스 C동', null),
    (5, '17:00', '송파구 올림픽로 35가길 9 푸르지오 월드마크 102동', null),
    (6, '17:00', '올림픽선수기자촌 (올림픽공원역 )', null)
  ) as v(seq, stop_time, address, gate)
  returning id, seq
)
insert into shuttle_assignments (stop_id, student_name_raw, class_raw, weekdays, guardian_phone)
select s74.id, a.name, a.klass, a.wd, a.phone
from s74, (values
    (0, '이건서', '4 Sparrow', '{1,2,3,4,5}'::int[], '010-7587-8852'),
    (1, '김시준', '학교', '{1,2,3,4,5}'::int[], '010-4614-9929'),
    (2, '이유성', '5 Starling', '{1,2,3,4,5}'::int[], '010-9686-5961'),
    (3, '김연수', '6 Seahawk', '{1,2,3,4,5}'::int[], '010-6308-4993'),
    (4, '서민준', '학교', '{1,2,3,4,5}'::int[], '010-2186-6134'),
    (5, '심재이', '초등', '{1,2,3,4,5}'::int[], '010-9253-3303'),
    (6, '김태리', '7 Emu', '{1,2,3,4,5}'::int[], '010-3129-1495')
) as a(seq, name, klass, wd, phone)
where s74.seq = a.seq;

with r75 as (
  insert into shuttle_routes (direction, route_no, name, driver_name, driver_phone, teacher_name, teacher_phone, depart_time, sort_order)
  values ('하원', '24', '역삼', '방현주', '010-5242-5359', '윤지영 July', '010-3711-0841', '16:00', 75)
  returning id
)
, s75 as (
  insert into shuttle_stops (route_id, seq, stop_time, address, gate)
  select r75.id, v.seq, v.stop_time, v.address, v.gate
  from r75, (values
    (0, '16:45', '강남구 언주로122길 25 두산위브 201동', null),
    (1, '16:45', '강남구 언주로122길 25 두산위브 2차 강여명', null),
    (2, '16:47', '강남구 언주로122길 6 현대넥서스 어연우', null),
    (3, '16:48', '강남구 언주로122길 34', null),
    (4, '16:49', '강남구 언주로 604 아크로힐스', null),
    (5, '16:50', '강남구 선릉로115길 39', null),
    (6, '16:52', '강남구 봉은사로 307 이안논현', null)
  ) as v(seq, stop_time, address, gate)
  returning id, seq
)
insert into shuttle_assignments (stop_id, student_name_raw, class_raw, weekdays, guardian_phone)
select s75.id, a.name, a.klass, a.wd, a.phone
from s75, (values
    (0, '유주아', '5 Starling', '{1,2,3,4,5}'::int[], '010-7297-9643'),
    (1, '강이제', '학교', '{1,2,3,4,5}'::int[], '010-5826-8910'),
    (2, '어준우', 'Seahawk / 4 Pelican', '{1,2,3,4,5}'::int[], '010-4453-3566'),
    (3, '이온유', '학교', '{1,2,3,4,5}'::int[], '010-7239-8383'),
    (4, '박이준', '7 Crane', '{1,2,3,4,5}'::int[], '010-9420-0601'),
    (5, '조아윤', '6 Kite', '{1,2,3,4,5}'::int[], '010-8080-3546'),
    (6, '최유주', '5 Parrot', '{1,2,3,4,5}'::int[], '010-6592-2468')
) as a(seq, name, klass, wd, phone)
where s75.seq = a.seq;

with r76 as (
  insert into shuttle_routes (direction, route_no, name, driver_name, driver_phone, teacher_name, teacher_phone, depart_time, sort_order)
  values ('하원', '25', '도곡', '송창석', '010-5347-2433', '한지원 Jane', '010-4877-5208', '16:00', 76)
  returning id
)
, s76 as (
  insert into shuttle_stops (route_id, seq, stop_time, address, gate)
  select r76.id, v.seq, v.stop_time, v.address, v.gate
  from r76, (values
    (0, '16:30', '강남구 테헤란로 52길 16 테헤란아이파크 101동', null),
    (1, '16:30', '강남구 테헤란로 44길 26 강남센트럴아이파크 104동', null),
    (2, '16:35-38', '강남구 역삼동 713-11 역삼아이파크 202동', null),
    (3, '16:35-38', '강남구 역삼동 713-11 역삼아이파크', null),
    (4, '16:40', '강남구 역삼로 306 개나리래미안 105동', null),
    (5, '16:30-40', '강남구 역삼로 314 개나리푸르지오', null),
    (6, '16:30-40', null, null),
    (7, '16:30-40', '강남구 언주로30길 26 타워팰리스 G', null),
    (8, '16:45-50', '강남구 언주로30길 56 타워팰리스 E동', null),
    (9, '16:45-50', '강남구 언주로30길 56 타워팰리스 E동', null)
  ) as v(seq, stop_time, address, gate)
  returning id, seq
)
insert into shuttle_assignments (stop_id, student_name_raw, class_raw, weekdays, guardian_phone)
select s76.id, a.name, a.klass, a.wd, a.phone
from s76, (values
    (0, '신예원', '4 Pelican', '{1,2,3,4,5}'::int[], '010-7176-4730'),
    (1, '홍도경', '3 Skylark', '{1,2,3,4,5}'::int[], '010-9120-1025'),
    (2, '정아인', '4 Dove', '{1,2,3,4,5}'::int[], '010-4003-1262'),
    (3, '허정원', '7 Emu', '{1,2,3,4,5}'::int[], '010-6267-0125'),
    (4, '유아린', '6 Flamingo', '{1,2,3,4,5}'::int[], '010-4340-3303'),
    (5, '리아채터', '4 Magpie', '{1,2,3,4,5}'::int[], '010-8980-5816'),
    (7, '오석', '5 Nightingale', '{1,2,3,4,5}'::int[], '010-9007-6726'),
    (8, '김태은', '5 Wren', '{1,2,3,4,5}'::int[], '010-9175-5822'),
    (9, '이해린', '3 Robin', '{1,2,3,4,5}'::int[], '010-2779-0000')
) as a(seq, name, klass, wd, phone)
where s76.seq = a.seq;

with r77 as (
  insert into shuttle_routes (direction, route_no, name, driver_name, driver_phone, teacher_name, teacher_phone, depart_time, sort_order)
  values ('하원', '26', '양재', '주의식', '010-3129-6250', '이소영', '010-9045-5200', '16:00', 77)
  returning id
)
, s77 as (
  insert into shuttle_stops (route_id, seq, stop_time, address, gate)
  select r77.id, v.seq, v.stop_time, v.address, v.gate
  from r77, (values
    (0, null, '강남구 논현동 222', null),
    (1, null, '강남구 논현로 213 역삼럭키아파트 103-908 강수빈', null),
    (2, null, '강남구 남부순환로 373길 3 도곡지웰카운티 1차', null),
    (3, null, null, null),
    (4, null, '강남구 도곡동 153-2 현대밸라하우스 8층', null),
    (5, null, null, null),
    (6, null, '강남구 도곡로 217 (카렉스앞 횡단보도 )', null),
    (7, null, '강남구 도곡로 306 래미안 그레이튼 104-1103', null)
  ) as v(seq, stop_time, address, gate)
  returning id, seq
)
insert into shuttle_assignments (stop_id, student_name_raw, class_raw, weekdays, guardian_phone)
select s77.id, a.name, a.klass, a.wd, a.phone
from s77, (values
    (0, '바이시우', '3 Kiwi', '{1,2,3,4,5}'::int[], '010-7759-8878'),
    (1, '강수현', 'Crane / 5 Starling', '{1,2,3,4,5}'::int[], '010-2725-8758'),
    (2, '전지완', '학교', '{1,2,3,4,5}'::int[], '010-8875-4490'),
    (4, '박윤솔', '7 Eagle', '{1,2,3,4,5}'::int[], '010-3665-4411'),
    (6, '이지원', '학교', '{5}'::int[], '010-7288-5702'),
    (7, '나유안', '7 Albatross', '{1,2,3,4,5}'::int[], '010-4149-3292')
) as a(seq, name, klass, wd, phone)
where s77.seq = a.seq;

with r78 as (
  insert into shuttle_routes (direction, route_no, name, driver_name, driver_phone, teacher_name, teacher_phone, depart_time, sort_order)
  values ('하원', '26-1', '삼성/도곡', '류강희', '010-9043-4589', 'Alyssa', '010-3812-1828', '16:00', 78)
  returning id
)
, s78 as (
  insert into shuttle_stops (route_id, seq, stop_time, address, gate)
  select r78.id, v.seq, v.stop_time, v.address, v.gate
  from r78, (values
    (0, null, '강남구 삼성로 403 대치사거리', null),
    (1, '17:40', '강남구 영동대로 65길 5', null),
    (2, '16:43', '강남구 대치동 932-21', null),
    (3, '16:45', '강남구 대치동 923-23', null),
    (4, '16:45', '강남구 도곡로57길 12 역삼아이파크 2차', null),
    (5, '16:48', '강남구 도곡로57길 12 역삼아이파크 2차', null),
    (6, '16:48', '강남구 언주로30길 21 아카데미스위트 A동', null),
    (7, '16:55', '강남구 언주로30길 56 타워팰리스 C동', null),
    (8, '16:55', '강남구 언주로30길 56 타워팰리스 E동 윤벨라', null)
  ) as v(seq, stop_time, address, gate)
  returning id, seq
)
insert into shuttle_assignments (stop_id, student_name_raw, class_raw, weekdays, guardian_phone)
select s78.id, a.name, a.klass, a.wd, a.phone
from s78, (values
    (0, '박지음', '학교', '{1,3}'::int[], '010-5160-9872'),
    (1, '민송희', '학교', '{2}'::int[], '010-3151-2767'),
    (1, '김재이', '학교', '{2}'::int[], '010-3151-2767'),
    (2, '이세나', '7 Albatross', '{1,2,3,4,5}'::int[], '010-2816-2079'),
    (3, '김도은', '학교', '{1,2,3,4,5}'::int[], '010-4739-6231'),
    (4, '이한범', '학교', '{1,2,3,4}'::int[], '010-7722-2879'),
    (5, '원세빈', '학교', '{1,2,3,4,5}'::int[], '010-5813-0000'),
    (6, '권수호', '학교', '{1,2,3,4,5}'::int[], '010-2748-9949'),
    (7, '오유준', '3 Kiwi', '{1,2,3,4,5}'::int[], '010-9090-7199'),
    (8, '윤엘라', '3 Skylark', '{1,2,3,4,5}'::int[], '010-3600-2252')
) as a(seq, name, klass, wd, phone)
where s78.seq = a.seq;

with r79 as (
  insert into shuttle_routes (direction, route_no, name, driver_name, driver_phone, teacher_name, teacher_phone, depart_time, sort_order)
  values ('하원', '26-2', '삼성/도곡', '김남규', '010-5771-1358', '조이 Joy', '010-6480-0499', '16:00', 79)
  returning id
)
, s79 as (
  insert into shuttle_stops (route_id, seq, stop_time, address, gate)
  select r79.id, v.seq, v.stop_time, v.address, v.gate
  from r79, (values
    (0, null, '강남구 삼성동 65-4 상지리츠빌 카일룸 4차', null),
    (1, '16:30', null, null),
    (2, '16:30', null, null),
    (3, '16:32', '강남구 삼성로112길 31-14 황시원', null),
    (4, '16:32', '강남구 학동로 607 청담르엘 105동', null),
    (5, '16:32', '강남구 학동로 607 청담르엘', null),
    (6, '16:40', '강남구 학동로 607 청담르엘', null),
    (7, '16:40', '강남구 학동로 607 청담르엘', null),
    (8, '16:50', '광진두산위브파크', null)
  ) as v(seq, stop_time, address, gate)
  returning id, seq
)
insert into shuttle_assignments (stop_id, student_name_raw, class_raw, weekdays, guardian_phone)
select s79.id, a.name, a.klass, a.wd, a.phone
from s79, (values
    (0, '김우진', '5 Toucan', '{1,2,3,4,5}'::int[], '010-9140-1471'),
    (1, '박지우', '3 Skylark', '{1,2,3,4,5}'::int[], '010-9140-1471'),
    (3, '황이준', '학교', '{1,2,3,4,5}'::int[], '010-8686-8118'),
    (4, '이예나', '학교', '{1,2,3,4,5}'::int[], '010-8754-2684'),
    (5, '고이건', '학교', '{1,2,3,4,5}'::int[], null),
    (6, '박세훈', '5 Parrot', '{1,2,3,4,5}'::int[], '010-8013-0403'),
    (7, '염시후', '6 Flamingo', '{1,2,3,4,5}'::int[], '010-3685-1459'),
    (8, '이서온', '6 Seahawk', '{1,2,3,4,5}'::int[], '010-4766-3896')
) as a(seq, name, klass, wd, phone)
where s79.seq = a.seq;

with r80 as (
  insert into shuttle_routes (direction, route_no, name, driver_name, driver_phone, teacher_name, teacher_phone, depart_time, sort_order)
  values ('하원', '27', '개포/일원', '박광득', '010-3256-6014', '양영승 Cindy', '010-2397-3815', '16:00', 80)
  returning id
)
, s80 as (
  insert into shuttle_stops (route_id, seq, stop_time, address, gate)
  select r80.id, v.seq, v.stop_time, v.address, v.gate
  from r80, (values
    (0, '16:35', '강남구 논현로64길 7 역삼청소년센터', null),
    (1, '16:35', '강남구 개포로 264 개포래미안포레스트 109동', null),
    (2, '16:45', '강남구 개포로 264 개포래미안포레스트 116동', null),
    (3, '16:50', '디에이치아이파크퍼스티어 아파트 143동', null),
    (4, '16:50', '강남구 삼성로 14 개포자이 프레지던스', null),
    (5, '17:00', '강남구 영동대로 16 상록스타힐스아파트', null)
  ) as v(seq, stop_time, address, gate)
  returning id, seq
)
insert into shuttle_assignments (stop_id, student_name_raw, class_raw, weekdays, guardian_phone)
select s80.id, a.name, a.klass, a.wd, a.phone
from s80, (values
    (0, '이예온', '학교', '{1,2,4}'::int[], '010-4256-8836'),
    (1, '서창현', '7 Emu', '{1,2,3,4,5}'::int[], '010-5175-3868'),
    (2, '임하임', '학교', '{1,2,3,4,5}'::int[], '010-9389-6648'),
    (3, '강로완', '5 Flacon', '{1,2,3,4,5}'::int[], '010-2326-0354'),
    (4, '김연우', '6 Kite', '{1,2,3,4,5}'::int[], '010-2775-1534'),
    (5, '강하영', '학교', '{1,2,3,4,5}'::int[], '010-2839-0180')
) as a(seq, name, klass, wd, phone)
where s80.seq = a.seq;

with r81 as (
  insert into shuttle_routes (direction, route_no, name, driver_name, driver_phone, teacher_name, teacher_phone, depart_time, sort_order)
  values ('하원', '28', '대치', '정재용', '010-5396-8109', null, null, '16:00', 81)
  returning id
)
, s81 as (
  insert into shuttle_stops (route_id, seq, stop_time, address, gate)
  select r81.id, v.seq, v.stop_time, v.address, v.gate
  from r81, (values
    (0, '4:30', '한티역 5, 6번 출구', null),
    (1, '4:30', '강남구 삼성로51길 25 대치sk뷰', null),
    (2, '4:45', '강남구 영동대로 210 쌍용아파트 5동 문준연', null),
    (3, '4:46', '강남구 영동대로 210 쌍용아파트 3동', null),
    (4, '4:50', '강남구 영동대로 210 쌍용아파트 상가', null),
    (5, '4:50', '강남구 영동대로 221 담담 선생님: 김효정 Anna 010-5492-2747', null)
  ) as v(seq, stop_time, address, gate)
  returning id, seq
)
insert into shuttle_assignments (stop_id, student_name_raw, class_raw, weekdays, guardian_phone)
select s81.id, a.name, a.klass, a.wd, a.phone
from s81, (values
    (0, '이예온', '학교', '{3,5}'::int[], '010-4256-8836'),
    (1, '강이준', '3 Skylark', '{1,2,3,4,5}'::int[], '010-9974-9592'),
    (2, '문정민', '학교 / 6 Kite', '{1,4,5}'::int[], '010-9136-4946'),
    (3, '이예온', '5 Flacon', '{1,3,5}'::int[], '010-3700-8489'),
    (4, '이한범', '학교', '{5}'::int[], '010-7722-2879'),
    (5, '남가인', '학교', '{2}'::int[], '010-5485-3270')
) as a(seq, name, klass, wd, phone)
where s81.seq = a.seq;

with r82 as (
  insert into shuttle_routes (direction, route_no, name, driver_name, driver_phone, teacher_name, teacher_phone, depart_time, sort_order)
  values ('하원', '29', '건대/광장동', '이기수', '010-8996-6170', '추수미 Sumi', '010-8212-5527', '16:00', 82)
  returning id
)
, s82 as (
  insert into shuttle_stops (route_id, seq, stop_time, address, gate)
  select r82.id, v.seq, v.stop_time, v.address, v.gate
  from r82, (values
    (0, '16:45', '광진구 능동로4길 40 이튼리버타워 5차 B동', null),
    (1, '16:45', '광진구 아차산로 262 더샾스타시티 D동', null),
    (2, '16:52', '광진구 아차산로 262 더샾스타시티 김이준', null),
    (3, '16:52', '광진구 아차산로 549 광장현대파크빌 1007동', null),
    (4, '17:03', '광진구 아차산로 453 미술학원', null),
    (5, '17:03', '광장동 월드메르디앙 1차', null)
  ) as v(seq, stop_time, address, gate)
  returning id, seq
)
insert into shuttle_assignments (stop_id, student_name_raw, class_raw, weekdays, guardian_phone)
select s82.id, a.name, a.klass, a.wd, a.phone
from s82, (values
    (0, '김리아', '7 Peacock', '{1,2,3,4,5}'::int[], '010-5161-2510'),
    (1, '홍리아', '4 Dove', '{1,2,3,4,5}'::int[], '010-8922-1076'),
    (2, '김로이B', 'Crane / 5 Toucan', '{1,2,3,4,5}'::int[], '010-2850-0064'),
    (3, '노유겸', '학교', '{1,2,3,4,5}'::int[], '010-3200-6207'),
    (4, '노유겸', '학교', '{1,2,3,4,5}'::int[], '010-3200-6207'),
    (5, '조여람', null, '{1,2,3,4,5}'::int[], '010-2528-8616')
) as a(seq, name, klass, wd, phone)
where s82.seq = a.seq;

with r83 as (
  insert into shuttle_routes (direction, route_no, name, driver_name, driver_phone, teacher_name, teacher_phone, depart_time, sort_order)
  values ('하원', '30', '압구정/옥수', '김경갑', '010-5323-9980', 'Carla', '010-6869-8992', '16:00', 83)
  returning id
)
, s83 as (
  insert into shuttle_stops (route_id, seq, stop_time, address, gate)
  select r83.id, v.seq, v.stop_time, v.address, v.gate
  from r83, (values
    (0, '16:25', '강남구 압구정로 42길 78 압구정하이츠파크 B동', null),
    (1, '16:30', '압구정 현대 91동', null),
    (2, '16:35', '강남구 압구정로 347 한양아파트 25동', null),
    (3, '16:38', '압구정 한양 72동', null),
    (4, '16:38', '강남구 압구정로 75길 27 청담101 A동', null),
    (5, '16:38', '강남구 청담동 102-2 연세힐하우스', null),
    (6, '16:45', '강남구 청담동 115-5', null),
    (7, '16:45', '강남구 청담동 116-2 두산빌라 김리안', null)
  ) as v(seq, stop_time, address, gate)
  returning id, seq
)
insert into shuttle_assignments (stop_id, student_name_raw, class_raw, weekdays, guardian_phone)
select s83.id, a.name, a.klass, a.wd, a.phone
from s83, (values
    (0, '이아인', '학교', '{1,2,3,4,5}'::int[], '010-6889-2937'),
    (1, '한우영', '학교', '{1,2,3,4,5}'::int[], '010-5148-3885'),
    (2, '유태정', '4 Pelican', '{1,2,3,4,5}'::int[], '010-7153-3903'),
    (3, '김태리', '7 Emu', '{1,2,3,4,5}'::int[], '010-4504-9451'),
    (4, '장유안', '4 Sparrow', '{1,2,3,4,5}'::int[], '010-9435-6770'),
    (5, '김이안', '5 Falcon', '{1,2,3,4,5}'::int[], '010-4827-7754'),
    (6, '배서준', '7 Emu', '{1,2,3,4,5}'::int[], '010-6749-7271'),
    (7, '김현수', '학교', '{1,2,3,4,5}'::int[], '010-8760-9264')
) as a(seq, name, klass, wd, phone)
where s83.seq = a.seq;

with r84 as (
  insert into shuttle_routes (direction, route_no, name, driver_name, driver_phone, teacher_name, teacher_phone, depart_time, sort_order)
  values ('하원', '30-1', '압구정', '손창기', '010-2889-2257', null, null, '16:00', 84)
  returning id
)
, s84 as (
  insert into shuttle_stops (route_id, seq, stop_time, address, gate)
  select r84.id, v.seq, v.stop_time, v.address, v.gate
  from r84, (values
    (0, null, '압구정 현대 24동', null),
    (1, null, '압구정 현대 25동', null),
    (2, '16:30', '압구정 현대 25동', null),
    (3, '16:30', '압구정 현대 25동', null),
    (4, '16:32', '압구정 현대 63동', null),
    (5, '16:32', '압구정 현대 116동', null),
    (6, '16:35', '압구정 현대 203동', null),
    (7, '16:35', '압구정 현대 211동', null),
    (8, '16:35', '호산여성병원', null),
    (9, '16:35', '강서면옥 하원 31 - 건대', null),
    (10, '16:35', '광진두산위브파크 강하늘', null),
    (11, '16:35', '광진두산위브파크 제이콥', null),
    (12, '16:35', '중/고등학생', null)
  ) as v(seq, stop_time, address, gate)
  returning id, seq
)
insert into shuttle_assignments (stop_id, student_name_raw, class_raw, weekdays, guardian_phone)
select s84.id, a.name, a.klass, a.wd, a.phone
from s84, (values
    (0, '조이안', '4 Goldfinch', '{1,2,3,4,5}'::int[], '010-8882-8688'),
    (1, '백서아', '학교', '{1,2,3,4,5}'::int[], '010-4785-9973'),
    (2, '홍지아', '4 Magpie', '{1,2,3,4,5}'::int[], '010-8981-6856'),
    (3, '배아린', '5 Nightingale', '{1,2,3,4,5}'::int[], '010-8702-5593'),
    (3, '등원', '5 Nightingale', '{1,2,3,4,5}'::int[], '010-8702-5593'),
    (4, '이서아', '5 Nightingale', '{1,2,3,4,5}'::int[], '010-9173-6033'),
    (5, '이하윤', '4 Pelican', '{1,2,3,4,5}'::int[], '010-6634-4085'),
    (6, '이라엘', '학교', '{1,2,3,4,5}'::int[], '010-6538-6529'),
    (7, '정승준', '5 Cardinal', '{1,2,3,4,5}'::int[], '010-3136-0969'),
    (8, '이세린', '학교', '{5}'::int[], null),
    (9, '박진우', '학교', '{4}'::int[], '010-9466-9779'),
    (10, '강하엘', '학교', '{1,2,3,4,5}'::int[], '010-2900-6454'),
    (11, '일라이아', '학교', '{1,2,3,4,5}'::int[], null),
    (12, '장하영', '학교', '{1,2,3,4,5}'::int[], null)
) as a(seq, name, klass, wd, phone)
where s84.seq = a.seq;

with r85 as (
  insert into shuttle_routes (direction, route_no, name, driver_name, driver_phone, teacher_name, teacher_phone, depart_time, sort_order)
  values ('하원', '31-1', '중구', '이종근', '010-3335-1591', '김종희', '010-2991-3806', '16:00', 85)
  returning id
)
, s85 as (
  insert into shuttle_stops (route_id, seq, stop_time, address, gate)
  select r85.id, v.seq, v.stop_time, v.address, v.gate
  from r85, (values
    (0, '16:50', '중구 정동길 21-31 정동상림원 B동', null),
    (1, '16:50', '종로구 사직로8길 4 광화문스페이스본 1단지', null),
    (2, '16:50', '종로구 사직로8길 4 광화문스페이스본 2단지 놀이터앞', null),
    (3, '16:50', '중구 통일로 102, 바비엔스위트 Maria 등교 - 중구', null),
    (4, '7:28', '종로구 사직로8길 4 광화문스페이스본 1단지 개구리 연못', null),
    (5, '7:29', '종로구 사직로8길 4 광화문스페이스본 2단지 놀이터앞', null),
    (6, '7:35', '종로구 송월길99 경희궁자이 2단지 후문', null),
    (7, '7:40', '중구 통일로 102, 바비엔스위트 Maria', null)
  ) as v(seq, stop_time, address, gate)
  returning id, seq
)
insert into shuttle_assignments (stop_id, student_name_raw, class_raw, weekdays, guardian_phone)
select s85.id, a.name, a.klass, a.wd, a.phone
from s85, (values
    (0, '심규원', '4 Dove', '{1,2,3,4,5}'::int[], '010-3564-9153'),
    (1, '민경건', '학교', '{1,2,3,4,5}'::int[], null),
    (2, '박진우', '학교', '{1,2,3,4,5}'::int[], '010-9466-9779'),
    (4, '민경건', '학교', '{1,2,3,4,5}'::int[], null),
    (5, '박진우', '학교', '{1,2,3,4,5}'::int[], '010-9466-9779'),
    (6, '정민호', '학교', '{1,2,3,4,5}'::int[], '01091876548')
) as a(seq, name, klass, wd, phone)
where s85.seq = a.seq;

-- 이름이 명부에 정확히 한 명만 있는 경우 자동으로 학생 레코드와 연결합니다.
-- (김연우A처럼 A/B가 붙은 표기는 뒤 글자를 떼고 한 번 더 시도합니다. 동명이인이라 여러 명이
--  잡히는 경우는 연결하지 않고 남겨두어 화면에서 직접 고르도록 합니다.)
-- 이름이 명부에 정확히 한 명만 있는 경우 자동으로 학생 레코드와 연결합니다.
-- (김연우A처럼 A/B가 붙은 표기는 뒤 글자를 떼고 맞춰봅니다. 동명이인이라 여러 명이 잡히는
--  경우는 연결하지 않고 남겨두어 화면에서 직접 고르도록 합니다 - ⚠️로 표시됩니다.)
-- uuid에는 min()이 없어서 array_agg로 하나를 꺼냅니다(having count(*)=1이라 어차피 한 건입니다).
update shuttle_assignments sa
set student_id = m.student_id
from (
  select sa2.id as asg_id, (array_agg(ws.id))[1] as student_id
  from shuttle_assignments sa2
  join wr_students ws
    on ws.status = 'active'
   and ws.name = regexp_replace(sa2.student_name_raw, '[AB]$', '')
  where sa2.student_id is null
  group by sa2.id
  having count(*) = 1
) m
where sa.id = m.asg_id;
