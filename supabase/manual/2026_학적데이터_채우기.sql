-- 학적 데이터 채우기(요청): 하원 대조표 기준으로 부서·학년(초등)·확정 반을 채웁니다.
-- 매칭 안전장치: 이름 + 어머니 전화번호(숫자 뒤 8자리)로만 갱신합니다(동명이인 오염 방지).
-- 전화번호가 없어 안전 매칭이 안 되는 학생은 맨 아래에 목록으로 남겨 수기 확인하게 합니다.
-- 학년/부서만 채우며(전학 등 status는 건드리지 않음), 반 코드가 확실한 김재이 등만 class_name까지 설정합니다.
begin;
update wr_students set department = '초등부', grade = '2', class_name = 'G2C', class_id = (select id from wr_classes c where c.class_name = 'G2C' and c.department = '초등부' limit 1) where name = '김단우' and regexp_replace(coalesce(parent_phone,''), '\D', '', 'g') like '%34420078';
update wr_students set department = '초등부', grade = '2', class_name = 'G2C', class_id = (select id from wr_classes c where c.class_name = 'G2C' and c.department = '초등부' limit 1) where name = '이연우' and regexp_replace(coalesce(parent_phone,''), '\D', '', 'g') like '%50452915';
update wr_students set department = '초등부', grade = '4' where name = '김서진' and regexp_replace(coalesce(parent_phone,''), '\D', '', 'g') like '%50477094';
update wr_students set department = '초등부', grade = '2', class_name = 'G2A', class_id = (select id from wr_classes c where c.class_name = 'G2A' and c.department = '초등부' limit 1) where name = '곽세린' and regexp_replace(coalesce(parent_phone,''), '\D', '', 'g') like '%88435196';
update wr_students set department = '초등부', grade = '5', class_name = 'G5', class_id = (select id from wr_classes c where c.class_name = 'G5' and c.department = '초등부' limit 1) where name = '도윤서' and regexp_replace(coalesce(parent_phone,''), '\D', '', 'g') like '%33956988';
update wr_students set department = '초등부', grade = '2', class_name = 'G2J', class_id = (select id from wr_classes c where c.class_name = 'G2J' and c.department = '초등부' limit 1) where name = '연하윤' and regexp_replace(coalesce(parent_phone,''), '\D', '', 'g') like '%71219559';
update wr_students set department = '초등부', grade = '3', class_name = 'G3J', class_id = (select id from wr_classes c where c.class_name = 'G3J' and c.department = '초등부' limit 1) where name = '김재이' and regexp_replace(coalesce(parent_phone,''), '\D', '', 'g') like '%45690657';
update wr_students set department = '초등부', grade = '2', class_name = 'G2J', class_id = (select id from wr_classes c where c.class_name = 'G2J' and c.department = '초등부' limit 1) where name = '전준백' and regexp_replace(coalesce(parent_phone,''), '\D', '', 'g') like '%30508681';
update wr_students set department = '초등부', grade = '3', class_name = 'G3J', class_id = (select id from wr_classes c where c.class_name = 'G3J' and c.department = '초등부' limit 1) where name = '이서아' and regexp_replace(coalesce(parent_phone,''), '\D', '', 'g') like '%57032692';
update wr_students set department = '초등부', grade = '2', class_name = 'G2C', class_id = (select id from wr_classes c where c.class_name = 'G2C' and c.department = '초등부' limit 1) where name = '이서준' and regexp_replace(coalesce(parent_phone,''), '\D', '', 'g') like '%48668100';
update wr_students set department = '중고등부' where name = '김도율' and regexp_replace(coalesce(parent_phone,''), '\D', '', 'g') like '%37298503';
update wr_students set department = '초등부', grade = '3', class_name = 'G3J', class_id = (select id from wr_classes c where c.class_name = 'G3J' and c.department = '초등부' limit 1) where name = '임예나' and regexp_replace(coalesce(parent_phone,''), '\D', '', 'g') like '%99017999';
update wr_students set department = '초등부', grade = '2', class_name = 'G2C', class_id = (select id from wr_classes c where c.class_name = 'G2C' and c.department = '초등부' limit 1) where name = '고진우' and regexp_replace(coalesce(parent_phone,''), '\D', '', 'g') like '%89722394';
update wr_students set department = '초등부', grade = '3', class_name = 'G3J', class_id = (select id from wr_classes c where c.class_name = 'G3J' and c.department = '초등부' limit 1) where name = '이준서' and regexp_replace(coalesce(parent_phone,''), '\D', '', 'g') like '%46552574';
update wr_students set department = '초등부', grade = '4' where name = '강예성' and regexp_replace(coalesce(parent_phone,''), '\D', '', 'g') like '%41143788';
update wr_students set department = '초등부', grade = '2', class_name = 'G2A', class_id = (select id from wr_classes c where c.class_name = 'G2A' and c.department = '초등부' limit 1) where name = '홍서형' and regexp_replace(coalesce(parent_phone,''), '\D', '', 'g') like '%71765490';
update wr_students set department = '초등부', grade = '2', class_name = 'G2J', class_id = (select id from wr_classes c where c.class_name = 'G2J' and c.department = '초등부' limit 1) where name = '황이안' and regexp_replace(coalesce(parent_phone,''), '\D', '', 'g') like '%31764702';
update wr_students set department = '초등부', grade = '4' where name = '김서이' and regexp_replace(coalesce(parent_phone,''), '\D', '', 'g') like '%85827165';
update wr_students set department = '초등부', grade = '2', class_name = 'G2A', class_id = (select id from wr_classes c where c.class_name = 'G2A' and c.department = '초등부' limit 1) where name = '김나율' and regexp_replace(coalesce(parent_phone,''), '\D', '', 'g') like '%73890228';
update wr_students set department = '초등부', grade = '4' where name = '임지효' and regexp_replace(coalesce(parent_phone,''), '\D', '', 'g') like '%63470288';
update wr_students set department = '초등부', grade = '2', class_name = 'G2A', class_id = (select id from wr_classes c where c.class_name = 'G2A' and c.department = '초등부' limit 1) where name = '이준원' and regexp_replace(coalesce(parent_phone,''), '\D', '', 'g') like '%92822232';
update wr_students set department = '초등부', grade = '4' where name = '황준호' and regexp_replace(coalesce(parent_phone,''), '\D', '', 'g') like '%22641478';
update wr_students set department = '초등부', grade = '2', class_name = 'G2J', class_id = (select id from wr_classes c where c.class_name = 'G2J' and c.department = '초등부' limit 1) where name = '황라원' and regexp_replace(coalesce(parent_phone,''), '\D', '', 'g') like '%22641478';
update wr_students set department = '초등부', grade = '2', class_name = 'G2C', class_id = (select id from wr_classes c where c.class_name = 'G2C' and c.department = '초등부' limit 1) where name = '황라윤' and regexp_replace(coalesce(parent_phone,''), '\D', '', 'g') like '%22641478';
update wr_students set department = '초등부', grade = '4' where name = '남가인' and regexp_replace(coalesce(parent_phone,''), '\D', '', 'g') like '%54853268';
update wr_students set department = '초등부', grade = '4' where name = '정서우' and regexp_replace(coalesce(parent_phone,''), '\D', '', 'g') like '%54853269';
update wr_students set department = '중고등부' where name = '이하은' and regexp_replace(coalesce(parent_phone,''), '\D', '', 'g') like '%98774057';
update wr_students set department = '중고등부' where name = '최온유' and regexp_replace(coalesce(parent_phone,''), '\D', '', 'g') like '%42706404';
update wr_students set department = '중고등부' where name = '위준완' and regexp_replace(coalesce(parent_phone,''), '\D', '', 'g') like '%49469137';
update wr_students set department = '초등부', grade = '5', class_name = 'G5', class_id = (select id from wr_classes c where c.class_name = 'G5' and c.department = '초등부' limit 1) where name = '김요한' and regexp_replace(coalesce(parent_phone,''), '\D', '', 'g') like '%35491402';
update wr_students set department = '초등부', grade = '2', class_name = 'G2J', class_id = (select id from wr_classes c where c.class_name = 'G2J' and c.department = '초등부' limit 1) where name = '심규민' and regexp_replace(coalesce(parent_phone,''), '\D', '', 'g') like '%77974865';
update wr_students set department = '중고등부' where name = '김승후' and regexp_replace(coalesce(parent_phone,''), '\D', '', 'g') like '%80104949';
update wr_students set department = '초등부', grade = '2', class_name = 'G2A', class_id = (select id from wr_classes c where c.class_name = 'G2A' and c.department = '초등부' limit 1) where name = '김재이' and regexp_replace(coalesce(parent_phone,''), '\D', '', 'g') like '%90486336';
update wr_students set department = '초등부', grade = '3', class_name = 'G3J', class_id = (select id from wr_classes c where c.class_name = 'G3J' and c.department = '초등부' limit 1) where name = '최서아' and regexp_replace(coalesce(parent_phone,''), '\D', '', 'g') like '%27232046';
update wr_students set department = '중고등부' where name = '문수민' and regexp_replace(coalesce(parent_phone,''), '\D', '', 'g') like '%26569604';
update wr_students set department = '중고등부' where name = '노다은' and regexp_replace(coalesce(parent_phone,''), '\D', '', 'g') like '%97036553';
update wr_students set department = '초등부', grade = '2', class_name = 'G2C', class_id = (select id from wr_classes c where c.class_name = 'G2C' and c.department = '초등부' limit 1) where name = '주이안' and regexp_replace(coalesce(parent_phone,''), '\D', '', 'g') like '%91205718';
update wr_students set department = '중고등부' where name = '이도후' and regexp_replace(coalesce(parent_phone,''), '\D', '', 'g') like '%37723110';
update wr_students set department = '중고등부' where name = '곽호율' and regexp_replace(coalesce(parent_phone,''), '\D', '', 'g') like '%66022947';
update wr_students set department = '초등부', grade = '2', class_name = 'G2C', class_id = (select id from wr_classes c where c.class_name = 'G2C' and c.department = '초등부' limit 1) where name = '고서윤' and regexp_replace(coalesce(parent_phone,''), '\D', '', 'g') like '%41737364';
update wr_students set department = '초등부', grade = '2', class_name = 'G2C', class_id = (select id from wr_classes c where c.class_name = 'G2C' and c.department = '초등부' limit 1) where name = '김재이' and regexp_replace(coalesce(parent_phone,''), '\D', '', 'g') like '%53210324';
update wr_students set department = '초등부', grade = '3' where name = '이서현' and regexp_replace(coalesce(parent_phone,''), '\D', '', 'g') like '%89084893';
update wr_students set department = '초등부', grade = '3', class_name = 'G3J', class_id = (select id from wr_classes c where c.class_name = 'G3J' and c.department = '초등부' limit 1) where name = '지수' and regexp_replace(coalesce(parent_phone,''), '\D', '', 'g') like '%90878430';
update wr_students set department = '중고등부' where name = '박지음' and regexp_replace(coalesce(parent_phone,''), '\D', '', 'g') like '%51609872';
update wr_students set department = '초등부', grade = '4' where name = '김지민' and regexp_replace(coalesce(parent_phone,''), '\D', '', 'g') like '%51007847';
update wr_students set department = '초등부', grade = '3', class_name = 'G3J', class_id = (select id from wr_classes c where c.class_name = 'G3J' and c.department = '초등부' limit 1) where name = '강서후' and regexp_replace(coalesce(parent_phone,''), '\D', '', 'g') like '%66458648';
update wr_students set department = '초등부', grade = '2', class_name = 'G2J', class_id = (select id from wr_classes c where c.class_name = 'G2J' and c.department = '초등부' limit 1) where name = '이현우' and regexp_replace(coalesce(parent_phone,''), '\D', '', 'g') like '%91438857';
update wr_students set department = '초등부', grade = '4' where name = '정서우' and regexp_replace(coalesce(parent_phone,''), '\D', '', 'g') like '%94062143';
update wr_students set department = '초등부', grade = '3', class_name = 'G3J', class_id = (select id from wr_classes c where c.class_name = 'G3J' and c.department = '초등부' limit 1) where name = '민송희' and regexp_replace(coalesce(parent_phone,''), '\D', '', 'g') like '%31512767';
update wr_students set department = '초등부', grade = '2', class_name = 'G2A', class_id = (select id from wr_classes c where c.class_name = 'G2A' and c.department = '초등부' limit 1) where name = '심재이' and regexp_replace(coalesce(parent_phone,''), '\D', '', 'g') like '%92533303';
update wr_students set department = '초등부', grade = '2', class_name = 'G2J', class_id = (select id from wr_classes c where c.class_name = 'G2J' and c.department = '초등부' limit 1) where name = '서민준' and regexp_replace(coalesce(parent_phone,''), '\D', '', 'g') like '%21866134';
update wr_students set department = '초등부', grade = '5', class_name = 'G5', class_id = (select id from wr_classes c where c.class_name = 'G5' and c.department = '초등부' limit 1) where name = '이온유' and regexp_replace(coalesce(parent_phone,''), '\D', '', 'g') like '%72398383';
update wr_students set department = '중고등부' where name = '강여명' and regexp_replace(coalesce(parent_phone,''), '\D', '', 'g') like '%58268910';
update wr_students set department = '초등부', grade = '2', class_name = 'G2J', class_id = (select id from wr_classes c where c.class_name = 'G2J' and c.department = '초등부' limit 1) where name = '전지완' and regexp_replace(coalesce(parent_phone,''), '\D', '', 'g') like '%88754490';
update wr_students set department = '초등부', grade = '3', class_name = 'G3J', class_id = (select id from wr_classes c where c.class_name = 'G3J' and c.department = '초등부' limit 1) where name = '김재이' and regexp_replace(coalesce(parent_phone,''), '\D', '', 'g') like '%31512767';
update wr_students set department = '초등부', grade = '2', class_name = 'G2J', class_id = (select id from wr_classes c where c.class_name = 'G2J' and c.department = '초등부' limit 1) where name = '김도은' and regexp_replace(coalesce(parent_phone,''), '\D', '', 'g') like '%47396231';
update wr_students set department = '초등부', grade = '4' where name = '이한범' and regexp_replace(coalesce(parent_phone,''), '\D', '', 'g') like '%77222879';
update wr_students set department = '초등부', grade = '2', class_name = 'G2A', class_id = (select id from wr_classes c where c.class_name = 'G2A' and c.department = '초등부' limit 1) where name = '원세빈' and regexp_replace(coalesce(parent_phone,''), '\D', '', 'g') like '%58130000';
update wr_students set department = '초등부', grade = '4' where name = '권수호' and regexp_replace(coalesce(parent_phone,''), '\D', '', 'g') like '%27489949';
update wr_students set department = '초등부', grade = '3', class_name = 'G3J', class_id = (select id from wr_classes c where c.class_name = 'G3J' and c.department = '초등부' limit 1) where name = '황시원' and regexp_replace(coalesce(parent_phone,''), '\D', '', 'g') like '%86868118';
update wr_students set department = '초등부', grade = '2', class_name = 'G2J', class_id = (select id from wr_classes c where c.class_name = 'G2J' and c.department = '초등부' limit 1) where name = '이예나' and regexp_replace(coalesce(parent_phone,''), '\D', '', 'g') like '%87542684';
update wr_students set department = '초등부', grade = '3' where name = '이예온' and regexp_replace(coalesce(parent_phone,''), '\D', '', 'g') like '%42568836';
update wr_students set department = '초등부', grade = '4' where name = '임하임' and regexp_replace(coalesce(parent_phone,''), '\D', '', 'g') like '%93896648';
update wr_students set department = '중고등부' where name = '강하영' and regexp_replace(coalesce(parent_phone,''), '\D', '', 'g') like '%28390180';
update wr_students set department = '초등부', grade = '2', class_name = 'G2J', class_id = (select id from wr_classes c where c.class_name = 'G2J' and c.department = '초등부' limit 1) where name = '문준연' and regexp_replace(coalesce(parent_phone,''), '\D', '', 'g') like '%91364946';
update wr_students set department = '초등부', grade = '2', class_name = 'G2C', class_id = (select id from wr_classes c where c.class_name = 'G2C' and c.department = '초등부' limit 1) where name = '노유겸' and regexp_replace(coalesce(parent_phone,''), '\D', '', 'g') like '%32006207';
update wr_students set department = '초등부', grade = '2', class_name = 'G2C', class_id = (select id from wr_classes c where c.class_name = 'G2C' and c.department = '초등부' limit 1) where name = '이아인' and regexp_replace(coalesce(parent_phone,''), '\D', '', 'g') like '%68892937';
update wr_students set department = '초등부', grade = '2', class_name = 'G2A', class_id = (select id from wr_classes c where c.class_name = 'G2A' and c.department = '초등부' limit 1) where name = '한우영' and regexp_replace(coalesce(parent_phone,''), '\D', '', 'g') like '%51483885';
update wr_students set department = '초등부', grade = '4' where name = '김리안' and regexp_replace(coalesce(parent_phone,''), '\D', '', 'g') like '%87609264';
update wr_students set department = '초등부', grade = '2', class_name = 'G2C', class_id = (select id from wr_classes c where c.class_name = 'G2C' and c.department = '초등부' limit 1) where name = '백서아' and regexp_replace(coalesce(parent_phone,''), '\D', '', 'g') like '%47859973';
update wr_students set department = '초등부', grade = '2', class_name = 'G2C', class_id = (select id from wr_classes c where c.class_name = 'G2C' and c.department = '초등부' limit 1) where name = '이라엘' and regexp_replace(coalesce(parent_phone,''), '\D', '', 'g') like '%65386529';
update wr_students set department = '중고등부' where name = '박진우' and regexp_replace(coalesce(parent_phone,''), '\D', '', 'g') like '%94669779';
commit;

