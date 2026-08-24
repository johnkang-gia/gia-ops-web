-- ===== 110. 하원 GPS - 정류장별 도착 기록 =====
--
-- 요청: "정류장에 도착했다면 어디정류장에 도착했는지 체크되게 해주고, 누가 내리는지까지 체크가
-- 되면 (...) 출발했다면 어느정류장으로 가고있는지, 정류장에 도착했다면 누가 내리는지 등이
-- 표시되었으면".
--
-- 학교 도착/출발(shuttle_run_events)과 달리, 이건 "노선 중간의 어느 정류장에 언제 닿았는가"를
-- 남깁니다. 기사님 휴대폰 GPS가 그 정류장 좌표 반경 안에 들어오면 /api/shuttle/track이 여기에
-- 한 줄을 남기고(하루 한 정류장당 한 번), 운영 대시보드가 이 기록으로 "몇 번째 정류장까지 갔고,
-- 지금 어느 정류장으로 가는 중이며, 이번 정류장에서 누가 내리는지"를 보여줍니다.
--
-- 정류장 좌표는 그날그날 GPS로 학습해 점점 정확해집니다(shuttle_stop_observations →
-- shuttle-learn-stops 크론이 매일 평균을 다시 계산). 좌표가 아직 없는 정류장은 도착 감지가
-- 안 되지만, 며칠 운행하면 자동으로 채워집니다.

create table if not exists shuttle_stop_arrivals (
  id uuid primary key default gen_random_uuid(),
  service_date date not null,
  route_id uuid not null references shuttle_routes(id) on delete cascade,
  stop_id uuid not null references shuttle_stops(id) on delete cascade,
  arrived_at timestamptz not null default now(),
  -- 사람이 아니라 GPS가 잡은 것이므로 근거(그때의 거리 m)를 남겨 나중에 정확도를 점검합니다.
  distance_m double precision,
  created_at timestamptz not null default now()
);

-- 같은 정류장은 하루 한 번만 기록합니다(왕복·재접근으로 여러 번 잡혀도 첫 도착만 남김).
create unique index if not exists shuttle_stop_arrivals_unique_idx
  on shuttle_stop_arrivals(service_date, stop_id);
create index if not exists shuttle_stop_arrivals_route_idx
  on shuttle_stop_arrivals(service_date, route_id);

alter table shuttle_stop_arrivals enable row level security;
drop policy if exists "giamicro_select_shuttle_stop_arrivals" on shuttle_stop_arrivals;
create policy "giamicro_select_shuttle_stop_arrivals" on shuttle_stop_arrivals
  for select using (is_giamicro_user());
drop policy if exists "wr_manager_write_shuttle_stop_arrivals" on shuttle_stop_arrivals;
create policy "wr_manager_write_shuttle_stop_arrivals" on shuttle_stop_arrivals
  for all using (is_wr_manager()) with check (is_wr_manager());

-- 대시보드가 거의 즉시 반영되도록 Realtime 발행 목록에 추가합니다.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'shuttle_stop_arrivals'
  ) then
    alter publication supabase_realtime add table shuttle_stop_arrivals;
  end if;
end $$;
