-- 정류장 학습에 "며칠 반복됐는가"를 함께 기록합니다.
--
-- 왜 필요한가요?
--   차는 정류장에서도 서고 신호에서도 섭니다. 하루치 기록만 보면 둘을 구별할 방법이 없습니다.
--   구별되는 지점은 딱 하나 - **반복성**입니다.
--     · 정류장: 그 자리에 배정된 아이가 결석하지 않는 한 매일 섭니다.
--     · 신호대기: 어떤 날은 서고 어떤 날은 그냥 지나갑니다. 자리도 매번 조금씩 다릅니다.
--   그래서 여러 날의 정차를 자리별로 묶어 "운행일 중 며칠이나 이 자리에 섰는가"를 세고,
--   그 비율이 높은 자리만 정류장 좌표로 인정합니다.
--
--   아래 칸들은 그 판단 근거를 사람이 볼 수 있게 남겨두는 용도입니다. 담당자가 [셔틀 →
--   링크·기기]에서 "이 좌표는 12일 중 11일 관측(92%)"처럼 확인하고 반영할 수 있습니다.
begin;

-- 이 자리에서 정차가 관측된 '날' 수(같은 날 여러 번 서도 1일로 셉니다).
alter table shuttle_stops add column if not exists gps_day_count integer;

-- 운행일 대비 관측 비율(0~1). 1에 가까울수록 매일 서는 자리 = 정류장일 가능성이 높습니다.
alter table shuttle_stops add column if not exists gps_confidence numeric;

-- 평균 체류시간(초). 승하차는 20~60초로 비교적 일정하고, 신호대기는 들쭉날쭉합니다.
alter table shuttle_stops add column if not exists gps_dwell_seconds integer;

-- 관측을 자리별로 묶을 때 쓴 묶음 식별자. 같은 정류장에 여러 묶음이 잡히면 담당자가
-- 어느 묶음이 반영됐는지 되짚어볼 수 있습니다.
alter table shuttle_stop_observations add column if not exists cluster_key text;

-- 신호대기로 판단해 제외한 묶음도 화면에서 볼 수 있도록, 판단 결과를 관측 쪽에 남깁니다.
--   'stop'    : 정류장으로 인정(좌표 반영에 사용)
--   'transit' : 반복성이 낮아 제외(신호대기·일시 정차 추정)
alter table shuttle_stop_observations add column if not exists verdict text;

create index if not exists shuttle_stop_observations_route_date_idx
  on shuttle_stop_observations (route_id, service_date desc);

commit;
