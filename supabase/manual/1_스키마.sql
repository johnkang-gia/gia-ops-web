-- ============================================================================
--  GIA 운영앱 - 손으로 적용하는 SQL 1/3 : 스키마
-- ============================================================================
--  ▶ Supabase 대시보드 → SQL Editor → New query → 이 파일 전체 붙여넣기 → Run
--  ▶ 순서대로 1 → 2 → 3 을 각각 실행해주세요.  ▶ 여러 번 실행해도 안전합니다.
-- ============================================================================



-- ════════════════════════════════════════════════════════════════
-- 20260811000000_shuttle_auto_depart.sql
-- ════════════════════════════════════════════════════════════════
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



-- ════════════════════════════════════════════════════════════════
-- 20260813000000_shuttle_traccar_tracking.sql
-- ════════════════════════════════════════════════════════════════
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



-- ════════════════════════════════════════════════════════════════
-- 20260820000000_work_notices.sql
-- ════════════════════════════════════════════════════════════════
-- ===== 94. 업무 전체공지 =====
-- 요청: "업무에서 전체공지가 있을경우 바로 상단으로 옮겨지고, 새로운 공지가 있으면 이전공지가
-- 사라지고, 다음공지가 상단으로 옮겨지게 하고, 전체공지 히스토리를 상단오른쪽에 히스토리
-- 아이콘을 눌러서 볼 수 있도록 만들어주고, 공지로 상단에 뜨는경우, 각각의 이용자들이 공지를
-- 접을 수 있게 해줘"
--
-- 공지는 지우지 않고 계속 쌓아두고, "가장 최근 것 하나만" 상단에 띄웁니다(화면에서 created_at
-- 내림차순 첫 행). 그래서 새 공지를 올리면 이전 공지는 자동으로 상단에서 내려가고 히스토리에만
-- 남습니다 - 별도의 '내리기' 처리가 필요 없고, 기록도 사라지지 않습니다.
create table if not exists work_notices (
  id uuid primary key default gen_random_uuid(),
  -- scope='전체'면 부서와 상관없이 모든 부서 탭 상단에, '부서'면 department와 같은 부서에서만
  -- 보입니다(요청: "둘 다 (전체/부서 선택)").
  scope text not null default '전체' check (scope in ('전체', '부서')),
  department text,
  title text not null,
  body text,
  author_email text not null,
  -- 올린 사람이 실수로 올렸을 때 되돌릴 수 있도록 감춤 처리만 합니다(행을 지우지 않아 히스토리
  -- 순서가 흐트러지지 않습니다).
  archived_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists work_notices_recent_idx on work_notices(created_at desc);
-- scope='부서'인데 department가 비어 있으면 어느 부서에도 안 뜨는 유령 공지가 되므로 막습니다.
alter table work_notices drop constraint if exists work_notices_scope_department_chk;
alter table work_notices add constraint work_notices_scope_department_chk
  check (scope = '전체' or department is not null);

-- 사용자별로 공지를 접어둔 상태입니다(요청: "각각의 이용자들이 공지를 접을 수 있게"). 공지마다
-- 따로 기록하므로, 접어둔 뒤 새 공지가 올라오면 그 새 공지는 다시 펼쳐진 채로 보입니다.
create table if not exists work_notice_collapses (
  notice_id uuid not null references work_notices(id) on delete cascade,
  user_email text not null,
  created_at timestamptz not null default now(),
  primary key (notice_id, user_email)
);

alter table work_notices enable row level security;
alter table work_notice_collapses enable row level security;

-- 조회는 giamicro.com 계정이면 누구나(공지는 모두가 봐야 함), 작성·수정은 관리자·행정직원만
-- 할 수 있습니다(요청: "관리자·행정직원만").
drop policy if exists "giamicro_select_work_notices" on work_notices;
create policy "giamicro_select_work_notices" on work_notices for select using (is_giamicro_user());
drop policy if exists "wr_manager_write_work_notices" on work_notices;
create policy "wr_manager_write_work_notices" on work_notices for all using (is_wr_manager()) with check (is_wr_manager());

-- 접기 기록은 본인 것만 읽고 쓸 수 있습니다(남의 화면 상태를 건드릴 이유가 없습니다).
drop policy if exists "own_work_notice_collapses" on work_notice_collapses;
create policy "own_work_notice_collapses" on work_notice_collapses for all
  using (user_email = lower(auth.jwt() ->> 'email'))
  with check (user_email = lower(auth.jwt() ->> 'email'));

-- 새 공지가 올라오면 보고 있던 사람들 화면에 새로고침 없이 바로 뜨도록 실시간 구독에 넣습니다.
-- 실시간 구독 등록(alter publication)은 Supabase에서 소유자 권한이 필요합니다. 대시보드
-- SQL Editor에서는 되지만, GitHub Actions가 쓰는 연결에서는 "must be owner of publication"으로
-- 막힐 수 있습니다. 이 한 줄 때문에 마이그레이션 전체가 멈추면 학생 명부까지 못 들어가므로,
-- 실패해도 안내만 남기고 넘어갑니다(그 경우 대시보드 > Database > Replication에서 켜주세요).
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='work_notices') then
    alter publication supabase_realtime add table work_notices;
  end if;
exception when others then
  raise notice 'work_notices 실시간 구독 등록을 건너뜁니다(대시보드 > Database > Replication에서 켜주세요): %', sqlerrm;
end $$;


-- ════════════════════════════════════════════════════════════════
-- 20260820120000_ops_board_timetable.sql
-- ════════════════════════════════════════════════════════════════
-- ===== 95. 통합 운영 대시보드(사무실 대형 모니터) + 시간표 =====
-- 요청: "gia운영에 있는 업무 탭을 사무실 가운데에 큰 모니터에 띄워서 전체가 한눈에 보고 파악할
-- 수 있는 통합 대시보드... 지금 시간에 각반이 무슨 수업시간인지, 그리고 오늘의 결석,지각,픽업
-- 학생들, 그리고 어떤 업무들이 오늘 있는지에 관한 요약... 오후 4시쯤에 하원차량 픽업이
-- 시작되기때문에 그 때에는 자동으로 차량 상황을 볼 수 있게끔"
--
-- 출결(attendance_records)·픽업(shuttle_boardings)·업무(tasks)·차량(shuttle_run_events)은 이미
-- 있어서 그대로 씁니다. 없던 것은 "지금 몇 교시이고 각 반이 무슨 수업인지"라서, 교시 정의와
-- 시간표 두 표를 새로 만듭니다. 데이터는 나중에 한 번에 넣기로 해서 지금은 틀만 만듭니다.

-- 교시 정의 - 부서(유치부/초등부/중고등부)마다 교시 수와 시각이 다를 수 있어 부서별로 둡니다.
create table if not exists wr_periods (
  id uuid primary key default gen_random_uuid(),
  department text not null check (department in ('유치부', '초등부', '중고등부')),
  period_no int not null,                     -- 1교시, 2교시...
  label text,                                 -- '1교시', '점심', '방과후' 등 화면 표기용
  start_time time not null,
  end_time time not null,
  created_at timestamptz not null default now(),
  unique (department, period_no)
);
create index if not exists wr_periods_dept_idx on wr_periods(department, start_time);

-- 시간표 한 칸 = 어느 반이, 무슨 요일 몇 교시에, 무슨 수업을 하는지.
-- weekday는 1=월 ... 5=금 (shuttle_assignments와 같은 규칙).
create table if not exists wr_timetable (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references wr_classes(id) on delete cascade,
  weekday int not null check (weekday between 1 and 7),
  period_id uuid not null references wr_periods(id) on delete cascade,
  subject_name text not null,                 -- 과목명(자유 입력 - wr_subjects에 없는 활동도 적을 수 있게)
  subject_id uuid references wr_subjects(id) on delete set null,
  teacher_name text,                          -- 담당 교사 표기(비워두면 화면에서 생략)
  room text,                                  -- 교실/장소
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (class_id, weekday, period_id)
);
create index if not exists wr_timetable_lookup_idx on wr_timetable(weekday, period_id);

drop trigger if exists wr_timetable_set_updated_at on wr_timetable;
create trigger wr_timetable_set_updated_at
  before update on wr_timetable
  for each row execute function set_updated_at();

