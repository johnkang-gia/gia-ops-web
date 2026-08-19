-- ===== 92. 도착체크 - 출발 자동감지(GPS·시간) =====
-- 요청: "여러대가 한꺼번에 도착해서... 출발하는 것을 체크하는걸 까먹거나, 늦어져서 계속
-- 화면에 차량이 뜨는 경우가 너무 많아 이부분을 어떻게 자동으로 할 수 있을지". 교직원
-- 도착체크(/shuttle-arrival) 화면은 "출발"을 사람이 직접 눌러야 하는데, 하원 시간에 여러
-- 차량을 동시에 상대하다 보면 잊어버리기 쉬워, 크론(/api/cron/shuttle-auto-depart)이 두
-- 신호로 자동으로 "출발"을 채워 넣습니다: 1) 그 노선의 파일럿(GPS) 체크인이 켜져 있으면
-- 학교 위치에서 100m 이상 멀어진 최근 위치로 실제 출발을 감지, 2) GPS 핑이 아예 없으면
-- "도착함" 후 20분이 지나면 화면 정리 차원의 시간 초과 자동 처리.
create table if not exists shuttle_campus_locations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  address text not null,
  lat double precision,
  lng double precision,
  geocoded_at timestamptz,
  created_at timestamptz not null default now()
);

alter table shuttle_campus_locations enable row level security;

drop policy if exists "giamicro_select_shuttle_campus_locations" on shuttle_campus_locations;
create policy "giamicro_select_shuttle_campus_locations" on shuttle_campus_locations for select using (is_giamicro_user());

drop policy if exists "wr_manager_write_shuttle_campus_locations" on shuttle_campus_locations;
create policy "wr_manager_write_shuttle_campus_locations" on shuttle_campus_locations for all using (is_wr_manager()) with check (is_wr_manager());

-- 위경도는 처음에는 비워두고, 크론이 처음 실행될 때 카카오 REST API로 한 번 지오코딩해서
-- 채워 넣습니다(내 개발 환경은 카카오 API에 접근할 수 없어 여기서 직접 채우지 못합니다).
insert into shuttle_campus_locations (name, address)
select '본교', '서울 강남구 논현로131길 45'
where not exists (select 1 from shuttle_campus_locations where name = '본교');

-- 자동 출발 처리가 겹쳐 중복 삽입되지 않도록, 먼저 기존에 혹시 있을 중복 '출발' 기록을
-- 정리(가장 이른 것만 남김)한 뒤 유니크 인덱스를 겁니다.
delete from shuttle_run_events a using shuttle_run_events b
where a.event = '출발' and b.event = '출발'
  and a.route_id = b.route_id and a.service_date = b.service_date
  and (a.created_at > b.created_at or (a.created_at = b.created_at and a.id > b.id));

create unique index if not exists shuttle_run_events_depart_unique_idx
  on shuttle_run_events (route_id, service_date)
  where event = '출발';

