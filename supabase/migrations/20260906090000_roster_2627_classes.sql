-- ===== 26-27 명부 기준으로 학년·반 맞추기 =====
--
-- 학교에서 받은 26-27 명부(초등부 102명 · 중고등부 36명)를 정답으로 두고, 앱의 학년·반
-- 배정을 그 명부에 맞춥니다. 특히 4학년이 크게 재편되어 앱과 실제가 어긋나 있었습니다.
--
-- **손대는 칸은 학년·반·부서뿐입니다.** 연락처·알레르기·악기·셔틀·교복 사이즈처럼 그동안
-- 화면에서 고쳐온 값은 건드리지 않습니다 - 명부 PDF가 그 칸들에서는 앱보다 오래된 자료일 수
-- 있고, 사람이 고쳐둔 것을 일괄 처리가 되돌리는 일은 이 저장소에서 이미 여러 번 났습니다.
--
-- 짝짓기는 **이름 + 생년월일**로 합니다. 이름만으로는 안 됩니다 - 김재이가 셋(G2C·G2A·G3JA),
-- 이준서가 둘(3학년 Justin Lee / G9 Paul Lee), June Hwang·Roy Lee·Teddy Kim·Jay Kim도
-- 각각 둘씩입니다. 생년월일이 없는 줄은 영문 이름으로 한 번 더 찾되, 후보가 둘 이상이면
-- 건너뛰고 아래 알림에 남깁니다.
--
-- 명부에 없는 재학생은 **지우지 않습니다.** 전출인지 명부 누락인지 여기서는 알 수 없어서,
-- 알림으로만 띄우고 사람이 [학생 → 명부 관리]에서 판단하도록 둡니다. 조용히 사라지는 것이
-- 가장 나쁩니다.

create temporary table _r2627 (
  name text, name_en text, birth_date date, gender text,
  grade text, class_name text, class_id uuid, department text
) on commit drop;

