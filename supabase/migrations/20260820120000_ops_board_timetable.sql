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
