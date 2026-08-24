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

-- ② 기사님 GPS 기기·설정코드 발급(노선별 1개, 없을 때만). label에는 기사님 성함을 적어둡니다.
insert into shuttle_tracker_devices (device_id, setup_code, route_id, label)
  select 'yf3m3pm6', 'wx8snt', id, '문형신' from shuttle_routes sr
  where sr.direction='하원' and sr.term='정규학기' and sr.route_no='1'
    and not exists (select 1 from shuttle_tracker_devices d where d.route_id = sr.id);
insert into shuttle_tracker_devices (device_id, setup_code, route_id, label)
  select '5kjt9kqe', 'u2jcma', id, '최종진' from shuttle_routes sr
  where sr.direction='하원' and sr.term='정규학기' and sr.route_no='1-1'
    and not exists (select 1 from shuttle_tracker_devices d where d.route_id = sr.id);
insert into shuttle_tracker_devices (device_id, setup_code, route_id, label)
  select '9dw2azwf', 'ddsvk3', id, '유완철' from shuttle_routes sr
  where sr.direction='하원' and sr.term='정규학기' and sr.route_no='1-2'
    and not exists (select 1 from shuttle_tracker_devices d where d.route_id = sr.id);
insert into shuttle_tracker_devices (device_id, setup_code, route_id, label)
  select 'wexfh3hy', 'nkekf8', id, '최병로' from shuttle_routes sr
  where sr.direction='하원' and sr.term='정규학기' and sr.route_no='2'
    and not exists (select 1 from shuttle_tracker_devices d where d.route_id = sr.id);
insert into shuttle_tracker_devices (device_id, setup_code, route_id, label)
  select 'hr7r32by', 'b24248', id, '고재현' from shuttle_routes sr
  where sr.direction='하원' and sr.term='정규학기' and sr.route_no='2-1'
    and not exists (select 1 from shuttle_tracker_devices d where d.route_id = sr.id);
insert into shuttle_tracker_devices (device_id, setup_code, route_id, label)
  select 'j63prbj8', 'a98dws', id, '손창기' from shuttle_routes sr
  where sr.direction='하원' and sr.term='정규학기' and sr.route_no='2-2'
    and not exists (select 1 from shuttle_tracker_devices d where d.route_id = sr.id);
insert into shuttle_tracker_devices (device_id, setup_code, route_id, label)
  select 'v5xktfk4', 'b32ten', id, '김연운' from shuttle_routes sr
  where sr.direction='하원' and sr.term='정규학기' and sr.route_no='3'
    and not exists (select 1 from shuttle_tracker_devices d where d.route_id = sr.id);
insert into shuttle_tracker_devices (device_id, setup_code, route_id, label)
  select '8wkza3dj', 'cpuw7y', id, null from shuttle_routes sr
  where sr.direction='하원' and sr.term='정규학기' and sr.route_no='4'
    and not exists (select 1 from shuttle_tracker_devices d where d.route_id = sr.id);
insert into shuttle_tracker_devices (device_id, setup_code, route_id, label)
  select 'wxs9sd8g', 'sygca4', id, '최상락' from shuttle_routes sr
  where sr.direction='하원' and sr.term='정규학기' and sr.route_no='4-1'
    and not exists (select 1 from shuttle_tracker_devices d where d.route_id = sr.id);
insert into shuttle_tracker_devices (device_id, setup_code, route_id, label)
  select '5kgdbc4g', 'zq9hve', id, '전명섭' from shuttle_routes sr
  where sr.direction='하원' and sr.term='정규학기' and sr.route_no='4-2'
    and not exists (select 1 from shuttle_tracker_devices d where d.route_id = sr.id);
insert into shuttle_tracker_devices (device_id, setup_code, route_id, label)
  select 'ar97grc9', 'xfh9uw', id, null from shuttle_routes sr
  where sr.direction='하원' and sr.term='정규학기' and sr.route_no='5'
    and not exists (select 1 from shuttle_tracker_devices d where d.route_id = sr.id);
insert into shuttle_tracker_devices (device_id, setup_code, route_id, label)
  select 'au9d9ew9', 'nbh7da', id, '김경태' from shuttle_routes sr
  where sr.direction='하원' and sr.term='정규학기' and sr.route_no='6'
    and not exists (select 1 from shuttle_tracker_devices d where d.route_id = sr.id);
