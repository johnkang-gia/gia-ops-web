-- 정류장 좌표 찾기를 **언제 마지막으로 시도했는지** 남깁니다.
--
-- ── 왜 필요한가 ─────────────────────────────────────────────────────────────
--
-- 좌표가 없는 정류장을 매일 밤 조금씩 채우는데, 주소로 찾을 수 없는 곳(「원페를라 202동」처럼
-- 건물 이름만 적힌 곳)이 섞여 있습니다. 시도한 기록이 없으면 다음 실행에서도 **같은 곳이 먼저
-- 뽑혀** 계속 실패하고, 뒤에 있는 곳은 영영 차례가 오지 않습니다.
--
-- 성공 시각(geocoded_at)만으로는 이걸 알 수 없습니다 - 실패한 곳도 아직 시도 안 한 곳도
-- 똑같이 비어 있기 때문입니다. 「해봤는데 안 된 것」과 「아직 안 해본 것」은 다른 상태이고,
-- 사람이 손대야 하는 것은 앞의 것뿐입니다.

alter table public.shuttle_stops
  add column if not exists geocode_tried_at timestamptz;

comment on column public.shuttle_stops.geocode_tried_at is
  '좌표 찾기를 마지막으로 시도한 시각. 이 값이 있는데 lat 이 비어 있으면 주소로 찾을 수 없는 정류장입니다.';

-- 아직 안 해본 곳부터 뽑기 위한 색인.
create index if not exists shuttle_stops_geocode_todo_idx
  on public.shuttle_stops (geocode_tried_at nulls first)
  where lat is null;

-- rls-ok: 표를 새로 만들지 않았습니다. 기존 표에 칸만 더합니다.