-- 대시보드 접속 링크 - 안내보드(shuttle_board_links)와 같은 토큰 방식이라 사무실 모니터에서
-- 로그인 없이 주소 하나로 띄워둘 수 있습니다(요청: "로그인 없는 전용 링크").
create table if not exists ops_board_links (
  id uuid primary key default gen_random_uuid(),
  label text not null default '운영 대시보드',
  token uuid not null default gen_random_uuid(),
  -- 화면에서 유치부/초등부/중고등부를 골라 볼 수 있고, 여기 값은 처음 열었을 때의 기본값입니다.
  default_department text not null default '초등부' check (default_department in ('유치부', '초등부', '중고등부')),
  -- 요청: "오후 4시쯤에 하원차량 픽업이 시작되기때문에... 앱쪽 전체가 차량화면으로 전환"
  -- 이 시각(KST)이 되면 대시보드가 통째로 차량 화면으로 바뀝니다.
  shuttle_switch_hour int not null default 16 check (shuttle_switch_hour between 0 and 23),
  shuttle_switch_minute int not null default 0 check (shuttle_switch_minute between 0 and 59),
  -- 전환했을 때 띄울 차량 화면(안내보드) 토큰입니다. 비워두면 전환하지 않습니다.
  shuttle_board_token uuid,
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index if not exists ops_board_links_token_idx on ops_board_links(token);

alter table wr_periods enable row level security;
alter table wr_timetable enable row level security;
alter table ops_board_links enable row level security;

-- 조회는 giamicro.com 계정이면 누구나(교사도 자기 반 시간표를 봐야 함), 수정은 관리자·행정직원만.
drop policy if exists "giamicro_select_wr_periods" on wr_periods;
create policy "giamicro_select_wr_periods" on wr_periods for select using (is_giamicro_user());
drop policy if exists "wr_manager_write_wr_periods" on wr_periods;
create policy "wr_manager_write_wr_periods" on wr_periods for all using (is_wr_manager()) with check (is_wr_manager());

drop policy if exists "giamicro_select_wr_timetable" on wr_timetable;
create policy "giamicro_select_wr_timetable" on wr_timetable for select using (is_giamicro_user());
drop policy if exists "wr_manager_write_wr_timetable" on wr_timetable;
create policy "wr_manager_write_wr_timetable" on wr_timetable for all using (is_wr_manager()) with check (is_wr_manager());

drop policy if exists "giamicro_select_ops_board_links" on ops_board_links;
create policy "giamicro_select_ops_board_links" on ops_board_links for select using (is_giamicro_user());
drop policy if exists "wr_manager_write_ops_board_links" on ops_board_links;
create policy "wr_manager_write_ops_board_links" on ops_board_links for all using (is_wr_manager()) with check (is_wr_manager());


-- ════════════════════════════════════════════════════════════════
-- 20260820180000_department_column.sql
-- ════════════════════════════════════════════════════════════════
-- ===== 96. 부서(유치부/초등부/중고등부) 명시 칸 + 유치부 분리 =====
-- 요청: "부서는 유치부는 통합하지말고 따로 만들어 달라고 하셨어... 앞으로도 저런형식을가진
-- 아이들을 유치부로 분류하고... 유치부는 우선 분리해서 표면적으로는 안보이게 해줘"
--
-- 지금까지는 학년 표기(wr_classes.grade)의 글자 모양을 보고 부서를 추측했는데, 표기가 조금만
-- 달라져도 엉뚱한 부서로 묶입니다. 새 학기 데이터를 통째로 넣기 전에 부서를 명시적으로 담는
-- 칸을 만들어, 앞으로는 추측 없이 이 값만 보고 판단하게 합니다. 나중에 유치부용 프로그램을
-- 따로 만들 때도 이 칸 하나로 학생을 골라낼 수 있습니다.

alter table wr_students add column if not exists department text
  check (department is null or department in ('유치부', '초등부', '중고등부'));
alter table wr_classes add column if not exists department text
  check (department is null or department in ('유치부', '초등부', '중고등부'));

create index if not exists wr_students_department_idx on wr_students(department);
create index if not exists wr_classes_department_idx on wr_classes(department);

-- 기존 행은 그동안 쓰던 추측 규칙과 같은 기준으로 한 번만 채워둡니다(이미 값이 있으면 건드리지
-- 않으므로 여러 번 실행해도 안전합니다). 새로 들어오는 데이터는 명시적으로 넣습니다.
update wr_classes
set department = case
  when grade ~* '유치|^K|^유' then '유치부'
  when grade ~ '중|고' then '중고등부'
  when coalesce(nullif(regexp_replace(grade, '[^0-9]', '', 'g'), ''), '0')::int >= 7 then '중고등부'
  when coalesce(nullif(regexp_replace(grade, '[^0-9]', '', 'g'), ''), '0')::int between 1 and 6 then '초등부'
  else null
end
where department is null and grade is not null;

update wr_students
set department = case
  when grade ~* '유치|^K|^유' then '유치부'
  when grade ~ '중|고' then '중고등부'
  when coalesce(nullif(regexp_replace(grade, '[^0-9]', '', 'g'), ''), '0')::int >= 7 then '중고등부'
  when coalesce(nullif(regexp_replace(grade, '[^0-9]', '', 'g'), ''), '0')::int between 1 and 6 then '초등부'
  else null
end
where department is null and grade is not null;


-- ════════════════════════════════════════════════════════════════
-- 20260820200000_ensure_base_columns.sql
-- ════════════════════════════════════════════════════════════════
-- ===== 96-b. 선행 보정 - 뒤 마이그레이션이 기대하는 칸을 먼저 채웁니다 =====
--
-- 왜 필요한가요?
--   실서버 DB는 마이그레이션 자동화를 만들기 전까지 "채팅으로 드린 SQL을 Supabase SQL Editor에
--   직접 붙여넣는" 방식으로 만들어져 왔습니다. 그러다 보니 중간에 빠뜨린 블록이 생겼고, 실제로
--   wr_students.gender 칸이 실서버에 없었습니다. 그런데 그 뒤에 만든 공용 명부 뷰
--   (wr_students_basic)가 그 칸을 읽으려 해서 다음 오류로 멈췄습니다.
--
--     ERROR: column s.gender does not exist (SQLSTATE 42703)
--
--   마이그레이션은 하나가 실패하면 그 뒤 파일이 전부 멈추기 때문에, 이 한 칸 때문에 3학기 학생
--   명부·반·시간표가 통째로 들어가지 못했습니다.
--
-- 이 파일이 하는 일
--   앞으로 실행될 마이그레이션들이 읽거나 쓰는 칸을 전부 "없으면 만들기"로 한 번씩 훑습니다.
--   이미 있으면 아무 일도 일어나지 않으므로, 실서버든 새 DB든 같은 결과가 됩니다. 앞으로도 손으로
--   넣은 SQL과 어긋나는 부분이 있으면 여기서 먼저 메워집니다.
--
-- 정의는 schema.sql(전체 구조 참고 문서)에 적힌 것과 글자 그대로 같게 맞췄습니다 - 타입이나
-- 기본값이 조금이라도 다르면 나중에 더 찾기 어려운 문제가 됩니다.

-- ── 학생 ────────────────────────────────────────────────────────────────────
alter table wr_students add column if not exists student_no text;
alter table wr_students add column if not exists birth_date date;
alter table wr_students add column if not exists phone text;
alter table wr_students add column if not exists address text;
alter table wr_students add column if not exists class_id uuid references wr_classes(id) on delete set null;
alter table wr_students add column if not exists name_en text;
alter table wr_students add column if not exists parent_email text;
alter table wr_students add column if not exists gender text check (gender in ('남', '여'));
alter table wr_students add column if not exists allergies text;
alter table wr_students add column if not exists custom_fields jsonb not null default '{}'::jsonb;
alter table wr_students add column if not exists shuttle_mode text not null default '없음'
  check (shuttle_mode in ('없음', '등원', '하원', '등하원'));
alter table wr_students add column if not exists lat double precision;
alter table wr_students add column if not exists lng double precision;
alter table wr_students add column if not exists geocoded_at timestamptz;

-- ── 반 ──────────────────────────────────────────────────────────────────────
-- 계정이 아직 없는 담임·부담임의 이름을 임시로 적어두는 칸입니다. 3학기 명부를 넣을 때
-- 선생님들이 가입 전이라 이 칸에 이름만 들어갑니다.
alter table wr_classes add column if not exists teacher_name text;
alter table wr_classes add column if not exists sub_teacher_name text;

-- ── 셔틀 ────────────────────────────────────────────────────────────────────
-- 하원 체크표에서 학생을 다른 차로 옮길 때 쓰는 칸입니다(영구 변경은 배정표, 오늘만 변경은
-- 탑승 기록에 남습니다). 공용 배정표 뷰가 이 칸을 읽습니다.
alter table shuttle_assignments add column if not exists override_route_id uuid references shuttle_routes(id) on delete set null;
alter table shuttle_boardings add column if not exists override_route_id uuid references shuttle_routes(id) on delete set null;
alter table shuttle_boardings add column if not exists alighted_at timestamptz;

-- ── 계정 ────────────────────────────────────────────────────────────────────
alter table app_users add column if not exists name text;
alter table app_users add column if not exists department text;
alter table app_users add column if not exists position text;
alter table app_users add column if not exists avatar_url text;
alter table app_users add column if not exists theme text not null default 'light';
alter table app_users add column if not exists hire_date date;
alter table app_users add column if not exists leave_date date;

-- ── 학기별 반 배정 기록 ─────────────────────────────────────────────────────
-- 3학기 명부를 넣을 때 "이 학생이 이번 학기에 어느 반이었는지"를 여기에 남깁니다. 다음 학기에
-- 반이 바뀌어도 지난 학기 기록을 그 학기의 반으로 되짚어볼 수 있습니다.
create table if not exists wr_enrollments (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references wr_students(id) on delete cascade,
  term_id uuid references terms(id) on delete set null,
  grade text,
  class_id uuid references wr_classes(id) on delete set null,
  homeroom_teacher_email text,
  created_at timestamptz not null default now(),
  unique (student_id, term_id)
);
alter table wr_enrollments enable row level security;
drop policy if exists "giamicro_all_wr_enrollments" on wr_enrollments;
create policy "giamicro_all_wr_enrollments" on wr_enrollments
  for all using (is_giamicro_user()) with check (is_giamicro_user());

-- ── 공통 함수 ───────────────────────────────────────────────────────────────
-- updated_at을 자동으로 갱신하는 트리거 함수입니다. 뒤에서 여러 표가 이 함수를 씁니다.
create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;


-- ════════════════════════════════════════════════════════════════
-- 20260820210000_student_roster_sharing.sql
-- ════════════════════════════════════════════════════════════════
-- ===== 97. 학생명부 공용화 + 권한 정리 =====
-- 요청: "학생명부를 다양하게 연결할 수 있도록 만들어주되, 이명부에 관한 권한은 행정직원,관리자,
-- 개발자... 로 할게" + 일반 교직원이 볼 수 있는 항목은 "이름(영어이름), 나이(생년월일), 성별,
-- 방과후수업진행여부, 악기, 셔틀탑승여부, 특이사항(알러지, 형제자매링크 등)"
--
-- 지금까지 wr_students는 "giamicro.com 계정이면 누구나 읽고 쓰기"였습니다. 즉 교사도 학생
-- 명부를 고칠 수 있었고, 보호자 연락처·주소 같은 개인정보도 전부 볼 수 있었습니다. 이번에
-- 두 가지로 나눕니다.
--   ① 원본 표(wr_students)   - 행정직원·관리자·개발자만 읽고 쓸 수 있음(모든 항목)
--   ② 공용 명부(wr_students_basic) - 교직원 누구나 읽을 수 있고, 위에 정하신 항목만 담음
-- 나중에 유치부 프로그램처럼 다른 시스템을 붙일 때도 ②를 보게 하면 개인정보를 넘기지 않고
-- 학생을 연결할 수 있습니다.
--
-- 개발자(johnkang@giamicro.com)는 is_app_admin() → is_wr_manager()에 이미 항상 포함되어 있어
-- 별도 처리 없이 최상위 권한으로 동작합니다.

-- 새로 필요한 항목들.
alter table wr_students add column if not exists afterschool boolean not null default false;
alter table wr_students add column if not exists instrument text
  check (instrument is null or instrument in ('첼로', '우쿨렐레', '클라리넷', '바이올린', '플룻'));
-- 형제자매 묶음 - 같은 집 아이들에게 같은 값을 넣어두면 부서를 넘나들어도(유치부 동생 ↔ 초등부
-- 형) 한 가족으로 이어집니다. 셔틀·보호자 연락·출결 이름 대조에 씁니다.
alter table wr_students add column if not exists family_id uuid;
create index if not exists wr_students_family_idx on wr_students(family_id);

-- ── ① 원본 표: 행정직원·관리자·개발자 전용 ────────────────────────────────────
drop policy if exists "giamicro_all_wr_students" on wr_students;
drop policy if exists "wr_manager_all_wr_students" on wr_students;
create policy "wr_manager_all_wr_students" on wr_students
  for all using (is_wr_manager()) with check (is_wr_manager());

-- 반 명부도 같은 기준으로 - 읽기는 모두(수업·출결 화면이 반 이름을 써야 함), 수정은 관리자급만.
drop policy if exists "giamicro_all_wr_classes" on wr_classes;
drop policy if exists "giamicro_select_wr_classes" on wr_classes;
create policy "giamicro_select_wr_classes" on wr_classes for select using (is_giamicro_user());
drop policy if exists "wr_manager_write_wr_classes" on wr_classes;
create policy "wr_manager_write_wr_classes" on wr_classes
  for all using (is_wr_manager()) with check (is_wr_manager());

-- ── ② 공용 명부: 교직원 누구나 읽기 ───────────────────────────────────────────
-- 보호자 연락처·이메일·주소·좌표·학번·custom_fields는 일부러 뺐습니다.
-- 뷰는 원본 표의 보안규칙을 우회하므로, 뷰 자체에서 giamicro.com 계정인지 한 번 확인합니다.
drop view if exists wr_students_basic;
create view wr_students_basic as
select
  s.id,
  s.name,
  s.name_en,
  s.grade,
  s.class_name,
  s.class_id,
  s.department,
  s.status,
  s.birth_date,
  s.gender,
  s.afterschool,
  s.instrument,
  s.shuttle_mode,
  s.allergies,
  s.note,
  s.family_id,
  s.created_at
from wr_students s
where is_giamicro_user();

revoke all on wr_students_basic from anon;
grant select on wr_students_basic to authenticated;


-- ════════════════════════════════════════════════════════════════
-- 20260820230000_guardian_phone_restrict.sql
-- ════════════════════════════════════════════════════════════════
-- ===== 98. 셔틀 배정표의 보호자 연락처 보호 =====
-- 요청: "보호자 연락처, 이메일, 주소, 좌표, 학번의 경우 행정직원과 관리자만 볼 수 있도록해줘"
--
-- 학생 명부(wr_students)는 앞 단계에서 이미 막았는데, 같은 정보가 셔틀 배정표에도 한 벌 더
-- 들어 있었습니다(shuttle_assignments.guardian_phone). 이 표는 동승선생님이 교사 계정일 수
-- 있어 조회를 열어둔 상태여서, 화면에는 안 보여도 데이터로는 교사가 읽을 수 있었습니다.
--
-- 명부와 같은 방식으로 나눕니다.
--   ① 원본 표(shuttle_assignments)          - 행정직원·관리자·개발자만
--   ② 공용 배정표(shuttle_assignments_basic) - 보호자 연락처만 빼고 나머지는 교직원 모두
-- 하원 체크표·실시간 셔틀은 ②만 있으면 되므로 동승선생님 업무에는 영향이 없습니다.

drop policy if exists "giamicro_select_shuttle_assignments" on shuttle_assignments;

drop view if exists shuttle_assignments_basic;
create view shuttle_assignments_basic as
select
  a.id,
  a.stop_id,
  a.student_id,
  a.student_name_raw,
  a.class_raw,
  a.weekdays,
  a.note,
  a.override_route_id,
  a.created_at
from shuttle_assignments a
where is_giamicro_user();

revoke all on shuttle_assignments_basic from anon;
grant select on shuttle_assignments_basic to authenticated;


-- ════════════════════════════════════════════════════════════════
-- 20260821000000_library_system.sql
-- ════════════════════════════════════════════════════════════════
-- ===== 99. 도서관 시스템(gia-lib) 기반 =====
-- 요청: "학생들이 도서관을 이용할 때 바코드로 학생도서카드를 만들어서, 바코드를 찍으면 누가,
-- 어떤 책을 이용하는지에 관한 데이터를 기록하고... 나중에 디지털 학생증처럼 출결·행사입장·
-- 물건구입까지 학생카드 하나로 통합 관리" + "앱은 별도로, 데이터는 하나로".
--
-- 도서관 앱(gia-lib-web)은 별도의 Next.js 앱이지만 DB는 이 프로젝트를 그대로 씁니다. 그래서
-- 표(lib_*)와 보안규칙은 운영앱 저장소인 여기서 한 벌로 관리하고(= GitHub Actions가 자동 반영),
-- 도서관 앱은 그 표를 읽고 쓰기만 합니다.
--
-- 설계 요약
--   ① 학생 식별  - 이미 있는 wr_students.student_no(GIA-2026-0001)를 그대로 카드 바코드로 씁니다.
--                  도서관 앱에는 lib_students 뷰(이름/반/고유번호만)만 열어 개인정보를 넘기지
--                  않습니다.
--   ② 책 식별    - 책 뒷면 ISBN 바코드를 그대로 씁니다(라벨 부착 작업 없음). ISBN이 없는 책만
--                  자체 라벨(GIA-B-00001)을 발급해 붙입니다. 같은 책 여러 권은 total_copies
--                  수량으로 관리합니다.
--   ③ 가계정     - 도서관 노트북은 gia-library@giamicro.com 같은 전용 계정으로 로그인합니다.
--                  이 계정은 도서관 표와 학생 명부(이름/반/번호)만 볼 수 있고, 운영앱의
--                  사건기록·보호자 연락처 등에는 접근할 수 없습니다.

-- ── ① 도서관 전용 가계정 판정 ────────────────────────────────────────────────
-- gia-library@giamicro.com, gia-library2@giamicro.com 처럼 'gia-library'로 시작하는 회사
-- 계정을 도서관 전용 가계정으로 봅니다(계정을 늘려도 규칙을 다시 고칠 필요가 없게).
create or replace function is_library_account()
returns boolean
language sql
stable
as $$
  select coalesce(lower(auth.jwt() ->> 'email') like 'gia-library%@giamicro.com', false);
$$;

-- 도서관 앱을 쓸 수 있는 사람 = 회사 계정 전체(일반 교직원) + 도서관 가계정.
create or replace function is_lib_user()
returns boolean
language sql
stable
as $$
  select coalesce((auth.jwt() ->> 'email') ilike '%@giamicro.com', false);
$$;

-- 운영앱 전체의 기본 판정 함수에서 도서관 가계정을 제외합니다. 이 한 줄로 gia-library 계정은
-- 사건/회의/업무/학생 원본 명부 등 운영앱의 모든 표에서 자동으로 차단됩니다(정책들이 전부
-- is_giamicro_user()를 쓰고 있기 때문입니다). 도서관 표는 위의 is_lib_user()를 쓰므로 영향이
-- 없습니다.
create or replace function is_giamicro_user()
returns boolean
language sql
stable
as $$
  select
    coalesce((auth.jwt() ->> 'email') ilike '%@giamicro.com', false)
    and not coalesce(lower(auth.jwt() ->> 'email') like 'gia-library%@giamicro.com', false);
$$;

-- ── ② 장서(lib_books) ────────────────────────────────────────────────────────
-- isbn: 하이픈을 뺀 13자리(또는 10자리) 문자열. 책에 인쇄된 바코드를 찍으면 그대로 들어옵니다.
-- item_code: ISBN이 없는 책에만 발급하는 자체 라벨 번호(GIA-B-00001).
-- total_copies: 같은 책 보유 권수. 대출 가능 권수 = total_copies - 현재 대출중 건수.
create table if not exists lib_books (
  id uuid primary key default gen_random_uuid(),
  isbn text,
  item_code text,
  title text not null,
  author text,
  publisher text,
  pub_year text,
  cover_url text,
  category text,
  language text not null default '한국어' check (language in ('한국어', '영어', '기타')),
  location text,
  total_copies integer not null default 1 check (total_copies >= 0),
  status text not null default '보유' check (status in ('보유', '폐기', '분실')),
  note text,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- 둘 중 하나는 반드시 있어야 스캔으로 찾을 수 있습니다.
  constraint lib_books_code_required check (isbn is not null or item_code is not null)
);
create unique index if not exists lib_books_isbn_idx on lib_books(isbn) where isbn is not null;
create unique index if not exists lib_books_item_code_idx on lib_books(item_code) where item_code is not null;
create index if not exists lib_books_title_idx on lib_books(lower(title));

-- 자체 라벨 번호 발급기. 앱에서 supabase.rpc('lib_next_item_code')로 호출합니다.
create sequence if not exists lib_item_no_seq;
create or replace function lib_next_item_code()
returns text
language sql
security definer
set search_path = public
as $$
  select 'GIA-B-' || lpad(nextval('lib_item_no_seq')::text, 5, '0');
$$;
grant execute on function lib_next_item_code() to authenticated;

-- ── ③ 대출(lib_loans) ────────────────────────────────────────────────────────
-- 학생 정보는 student_id(연결)와 함께 이름/번호/반을 그때 값 그대로도 남겨둡니다. 학생이
-- 졸업해 명부에서 빠지거나 반이 바뀌어도 "그때 누가 빌렸는지" 기록이 유지되어야 하기 때문입니다.
create table if not exists lib_loans (
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null references lib_books(id) on delete cascade,
  student_id uuid references wr_students(id) on delete set null,
  student_no text not null,
  student_name text not null,
  student_class text,
  borrowed_at timestamptz not null default now(),
  due_date date not null,
  returned_at timestamptz,
  renew_count integer not null default 0,
  status text not null default '대출중' check (status in ('대출중', '반납완료', '분실')),
  handled_by text,
  returned_by text,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists lib_loans_book_active_idx on lib_loans(book_id) where status = '대출중';
create index if not exists lib_loans_student_idx on lib_loans(student_no, borrowed_at desc);
create index if not exists lib_loans_due_idx on lib_loans(due_date) where status = '대출중';
create index if not exists lib_loans_recent_idx on lib_loans(borrowed_at desc);

-- ── ④ 도서관 입실 기록(lib_visits) ───────────────────────────────────────────
-- 화면은 2단계에서 붙이지만(요청: "대출/반납 먼저, 나중에 추가"), 표는 미리 만들어 둡니다.
-- 나중에 출결·행사입장으로 확장할 때도 같은 모양(카드 찍기 → 시각 기록)을 재사용합니다.
create table if not exists lib_visits (
  id uuid primary key default gen_random_uuid(),
  student_id uuid references wr_students(id) on delete set null,
  student_no text not null,
  student_name text not null,
  student_class text,
  kind text not null default '입실' check (kind in ('입실', '퇴실')),
  visited_at timestamptz not null default now(),
  device text
);
create index if not exists lib_visits_time_idx on lib_visits(visited_at desc);
create index if not exists lib_visits_student_idx on lib_visits(student_no, visited_at desc);

-- ── ⑤ 대출 규칙(lib_settings) ────────────────────────────────────────────────
-- 한 줄짜리 설정표입니다(id=1 고정). 화면에서 바로 고칠 수 있습니다.
create table if not exists lib_settings (
  id integer primary key default 1 check (id = 1),
  library_name text not null default 'GIA 도서관',
  loan_days integer not null default 14 check (loan_days between 1 and 365),
  max_books integer not null default 3 check (max_books between 1 and 50),
  allow_renew boolean not null default true,
  renew_days integer not null default 7 check (renew_days between 1 and 365),
  max_renew integer not null default 1 check (max_renew between 0 and 10),
  block_when_overdue boolean not null default true,
  updated_at timestamptz not null default now()
);
insert into lib_settings (id) values (1) on conflict (id) do nothing;

-- ── ⑥ 갱신시각 자동 기록 ─────────────────────────────────────────────────────
drop trigger if exists lib_books_set_updated_at on lib_books;
create trigger lib_books_set_updated_at
  before update on lib_books
  for each row execute function set_updated_at();

drop trigger if exists lib_loans_set_updated_at on lib_loans;
create trigger lib_loans_set_updated_at
  before update on lib_loans
  for each row execute function set_updated_at();

drop trigger if exists lib_settings_set_updated_at on lib_settings;
create trigger lib_settings_set_updated_at
  before update on lib_settings
  for each row execute function set_updated_at();

-- ── ⑦ 보안규칙(RLS) ─────────────────────────────────────────────────────────
-- 도서관 표는 회사 계정(도서관 가계정 포함) 모두에게 열어둡니다. 운영앱의 다른 표들과 달리
-- 직위별로 나누지 않는 이유는, 도서관 데이터에는 민감한 개인정보가 없고(이름·반·빌린 책)
-- 담당 교직원이 누구든 대출 처리를 할 수 있어야 하기 때문입니다.
alter table lib_books enable row level security;
alter table lib_loans enable row level security;
alter table lib_visits enable row level security;
alter table lib_settings enable row level security;

drop policy if exists "lib_all_books" on lib_books;
create policy "lib_all_books" on lib_books
  for all using (is_lib_user()) with check (is_lib_user());

drop policy if exists "lib_all_loans" on lib_loans;
create policy "lib_all_loans" on lib_loans
  for all using (is_lib_user()) with check (is_lib_user());

drop policy if exists "lib_all_visits" on lib_visits;
create policy "lib_all_visits" on lib_visits
  for all using (is_lib_user()) with check (is_lib_user());

drop policy if exists "lib_all_settings" on lib_settings;
create policy "lib_all_settings" on lib_settings
  for all using (is_lib_user()) with check (is_lib_user());

-- ── ⑧ 도서관용 학생 명부 뷰 ─────────────────────────────────────────────────
-- 도서카드 바코드로 학생을 찾으려면 student_no가 필요한데, 교직원 공용 명부
-- (wr_students_basic)에는 개인정보 보호를 위해 student_no가 빠져 있습니다. 도서관에 꼭
-- 필요한 항목(고유번호·이름·학년·반)만 담은 별도 뷰를 만듭니다. 보호자 연락처·주소·생년월일·
-- 알러지 등은 일부러 뺐습니다.
-- 뷰는 원본 표의 보안규칙을 우회하므로, 뷰 자체에서 회사 계정인지 한 번 확인합니다.
drop view if exists lib_students;
create view lib_students as
select
  s.id,
  s.student_no,
  s.name,
  s.name_en,
  s.grade,
  s.class_name,
  s.department,
  s.status
from wr_students s
where is_lib_user();

revoke all on lib_students from anon;
grant select on lib_students to authenticated;

-- ── ⑨ 실시간 반영 ───────────────────────────────────────────────────────────
-- 실시간 구독 등록(alter publication)은 Supabase에서 소유자 권한이 필요합니다. 대시보드
-- SQL Editor에서는 되지만, GitHub Actions가 쓰는 연결에서는 "must be owner of publication"으로
-- 막힐 수 있습니다. 이 한 줄 때문에 마이그레이션 전체가 멈추면 학생 명부까지 못 들어가므로,
-- 실패해도 안내만 남기고 넘어갑니다(그 경우 대시보드 > Database > Replication에서 켜주세요).
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'lib_loans'
  ) then
    alter publication supabase_realtime add table lib_loans;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'lib_visits'
  ) then
    alter publication supabase_realtime add table lib_visits;
  end if;