insert into shuttle_tracker_devices (device_id, setup_code, route_id, label)
  select '4zcn9jvt', '37dktf', id, null from shuttle_routes sr
  where sr.direction='하원' and sr.term='정규학기' and sr.route_no='7'
    and not exists (select 1 from shuttle_tracker_devices d where d.route_id = sr.id);
insert into shuttle_tracker_devices (device_id, setup_code, route_id, label)
  select 'uam2m3w8', 'xfy7dw', id, '김동도' from shuttle_routes sr
  where sr.direction='하원' and sr.term='정규학기' and sr.route_no='8'
    and not exists (select 1 from shuttle_tracker_devices d where d.route_id = sr.id);
insert into shuttle_tracker_devices (device_id, setup_code, route_id, label)
  select 'njv2hd3d', 'gb2pga', id, '정홍균' from shuttle_routes sr
  where sr.direction='하원' and sr.term='정규학기' and sr.route_no='9'
    and not exists (select 1 from shuttle_tracker_devices d where d.route_id = sr.id);
insert into shuttle_tracker_devices (device_id, setup_code, route_id, label)
  select 'ej47fjd7', '96dkyv', id, '이재남' from shuttle_routes sr
  where sr.direction='하원' and sr.term='정규학기' and sr.route_no='9-1'
    and not exists (select 1 from shuttle_tracker_devices d where d.route_id = sr.id);
insert into shuttle_tracker_devices (device_id, setup_code, route_id, label)
  select 'hpsy28cj', 'spvn7z', id, '마상훈' from shuttle_routes sr
  where sr.direction='하원' and sr.term='정규학기' and sr.route_no='9-2'
    and not exists (select 1 from shuttle_tracker_devices d where d.route_id = sr.id);
insert into shuttle_tracker_devices (device_id, setup_code, route_id, label)
  select 'z2ex7hwr', '49uvyt', id, '이만기' from shuttle_routes sr
  where sr.direction='하원' and sr.term='정규학기' and sr.route_no='10'
    and not exists (select 1 from shuttle_tracker_devices d where d.route_id = sr.id);
insert into shuttle_tracker_devices (device_id, setup_code, route_id, label)
  select '7ej8hfd3', 'drpe8x', id, null from shuttle_routes sr
  where sr.direction='하원' and sr.term='정규학기' and sr.route_no='11'
    and not exists (select 1 from shuttle_tracker_devices d where d.route_id = sr.id);
insert into shuttle_tracker_devices (device_id, setup_code, route_id, label)
  select '2ekq2kz2', 'adb4c4', id, '최상균' from shuttle_routes sr
  where sr.direction='하원' and sr.term='정규학기' and sr.route_no='12'
    and not exists (select 1 from shuttle_tracker_devices d where d.route_id = sr.id);
insert into shuttle_tracker_devices (device_id, setup_code, route_id, label)
  select 'h8bp3nqh', '9vjvry', id, '강호' from shuttle_routes sr
  where sr.direction='하원' and sr.term='정규학기' and sr.route_no='12-1'
    and not exists (select 1 from shuttle_tracker_devices d where d.route_id = sr.id);
insert into shuttle_tracker_devices (device_id, setup_code, route_id, label)
  select '5sz847bu', 't4fduw', id, '차명신' from shuttle_routes sr
  where sr.direction='하원' and sr.term='정규학기' and sr.route_no='13'
    and not exists (select 1 from shuttle_tracker_devices d where d.route_id = sr.id);
insert into shuttle_tracker_devices (device_id, setup_code, route_id, label)
  select 'k4yezht2', 'qsd3hj', id, '정재오' from shuttle_routes sr
  where sr.direction='하원' and sr.term='정규학기' and sr.route_no='14'
    and not exists (select 1 from shuttle_tracker_devices d where d.route_id = sr.id);
insert into shuttle_tracker_devices (device_id, setup_code, route_id, label)
  select 'hbeh3t6p', 'p6u7yv', id, '김천석' from shuttle_routes sr
  where sr.direction='하원' and sr.term='정규학기' and sr.route_no='15'
    and not exists (select 1 from shuttle_tracker_devices d where d.route_id = sr.id);
