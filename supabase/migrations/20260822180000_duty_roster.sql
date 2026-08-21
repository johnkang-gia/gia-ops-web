-- ===== 104. 당번표 =====
-- 요청: "당번표는 대시보드에 필요없고, 일단은 데이터만 넣을 수 있게 해주고"
--
-- 명부 PDF에 급식 당번(Lunch Duty), 체육관·코딩실 예약, 도서관 일정 같은 "누가 언제 어디를
-- 맡는가" 표가 여러 개 들어 있습니다. 지금은 화면에 띄워 보여줄 필요가 없다고 하셔서, 표를 하나만
-- 두고 종류(kind)로 구분해 담아둡니다. 나중에 대시보드나 달력에 띄우기로 하면 이 표를 그대로
-- 읽어가면 됩니다.
--
-- 종류마다 표를 따로 만들지 않은 이유: 담는 내용이 "언제 / 어디를 / 누가"로 전부 같아서,
-- 표를 나누면 화면도 종류만큼 따로 만들어야 하고 새 당번이 생길 때마다 배포가 필요해집니다.
-- 지금 방식은 종류 이름만 새로 적으면 바로 쓸 수 있습니다.

create table if not exists duty_roster (
  id uuid primary key default gen_random_uuid(),
  -- '급식당번', '체육관 사용', '도서관 당번' 등. 자유 입력이지만 화면에서 기존 값 중에 고르게
  -- 해서 표기가 어긋나지 않게 합니다.
  kind text not null,
  -- 반복형은 weekday(1=월~5=금), 특정일 지정형은 service_date를 씁니다. 둘 다 비어 있으면
  -- "기간 무관"으로 보고 목록 맨 아래에 둡니다.
  weekday int check (weekday is null or weekday between 1 and 7),
  service_date date,
  -- '1층', '점심 1부', '코딩실' 처럼 같은 종류 안에서 자리를 나누는 값입니다.
  slot text,
  -- 담당자는 이름만으로도 넣을 수 있습니다. 아직 앱에 가입하지 않은 선생님도 많고, 당번은
  -- 계정과 상관없이 종이로도 돌기 때문입니다. 계정이 있으면 staff_email까지 채워둡니다.
  staff_name text not null,
  staff_email text,
  note text,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists duty_roster_kind_idx on duty_roster(kind, weekday, service_date);

drop trigger if exists duty_roster_set_updated_at on duty_roster;
create trigger duty_roster_set_updated_at
  before update on duty_roster
  for each row execute function set_updated_at();

alter table duty_roster enable row level security;

-- 조회는 교직원 누구나(당번은 모두가 봐야 하는 정보입니다), 편집은 행정직원·관리자·개발자만.
drop policy if exists "giamicro_select_duty_roster" on duty_roster;
create policy "giamicro_select_duty_roster" on duty_roster
  for select using (is_giamicro_user());
drop policy if exists "wr_manager_write_duty_roster" on duty_roster;
create policy "wr_manager_write_duty_roster" on duty_roster
  for all using (is_wr_manager()) with check (is_wr_manager());
