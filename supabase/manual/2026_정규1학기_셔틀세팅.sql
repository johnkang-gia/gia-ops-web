-- ============================================================================
-- 정규 1학기 셔틀 세팅: 안내보드·도착체크 학기 전환 + 기사님 GPS 기기 발급
-- · 안내보드/도착체크 링크를 전부 '정규학기'로 전환(여름캠프2 종료)
-- · 방금 등록한 48개 하원 정규학기 노선에 GPS 기기·설정코드 발급(이미 있으면 건너뜀)
-- · 다시 실행해도 중복 발급되지 않습니다.
-- ============================================================================
begin;

-- ① 안내보드·도착체크를 정규 1학기로 전환
update shuttle_board_links   set term = '정규학기' where term <> '정규학기';
update shuttle_arrival_links set term = '정규학기' where term <> '정규학기';

-- ①-b 여름캠프2 노선 정리: 남은 여름캠프2 노선을 비활성화합니다(정규학기만 보이도록).
--     기록 보존을 위해 삭제하지 않고 active=false 로만 둡니다. 모든 운영 화면은 active=true
--     + term='정규학기'만 조회하므로 화면에서는 완전히 사라집니다.
update shuttle_routes set active = false where term = '여름캠프2' and active = true;

-- ①-c 도착·출발 기준점을 GIA마이크로랩(서울 강남구 논현로131길 45)로 고정합니다.
--     주소를 정확히 맞추고 좌표를 비워, 다음 크론 실행 때 카카오로 이 주소를 다시 지오코딩해
--     정확한 학교 좌표로 채웁니다(도착·출발 감지가 모두 이 좌표 반경으로 계산됩니다).
update shuttle_campus_locations set address = '서울 강남구 논현로131길 45', lat = null, lng = null, geocoded_at = null where name = '본교';
insert into shuttle_campus_locations (name, address)
  select '본교', '서울 강남구 논현로131길 45' where not exists (select 1 from shuttle_campus_locations where name = '본교');

-- ② 기사님 GPS 기기·설정코드 발급(노선별 1개, 없을 때만). label에는 기사님 성함을 적어둡니다.
insert into shuttle_tracker_devices (device_id, setup_code, route_id, label)
  select 'cq5fvr83', 'agnjsy', id, '문형신' from shuttle_routes sr
  where sr.direction='하원' and sr.term='정규학기' and sr.route_no='1'
    and not exists (select 1 from shuttle_tracker_devices d where d.route_id = sr.id);
insert into shuttle_tracker_devices (device_id, setup_code, route_id, label)
  select '6f685bvv', 't934xn', id, '최종진' from shuttle_routes sr
  where sr.direction='하원' and sr.term='정규학기' and sr.route_no='1-1'
    and not exists (select 1 from shuttle_tracker_devices d where d.route_id = sr.id);
insert into shuttle_tracker_devices (device_id, setup_code, route_id, label)
  select 'sjbxqcc4', 'fqbgxj', id, '유완철' from shuttle_routes sr
  where sr.direction='하원' and sr.term='정규학기' and sr.route_no='1-2'
    and not exists (select 1 from shuttle_tracker_devices d where d.route_id = sr.id);
insert into shuttle_tracker_devices (device_id, setup_code, route_id, label)
  select 'fbcez3v9', 'vx4z26', id, '최병로' from shuttle_routes sr
  where sr.direction='하원' and sr.term='정규학기' and sr.route_no='2'
    and not exists (select 1 from shuttle_tracker_devices d where d.route_id = sr.id);
insert into shuttle_tracker_devices (device_id, setup_code, route_id, label)
  select 'j3sjugtk', 'ttj7tb', id, '고재현' from shuttle_routes sr
  where sr.direction='하원' and sr.term='정규학기' and sr.route_no='2-1'
    and not exists (select 1 from shuttle_tracker_devices d where d.route_id = sr.id);
insert into shuttle_tracker_devices (device_id, setup_code, route_id, label)
  select 'ty27m4ud', '9vcymt', id, '손창기' from shuttle_routes sr
  where sr.direction='하원' and sr.term='정규학기' and sr.route_no='2-2'
    and not exists (select 1 from shuttle_tracker_devices d where d.route_id = sr.id);
insert into shuttle_tracker_devices (device_id, setup_code, route_id, label)
  select 'chfrtbzx', 'mhtejf', id, '김연운' from shuttle_routes sr
  where sr.direction='하원' and sr.term='정규학기' and sr.route_no='3'
    and not exists (select 1 from shuttle_tracker_devices d where d.route_id = sr.id);