-- ⚠ 전화번호가 없어 자동 매칭에서 제외한 학생(수기 확인 필요):
--   2-1호 정레인 (G3J/초등)
--   4-2호 임지효 (G4R/초등)
--   4-2호 이준서 (중고등(형제)/중고등)
--   4-2호 이준우 (중고등(형제)/중고등)
--   8호 김샤론 ((초등명부밖)/중고등)
--   9호 이준서 (중고등(형제)/중고등)
--   9호 이준우 (중고등(형제)/중고등)
--   10호 유재이 (G3B/초등)
--   11호 이신원 (G2J/초등)
--   11호 마야 ((초등명부밖)/중고등)
--   12호 차봄 (G3J/초등)
--   12-1호 강하라 (G4R/초등)
--   13호 권태이 (G2J/초등)
--   14호 박준후 (중등부(초등 졸업)/중등부)
--   16-1호 노다혜 ((초등명부밖)/중고등)
--   20호 곽호율 (중등부(초등 졸업)/중등부)
--   21호 박준후 (중등부(초등 졸업)/중등부)
--   22호 정서안 (중등부(초등 졸업)/중등부)
--   24호 강이제 (G2A/초등)
--   26-1호 남가인 (G4R/초등)
--   26-2호 황이준 (G2A/초등)
--   26-2호 고이건 (G3B/초등)
--   28호 송우진 (G5/초등)
--   28호 송윤진 (G3B/초등)
--   30호 김현수 (G2A/초등)
--   31호 에이바 ((초등명부밖)/중고등)
--   31호 제이콥 ((초등명부밖)/중고등)
--   31호 장하영 ((초등명부밖)/중고등)
--   31호 강하늘 (G5/초등)
--   31호 강하엘 ((초등명부밖)/중고등)