exception when others then
  raise notice '도서관 표 실시간 구독 등록을 건너뜁니다(대시보드 > Database > Replication에서 켜주세요): %', sqlerrm;
end $$;

-- ── ⑩ 도서관 가계정을 운영앱 계정 목록에 등록 ───────────────────────────────
-- 요청: "실제 구글계정을 등록할 필요 없이 가계정으로 만들어서 운영앱에서 관리할 때 가계정으로
-- 등록해서 나중에 통합관리". 도서관 노트북은 구글 로그인 대신 Supabase Auth의 이메일+비밀번호
-- 계정으로 들어옵니다(구글 계정을 새로 만들 필요가 없습니다). 그 계정을 여기 계정 목록에도
-- 넣어두면 관리자가 운영앱의 계정 관리 화면에서 함께 보고, 승인 취소로 즉시 정지시킬 수
-- 있습니다(도서관 앱이 로그인할 때마다 이 상태를 확인합니다).
--
-- 직위는 '행정직원'으로 넣습니다. 예전에는 '교직원'이라는 모호한 이름을 썼는데 v0.36에서
-- '행정직원'으로 정리되면서 app_users의 허용값 목록에서 빠졌습니다. 도서관 마이그레이션이
-- 다른 갈래에서 만들어지는 동안 옛 이름이 그대로 남아 있어, 실제 반영할 때 아래 오류로
-- 막혔습니다(그리고 뒤 마이그레이션이 전부 멈췄습니다).
--   ERROR: new row for relation "app_users" violates check constraint "app_users_position_check"
insert into app_users (email, status, name, position, decided_at, decided_by)
values ('gia-library@giamicro.com', 'approved', 'GIA 도서관(공용 단말)', '행정직원', now(), 'system')
on conflict (email) do nothing;