insert into shuttle_tracker_devices (device_id, setup_code, route_id, label)
  select 'qt7gntcr', 'de5r87', id, null from shuttle_routes sr
  where sr.direction='하원' and sr.term='정규학기' and sr.route_no='4'
    and not exists (select 1 from shuttle_tracker_devices d where d.route_id = sr.id);
insert into shuttle_tracker_devices (device_id, setup_code, route_id, label)
  select '7ah9e7r7', 'rr6u2k', id, '최상락' from shuttle_routes sr
  where sr.direction='하원' and sr.term='정규학기' and sr.route_no='4-1'
    and not exists (select 1 from shuttle_tracker_devices d where d.route_id = sr.id);
insert into shuttle_tracker_devices (device_id, setup_code, route_id, label)
  select 'ee4b6ntr', 'q8euvx', id, '전명섭' from shuttle_routes sr
  where sr.direction='하원' and sr.term='정규학기' and sr.route_no='4-2'
    and not exists (select 1 from shuttle_tracker_devices d where d.route_id = sr.id);
insert into shuttle_tracker_devices (device_id, setup_code, route_id, label)
  select 'f2w9rm3h', '8gzqfk', id, null from shuttle_routes sr
  where sr.direction='하원' and sr.term='정규학기' and sr.route_no='5'
    and not exists (select 1 from shuttle_tracker_devices d where d.route_id = sr.id);
insert into shuttle_tracker_devices (device_id, setup_code, route_id, label)
  select '732prczz', 'qse2da', id, '김경태' from shuttle_routes sr
  where sr.direction='하원' and sr.term='정규학기' and sr.route_no='6'
    and not exists (select 1 from shuttle_tracker_devices d where d.route_id = sr.id);
insert into shuttle_tracker_devices (device_id, setup_code, route_id, label)
  select 'mgz4wtb7', '6hrvvu', id, null from shuttle_routes sr
  where sr.direction='하원' and sr.term='정규학기' and sr.route_no='7'
    and not exists (select 1 from shuttle_tracker_devices d where d.route_id = sr.id);
insert into shuttle_tracker_devices (device_id, setup_code, route_id, label)
  select 'y48kt9xh', 'xgq7vk', id, '김동도' from shuttle_routes sr
  where sr.direction='하원' and sr.term='정규학기' and sr.route_no='8'
    and not exists (select 1 from shuttle_tracker_devices d where d.route_id = sr.id);
insert into shuttle_tracker_devices (device_id, setup_code, route_id, label)
  select '4ghd88v5', 'x32j72', id, '정홍균' from shuttle_routes sr
  where sr.direction='하원' and sr.term='정규학기' and sr.route_no='9'
    and not exists (select 1 from shuttle_tracker_devices d where d.route_id = sr.id);
insert into shuttle_tracker_devices (device_id, setup_code, route_id, label)
  select 'yzzavjwq', '3xabu7', id, '이재남' from shuttle_routes sr
  where sr.direction='하원' and sr.term='정규학기' and sr.route_no='9-1'
    and not exists (select 1 from shuttle_tracker_devices d where d.route_id = sr.id);
insert into shuttle_tracker_devices (device_id, setup_code, route_id, label)
  select 'zkmzwcft', 'hwt964', id, '마상훈' from shuttle_routes sr
  where sr.direction='하원' and sr.term='정규학기' and sr.route_no='9-2'
    and not exists (select 1 from shuttle_tracker_devices d where d.route_id = sr.id);
insert into shuttle_tracker_devices (device_id, setup_code, route_id, label)
  select 'q55suehq', '722wqw', id, '이만기' from shuttle_routes sr
  where sr.direction='하원' and sr.term='정규학기' and sr.route_no='10'
    and not exists (select 1 from shuttle_tracker_devices d where d.route_id = sr.id);
insert into shuttle_tracker_devices (device_id, setup_code, route_id, label)
  select 'hqj3page', 'm3ufk6', id, null from shuttle_routes sr
  where sr.direction='하원' and sr.term='정규학기' and sr.route_no='11'
    and not exists (select 1 from shuttle_tracker_devices d where d.route_id = sr.id);
insert into shuttle_tracker_devices (device_id, setup_code, route_id, label)
  select 'mkv936wn', 'az39d5', id, '최상균' from shuttle_routes sr
  where sr.direction='하원' and sr.term='정규학기' and sr.route_no='12'
    and not exists (select 1 from shuttle_tracker_devices d where d.route_id = sr.id);
insert into shuttle_tracker_devices (device_id, setup_code, route_id, label)
  select 'mxnnhjue', 'wc35gv', id, '강호' from shuttle_routes sr
  where sr.direction='하원' and sr.term='정규학기' and sr.route_no='12-1'
    and not exists (select 1 from shuttle_tracker_devices d where d.route_id = sr.id);
