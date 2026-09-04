-- ===== 출석부: 결석 사유와 출처 =====
--
-- 두 가지가 없었습니다.
--
-- ① **사유** — 상급학교 서류와 체류 증빙에서 묻는 것은 "며칠 결석" 이 아니라 대개
--    "무단결석 몇 회" 입니다. 지금은 결석/지각/조퇴/기타 네 가지뿐이고 사유 칸이 없어서,
--    아파서 쉰 아이와 연락 없이 안 온 아이가 같은 줄로 남습니다. 나중에 나누려면 지난
--    기록을 사람이 다시 훑어야 합니다.
--
-- ② **출처** — 이 줄을 누가 만들었는지. 담임이 찍은 것과 토들 연락에서 자동으로 들어온
--    것은 믿는 정도가 다른데, 화면에서 구분이 안 되면 둘 다 똑같이 보입니다.
--    자동으로 들어온 줄을 사람이 확인했는지도 여기서 갈립니다.

alter table public.attendance_records
  -- '질병' · '인정' · '기타' · '무단'
  --   질병 : 아파서 (진단서·학부모 연락)
  --   인정 : 학교가 인정하는 사유 (경조사·학교 행사·법정 감염병 등)
  --   기타 : 위에 안 들어가는데 사유는 있는 경우
  --   무단 : 연락 없이 오지 않음 - 서류에서 실제로 묻는 것이 이 숫자입니다
  add column if not exists reason_type text,

  -- 이 줄이 어디서 왔는가. '담임' · '행정' · '토들' · '구글챗'
  -- 기본값을 '담임' 으로 두는 이유: 지금까지 쌓인 줄은 전부 사람이 화면에서 찍은 것입니다.
  add column if not exists source text not null default '담임',

  -- 자동으로 들어온 줄을 사람이 보고 맞다고 했는가.
  -- 자동 줄은 이 값이 false 인 채로 들어오고, 화면에서 노란 표시로 뜹니다.
  add column if not exists confirmed_by_human boolean not null default true,

  -- 어느 연락에서 왔는가. 틀렸을 때 원문을 다시 읽을 수 있어야 고칠 수 있습니다.
  add column if not exists entry_id uuid references public.attendance_entries(id) on delete set null,

  add column if not exists term_id uuid references public.terms(id) on delete set null;

alter table public.attendance_records
  drop constraint if exists attendance_records_reason_type_ck;
alter table public.attendance_records
  add constraint attendance_records_reason_type_ck
  check (reason_type is null or reason_type in ('질병', '인정', '기타', '무단'));

alter table public.attendance_records
  drop constraint if exists attendance_records_source_ck;
alter table public.attendance_records
  add constraint attendance_records_source_ck
  check (source in ('담임', '행정', '토들', '구글챗'));

comment on column public.attendance_records.reason_type is
  '질병·인정·기타·무단. 서류에서 실제로 묻는 것은 무단 횟수입니다.';
comment on column public.attendance_records.source is
  '담임·행정은 사람이 찍은 것, 토들·구글챗은 연락에서 자동으로 들어온 것입니다.';
comment on column public.attendance_records.confirmed_by_human is
  'false면 자동으로 들어왔고 아직 사람이 확인하지 않았다는 뜻입니다. 화면에서 따로 보여줍니다.';

-- 학생 한 명의 학기 집계를 내는 자리라 이 순서로 자주 읽습니다.
create index if not exists attendance_records_student_date_idx
  on public.attendance_records (student_id, date);

-- 출석은 대부분의 줄이라, 결석·지각만 볼 때 전체를 훑지 않도록 따로 색인합니다.
create index if not exists attendance_records_exception_idx
  on public.attendance_records (date, status)
  where status <> '출석';

-- 확인 안 된 자동 줄. 화면 맨 위에 "확인 필요 n건" 으로 띄웁니다.
create index if not exists attendance_records_unconfirmed_idx
  on public.attendance_records (date)
  where confirmed_by_human = false;