-- ════════════════════════════════════════════════════════════════
-- 20260821120000_library_locations_cards.sql
-- ════════════════════════════════════════════════════════════════
-- ===== 100. 도서관 구역(책장 위치) 체계 =====
-- 요청: "장서목록을 검색하고 볼 수 있게 해주고, 그 장서가 어느 구역에 있는지도 잘 찾을 수 있게...
-- 책을 등록하고 나중에 책장에 꽂고나서 그 책장에 구역을 부과하고... 반납하고나서도 아무데나
-- 꽂아 넣는게 아니라 정해진 위치에 다시 넣을 수 있도록" + "나중에 책장구조를 알려줄게 그러면
-- 화면에 책장화면을 간단한 벡터로 넣어주고, 그 구역을 보여줘서 찾아 넣을 수 있게"
--
-- 지금까지 책의 위치는 lib_books.location 이라는 자유 입력 글자 한 칸이었습니다. 사람마다
-- 'A-3', 'a3', 'A3 칸'처럼 다르게 적으면 검색이 안 되고, 배치도를 그릴 수도 없습니다. 구역을
-- 별도 표로 올려서 ① 이름을 한 곳에서 관리하고 ② 책장 평면도의 좌표를 함께 담습니다.

-- ── ① 구역(lib_locations) ───────────────────────────────────────────────────
-- code   - 라벨과 바코드에 찍히는 짧은 이름. 체계는 학교가 정하는 대로 자유롭게 씁니다
--          (A-1 같은 책장-칸 번호도 되고, '그림책' 같은 분류 이름도 됩니다).
-- map_*  - 도서관 평면도에서의 자리(격자 칸 단위). 책장 구조를 받은 뒤에 채우면 되고,
--          비어 있으면 배치도 대신 목록으로만 보여줍니다.
create table if not exists lib_locations (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  name text,
  note text,
  color text not null default '#1d4ed8',
  sort_order integer not null default 0,
  map_x numeric,
  map_y numeric,
  map_w numeric not null default 3,
  map_h numeric not null default 2,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists lib_locations_code_idx on lib_locations(upper(code));
create index if not exists lib_locations_sort_idx on lib_locations(sort_order, code);

-- ── ② 도서관 평면도 설정(lib_map) ───────────────────────────────────────────
-- 격자 칸 수만 정해두면, 구역들을 그 위에 올려놓는 방식으로 배치도를 그립니다.
create table if not exists lib_map (
  id integer primary key default 1 check (id = 1),
  cols integer not null default 24 check (cols between 4 and 200),
  rows integer not null default 14 check (rows between 4 and 200),
  note text,
  updated_at timestamptz not null default now()
);
insert into lib_map (id) values (1) on conflict (id) do nothing;

-- ── ③ 책에 구역 연결 ────────────────────────────────────────────────────────
alter table lib_books add column if not exists location_id uuid
  references lib_locations(id) on delete set null;
create index if not exists lib_books_location_idx on lib_books(location_id);

-- 예전에 자유 입력으로 적어둔 위치가 있으면 구역으로 옮겨 담습니다(처음 설치라면 아무 일도
-- 일어나지 않습니다). lib_books.location 칸은 그대로 두지만 화면에서는 더 이상 쓰지 않습니다.
insert into lib_locations (code)
select distinct trim(location)
from lib_books
where location is not null and trim(location) <> ''
on conflict do nothing;

update lib_books b
set location_id = l.id
from lib_locations l
where b.location_id is null
  and b.location is not null
  and upper(trim(b.location)) = upper(l.code);

-- ── ④ 반납 후 제자리 정리 표시 ──────────────────────────────────────────────
-- 반납받은 책을 책수레에 모아뒀다가 나중에 꽂는 경우가 많아서, "아직 안 꽂은 책"을 구역별로
-- 묶어 보여줄 수 있도록 정리 시각을 남깁니다. 반납함(book drop)에 들어온 책도 같은 목록에
-- 나타납니다.
alter table lib_loans add column if not exists reshelved_at timestamptz;
create index if not exists lib_loans_reshelve_idx on lib_loans(returned_at desc)
  where status = '반납완료' and reshelved_at is null;

-- ── ⑤ 갱신시각 자동 기록 ────────────────────────────────────────────────────
drop trigger if exists lib_locations_set_updated_at on lib_locations;
create trigger lib_locations_set_updated_at
  before update on lib_locations
  for each row execute function set_updated_at();

drop trigger if exists lib_map_set_updated_at on lib_map;
create trigger lib_map_set_updated_at
  before update on lib_map
  for each row execute function set_updated_at();

-- ── ⑥ 보안규칙 ──────────────────────────────────────────────────────────────
alter table lib_locations enable row level security;
alter table lib_map enable row level security;

drop policy if exists "lib_all_locations" on lib_locations;
create policy "lib_all_locations" on lib_locations
  for all using (is_lib_user()) with check (is_lib_user());

drop policy if exists "lib_all_map" on lib_map;
create policy "lib_all_map" on lib_map
  for all using (is_lib_user()) with check (is_lib_user());

-- ── ⑦ 도서카드 꾸미기(배경 그림 · 사진) ─────────────────────────────────────
-- 요청: "도서카드 배경 그림을 보내주면 거기에 학생의 이름과 학생고유바코드를 넣어서 인쇄할 수
-- 있도록... 사진을 넣을 수도 있고, 사진없이 이름만 넣어서 뽑을 수 있도록".
-- 배경 그림은 학교가 직접 올려서 언제든 바꿀 수 있게 만듭니다(그림 파일은 Supabase 저장소에
-- 두고 주소만 여기 적어둡니다).
alter table lib_settings add column if not exists card_bg_url text;
alter table lib_settings add column if not exists card_text_color text not null default '#10203a';
alter table lib_settings add column if not exists card_show_photo boolean not null default false;

-- 도서카드에 넣을 학생 사진. 운영앱의 학생 명부(wr_students)는 건드리지 않고 도서관 쪽에만
-- 보관합니다(도서관 가계정이 학생 개인정보 표를 고칠 수 없기 때문이기도 합니다).
create table if not exists lib_student_photos (
  student_no text primary key,
  url text not null,
  updated_at timestamptz not null default now()
);

alter table lib_student_photos enable row level security;
drop policy if exists "lib_all_student_photos" on lib_student_photos;
create policy "lib_all_student_photos" on lib_student_photos
  for all using (is_lib_user()) with check (is_lib_user());

drop trigger if exists lib_student_photos_set_updated_at on lib_student_photos;
create trigger lib_student_photos_set_updated_at
  before update on lib_student_photos
  for each row execute function set_updated_at();

-- ── ⑧ 그림 파일 저장소(Supabase Storage) ────────────────────────────────────
-- 도서카드 배경과 학생 사진을 담을 'library' 버킷입니다. 인쇄 화면에서 그림을 바로 불러와야
-- 해서 읽기는 공개로 두고, 올리고 지우는 것은 회사 계정만 할 수 있게 합니다.
-- (저장소 권한은 프로젝트 설정에 따라 마이그레이션에서 못 건드릴 수도 있어, 실패해도 전체가
--  멈추지 않도록 감쌌습니다. 그런 경우 Supabase 대시보드에서 버킷만 만들어 주면 됩니다.)
do $$
begin
  insert into storage.buckets (id, name, public)
  values ('library', 'library', true)
  on conflict (id) do nothing;
exception when others then
  raise notice 'library 버킷을 만들지 못했습니다(대시보드에서 직접 만들어 주세요): %', sqlerrm;
end $$;

do $$
begin
  execute $p$drop policy if exists "library_read" on storage.objects$p$;
  execute $p$create policy "library_read" on storage.objects
    for select using (bucket_id = 'library')$p$;

  execute $p$drop policy if exists "library_write" on storage.objects$p$;
  execute $p$create policy "library_write" on storage.objects
    for insert to authenticated with check (bucket_id = 'library' and is_lib_user())$p$;

  execute $p$drop policy if exists "library_update" on storage.objects$p$;
  execute $p$create policy "library_update" on storage.objects
    for update to authenticated using (bucket_id = 'library' and is_lib_user())$p$;

  execute $p$drop policy if exists "library_delete" on storage.objects$p$;
  execute $p$create policy "library_delete" on storage.objects
    for delete to authenticated using (bucket_id = 'library' and is_lib_user())$p$;
exception when others then
  raise notice '저장소 권한 설정을 건너뜁니다(대시보드에서 설정해 주세요): %', sqlerrm;
end $$;


-- ════════════════════════════════════════════════════════════════
-- 20260821200000_demo_account_orientation.sql
-- ════════════════════════════════════════════════════════════════
-- ===== 100. 신입교사 오리엔테이션용 데모 계정 + 더미 데이터 =====
-- 요청: "교사들에게 설명하도록 교사 에게 보여줄수 있는 더미 계정을 하나 만들어주고, 학생데이터도
-- 더미로 넣어줘, 매번 신입선생님들이 오면 설명을 해야 하니 아예 가계정 하나와 더미데이터로
-- 어떻게 써넣으면 될지 알려줄 수 있게 가계정을 등록해줘"
--
-- 지금까지 신입 선생님께 사용법을 보여드리려면 (1) 실제 학생 명단을 띄워놓고 설명하거나
-- (2) 설명하는 사람의 계정으로 시연해야 했습니다. 둘 다 문제가 있습니다. 실제 학생의
-- 관찰기록을 연습 삼아 저장하면 그 기록이 그대로 학부모 리포트로 나가고, 잘못 누른 픽업 체크는
-- 하원 차량 운행에 곧바로 반영됩니다.
--
-- 그래서 "교사 화면은 실제와 완전히 똑같은데 보이는 학생은 전부 가짜"인 계정을 하나 둡니다.
-- 마음껏 눌러보고 저장하고 지워도 실제 기록에는 아무 영향이 없습니다.
--
-- 격리 방식: 표를 새로 만들지 않고 기존 표에 is_demo 칸 하나만 붙였습니다. 표를 따로 만들면
-- 모든 화면 코드를 "지금이 데모인지"에 따라 두 갈래로 나눠야 하고, 그러면 데모에서 잘 되던 게
-- 실제에서는 안 되는 일이 생깁니다. 지금 방식은 화면 코드가 하나 그대로이고, 누가 로그인했느냐에
-- 따라 보안규칙이 알아서 다른 행을 돌려줍니다 - 데모 계정에는 데모 행만, 나머지 모두에게는
-- 실제 행만 보입니다. 서로를 아예 볼 수 없으므로 섞일 수가 없습니다.

-- ── 데모 계정 판별 ───────────────────────────────────────────────────────────
-- 화면 쪽(src/lib/sharedAccounts.ts)의 isDemoAccount()와 같은 규칙입니다. 계정 목록을 DB에
-- 따로 두지 않고 이름 규칙으로 판단해서, 판별할 때마다 표를 조회하는 왕복을 없앴습니다.
create or replace function is_demo_user()
returns boolean
language sql
stable
as $$
  select coalesce(lower(auth.jwt() ->> 'email') like 'gia-demo%@giamicro.com', false);
$$;

-- ── 데모 표시 칸 ─────────────────────────────────────────────────────────────
alter table wr_students add column if not exists is_demo boolean not null default false;
alter table wr_classes  add column if not exists is_demo boolean not null default false;
create index if not exists wr_students_is_demo_idx on wr_students(is_demo);
create index if not exists wr_classes_is_demo_idx on wr_classes(is_demo);

-- 리포트·출결에는 is_demo 칸을 따로 두지 않고 "이 학생이 데모 학생인가"를 되묻습니다. 칸을
-- 하나 더 두면 학생은 데모인데 리포트는 실제로 표시되는 식으로 두 값이 어긋날 수 있습니다.
--
-- security definer로 두는 이유: 보안규칙 안에서 다른 표를 조회하면 그 표의 보안규칙도 함께
-- 걸립니다. wr_students는 행정직원급만 읽을 수 있으므로, 이 함수가 일반 함수라면 교사가 리포트를
-- 읽을 때 조회가 막혀 "리포트가 하나도 없는" 화면이 됩니다. definer로 두면 함수 안에서는 소유자
-- 권한으로 조회하되, 돌려주는 값은 참/거짓 한 개뿐이라 개인정보가 새지 않습니다.
create or replace function wr_student_is_demo(p_student_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select coalesce((select is_demo from wr_students where id = p_student_id), false);
$$;

-- ── 보안규칙: 데모 계정과 실제 계정이 서로를 못 보게 ──────────────────────────
-- 공용 명부(뷰)는 원본 표의 보안규칙을 우회하므로 뷰 자체의 where 절이 유일한 방어선입니다.
-- is_demo = is_demo_user() 한 줄이 양방향을 동시에 처리합니다: 데모 계정(참)에게는 데모 행만,
-- 나머지 계정(거짓)에게는 실제 행만 보입니다.
drop view if exists wr_students_basic;
create view wr_students_basic as
select
  s.id,
  s.name,
  s.name_en,
  s.grade,
  s.class_name,
  s.class_id,
  s.department,
  s.status,
  s.birth_date,
  s.gender,
  s.afterschool,
  s.instrument,
  s.shuttle_mode,
  s.allergies,
  s.note,
  s.family_id,
  s.created_at
from wr_students s
where is_giamicro_user()
  and s.is_demo = is_demo_user();

revoke all on wr_students_basic from anon;
grant select on wr_students_basic to authenticated;

-- 원본 학생 표(행정직원·관리자·개발자 전용)에서는 데모 학생을 아예 감춥니다 - 학생 명부 관리
-- 화면에 가짜 학생이 섞여 나오면 실제 명단을 헷갈리게 만듭니다. 데모 학생은 이 마이그레이션이
-- 유일한 관리 창구입니다(바꿀 일이 생기면 여기서 고쳐 다시 배포합니다).
drop policy if exists "wr_manager_all_wr_students" on wr_students;
create policy "wr_manager_all_wr_students" on wr_students
  for all using (is_wr_manager() and is_demo = false)
  with check (is_wr_manager() and is_demo = false);

drop policy if exists "giamicro_select_wr_classes" on wr_classes;
create policy "giamicro_select_wr_classes" on wr_classes
  for select using (is_giamicro_user() and is_demo = is_demo_user());

drop policy if exists "wr_manager_write_wr_classes" on wr_classes;
create policy "wr_manager_write_wr_classes" on wr_classes
  for all using (is_wr_manager() and is_demo = false)
  with check (is_wr_manager() and is_demo = false);

-- 관찰기록: 데모 계정이 연습으로 저장한 기록은 실제 화면 어디에도 나타나지 않고, 반대로 실제
-- 학생 기록은 데모 계정에서 절대 열리지 않습니다.
drop policy if exists "giamicro_select_wr_reports" on wr_reports;
create policy "giamicro_select_wr_reports" on wr_reports
  for select using (is_giamicro_user() and wr_student_is_demo(student_id) = is_demo_user());

drop policy if exists "giamicro_insert_wr_reports" on wr_reports;
create policy "giamicro_insert_wr_reports" on wr_reports
  for insert with check (is_giamicro_user() and wr_student_is_demo(student_id) = is_demo_user());

drop policy if exists "giamicro_update_wr_reports" on wr_reports;
create policy "giamicro_update_wr_reports" on wr_reports
  for update using (is_giamicro_user() and wr_student_is_demo(student_id) = is_demo_user())
  with check (is_giamicro_user() and wr_student_is_demo(student_id) = is_demo_user());

drop policy if exists "giamicro_all_attendance_records" on attendance_records;
create policy "giamicro_all_attendance_records" on attendance_records
  for all using (is_giamicro_user() and wr_student_is_demo(student_id) = is_demo_user())
  with check (is_giamicro_user() and wr_student_is_demo(student_id) = is_demo_user());

-- ── 데모 셔틀 노선 ───────────────────────────────────────────────────────────
-- 픽업 체크 화면을 실제처럼 보여주려면 학생이 하원 차량에 배정되어 있어야 합니다. 셔틀 표들은
-- 이미 term(정규학기 / 여름캠프2)으로 나뉘어 있고 모든 화면이 term으로 걸러 조회하므로, '데모'
-- term을 하나 더 두면 실제 운행 화면에는 전혀 나타나지 않습니다.
alter table shuttle_routes drop constraint if exists shuttle_routes_term_check;
alter table shuttle_routes add constraint shuttle_routes_term_check
  check (term in ('정규학기', '여름캠프2', '데모'));

-- 화면마다 term 조건을 붙이는 것만으로는 부족합니다. 노선 관리·지역 현황처럼 term을 따지지 않고
-- 전체를 훑는 화면이 여럿 있어서, 그런 곳에 가짜 "9호"가 섞여 나오면 실제 운행표를 헷갈리게
-- 만듭니다. 반대로 데모 계정이 실제 정류장 주소를 읽을 수 있는 것도 바람직하지 않습니다.
-- 그래서 학생 명부와 같은 방식으로 보안규칙 단계에서 양방향으로 갈라둡니다.
--
-- 아래 두 함수를 security definer로 두는 이유는 wr_student_is_demo와 같습니다 - 보안규칙 안에서
-- 다른 표를 조회하면 그 표의 규칙이 또 걸려 서로 물고 물리는 상황이 생기기 때문입니다.
create or replace function shuttle_route_is_demo(p_route_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select coalesce((select term = '데모' from shuttle_routes where id = p_route_id), false);
$$;

create or replace function shuttle_stop_is_demo(p_stop_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select coalesce((select shuttle_route_is_demo(route_id) from shuttle_stops where id = p_stop_id), false);
$$;

create or replace function shuttle_assignment_is_demo(p_assignment_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select coalesce((select shuttle_stop_is_demo(stop_id) from shuttle_assignments where id = p_assignment_id), false);
$$;

drop policy if exists "giamicro_select_shuttle_routes" on shuttle_routes;
create policy "giamicro_select_shuttle_routes" on shuttle_routes
  for select using (is_giamicro_user() and (term = '데모') = is_demo_user());
drop policy if exists "wr_manager_write_shuttle_routes" on shuttle_routes;
create policy "wr_manager_write_shuttle_routes" on shuttle_routes
  for all using (is_wr_manager() and term <> '데모') with check (is_wr_manager() and term <> '데모');

drop policy if exists "giamicro_select_shuttle_stops" on shuttle_stops;
create policy "giamicro_select_shuttle_stops" on shuttle_stops
  for select using (is_giamicro_user() and shuttle_route_is_demo(route_id) = is_demo_user());

drop policy if exists "giamicro_select_shuttle_assignments" on shuttle_assignments;
drop policy if exists "wr_manager_write_shuttle_assignments" on shuttle_assignments;
create policy "wr_manager_write_shuttle_assignments" on shuttle_assignments
  for all using (is_wr_manager() and shuttle_stop_is_demo(stop_id) = false)
  with check (is_wr_manager() and shuttle_stop_is_demo(stop_id) = false);

-- 탑승 체크(픽업/결석)는 데모 계정이 직접 저장하는 유일한 셔틀 데이터입니다. 실제 하원 운행에
-- 절대 섞이지 않도록 여기가 마지막 방어선입니다.
drop policy if exists "giamicro_all_shuttle_boardings" on shuttle_boardings;
create policy "giamicro_all_shuttle_boardings" on shuttle_boardings
  for all using (is_giamicro_user() and shuttle_assignment_is_demo(assignment_id) = is_demo_user())
  with check (is_giamicro_user() and shuttle_assignment_is_demo(assignment_id) = is_demo_user());

-- 공용 배정표(뷰)도 같은 기준으로 - 뷰는 원본 표의 보안규칙을 우회하므로 따로 걸러야 합니다.
drop view if exists shuttle_assignments_basic;
create view shuttle_assignments_basic as
select
  a.id,
  a.stop_id,
  a.student_id,
  a.student_name_raw,
  a.class_raw,
  a.weekdays,
  a.note,
  a.override_route_id,
  a.created_at
from shuttle_assignments a
where is_giamicro_user()
  and shuttle_stop_is_demo(a.stop_id) = is_demo_user();

revoke all on shuttle_assignments_basic from anon;
grant select on shuttle_assignments_basic to authenticated;

-- ── 데모 데이터 ──────────────────────────────────────────────────────────────
-- 고정 UUID를 씁니다. 나중에 이 마이그레이션을 고쳐 다시 돌려도 같은 행을 갱신하게 되어
-- 데모 학생이 두 벌 세 벌로 늘어나지 않습니다.

-- 계정 정보. 실제 로그인 비밀번호는 여기서 만들 수 없고(마이그레이션 파일에 비밀번호를 적어두는
-- 것은 위험합니다), 관리자가 [관리자 > 공용 계정 관리] 화면에서 직접 정합니다. 이 행은 그
-- 계정이 로그인했을 때 "승인된 초등부 교사"로 취급되도록 미리 깔아두는 것입니다.
insert into app_users (email, name, department, position, status, decided_by, decided_at)
values ('gia-demo@giamicro.com', '오리엔테이션 데모', '초등부', '교사', 'approved', 'system', now())
on conflict (email) do update
  set name = excluded.name,
      department = excluded.department,
      position = excluded.position,
      status = excluded.status;

-- 데모 담임반. teacher_email이 데모 계정이라 로그인하면 [내 담임반]에 바로 이 반이 뜹니다.
insert into wr_classes (id, grade, class_name, teacher_email, department, is_demo)
values ('d0000000-0000-4000-a000-000000000001', '3', 'Demo', 'gia-demo@giamicro.com', '초등부', true)
on conflict (id) do update
  set grade = excluded.grade,
      class_name = excluded.class_name,
      teacher_email = excluded.teacher_email,
      department = excluded.department,
      is_demo = true;

-- 데모 학생 8명. 설명할 거리가 나오도록 상황을 일부러 섞었습니다 - 알러지가 있는 학생, 악기
-- 수업을 듣는 학생, 방과후 수업이 있는 학생, 형제자매가 함께 다니는 경우(family_id가 같은 두
-- 명), 셔틀을 타지 않는 학생까지 한 반 안에 들어 있습니다.
insert into wr_students (id, name, name_en, grade, class_name, class_id, department, status, birth_date, gender, afterschool, instrument, shuttle_mode, allergies, note, family_id, is_demo)
values
  ('d0000000-0000-4000-b000-000000000001', '김서준', 'Seojun Kim',   '3', 'Demo', 'd0000000-0000-4000-a000-000000000001', '초등부', 'active', '2017-03-14', '남', true,  '바이올린',  '등하원', null,        '수업 중 질문이 많고 발표를 좋아합니다.', 'd0000000-0000-4000-c000-000000000001', true),
  ('d0000000-0000-4000-b000-000000000002', '이하윤', 'Hayun Lee',    '3', 'Demo', 'd0000000-0000-4000-a000-000000000001', '초등부', 'active', '2017-06-02', '여', false, '첼로',      '등하원', '땅콩',      '조용하지만 글쓰기를 잘합니다.', null, true),
  ('d0000000-0000-4000-b000-000000000003', '박도윤', 'Doyun Park',   '3', 'Demo', 'd0000000-0000-4000-a000-000000000001', '초등부', 'active', '2017-01-28', '남', true,  null,        '등하원', null,        null, null, true),
  ('d0000000-0000-4000-b000-000000000004', '최지우', 'Jiwoo Choi',   '3', 'Demo', 'd0000000-0000-4000-a000-000000000001', '초등부', 'active', '2017-09-19', '여', false, '플룻',      '등하원', null,        '친구들을 잘 챙깁니다.', null, true),
  ('d0000000-0000-4000-b000-000000000005', '정시우', 'Siwoo Jung',   '3', 'Demo', 'd0000000-0000-4000-a000-000000000001', '초등부', 'active', '2017-11-05', '남', false, null,        '없음', '우유',      '하원은 보호자가 직접 데리러 옵니다.', null, true),
  ('d0000000-0000-4000-b000-000000000006', '강유나', 'Yuna Kang',    '3', 'Demo', 'd0000000-0000-4000-a000-000000000001', '초등부', 'active', '2017-04-22', '여', true,  '우쿨렐레',  '등하원', null,        null, 'd0000000-0000-4000-c000-000000000002', true),
  ('d0000000-0000-4000-b000-000000000007', '윤예준', 'Yejun Yoon',   '3', 'Demo', 'd0000000-0000-4000-a000-000000000001', '초등부', 'active', '2017-07-30', '남', false, '클라리넷',  '등하원', null,        '동생과 함께 등하원합니다.', 'd0000000-0000-4000-c000-000000000002', true),
  ('d0000000-0000-4000-b000-000000000008', '임소율', 'Soyul Lim',    '3', 'Demo', 'd0000000-0000-4000-a000-000000000001', '초등부', 'active', '2017-12-11', '여', false, null,        '없음', null,        null, null, true)
on conflict (id) do update
  set name = excluded.name,
      name_en = excluded.name_en,
      grade = excluded.grade,
      class_name = excluded.class_name,
      class_id = excluded.class_id,
      department = excluded.department,
      status = excluded.status,
      birth_date = excluded.birth_date,
      gender = excluded.gender,
      afterschool = excluded.afterschool,
      instrument = excluded.instrument,
      shuttle_mode = excluded.shuttle_mode,
      allergies = excluded.allergies,
      note = excluded.note,
      family_id = excluded.family_id,
      is_demo = true;

-- 데모 하원 노선 1개 + 정류장 1개. 픽업 체크 화면에서 "9호"로 표시됩니다.
insert into shuttle_routes (id, direction, route_no, name, driver_name, vehicle_no, teacher_name, depart_time, term, active, sort_order)
values ('d0000000-0000-4000-d000-000000000001', '하원', '9', '데모 노선', '홍기사', '서울 00가 0000', '데모 동승', '16:00', '데모', true, 999)
on conflict (id) do update
  set direction = excluded.direction,
      route_no = excluded.route_no,
      name = excluded.name,
      term = '데모',
      active = true;

insert into shuttle_stops (id, route_id, seq, stop_time, address, note)
values ('d0000000-0000-4000-e000-000000000001', 'd0000000-0000-4000-d000-000000000001', 1, '16:20', '데모 정류장 (Demo stop)', '연습용입니다.')
on conflict (id) do update
  set route_id = excluded.route_id,
      seq = excluded.seq,
      stop_time = excluded.stop_time,
      address = excluded.address;

-- 8명 중 6명만 셔틀에 배정합니다. 나머지 2명(정시우·임소율)은 픽업 체크 화면에서 "셔틀 미탑승"
-- 회색 카드로 나타나서, 그 상태가 어떻게 보이는지도 함께 설명할 수 있습니다.
insert into shuttle_assignments (id, stop_id, student_id, student_name_raw, class_raw, weekdays)
values
  ('d0000000-0000-4000-f000-000000000001', 'd0000000-0000-4000-e000-000000000001', 'd0000000-0000-4000-b000-000000000001', '김서준', '3 Demo', '{1,2,3,4,5}'),
  ('d0000000-0000-4000-f000-000000000002', 'd0000000-0000-4000-e000-000000000001', 'd0000000-0000-4000-b000-000000000002', '이하윤', '3 Demo', '{1,2,3,4,5}'),
  ('d0000000-0000-4000-f000-000000000003', 'd0000000-0000-4000-e000-000000000001', 'd0000000-0000-4000-b000-000000000003', '박도윤', '3 Demo', '{1,2,3,4,5}'),
  ('d0000000-0000-4000-f000-000000000004', 'd0000000-0000-4000-e000-000000000001', 'd0000000-0000-4000-b000-000000000004', '최지우', '3 Demo', '{1,2,3,4,5}'),
  ('d0000000-0000-4000-f000-000000000005', 'd0000000-0000-4000-e000-000000000001', 'd0000000-0000-4000-b000-000000000006', '강유나', '3 Demo', '{1,2,3,4,5}'),
  ('d0000000-0000-4000-f000-000000000006', 'd0000000-0000-4000-e000-000000000001', 'd0000000-0000-4000-b000-000000000007', '윤예준', '3 Demo', '{1,2,3,4,5}')
on conflict (id) do update
  set stop_id = excluded.stop_id,
      student_id = excluded.student_id,
      student_name_raw = excluded.student_name_raw,
      class_raw = excluded.class_raw,
      weekdays = excluded.weekdays;

-- 이미 작성된 관찰기록 예시 두 건. 신입 선생님이 빈 화면부터 시작하면 "무엇을 어느 정도로
-- 적어야 하는지" 감이 오지 않습니다. 발행된 기록 하나와 임시저장 하나를 미리 넣어두어, 완성된
-- 예시를 열어보고 그 수준에 맞춰 연습할 수 있게 합니다.
insert into wr_reports (id, student_id, subject, academic, improvement, participation, behavior, social, teacher_note, eval_badges, status, report_date)
values
  ('d0000000-0000-4000-9000-000000000001', 'd0000000-0000-4000-b000-000000000001', '담임',
   '곱셈 단원에서 두 자리 수 계산까지 정확하게 해결합니다. 특히 문장제 문제를 그림으로 바꿔 푸는 방법을 스스로 찾아냈습니다.',
   '풀이 과정을 생략하고 답만 적는 경우가 있어, 과정을 남기도록 지도하고 있습니다.',
   '발표를 자원하는 횟수가 지난주보다 늘었고, 친구의 답에도 이유를 물으며 반응합니다.',
   '준비물을 스스로 챙기고 정리 시간에 끝까지 남아 돕습니다.',
   '모둠 활동에서 의견이 갈릴 때 먼저 양보하고 대안을 제안합니다.',
   '이번 주 서준이는 수학에서 자신감이 눈에 띄게 붙었습니다. 답을 맞히는 것보다 과정을 설명하는 데 재미를 붙이고 있어, 집에서도 "왜 그렇게 풀었어?"라고 한 번 물어봐 주시면 큰 도움이 됩니다.',
   '{"academic":["excellent"],"improvement":["good"],"participation":["excellent"],"behavior":["good"],"social":["good"]}',
   'published', current_date),
  ('d0000000-0000-4000-9000-000000000002', 'd0000000-0000-4000-b000-000000000002', '담임',
   '읽기 이해력이 좋아 글의 흐름을 잘 요약합니다.',
   '', '', '', '', '',
   '{"academic":["good"],"improvement":["good"],"participation":["good"],"behavior":["good"],"social":["good"]}',
   'draft', current_date)
on conflict (id) do update
  set academic = excluded.academic,
      improvement = excluded.improvement,
      participation = excluded.participation,
      behavior = excluded.behavior,
      social = excluded.social,
      teacher_note = excluded.teacher_note,
      eval_badges = excluded.eval_badges,
      status = excluded.status,
      report_date = excluded.report_date;


-- ════════════════════════════════════════════════════════════════
-- 20260821230000_ops_board_short_code.sql
-- ════════════════════════════════════════════════════════════════
-- ===== 101. 운영 대시보드 짧은 주소 =====
-- 요청: "운영안내 대시보드 주소 간결하게 만들어주고,(다른곳에서 바로 주소만쳐서 들어갈 수 있게"
--
-- 지금 대시보드 주소는 /ops-board/3f2a9c1e-... 처럼 36자리 토큰이 붙어 있어서, 사무실 모니터나
-- 다른 컴퓨터에서 주소창에 직접 치는 것이 사실상 불가능합니다. 안내보드에 이미 같은 문제로
-- 짧은 주소(/b/{코드})를 만들어 뒀으므로, 같은 방식으로 /d/{코드}를 둡니다(d = dashboard).
--
-- 토큰을 짧게 바꾸는 것이 아니라 짧은 코드를 하나 더 두는 방식인 이유는, 토큰 자체를 짧게 하면
-- 아무나 몇 번 찍어보는 것만으로 대시보드를 열 수 있게 되기 때문입니다. 짧은 코드는 "우리
-- 직원이 주소창에 치기 위한 지름길"일 뿐이고, 이 화면에는 학생 개인정보(연락처·주소)가 없으며
-- 사용을 멈추려면 [중지] 한 번으로 즉시 막힙니다.

alter table ops_board_links add column if not exists short_code text;
-- null인 행끼리는 서로 겹쳐도 되므로 부분 유니크 인덱스를 씁니다.
create unique index if not exists ops_board_links_short_code_idx
  on ops_board_links(short_code) where short_code is not null;

-- 이미 만들어 둔 링크에도 코드를 하나씩 채워줍니다. 관리자가 화면에서 원하는 값으로 바꿀 수
-- 있으니 여기서는 겹치지 않는 아무 값이면 충분합니다.
--
-- 글자 후보에서 0·o·1·i·l을 뺐습니다. 이 코드는 눈으로 보고 손으로 옮겨 치는 용도라, 가장 흔한
-- 실수가 0과 O를 헷갈리는 것입니다.
do $do$
declare
  r record;
  candidate text;
  chars text := '23456789abcdefghjkmnpqrstuvwxyz';
  i int;
begin
  for r in select id from ops_board_links where short_code is null loop
    -- 겹치면 다시 뽑습니다. 4자리(약 92만 가지)라 실제로 겹칠 일은 거의 없습니다.
    for i in 1..20 loop
      candidate := '';
      candidate := candidate || substr(chars, 1 + floor(random() * length(chars))::int, 1);
      candidate := candidate || substr(chars, 1 + floor(random() * length(chars))::int, 1);
      candidate := candidate || substr(chars, 1 + floor(random() * length(chars))::int, 1);
      candidate := candidate || substr(chars, 1 + floor(random() * length(chars))::int, 1);
      exit when not exists (select 1 from ops_board_links where short_code = candidate);
    end loop;
    update ops_board_links set short_code = candidate where id = r.id;
  end loop;
end
$do$;


-- ════════════════════════════════════════════════════════════════
-- 20260822000000_ops_board_dismissal_end.sql
-- ════════════════════════════════════════════════════════════════
-- ===== 102. 운영 대시보드 하원 종료 시각 =====
-- 요청: "지금 cctv프로그램하고 화면을 분할해서 반반 쓰고 있는데 하원시간에는 전체화면으로
-- 전환되고 하원종료버튼을 누르거나 종료시간이 되면 다시 화면 되돌리게 만들어줘"
--
-- 지금까지는 전환 시각(기본 16:00)만 있고 "언제 끝나는지"가 없어서, 한 번 하원 화면으로 바뀌면
-- 자정까지 그대로 남아 있었습니다. 종료 시각을 두면 하원이 끝난 뒤 자동으로 평소 대시보드로
-- 돌아오고, 전체화면도 함께 풀려 CCTV 반반 화면이 원래대로 복구됩니다.
--
-- 기본값 17:30 - 16:00에 출발해 노선을 다 돌고 마지막 차가 복귀하기까지 걸리는 시간을 기준으로
-- 잡았습니다. 실제 운행에 맞지 않으면 관리 화면에서 바꾸면 됩니다.
alter table ops_board_links add column if not exists shuttle_end_hour int not null default 17;
alter table ops_board_links add column if not exists shuttle_end_minute int not null default 30;

alter table ops_board_links drop constraint if exists ops_board_links_shuttle_end_hour_check;
alter table ops_board_links add constraint ops_board_links_shuttle_end_hour_check
  check (shuttle_end_hour between 0 and 23);
alter table ops_board_links drop constraint if exists ops_board_links_shuttle_end_minute_check;
alter table ops_board_links add constraint ops_board_links_shuttle_end_minute_check
  check (shuttle_end_minute between 0 and 59);


-- ============================================================================
--  106. 기사님 설정 링크 (20260823120000_driver_setup_link.sql)
-- ============================================================================

-- ===== 106. 기사님 설정 링크 - 문자로 링크 하나 보내면 끝나도록 =====
-- 요청: "어플의 설정을 편하게 웹앱을 통해서 발급받을 수 있는 페이지를 만들어줄 수 있어?
-- 기사님들이 오셔서 기기를 맡기면 오분이내에 설정이 완료되어야 하는데 매번 기사님 핸드폰으로
-- 앱다운받고 거기서 숫자다적고 하기가 힘들어, 웹앱으로 몇호차 기사님께 보내기하면 기사님
-- 카톡이나 문자로 링크가 가서 누르면 웹앱으로 접속되고..."
--
-- 지금까지는 담당자가 기사님 휴대폰을 받아서 서버 주소(60자 넘는 URL)와 기기 ID 8자리를
-- 손으로 쳐 넣어야 했습니다. 남의 휴대폰 자판으로 URL을 치는 건 오타가 나기 쉽고 시간도
-- 오래 걸립니다. 그래서 기기마다 짧은 설정 링크(/s/{코드})를 하나씩 발급해, 그 링크만 열면
-- 값이 이미 채워진 안내 화면이 뜨고 눌러서 복사만 하면 되도록 했습니다.
--
-- setup_code를 device_id와 따로 두는 이유
--   device_id는 위치를 보내는 열쇠라서, 유출되면 남이 가짜 위치를 밀어 넣을 수 있습니다.
--   반면 설정 링크는 문자·카카오톡으로 나가기 때문에 전달 과정에서 남을 가능성이 훨씬 큽니다.
--   두 값을 분리해두면, 링크가 새어 나갔을 때 setup_code만 새로 발급해서 링크를 무효로 만들 수
--   있고 기사님 휴대폰의 설정은 건드리지 않아도 됩니다.

alter table shuttle_tracker_devices add column if not exists setup_code text;
-- 기사님이 링크를 처음 열어본 시각. 담당자가 "보내드렸는데 하셨나?"를 전화로 묻지 않아도
-- 되도록 남깁니다. 기사님 성함·연락처는 이미 shuttle_routes에 있으므로 여기에 또 두지
-- 않습니다(같은 값이 두 군데 있으면 언젠가 서로 달라집니다).
alter table shuttle_tracker_devices add column if not exists setup_opened_at timestamptz;

-- 이미 등록된 기기에도 링크를 하나씩 만들어 줍니다. 헷갈리는 글자(0/O, 1/l/I)는 빼고,
-- 주소창에 직접 칠 수도 있을 만큼 짧은 6자리로 만듭니다.
do $$
declare
  d record;
  candidate text;
  alphabet text := 'abcdefghjkmnpqrstuvwxyz23456789';
begin
  for d in select id from shuttle_tracker_devices where setup_code is null loop
    loop
      candidate := '';
      for i in 1..6 loop
        candidate := candidate || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
      end loop;
      exit when not exists (select 1 from shuttle_tracker_devices where setup_code = candidate);
    end loop;
    update shuttle_tracker_devices set setup_code = candidate where id = d.id;
  end loop;
end $$;

create unique index if not exists shuttle_tracker_devices_setup_code_idx
  on shuttle_tracker_devices(setup_code);