insert into shuttle_tracker_devices (device_id, setup_code, route_id, label)
  select 'mdepk83n', '2ftgr8', id, '차명신' from shuttle_routes sr
  where sr.direction='하원' and sr.term='정규학기' and sr.route_no='13'
    and not exists (select 1 from shuttle_tracker_devices d where d.route_id = sr.id);
insert into shuttle_tracker_devices (device_id, setup_code, route_id, label)
  select 'kqsqmwzu', 'watqb2', id, '정재오' from shuttle_routes sr
  where sr.direction='하원' and sr.term='정규학기' and sr.route_no='14'
    and not exists (select 1 from shuttle_tracker_devices d where d.route_id = sr.id);
insert into shuttle_tracker_devices (device_id, setup_code, route_id, label)
  select 'qa4euvxy', 't6m726', id, '김천석' from shuttle_routes sr
  where sr.direction='하원' and sr.term='정규학기' and sr.route_no='15'
    and not exists (select 1 from shuttle_tracker_devices d where d.route_id = sr.id);
insert into shuttle_tracker_devices (device_id, setup_code, route_id, label)
  select '5dd8tb24', 'u27btu', id, '김정남' from shuttle_routes sr
  where sr.direction='하원' and sr.term='정규학기' and sr.route_no='16'
    and not exists (select 1 from shuttle_tracker_devices d where d.route_id = sr.id);
insert into shuttle_tracker_devices (device_id, setup_code, route_id, label)
  select '2vbvk3kf', '9jxmgr', id, '김인홍' from shuttle_routes sr
  where sr.direction='하원' and sr.term='정규학기' and sr.route_no='16-1'
    and not exists (select 1 from shuttle_tracker_devices d where d.route_id = sr.id);
insert into shuttle_tracker_devices (device_id, setup_code, route_id, label)
  select 'xndxsdx9', 'f8kqpz', id, '이남희' from shuttle_routes sr
  where sr.direction='하원' and sr.term='정규학기' and sr.route_no='17'
    and not exists (select 1 from shuttle_tracker_devices d where d.route_id = sr.id);
insert into shuttle_tracker_devices (device_id, setup_code, route_id, label)
  select '5kg7qbgd', 'ztbyn8', id, '안용해' from shuttle_routes sr
  where sr.direction='하원' and sr.term='정규학기' and sr.route_no='18'
    and not exists (select 1 from shuttle_tracker_devices d where d.route_id = sr.id);
insert into shuttle_tracker_devices (device_id, setup_code, route_id, label)
  select '2pxyanap', '592w9y', id, '박유생' from shuttle_routes sr
  where sr.direction='하원' and sr.term='정규학기' and sr.route_no='19'
    and not exists (select 1 from shuttle_tracker_devices d where d.route_id = sr.id);
insert into shuttle_tracker_devices (device_id, setup_code, route_id, label)
  select 'ynp5mv3b', 'v7hkbv', id, '정재필' from shuttle_routes sr
  where sr.direction='하원' and sr.term='정규학기' and sr.route_no='20'
    and not exists (select 1 from shuttle_tracker_devices d where d.route_id = sr.id);
insert into shuttle_tracker_devices (device_id, setup_code, route_id, label)
  select 'gx3f8k8g', 'ndgutx', id, '송창훈' from shuttle_routes sr
  where sr.direction='하원' and sr.term='정규학기' and sr.route_no='20-1'
    and not exists (select 1 from shuttle_tracker_devices d where d.route_id = sr.id);
insert into shuttle_tracker_devices (device_id, setup_code, route_id, label)
  select '7kwhcgny', '7su9sx', id, '김진배' from shuttle_routes sr
  where sr.direction='하원' and sr.term='정규학기' and sr.route_no='21'
    and not exists (select 1 from shuttle_tracker_devices d where d.route_id = sr.id);
insert into shuttle_tracker_devices (device_id, setup_code, route_id, label)
  select 'qtazf6c6', 'cee6a7', id, '박남홍' from shuttle_routes sr
  where sr.direction='하원' and sr.term='정규학기' and sr.route_no='22'
    and not exists (select 1 from shuttle_tracker_devices d where d.route_id = sr.id);
insert into shuttle_tracker_devices (device_id, setup_code, route_id, label)
  select '6tmuh35g', 'hrbg6u', id, '이종근' from shuttle_routes sr
  where sr.direction='하원' and sr.term='정규학기' and sr.route_no='23'
    and not exists (select 1 from shuttle_tracker_devices d where d.route_id = sr.id);