insert into shuttle_tracker_devices (device_id, setup_code, route_id, label)
  select 'yu7uqyg2', 'fkhbt9', id, '김정남' from shuttle_routes sr
  where sr.direction='하원' and sr.term='정규학기' and sr.route_no='16'
    and not exists (select 1 from shuttle_tracker_devices d where d.route_id = sr.id);
insert into shuttle_tracker_devices (device_id, setup_code, route_id, label)
  select 'x3xc43vw', 'rnz3as', id, '김인홍' from shuttle_routes sr
  where sr.direction='하원' and sr.term='정규학기' and sr.route_no='16-1'
    and not exists (select 1 from shuttle_tracker_devices d where d.route_id = sr.id);
insert into shuttle_tracker_devices (device_id, setup_code, route_id, label)
  select 'mmnp5tte', '5wzce5', id, '이남희' from shuttle_routes sr
  where sr.direction='하원' and sr.term='정규학기' and sr.route_no='17'
    and not exists (select 1 from shuttle_tracker_devices d where d.route_id = sr.id);
insert into shuttle_tracker_devices (device_id, setup_code, route_id, label)
  select '6ryugp85', '4kncz4', id, '안용해' from shuttle_routes sr
  where sr.direction='하원' and sr.term='정규학기' and sr.route_no='18'
    and not exists (select 1 from shuttle_tracker_devices d where d.route_id = sr.id);
insert into shuttle_tracker_devices (device_id, setup_code, route_id, label)
  select 'rfe4b9sh', '6mcubz', id, '박유생' from shuttle_routes sr
  where sr.direction='하원' and sr.term='정규학기' and sr.route_no='19'
    and not exists (select 1 from shuttle_tracker_devices d where d.route_id = sr.id);
insert into shuttle_tracker_devices (device_id, setup_code, route_id, label)
  select 'ev4e54n4', '9w5u56', id, '정재필' from shuttle_routes sr
  where sr.direction='하원' and sr.term='정규학기' and sr.route_no='20'
    and not exists (select 1 from shuttle_tracker_devices d where d.route_id = sr.id);
insert into shuttle_tracker_devices (device_id, setup_code, route_id, label)
  select 'wucsy8w5', 'bacrmn', id, '송창훈' from shuttle_routes sr
  where sr.direction='하원' and sr.term='정규학기' and sr.route_no='20-1'
    and not exists (select 1 from shuttle_tracker_devices d where d.route_id = sr.id);
insert into shuttle_tracker_devices (device_id, setup_code, route_id, label)
  select 'g9beymc2', '9wj8kh', id, '김진배' from shuttle_routes sr
  where sr.direction='하원' and sr.term='정규학기' and sr.route_no='21'
    and not exists (select 1 from shuttle_tracker_devices d where d.route_id = sr.id);
insert into shuttle_tracker_devices (device_id, setup_code, route_id, label)
  select 'dzajjr72', '27fw4t', id, '박남홍' from shuttle_routes sr
  where sr.direction='하원' and sr.term='정규학기' and sr.route_no='22'
    and not exists (select 1 from shuttle_tracker_devices d where d.route_id = sr.id);
insert into shuttle_tracker_devices (device_id, setup_code, route_id, label)
  select 'n34gktc2', 'etwugy', id, '이종근' from shuttle_routes sr
  where sr.direction='하원' and sr.term='정규학기' and sr.route_no='23'
    and not exists (select 1 from shuttle_tracker_devices d where d.route_id = sr.id);
insert into shuttle_tracker_devices (device_id, setup_code, route_id, label)
  select '5pryvbw5', 'kjw5us', id, '이종진' from shuttle_routes sr
  where sr.direction='하원' and sr.term='정규학기' and sr.route_no='23-1'
    and not exists (select 1 from shuttle_tracker_devices d where d.route_id = sr.id);
insert into shuttle_tracker_devices (device_id, setup_code, route_id, label)
  select 'edkmk42a', '8k35sg', id, '최재호' from shuttle_routes sr
  where sr.direction='하원' and sr.term='정규학기' and sr.route_no='23-2'
    and not exists (select 1 from shuttle_tracker_devices d where d.route_id = sr.id);