insert into _r2627 (name, name_en, birth_date, gender, grade, class_name, class_id, department) values
  ('이신원', 'Max Lee', date '2019-08-20', '남', '2', 'G2J', uuid '3a000000-0000-4000-a000-000000000001', '초등부'),
  ('노유겸', 'Noah Roh', date '2019-12-24', '남', '2', 'G2J', uuid '3a000000-0000-4000-a000-000000000001', '초등부'),
  ('주이안', 'Ian Ju', date '2019-03-15', '남', '2', 'G2J', uuid '3a000000-0000-4000-a000-000000000001', '초등부'),
  ('문준연', 'Joon Moon', date '2019-09-05', '남', '2', 'G2J', uuid '3a000000-0000-4000-a000-000000000001', '초등부'),
  ('김서준', 'Leo Kim', date '2019-05-20', '남', '2', 'G2J', uuid '3a000000-0000-4000-a000-000000000001', '초등부'),
  ('김준영', 'Junyoung Kim', date '2019-02-23', '남', '2', 'G2J', uuid '3a000000-0000-4000-a000-000000000001', '초등부'),
  ('이연우', 'Yeni Lee', date '2019-10-22', '여', '2', 'G2J', uuid '3a000000-0000-4000-a000-000000000001', '초등부'),
  ('심규민', 'Gyumin Shim', date '2019-07-04', '여', '2', 'G2J', uuid '3a000000-0000-4000-a000-000000000001', '초등부'),
  ('황라원', 'Sophia Hwang', date '2019-02-07', '여', '2', 'G2J', uuid '3a000000-0000-4000-a000-000000000001', '초등부'),
  ('신민하', 'Brooklyn Shin', date '2019-07-23', '여', '2', 'G2J', uuid '3a000000-0000-4000-a000-000000000001', '초등부'),
  ('이예나', 'Eliana Lee', date '2019-06-24', '여', '2', 'G2J', uuid '3a000000-0000-4000-a000-000000000001', '초등부'),
  ('김나율', 'Anna Kim', date '2019-05-14', '여', '2', 'G2J', uuid '3a000000-0000-4000-a000-000000000001', '초등부'),
  ('이라엘', 'Lael Lee', date '2019-01-11', '여', '2', 'G2J', uuid '3a000000-0000-4000-a000-000000000001', '초등부'),
  ('권태이', 'Tay Kwon', date '2019-09-12', '남', '2', 'G2C', uuid '3a000000-0000-4000-a000-000000000002', '초등부'),
  ('전준백', 'Justin Jeon', date '2019-04-29', '남', '2', 'G2C', uuid '3a000000-0000-4000-a000-000000000002', '초등부'),
  ('전지완', 'Eric Jeon', date '2019-10-08', '남', '2', 'G2C', uuid '3a000000-0000-4000-a000-000000000002', '초등부'),
  ('황이안', 'Ian Hwang', date '2019-12-01', '남', '2', 'G2C', uuid '3a000000-0000-4000-a000-000000000002', '초등부'),
  ('이현우', 'Harry Lee', date '2019-01-07', '남', '2', 'G2C', uuid '3a000000-0000-4000-a000-000000000002', '초등부'),
  ('김준원', 'Junwon Kim', date '2019-02-23', '남', '2', 'G2C', uuid '3a000000-0000-4000-a000-000000000002', '초등부'),
  ('박하솜', 'Hasom Park', date '2019-02-09', '여', '2', 'G2C', uuid '3a000000-0000-4000-a000-000000000002', '초등부'),
  ('김재이', 'Jay Kim', date '2019-05-10', '여', '2', 'G2C', uuid '3a000000-0000-4000-a000-000000000002', '초등부'),
  ('이아인', 'Ayn Lee', date '2019-12-30', '여', '2', 'G2C', uuid '3a000000-0000-4000-a000-000000000002', '초등부'),
  ('고서윤', 'Jenny Go', date '2019-01-08', '여', '2', 'G2C', uuid '3a000000-0000-4000-a000-000000000002', '초등부'),
  ('이은재', 'Ellie Lee', date '2019-04-18', '여', '2', 'G2C', uuid '3a000000-0000-4000-a000-000000000002', '초등부'),
  ('김사랑', 'Benecia Kim', date '2019-08-21', '여', '2', 'G2C', uuid '3a000000-0000-4000-a000-000000000002', '초등부'),
  ('백서아', 'Ruby Paik', date '2019-08-07', '여', '2', 'G2C', uuid '3a000000-0000-4000-a000-000000000002', '초등부'),
  ('황라윤', 'Bella Hwang', date '2019-02-07', '여', '2', 'G2C', uuid '3a000000-0000-4000-a000-000000000002', '초등부'),
  ('김도은', 'Rogan Kim', date '2019-02-07', '남', '2', 'G2A', uuid '3a000000-0000-4000-a000-000000000003', '초등부'),
  ('고진우', 'Jinwoo Ko', date '2019-09-01', '남', '2', 'G2A', uuid '3a000000-0000-4000-a000-000000000003', '초등부'),
  ('김단우', 'Danu Kim', date '2019-09-08', '남', '2', 'G2A', uuid '3a000000-0000-4000-a000-000000000003', '초등부'),
  ('이서준', 'Seojun Lee', date '2019-07-30', '남', '2', 'G2A', uuid '3a000000-0000-4000-a000-000000000003', '초등부'),
  ('서민준', 'Eden Seo', date '2019-11-05', '남', '2', 'G2A', uuid '3a000000-0000-4000-a000-000000000003', '초등부'),
  ('박세인', 'Clara Park', date '2019-09-26', '여', '2', 'G2A', uuid '3a000000-0000-4000-a000-000000000003', '초등부'),
  ('한우영', 'Zoe Han', date '2019-10-21', '여', '2', 'G2A', uuid '3a000000-0000-4000-a000-000000000003', '초등부'),
  ('곽세린', 'Celine Kwak', date '2019-10-23', '여', '2', 'G2A', uuid '3a000000-0000-4000-a000-000000000003', '초등부'),
  ('박세주', 'Reina Park', date '2019-05-30', '여', '2', 'G2A', uuid '3a000000-0000-4000-a000-000000000003', '초등부'),
  ('김재이', 'Jay Kim', date '2019-08-28', '여', '2', 'G2A', uuid '3a000000-0000-4000-a000-000000000003', '초등부'),
  ('원세빈', 'Sophia Won', date '2019-03-12', '여', '2', 'G2A', uuid '3a000000-0000-4000-a000-000000000003', '초등부'),
  ('심재이', 'Jay Shim', date '2019-03-02', '여', '2', 'G2A', uuid '3a000000-0000-4000-a000-000000000003', '초등부'),
  ('조하윤', 'Esther Jo', date '2019-08-30', '여', '2', 'G2A', uuid '3a000000-0000-4000-a000-000000000003', '초등부'),
  ('연하윤', 'Hayoon Yon', date '2019-10-08', '여', '2', 'G2A', uuid '3a000000-0000-4000-a000-000000000003', '초등부'),
  ('황이준', 'June Hwang', date '2018-07-07', '남', '3', 'G3JU', uuid '3a000000-0000-4000-a000-000000000004', '초등부'),
  ('이준원', 'Jun Lee', date '2018-03-14', '남', '3', 'G3JU', uuid '3a000000-0000-4000-a000-000000000004', '초등부'),
  ('유한솔', 'Kai Yoo', date '2017-01-22', '남', '3', 'G3JU', uuid '3a000000-0000-4000-a000-000000000004', '초등부'),
  ('엄하율', 'Henry Hayule Eom', date '2018-06-08', '남', '3', 'G3JU', uuid '3a000000-0000-4000-a000-000000000004', '초등부'),
  ('강이제', 'Ije Kang', date '2018-09-24', '남', '3', 'G3JU', uuid '3a000000-0000-4000-a000-000000000004', '초등부'),
  ('김현수', 'Hans Kim', date '2018-07-28', '남', '3', 'G3JU', uuid '3a000000-0000-4000-a000-000000000004', '초등부'),
  ('홍서형', 'Danny Hong', date '2018-07-12', '남', '3', 'G3JU', uuid '3a000000-0000-4000-a000-000000000004', '초등부'),
  ('민노엘', 'Noel Min', date '2018-10-28', '남', '3', 'G3JU', uuid '3a000000-0000-4000-a000-000000000004', '초등부'),
  ('정세진', 'Emma Jung', date '2018-01-13', '여', '3', 'G3JU', uuid '3a000000-0000-4000-a000-000000000004', '초등부'),
  ('최서아', 'Sarah Choi', date '2018-05-28', '여', '3', 'G3JU', uuid '3a000000-0000-4000-a000-000000000004', '초등부'),
  ('민송희', 'Sophia Min', date '2018-06-27', '여', '3', 'G3JU', uuid '3a000000-0000-4000-a000-000000000004', '초등부'),
  ('임다현', 'Diane Lim', date '2018-09-27', '여', '3', 'G3JU', uuid '3a000000-0000-4000-a000-000000000004', '초등부'),
  ('임예나', 'Grace Lim', date '2018-08-18', '여', '3', 'G3JU', uuid '3a000000-0000-4000-a000-000000000004', '초등부'),
  ('이서아', 'Vivian Lee', date '2018-10-22', '여', '3', 'G3JU', uuid '3a000000-0000-4000-a000-000000000004', '초등부'),
  ('차봄', 'Bom Cha', date '2018-10-30', '여', '3', 'G3JU', uuid '3a000000-0000-4000-a000-000000000004', '초등부'),
  ('황시원', 'Sean Hwang', date '2018-07-07', '남', '3', 'G3JA', uuid '3a000000-0000-4000-a000-000000000005', '초등부'),
  ('지수', 'Soo Ji', date '2018-03-20', '남', '3', 'G3JA', uuid '3a000000-0000-4000-a000-000000000005', '초등부'),
  ('임주한', 'Juhan Lim', date '2018-08-30', '남', '3', 'G3JA', uuid '3a000000-0000-4000-a000-000000000005', '초등부'),
  ('이주원', 'Benny Lee', date '2018-08-13', '남', '3', 'G3JA', uuid '3a000000-0000-4000-a000-000000000005', '초등부'),
  ('이준서', 'Justin Lee', date '2018-05-21', '남', '3', 'G3JA', uuid '3a000000-0000-4000-a000-000000000005', '초등부'),
  ('정레인', 'Rain Jung', date '2018-01-18', '남', '3', 'G3JA', uuid '3a000000-0000-4000-a000-000000000005', '초등부'),
  ('강서후', 'Seohu Kang', date '2018-12-05', '남', '3', 'G3JA', uuid '3a000000-0000-4000-a000-000000000005', '초등부'),
  ('송윤진', 'Diana Song', date '2018-10-01', '여', '3', 'G3JA', uuid '3a000000-0000-4000-a000-000000000005', '초등부'),
  ('이예온', 'Grace Lee', date '2018-11-13', '여', '3', 'G3JA', uuid '3a000000-0000-4000-a000-000000000005', '초등부'),
  ('정이엘', 'E.L. Jeong', date '2018-10-10', '여', '3', 'G3JA', uuid '3a000000-0000-4000-a000-000000000005', '초등부'),
  ('이서현', 'Elizabeth Lee', date '2018-03-12', '여', '3', 'G3JA', uuid '3a000000-0000-4000-a000-000000000005', '초등부'),
  ('김재이', 'Jay Kim', date '2018-09-27', '여', '3', 'G3JA', uuid '3a000000-0000-4000-a000-000000000005', '초등부'),
  ('정겨울', 'Wynter Jeong', date '2018-01-13', '여', '3', 'G3JA', uuid '3a000000-0000-4000-a000-000000000005', '초등부'),
  ('Maya Amelia Dowding', 'Maya Amelia Dowding', date '2018-05-19', '여', '3', 'G3JA', uuid '3a000000-0000-4000-a000-000000000005', '초등부'),
  ('곽호율', 'James Kwak', date '2017-10-04', '남', '4', 'G4R', uuid '3a000000-0000-4000-a000-000000000006', '초등부'),
  ('유재이', 'Jay Yu', date '2017-12-12', '남', '4', 'G4R', uuid '3a000000-0000-4000-a000-000000000006', '초등부'),
  ('고이건', 'Eagon Koh', date '2017-07-19', '남', '4', 'G4R', uuid '3a000000-0000-4000-a000-000000000006', '초등부'),
  ('홍동은', 'Jaden Hong', date '2017-11-01', '남', '4', 'G4R', uuid '3a000000-0000-4000-a000-000000000006', '초등부'),
  ('조장훈', 'Janghoon Cho', date '2017-09-16', '남', '4', 'G4R', uuid '3a000000-0000-4000-a000-000000000006', '초등부'),
  ('김태오', 'Theo Kim', date '2017-07-17', '남', '4', 'G4R', uuid '3a000000-0000-4000-a000-000000000006', '초등부'),
  ('정서우', 'Stella Jung', date '2017-10-23', '여', '4', 'G4R', uuid '3a000000-0000-4000-a000-000000000006', '초등부'),
  ('강하라', 'Hara Kang', date '2017-08-30', '여', '4', 'G4R', uuid '3a000000-0000-4000-a000-000000000006', '초등부'),
  ('마리아 파즈 마누키안', 'Maria Paz Manoukian', date '2017-08-17', '여', '4', 'G4R', uuid '3a000000-0000-4000-a000-000000000006', '초등부'),
  ('장예나', 'Yeana Jang', date '2017-03-22', '여', '4', 'G4R', uuid '3a000000-0000-4000-a000-000000000006', '초등부'),
  ('임하임', 'Blaire Lim', date '2017-04-17', '여', '4', 'G4R', uuid '3a000000-0000-4000-a000-000000000006', '초등부'),
  ('권수호', 'Teddy Kwon', date '2017-06-27', '남', '4', 'G4S', uuid '3a000000-0000-4000-a000-000000000007', '초등부'),
  ('김동하', 'Dongha Kim', date '2017-01-11', '남', '4', 'G4S', uuid '3a000000-0000-4000-a000-000000000007', '초등부'),
  ('황준호', 'June Hwang', date '2017-12-11', '남', '4', 'G4S', uuid '3a000000-0000-4000-a000-000000000007', '초등부'),
  ('김서진', 'Seojin Kim', date '2017-01-28', '남', '4', 'G4S', uuid '3a000000-0000-4000-a000-000000000007', '초등부'),
  ('임선우', 'Sunwoo Lim', date '2017-09-16', '남', '4', 'G4S', uuid '3a000000-0000-4000-a000-000000000007', '초등부'),
  ('홍선우', 'Sunwoo Hong', date '2016-11-02', '남', '4', 'G4S', uuid '3a000000-0000-4000-a000-000000000007', '초등부'),
  ('정하임', 'Hayim (Peyton) Jung', date '2017-05-22', '여', '4', 'G4S', uuid '3a000000-0000-4000-a000-000000000007', '초등부'),
  ('김서이', 'Victoria Kim', date '2017-10-28', '여', '4', 'G4S', uuid '3a000000-0000-4000-a000-000000000007', '초등부'),
  ('김지민', 'Jimin Kim', date '2017-05-26', '여', '4', 'G4S', uuid '3a000000-0000-4000-a000-000000000007', '초등부'),
  ('남가인', 'Gahin Nam', date '2017-10-21', '여', '4', 'G4S', uuid '3a000000-0000-4000-a000-000000000007', '초등부'),
  ('임지효', 'Jihyo Yim', date '2016-07-27', '여', '5', 'G5E', uuid '3a000000-0000-4000-a000-000000000008', '초등부'),
  ('최서연', 'Seoyeon Choi', date '2016-12-02', '여', '5', 'G5E', uuid '3a000000-0000-4000-a000-000000000008', '초등부'),
  ('강예성', 'Yesung Kang', date '2016-02-05', '남', '5', 'G5E', uuid '3a000000-0000-4000-a000-000000000008', '초등부'),
  ('이한범', 'Danny Lee', date '2016-04-02', '남', '5', 'G5E', uuid '3a000000-0000-4000-a000-000000000008', '초등부'),
  ('김리안', 'Rian Kim', date '2016-06-02', '여', '5', 'G5E', uuid '3a000000-0000-4000-a000-000000000008', '초등부'),
  ('강하늘', 'Skye (Haneul) Kang', date '2016-10-14', '여', '5', 'G5E', uuid '3a000000-0000-4000-a000-000000000008', '초등부'),
  ('김태윤', 'Teddy Kim', date '2016-12-05', '남', '5', 'G5E', uuid '3a000000-0000-4000-a000-000000000008', '초등부'),
  ('이온유', 'Roy Lee', date '2016-10-25', '남', '5', 'G5E', uuid '3a000000-0000-4000-a000-000000000008', '초등부'),
  ('송우진', 'Daniel Song', date '2016-07-08', '남', '5', 'G5E', uuid '3a000000-0000-4000-a000-000000000008', '초등부'),
  ('김요한', 'John Kim', date '2015-11-16', '남', '5', 'G5E', uuid '3a000000-0000-4000-a000-000000000008', '초등부'),
  ('도윤서', 'Yoonseo Doh', date '2016-06-01', '여', '5', 'G5E', uuid '3a000000-0000-4000-a000-000000000008', '초등부'),
  ('박준후', 'Justin Park', date '2015-05-12', null, '6', null, null, '중고등부'),
  ('문수민', 'Clara Moon', date '2015-05-10', null, '6', null, null, '중고등부'),
  ('정도현', 'Aaron Jung', date '2015-10-13', null, '6', null, null, '중고등부'),
  ('강하엘', 'Hael Kang', date '2015-08-25', null, '6', null, null, '중고등부'),
  ('제이콥 딜런 마', 'Jacob Dylan Ma', date '2015-08-02', null, '6', null, null, '중고등부'),
  ('강여명', 'Ryeomyeong Kang', date '2015-05-08', null, '6', null, null, '중고등부'),
  ('후안 이그나시오 마누키안', 'Juan Ignacio Manoukian', date '2015-09-21', null, '6', null, null, '중고등부'),
  ('이도후', 'Henry Lee', date '2012-08-06', null, '6', null, null, '중고등부'),
  ('박지음', 'Jeum Park', date '2015-10-05', null, '6', null, null, '중고등부'),
  ('최온유', 'Onyu Choi', date '2014-12-07', null, '7', null, null, '중고등부'),
  ('정이건', 'Egeon Jeong', date '2014-05-19', null, '7', null, null, '중고등부'),
  ('김엘리사', 'Elisha Kim', date '2014-09-22', null, '7', null, null, '중고등부'),
  ('김도율', 'Doyul Kim', date '2013-07-08', null, '7', null, null, '중고등부'),
  ('김승후', 'Seunghoo Kim', date '2013-02-28', null, '7', null, null, '중고등부'),
  ('김샤론', 'Sharon Kim', date '2014-09-22', null, '7', null, null, '중고등부'),
  ('고영', 'Young Ko', date '2014-06-14', null, '7', null, null, '중고등부'),
  ('이준우', 'Roy Lee', date '2014-07-17', null, '7', null, null, '중고등부'),
  ('유하이', 'Heather Yu', date '2014-02-25', null, '7', null, null, '중고등부'),
  ('위준완', 'Jade We', date '2013-10-28', null, '7', null, null, '중고등부'),
  ('강하영', 'Maria Kang', date '2013-05-25', null, '8', null, null, '중고등부'),
  ('Elliana Ma', 'Elliana Ma', date '2012-11-05', null, '8', null, null, '중고등부'),
  ('노다혜', 'Grace Noh', date '2013-03-18', null, '8', null, null, '중고등부'),
  ('박진우', 'Jinwoo Park', date '2014-07-17', null, '8', null, null, '중고등부'),
  ('김에스더', 'Esther Kim', date '2011-08-16', null, '9', null, null, '중고등부'),
  ('이하은', 'Karis Lee', date '2011-02-10', null, '9', null, null, '중고등부'),
  ('이준서', 'Paul Lee', date '2012-09-07', null, '9', null, null, '중고등부'),
  ('Joshua Min', 'Joshua Min', date '2012-01-19', null, '9', null, null, '중고등부'),
  ('Mohammed Adam', 'Mohammed Adam', date '2011-10-29', null, '10', null, null, '중고등부'),
  ('정에린', 'Elin Jung', date '2011-05-01', null, '10', null, null, '중고등부'),
  ('노다은', 'Daeun Noh', date '2011-04-28', null, '10', null, null, '중고등부'),
  ('장하영', 'Hayoung Jang', date '2010-09-01', null, '11', null, null, '중고등부'),
  ('정하담', 'Elizabeth Jeong', date '2010-07-28', null, '11', null, null, '중고등부'),
  ('한이준', 'Leejun Han', date '2009-07-08', null, '12', null, null, '중고등부'),
  ('김태훈', 'Tae Hoon Kim', date '2007-10-25', null, '12', null, null, '중고등부'),
  ('신혁', 'Shin Hyuck', date '2007-03-21', null, '12+', null, null, '중고등부'),
  ('강윤영', 'Jennifer Kang', date '2008-11-11', null, '12+', null, null, '중고등부');