insert into shuttle_tracker_devices (device_id, setup_code, route_id, label)
  select '6b3mze35', 'q8qat2', id, '이종진' from shuttle_routes sr
  where sr.direction='하원' and sr.term='정규학기' and sr.route_no='23-1'
    and not exists (select 1 from shuttle_tracker_devices d where d.route_id = sr.id);
insert into shuttle_tracker_devices (device_id, setup_code, route_id, label)
  select 'bfyet5yb', '382hne', id, '최재호' from shuttle_routes sr
  where sr.direction='하원' and sr.term='정규학기' and sr.route_no='23-2'
    and not exists (select 1 from shuttle_tracker_devices d where d.route_id = sr.id);
insert into shuttle_tracker_devices (device_id, setup_code, route_id, label)
  select '3cvg37xu', 'w87h98', id, '방현주' from shuttle_routes sr
  where sr.direction='하원' and sr.term='정규학기' and sr.route_no='24'
    and not exists (select 1 from shuttle_tracker_devices d where d.route_id = sr.id);
insert into shuttle_tracker_devices (device_id, setup_code, route_id, label)
  select '2ga5frp2', 'nzpbf4', id, '송창석' from shuttle_routes sr
  where sr.direction='하원' and sr.term='정규학기' and sr.route_no='25'
    and not exists (select 1 from shuttle_tracker_devices d where d.route_id = sr.id);
insert into shuttle_tracker_devices (device_id, setup_code, route_id, label)
  select '3xxyvr7y', 'bj4963', id, '주의식' from shuttle_routes sr
  where sr.direction='하원' and sr.term='정규학기' and sr.route_no='26'
    and not exists (select 1 from shuttle_tracker_devices d where d.route_id = sr.id);
insert into shuttle_tracker_devices (device_id, setup_code, route_id, label)
  select '29a9at95', 'muueuu', id, '류강희' from shuttle_routes sr
  where sr.direction='하원' and sr.term='정규학기' and sr.route_no='26-1'
    and not exists (select 1 from shuttle_tracker_devices d where d.route_id = sr.id);
insert into shuttle_tracker_devices (device_id, setup_code, route_id, label)
  select '7q72c5s5', 'yxukmt', id, '임남혁' from shuttle_routes sr
  where sr.direction='하원' and sr.term='정규학기' and sr.route_no='26-2'
    and not exists (select 1 from shuttle_tracker_devices d where d.route_id = sr.id);
insert into shuttle_tracker_devices (device_id, setup_code, route_id, label)
  select 'km28tp3n', 'munjky', id, '박광득' from shuttle_routes sr
  where sr.direction='하원' and sr.term='정규학기' and sr.route_no='27'
    and not exists (select 1 from shuttle_tracker_devices d where d.route_id = sr.id);
insert into shuttle_tracker_devices (device_id, setup_code, route_id, label)
  select 'qnq4aduv', '8x8n5g', id, '정재용' from shuttle_routes sr
  where sr.direction='하원' and sr.term='정규학기' and sr.route_no='28'
    and not exists (select 1 from shuttle_tracker_devices d where d.route_id = sr.id);
insert into shuttle_tracker_devices (device_id, setup_code, route_id, label)
  select 'btfp6hva', 'x9n9vc', id, '이기수' from shuttle_routes sr
  where sr.direction='하원' and sr.term='정규학기' and sr.route_no='29'
    and not exists (select 1 from shuttle_tracker_devices d where d.route_id = sr.id);
insert into shuttle_tracker_devices (device_id, setup_code, route_id, label)
  select '7g3z4xjh', 'mgp75z', id, '김경갑' from shuttle_routes sr
  where sr.direction='하원' and sr.term='정규학기' and sr.route_no='30'
    and not exists (select 1 from shuttle_tracker_devices d where d.route_id = sr.id);
insert into shuttle_tracker_devices (device_id, setup_code, route_id, label)
  select '78qp977s', 'f9e3hg', id, '함오식' from shuttle_routes sr
  where sr.direction='하원' and sr.term='정규학기' and sr.route_no='30-1'
    and not exists (select 1 from shuttle_tracker_devices d where d.route_id = sr.id);
insert into shuttle_tracker_devices (device_id, setup_code, route_id, label)
  select 'yc7mh6ha', 'n49m6c', id, '손창기' from shuttle_routes sr
  where sr.direction='하원' and sr.term='정규학기' and sr.route_no='31'
    and not exists (select 1 from shuttle_tracker_devices d where d.route_id = sr.id);
insert into shuttle_tracker_devices (device_id, setup_code, route_id, label)
  select 'u8hg36r9', '2qfbcm', id, '이종근' from shuttle_routes sr
  where sr.direction='하원' and sr.term='정규학기' and sr.route_no='31-1'
    and not exists (select 1 from shuttle_tracker_devices d where d.route_id = sr.id);

commit;