insert into shuttle_tracker_devices (device_id, setup_code, route_id, label)
  select 'qeurxem9', '7a4p6y', id, '방현주' from shuttle_routes sr
  where sr.direction='하원' and sr.term='정규학기' and sr.route_no='24'
    and not exists (select 1 from shuttle_tracker_devices d where d.route_id = sr.id);
insert into shuttle_tracker_devices (device_id, setup_code, route_id, label)
  select 'r57xwzcm', 'mj8pcb', id, '송창석' from shuttle_routes sr
  where sr.direction='하원' and sr.term='정규학기' and sr.route_no='25'
    and not exists (select 1 from shuttle_tracker_devices d where d.route_id = sr.id);
insert into shuttle_tracker_devices (device_id, setup_code, route_id, label)
  select 'h4b6qy4u', '5z9mmk', id, '주의식' from shuttle_routes sr
  where sr.direction='하원' and sr.term='정규학기' and sr.route_no='26'
    and not exists (select 1 from shuttle_tracker_devices d where d.route_id = sr.id);
insert into shuttle_tracker_devices (device_id, setup_code, route_id, label)
  select '89ac9pg9', '6df448', id, '류강희' from shuttle_routes sr
  where sr.direction='하원' and sr.term='정규학기' and sr.route_no='26-1'
    and not exists (select 1 from shuttle_tracker_devices d where d.route_id = sr.id);
insert into shuttle_tracker_devices (device_id, setup_code, route_id, label)
  select 'mzejka64', 'kju3qa', id, '임남혁' from shuttle_routes sr
  where sr.direction='하원' and sr.term='정규학기' and sr.route_no='26-2'
    and not exists (select 1 from shuttle_tracker_devices d where d.route_id = sr.id);
insert into shuttle_tracker_devices (device_id, setup_code, route_id, label)
  select 'ckmj3c22', '8rgg5s', id, '박광득' from shuttle_routes sr
  where sr.direction='하원' and sr.term='정규학기' and sr.route_no='27'
    and not exists (select 1 from shuttle_tracker_devices d where d.route_id = sr.id);
insert into shuttle_tracker_devices (device_id, setup_code, route_id, label)
  select 'v8dz65b7', 'dmsxqe', id, '정재용' from shuttle_routes sr
  where sr.direction='하원' and sr.term='정규학기' and sr.route_no='28'
    and not exists (select 1 from shuttle_tracker_devices d where d.route_id = sr.id);
insert into shuttle_tracker_devices (device_id, setup_code, route_id, label)
  select '5eyggrgw', '8skn44', id, '이기수' from shuttle_routes sr
  where sr.direction='하원' and sr.term='정규학기' and sr.route_no='29'
    and not exists (select 1 from shuttle_tracker_devices d where d.route_id = sr.id);
insert into shuttle_tracker_devices (device_id, setup_code, route_id, label)
  select 'jw9c6zw7', 's6v8pj', id, '김경갑' from shuttle_routes sr
  where sr.direction='하원' and sr.term='정규학기' and sr.route_no='30'
    and not exists (select 1 from shuttle_tracker_devices d where d.route_id = sr.id);
insert into shuttle_tracker_devices (device_id, setup_code, route_id, label)
  select '9y9ytvyk', 'kfxywr', id, '함오식' from shuttle_routes sr
  where sr.direction='하원' and sr.term='정규학기' and sr.route_no='30-1'
    and not exists (select 1 from shuttle_tracker_devices d where d.route_id = sr.id);
insert into shuttle_tracker_devices (device_id, setup_code, route_id, label)
  select '46w4uv6q', '9f3aha', id, '손창기' from shuttle_routes sr
  where sr.direction='하원' and sr.term='정규학기' and sr.route_no='31'
    and not exists (select 1 from shuttle_tracker_devices d where d.route_id = sr.id);
insert into shuttle_tracker_devices (device_id, setup_code, route_id, label)
  select 'q5j3fuxa', 'g7m4nx', id, '이종근' from shuttle_routes sr
  where sr.direction='하원' and sr.term='정규학기' and sr.route_no='31-1'
    and not exists (select 1 from shuttle_tracker_devices d where d.route_id = sr.id);

commit;