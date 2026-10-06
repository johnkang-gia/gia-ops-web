-- 정류장 좌표 학습: 사람이 고른 정차를 학습에 넣고, 얼마나 정확한지(퍼짐)를 남깁니다.
--
-- ① 사람이 「이 정차는 몇 번 정류장」이라고 고른 표시.
--    자동 연결(matched_stop_id)과 같은 칸을 쓰는데 둘을 구별할 수 없어서, 사람이 고른 것이
--    다음 날 재계산에서 그냥 버려졌습니다. 화면에는 「다음부터 학습에 반영됩니다」라고 적혀 있었습니다.
alter table public.shuttle_stop_observations
  add column if not exists assigned_by_human boolean not null default false;

comment on column public.shuttle_stop_observations.assigned_by_human is
  '사람이 정류장을 골라 준 정차. 재계산이 거리로 다시 짝짓지 않고 그 정류장의 학습에 그대로 넣습니다.';

-- ② 학습 좌표가 얼마나 믿을 만한가 - 관측 정차들이 학습 좌표에서 떨어진 거리의 중앙값(m).
--    날이 갈수록 작아지면 수렴하고 있는 것이고, 크면 그 정류장 앞에서 서는 자리가 날마다 다르다는 뜻입니다.
alter table public.shuttle_stops add column if not exists gps_spread_m int;

comment on column public.shuttle_stops.gps_spread_m is
  '학습에 쓰인 정차들이 학습 좌표에서 떨어진 거리의 중앙값(m). 작을수록 매일 같은 자리에 섭니다.';
