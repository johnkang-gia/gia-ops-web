-- ===== 111. GPS 기기 24시간 테스트(강경원 본인 휴대폰) =====
--
-- 요청: "기사님께 드리기전에 내 핸드폰으로 등록 테스트해보고싶어 (...) 24시간 추적한다고 하고
-- 실시간으로 체크가 되는지 (...) 강경원 이름으로 테스트 링크를 하나 만들어줘 (...) 히스토리처럼
-- 남겨줘 나는 다음날 출근해서 잘 되었는지 노선은 정확한지 체크".
--
-- 평소 기기는 하원 시간대(평일 15:30~18:30)에만 위치를 저장합니다. 테스트는 출퇴근 등 아무
-- 때나 켜보셔야 하므로, 이 기기에만 "항상 수집(always_on)"을 켜서 시간대와 무관하게 위치를
-- 기록합니다. 실제 노선이 아니라 term='데모'인 숨김 노선에 물려두어, 정규학기 운영 화면에는
-- 전혀 나타나지 않습니다(전용 테스트 화면과 업무 대시보드의 '테스트 위치'로만 보입니다).

alter table shuttle_tracker_devices add column if not exists always_on boolean not null default false;

-- 숨김 테스트 노선(정규학기 화면에 안 뜨도록 term='데모', active=false).
insert into shuttle_routes (id, direction, route_no, name, term, active, sort_order)
values ('e0000000-0000-4000-a000-000000000001', '하원', 'TEST', '강경원 GPS 테스트', '데모', false, 9998)
on conflict (id) do update
  set name = excluded.name, term = '데모', active = false;

-- 테스트 기기 + 설정 링크(/s/kkwtst). always_on=true 라 24시간 기록됩니다.
insert into shuttle_tracker_devices (id, device_id, setup_code, route_id, label, always_on, enabled)
values ('e0000000-0000-4000-b000-000000000001', 'kkwtest1', 'kkwtst', 'e0000000-0000-4000-a000-000000000001', '강경원 테스트', true, true)
on conflict (id) do update
  set device_id = excluded.device_id, setup_code = excluded.setup_code, label = excluded.label,
      always_on = true, enabled = true;
