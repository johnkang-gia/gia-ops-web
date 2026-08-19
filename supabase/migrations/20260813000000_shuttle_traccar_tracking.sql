-- ===== 93. 하원 GPS 추적(Traccar Client 연동) + 정류장 좌표 자동 학습 =====
-- 요청: "기사님들은 네비를 핸드폰으로 하시는 경우도 많아서... 백그라운드에서 돌아갈 수 있도록",
-- "각 정류장도 우리는 지금 정확한 정보를 가지고 있지 않아서, gps를 통해서 정류장과, 도착 또한
-- gps를 계속 갱신해서 정확도를 높여서 정류장도 파악이 되도록 만들어줘"
--
-- 웹페이지는 아이폰 사파리 특성상 백그라운드에서 위치를 보낼 수 없어서, 무료 오픈소스 앱인
-- Traccar Client가 우리 서버(/api/shuttle/track)로 위치를 직접 보내도록 연동합니다. 기사님은
-- 최초 1회 설정 뒤로는 아무 조작도 하지 않으시고 네비 화면도 가려지지 않습니다.

-- 어느 기기(휴대폰)가 어느 노선인지 연결합니다. device_id는 Traccar Client의 "Device
-- identifier" 칸에 넣을 값이고, 이 값 자체가 비밀키 역할을 하므로 추측하기 어려운 임의
-- 문자열을 씁니다(등록되지 않은 ID로 들어온 위치는 조용히 버립니다).
create table if not exists shuttle_tracker_devices (
  id uuid primary key default gen_random_uuid(),
  device_id text not null unique,
  route_id uuid not null references shuttle_routes(id) on delete cascade,
  label text,                                 -- 기사님 성함·차량번호 등 식별용 메모
  enabled boolean not null default true,
  last_seen_at timestamptz,                   -- 마지막으로 위치를 보내온 시각(설치 확인용)
  created_at timestamptz not null default now()
);
create index if not exists shuttle_tracker_devices_route_idx on shuttle_tracker_devices(route_id);

alter table shuttle_tracker_devices enable row level security;
drop policy if exists "giamicro_select_shuttle_tracker_devices" on shuttle_tracker_devices;
create policy "giamicro_select_shuttle_tracker_devices" on shuttle_tracker_devices for select using (is_giamicro_user());
drop policy if exists "wr_manager_write_shuttle_tracker_devices" on shuttle_tracker_devices;
create policy "wr_manager_write_shuttle_tracker_devices" on shuttle_tracker_devices for all using (is_wr_manager()) with check (is_wr_manager());

-- Traccar는 속도도 함께 보내줍니다(정차 판정에 씁니다). source는 웹 체크인('web')과 Traccar
-- 앱('traccar')을 구분해, 나중에 어느 쪽이 더 안정적이었는지 비교할 수 있게 남겨둡니다.
alter table shuttle_pilot_pings add column if not exists speed double precision;
alter table shuttle_pilot_pings add column if not exists source text not null default 'web';

-- 주행 기록에서 찾아낸 "차가 실제로 멈춰 있던 지점"입니다. 같은 자리가 반복 관측될수록
-- 평균 좌표가 정확해집니다. matched_stop_id가 비어 있으면 기존 정류장과 연결되지 않은
-- 지점이라, 담당자가 관리자 화면에서 어느 정류장인지 지정해주면 됩니다.
create table if not exists shuttle_stop_observations (
  id bigint generated always as identity primary key,
  route_id uuid not null references shuttle_routes(id) on delete cascade,
  service_date date not null,
  lat double precision not null,
  lng double precision not null,
  arrived_at timestamptz not null,            -- 그 자리에 선 시각
  departed_at timestamptz not null,           -- 다시 움직인 시각
  dwell_seconds int not null,
  sample_count int not null default 1,
  order_index int,                            -- 그날 몇 번째 정차였는지(정류장 순서 대조용)
  matched_stop_id uuid references shuttle_stops(id) on delete set null,
  distance_m double precision,                -- 연결된 정류장 좌표와의 거리(기존 좌표 오차)
  created_at timestamptz not null default now()
);
-- 크론이 여러 번 돌아도 같은 정차가 중복으로 쌓이지 않도록.
create unique index if not exists shuttle_stop_observations_unique_idx on shuttle_stop_observations(route_id, arrived_at);
create index if not exists shuttle_stop_observations_stop_idx on shuttle_stop_observations(matched_stop_id);
create index if not exists shuttle_stop_observations_date_idx on shuttle_stop_observations(service_date desc);

alter table shuttle_stop_observations enable row level security;
drop policy if exists "giamicro_select_shuttle_stop_observations" on shuttle_stop_observations;
create policy "giamicro_select_shuttle_stop_observations" on shuttle_stop_observations for select using (is_giamicro_user());
drop policy if exists "wr_manager_write_shuttle_stop_observations" on shuttle_stop_observations;
create policy "wr_manager_write_shuttle_stop_observations" on shuttle_stop_observations for all using (is_wr_manager()) with check (is_wr_manager());

-- GPS로 학습한 좌표는 기존 좌표(lat/lng - 주소 지오코딩 결과)를 덮어쓰지 않고 따로 담아둡니다.
-- 담당자가 관리자 화면에서 확인한 뒤 "반영" 버튼으로 옮기는 방식이라, 잘못 학습되어도 원래
-- 값을 잃지 않습니다.
alter table shuttle_stops add column if not exists gps_lat double precision;
alter table shuttle_stops add column if not exists gps_lng double precision;
alter table shuttle_stops add column if not exists gps_sample_count int not null default 0;
alter table shuttle_stops add column if not exists gps_updated_at timestamptz;