do $roster$
declare
  r record;
  sid uuid;
  hits int;
  updated int := 0;
  created int := 0;
  ambiguous int := 0;
begin
  for r in select * from _r2627 loop
    sid := null;

    -- ① 이름 + 생년월일. 가장 확실한 짝입니다.
    select s.id into sid
      from wr_students s
     where s.is_demo = false
       and s.birth_date = r.birth_date
       and (btrim(s.name) = r.name or btrim(coalesce(s.name_en,'')) = r.name_en)
     limit 1;

    -- ② 생년월일이 아직 안 채워진 줄이 있어 영문 이름으로 한 번 더 찾습니다.
    --    후보가 둘 이상이면 고르지 않습니다 - 반을 엉뚱한 아이에게 붙이면 화면에는
    --    아무 문제 없이 보이는데 그 아이가 다른 교실로 갑니다.
    if sid is null then
      select count(*) into hits
        from wr_students s
       where s.is_demo = false
         and s.birth_date is null
         and (btrim(s.name) = r.name or btrim(coalesce(s.name_en,'')) = r.name_en);
      if hits = 1 then
        select s.id into sid
          from wr_students s
         where s.is_demo = false
           and s.birth_date is null
           and (btrim(s.name) = r.name or btrim(coalesce(s.name_en,'')) = r.name_en)
         limit 1;
      elsif hits > 1 then
        ambiguous := ambiguous + 1;
        raise notice '[명부] 동명이인이라 건너뜁니다: % (%) — 명부 관리에서 직접 골라주세요', r.name, r.name_en;
      end if;
    end if;

    if sid is not null then
      update wr_students s
         set grade      = r.grade,
             class_name = r.class_name,
             class_id   = r.class_id,
             department = r.department,
             -- 생년월일·영문이름이 비어 있던 줄만 채웁니다. 있는 값은 덮지 않습니다.
             birth_date = coalesce(s.birth_date, r.birth_date),
             name_en    = coalesce(nullif(btrim(coalesce(s.name_en,'')), ''), r.name_en),
             gender     = coalesce(s.gender, r.gender)
       where s.id = sid;
      updated := updated + 1;
    else
      -- 명부에는 있는데 앱에 없는 아이(신규생). is_demo 는 **값으로** 못박습니다.
      insert into wr_students (name, name_en, birth_date, gender, grade, class_name, class_id,
                               department, status, is_demo)
      values (r.name, r.name_en, r.birth_date, r.gender, r.grade, r.class_name, r.class_id,
              r.department, 'active', false);
      created := created + 1;
      raise notice '[명부] 새로 등록: % (%) — % %', r.name, r.name_en, r.grade, coalesce(r.class_name, '');
    end if;
  end loop;

  raise notice '[명부] 반영 완료 — 갱신 %명, 신규 %명, 동명이인 보류 %건', updated, created, ambiguous;
end
$roster$;

-- 명부에 없는 재학생. 지우지 않고 알리기만 합니다.
do $leftover$
declare
  r record;
  n int := 0;
begin
  for r in
    select s.name, s.name_en, s.grade, s.class_name, s.birth_date
      from wr_students s
     where s.is_demo = false
       and s.status = 'active'
       and not exists (
             select 1 from _r2627 x
              where (x.birth_date = s.birth_date and (x.name = btrim(s.name) or x.name_en = btrim(coalesce(s.name_en,''))))
                 or (s.birth_date is null and (x.name = btrim(s.name) or x.name_en = btrim(coalesce(s.name_en,''))))
           )
     order by s.grade, s.class_name, s.name
  loop
    n := n + 1;
    raise notice '[명부] 새 명부에 없는 재학생: % (%) — 현재 %학년 %', r.name, r.name_en, r.grade, coalesce(r.class_name, '반 없음');
  end loop;
  if n = 0 then
    raise notice '[명부] 새 명부에 없는 재학생 없음';
  else
    raise notice '[명부] 새 명부에 없는 재학생 %명 — 전출인지 명부 누락인지 [학생 → 명부 관리]에서 확인해 주세요', n;
  end if;
end
$leftover$;
