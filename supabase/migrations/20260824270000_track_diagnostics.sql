-- ===== 112. 기기 신호 진단(앱 로그를 서버에서 대신 보기) =====
--
-- 요청: "27호차 기사님 (...) 설치 다 했는데 위치 계속 안오는거 같아 (...) 셔틀탭에서도 확인할
-- 수 있도록 (...) 앱에 로그기록있던데 이거 가져오게 못하나?"
--
-- 휴대폰 앱(Traccar Client)의 로그 자체는 그 폰 안에만 있어 서버로 가져올 수 없습니다. 대신
-- 앱이 우리 서버(/api/shuttle/track)로 보내오는 요청을 **받는 쪽에서** 매번 남겨두면, "앱이
-- 신호를 보내고 있는지 / 왜 위치가 저장되지 않는지"를 관리 화면에서 그대로 확인할 수 있습니다.
--
-- 가장 흔한 원인: 하원 시간대(평일 15:30~18:30) 밖에서 테스트하면 앱은 신호를 보내지만 서버가
-- "지금은 저장 안 하는 시간"이라 위치를 버립니다. 이때 last_hit_reason='out_of_window'로 남아
-- "신호는 오는데 시간대가 아니라 저장 안 됨"을 바로 알 수 있습니다.

alter table shuttle_tracker_devices add column if not exists last_hit_at timestamptz;   -- 앱이 마지막으로 요청을 보내온 시각(좌표 유무 무관)
alter table shuttle_tracker_devices add column if not exists last_hit_reason text;       -- 그때 서버 판정: 'stored'|'out_of_window'|'no_coords'
