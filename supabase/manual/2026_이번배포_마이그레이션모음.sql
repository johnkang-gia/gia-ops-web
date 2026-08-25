-- ============================================================================
-- 이번 배포 마이그레이션 모음 (한 번에 적용용)
-- Supabase SQL 편집기에 붙여넣고 실행하세요. 모두 idempotent라 다시 실행해도 안전합니다.
-- GitHub Actions 자동 적용이 켜져 있으면 이미 반영됐을 수 있으나, 직접 실행해도 문제 없습니다.
-- 포함: 교사 대시보드 데모격리 / 정류장 도착 / 강경원 테스트 기기 / 기기 신호 진단
-- ============================================================================
begin;

-- ===== 20260824240000_myclass_dashboard_demo.sql =====
-- ===== 109. 교사 자기반 대시보드 - 데모 격리용 is_demo + 데모 문의 =====
--
-- 요청: "교사 권한으로 로그인했을때 (...) 자기반 아이들 어머님께서 문의하신 사항을 띄울 수 있게
-- 만들어주고, 픽업의 경우 시간을 명시한경우 담임선생님께 누가 몇시에 픽업인지 알려줄 수 있는
-- 자기반 대시보드를 (...) 더미에서 볼 수 있도록 더미계정도 만들어줘".
--
-- 교사 대시보드는 pickup_requests(학부모 문의·픽업)를 담임 이메일(homeroom_email)로 걸러 보여줍니다.
-- 신입교사 오리엔테이션용 데모 계정(gia-demo…)에서도 이 화면이 "실제처럼" 보여야 하는데, 데모
-- 문의가 실제 행정실 문의 목록·운영 대시보드에 섞이면 안 됩니다. 그래서 학생·반과 같은 방식으로
-- is_demo 칸을 하나 붙여, 데모 문의는 데모 계정에만 보이고 실제 화면에는 전혀 나타나지 않게 합니다.

alter table pickup_requests add column if not exists is_demo boolean not null default false;
create index if not exists pickup_requests_is_demo_idx on pickup_requests(is_demo);

-- ── 데모 학부모 문의·픽업 ────────────────────────────────────────────────────
-- 데모 담임반(3 Demo, gia-demo@giamicro.com)의 학생들에 대한 예시입니다. 고정 UUID라 다시
-- 실행해도 늘어나지 않습니다. service_date는 "오늘"로 두어 픽업이 오늘 것으로 보이게 합니다.
insert into pickup_requests
  (id, service_date, source, source_ref, channel_label, sender_name, received_at,
   raw_text, ai_is_pickup, ai_student_name, ai_pickup_time, ai_confidence, ai_note,
   student_id, matched_name, status, kind, inquiry_type, summary, urgency, homeroom_email, is_demo)
values
  -- 시간이 명시된 픽업 두 건(대시보드 "오늘 픽업"에 시각과 함께 뜹니다)
  ('d0000000-0000-4000-a100-000000000001', current_date, '토들', 'demo-pickup-1',
   'G3_Seojun Kim_Office', '김서준 어머니', now(),
   '오늘 김서준 3시 40분에 제가 직접 데리러 갈게요. 셔틀 안 태워주셔도 됩니다.',
   true, '김서준', '15:40', 0.95, '시간 명시된 픽업',
   'd0000000-0000-4000-b000-000000000001', '김서준', '확정', '픽업', '차량·하원',
   '오늘 15:40 보호자 직접 픽업(셔틀 미탑승)', '보통', 'gia-demo@giamicro.com', true),
  ('d0000000-0000-4000-a100-000000000002', current_date, '토들', 'demo-pickup-2',
   'G3_Jiwoo Choi_Office', '최지우 어머니', now(),
   '지우 오늘 4시 10분에 데리러 갑니다. 병원 예약이 있어서요.',
   true, '최지우', '16:10', 0.92, '시간 명시된 픽업',
   'd0000000-0000-4000-b000-000000000004', '최지우', '확정', '픽업', '차량·하원',
   '오늘 16:10 보호자 직접 픽업(병원)', '보통', 'gia-demo@giamicro.com', true),
  -- 일반 문의 세 건(대시보드 "우리 반 문의"에 뜹니다)
  ('d0000000-0000-4000-a100-000000000003', current_date, '토들', 'demo-inq-1',
   'G3_Hayun Lee_Office', '이하윤 어머니', now() - interval '40 minutes',
   '하윤이가 어제 배운 받아쓰기를 어려워하는데 집에서 어떻게 도와주면 좋을까요?',
   false, null, null, null, '학습 관련 문의',
   'd0000000-0000-4000-b000-000000000002', '이하윤', '확인대기', '문의', '수업·학습',
   '받아쓰기 가정학습 방법 문의', '낮음', 'gia-demo@giamicro.com', true),
  ('d0000000-0000-4000-a100-000000000004', current_date, '토들', 'demo-inq-2',
   'G3_Doyun Park_Office', '박도윤 어머니', now() - interval '2 hours',
   '도윤이가 아침부터 살짝 열이 있어요. 혹시 열이 오르면 바로 연락 부탁드립니다.',
   false, null, null, null, '건강 관련 문의',
   'd0000000-0000-4000-b000-000000000003', '박도윤', '확인대기', '문의', '건강·안전',
   '미열 있음 - 상태 악화 시 연락 요청', '높음', 'gia-demo@giamicro.com', true),
  ('d0000000-0000-4000-a100-000000000005', current_date, '토들', 'demo-inq-3',
   'G3_Yuna Kang_Office', '강유나 어머니', now() - interval '1 day',
   '유나가 요즘 쉬는 시간에 혼자 있는다고 해서 걱정입니다. 반 친구들과 잘 지내는지 궁금해요.',
   false, null, null, null, '교우관계 문의',
   'd0000000-0000-4000-b000-000000000006', '강유나', '확인대기', '문의', '생활·교우',
   '교우관계 - 쉬는 시간 어울림 확인 요청', '보통', 'gia-demo@giamicro.com', true)
on conflict (id) do update
  set service_date = excluded.service_date,
      received_at = excluded.received_at,
      raw_text = excluded.raw_text,
      ai_pickup_time = excluded.ai_pickup_time,
      summary = excluded.summary,
      inquiry_type = excluded.inquiry_type,
      urgency = excluded.urgency,
      kind = excluded.kind,
      homeroom_email = excluded.homeroom_email,
      is_demo = true;

-- ===== 20260824250000_shuttle_stop_arrivals.sql =====
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

-- ===== 20260824260000_tracker_test_device.sql =====
-- ===== 111. GPS 기기 24시간 테스트(강경원 본인 휴대폰) =====
--
-- 요청: "기사님께 드리기전에 내 핸드폰으로 등록 테스트해보고싶어 (...) 24시간 추적한다고 하고
-- 실시간으로 체크가 되는지 (...) 강경원 이름으로 테스트 링크를 하나 만들어줘 (...) 히스토리처럼
-- 남겨줘 나는 다음날 출근해서 잘 되었는지 노선은 정확한지 체크".
--
-- 평소 기기는 하원 시간대(평일 15:30~18:30)에만 위치를 저장합니다. 테스트는 출퇴근 등 아무
-- 때나 켜보셔야 하므로, 이 기기에만 "항상 수집(always_on)"을 켜서 시간대와 무관하게 위치를
-- 기록합니다. 실제 노선이 아니라 term='데모'인 숨김 노선에 물려두어, 정규학기 운영 화면에는
-- 전혀 나타나지 않습니다(전용 테스트 화면과 업무 대시보드의 '테스트 위치'로만 보입니다).

alter table shuttle_tracker_devices add column if not exists always_on boolean not null default false;

-- 숨김 테스트 노선(정규학기 화면에 안 뜨도록 term='데모', active=false).
insert into shuttle_routes (id, direction, route_no, name, term, active, sort_order)
values ('e0000000-0000-4000-a000-000000000001', '하원', 'TEST', '강경원 GPS 테스트', '데모', false, 9998)
on conflict (id) do update
  set name = excluded.name, term = '데모', active = false;

-- 테스트 기기 + 설정 링크(/s/kkwtst). always_on=true 라 24시간 기록됩니다.
insert into shuttle_tracker_devices (id, device_id, setup_code, route_id, label, always_on, enabled)
values ('e0000000-0000-4000-b000-000000000001', 'kkwtest1', 'kkwtst', 'e0000000-0000-4000-a000-000000000001', '강경원 테스트', true, true)
on conflict (id) do update
  set device_id = excluded.device_id, setup_code = excluded.setup_code, label = excluded.label,
      always_on = true, enabled = true;

-- ===== 20260824270000_track_diagnostics.sql =====
-- ===== 112. 기기 신호 진단(앱 로그를 서버에서 대신 보기) =====
--
-- 요청: "27호차 기사님 (...) 설치 다 했는데 위치 계속 안오는거 같아 (...) 셔틀탭에서도 확인할
-- 수 있도록 (...) 앱에 로그기록있던데 이거 가져오게 못하나?"
--
-- 휴대폰 앱(Traccar Client)의 로그 자체는 그 폰 안에만 있어 서버로 가져올 수 없습니다. 대신
-- 앱이 우리 서버(/api/shuttle/track)로 보내오는 요청을 **받는 쪽에서** 매번 남겨두면, "앱이
-- 신호를 보내고 있는지 / 왜 위치가 저장되지 않는지"를 관리 화면에서 그대로 확인할 수 있습니다.
--
-- 가장 흔한 원인: 하원 시간대(평일 15:30~18:30) 밖에서 테스트하면 앱은 신호를 보내지만 서버가
-- "지금은 저장 안 하는 시간"이라 위치를 버립니다. 이때 last_hit_reason='out_of_window'로 남아
-- "신호는 오는데 시간대가 아니라 저장 안 됨"을 바로 알 수 있습니다.

alter table shuttle_tracker_devices add column if not exists last_hit_at timestamptz;   -- 앱이 마지막으로 요청을 보내온 시각(좌표 유무 무관)
alter table shuttle_tracker_devices add column if not exists last_hit_reason text;       -- 그때 서버 판정: 'stored'|'out_of_window'|'no_coords'

-- ===== 20260825120000_shuttle_persistent_notes.sql =====
-- 하원 체크표 "지속 특이사항" 창구 (요청: 왼쪽에 지속 반영사항을 적으면 오른쪽에 요약으로
-- 계속 뜨고, 셔틀도 자동 수정되며, 삭제하면 원래 셔틀로 복귀). effect_kind:
--   none / skip_days(effect_days 요일 셔틀 제외) / no_shuttle(개별하원 전면 제외)
create table if not exists public.shuttle_persistent_notes (
  id uuid primary key default gen_random_uuid(),
  term text not null default '정규학기',
  student_name text not null,
  student_id uuid null references public.wr_students(id) on delete set null,
  route_no text null,
  content text not null,
  effect_kind text not null default 'none' check (effect_kind in ('none','skip_days','no_shuttle')),
  effect_days int[] not null default '{}',
  active boolean not null default true,
  created_by text null,
  created_at timestamptz not null default now()
);
create index if not exists shuttle_persistent_notes_term_active_idx
  on public.shuttle_persistent_notes (term, active);
alter table public.shuttle_persistent_notes enable row level security;
drop policy if exists shuttle_persistent_notes_select on public.shuttle_persistent_notes;
create policy shuttle_persistent_notes_select on public.shuttle_persistent_notes
  for select using (auth.role() = 'authenticated');
drop policy if exists shuttle_persistent_notes_insert on public.shuttle_persistent_notes;
create policy shuttle_persistent_notes_insert on public.shuttle_persistent_notes
  for insert with check (auth.role() = 'authenticated');
drop policy if exists shuttle_persistent_notes_update on public.shuttle_persistent_notes;
create policy shuttle_persistent_notes_update on public.shuttle_persistent_notes
  for update using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
drop policy if exists shuttle_persistent_notes_delete on public.shuttle_persistent_notes;
create policy shuttle_persistent_notes_delete on public.shuttle_persistent_notes
  for delete using (auth.role() = 'authenticated');

-- ===== 20260825140000_shuttle_route_vehicle_history.sql =====
-- 기사 교대·차량번호 이력 관리(요청: 벤치마킹 채택). 지입차량이라 기사·차량번호·동승선생님이
-- 자주 바뀌는데, 바뀔 때마다 자동으로 스냅샷을 남겨 "언제 누가 어떤 차로 운행했는지"를
-- 추적할 수 있게 합니다. shuttle_routes를 수정하면 트리거가 알아서 한 줄 기록합니다.
create table if not exists public.shuttle_route_vehicle_history (
  id uuid primary key default gen_random_uuid(),
  route_id uuid not null references public.shuttle_routes(id) on delete cascade,
  route_no text,
  driver_name text,
  driver_phone text,
  vehicle_no text,
  teacher_name text,
  teacher_phone text,
  note text,
  changed_at timestamptz not null default now()
);
create index if not exists shuttle_rvh_route_idx on public.shuttle_route_vehicle_history (route_id, changed_at desc);

alter table public.shuttle_route_vehicle_history enable row level security;
drop policy if exists shuttle_rvh_select on public.shuttle_route_vehicle_history;
create policy shuttle_rvh_select on public.shuttle_route_vehicle_history
  for select using (auth.role() = 'authenticated');
-- 기록은 트리거(정의자 권한)로만 생기므로 일반 insert 정책은 두지 않습니다.

-- 변경 감지 트리거: 기사/연락처/차량/동승 중 하나라도 바뀌면 새 스냅샷을 남깁니다.
create or replace function public.log_shuttle_route_vehicle_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (tg_op = 'INSERT')
     or new.driver_name is distinct from old.driver_name
     or new.driver_phone is distinct from old.driver_phone
     or new.vehicle_no is distinct from old.vehicle_no
     or new.teacher_name is distinct from old.teacher_name
     or new.teacher_phone is distinct from old.teacher_phone then
    insert into public.shuttle_route_vehicle_history
      (route_id, route_no, driver_name, driver_phone, vehicle_no, teacher_name, teacher_phone, note)
    values
      (new.id, new.route_no, new.driver_name, new.driver_phone, new.vehicle_no, new.teacher_name, new.teacher_phone,
       case when tg_op = 'INSERT' then '노선 등록' else '기사·차량 변경' end);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_log_shuttle_route_vehicle on public.shuttle_routes;
create trigger trg_log_shuttle_route_vehicle
  after insert or update on public.shuttle_routes
  for each row execute function public.log_shuttle_route_vehicle_change();

-- 현재 노선들의 첫 스냅샷을 남깁니다(이미 이력이 있으면 중복 삽입하지 않음).
insert into public.shuttle_route_vehicle_history
  (route_id, route_no, driver_name, driver_phone, vehicle_no, teacher_name, teacher_phone, note)
select r.id, r.route_no, r.driver_name, r.driver_phone, r.vehicle_no, r.teacher_name, r.teacher_phone, '초기 기록'
from public.shuttle_routes r
where not exists (select 1 from public.shuttle_route_vehicle_history h where h.route_id = r.id);


-- ===== 20260825160000_pickup_sender_feedback.sql =====
-- 픽업 인박스 학습(요청 ⑩: 픽업/픽업아님 정정을 학습해 점점 정확하게). 발신자(어머니/채널)별로
-- "픽업으로 확정한 횟수"와 "픽업 아님으로 넘긴 횟수"를 누적합니다. 이 이력을 ingest 분류의
-- 신뢰도(자동확정 여부)에 반영해, 늘 픽업인 발신자는 더 빨리 자동확정하고, 대개 픽업이
-- 아니었던 발신자는 사람이 한 번 더 확인하도록 유도합니다(오분류를 만들지 않는 안전한 방향).
create table if not exists public.pickup_sender_feedback (
  sender_key text primary key,
  pickup_count integer not null default 0,
  not_pickup_count integer not null default 0,
  updated_at timestamptz not null default now()
);

alter table public.pickup_sender_feedback enable row level security;
drop policy if exists pickup_sender_feedback_select on public.pickup_sender_feedback;
create policy pickup_sender_feedback_select on public.pickup_sender_feedback
  for select using (auth.role() = 'authenticated');

-- 정정 1건을 원자적으로 누적합니다(서비스 롤/로그인 사용자가 호출).
create or replace function public.bump_pickup_feedback(p_sender text, p_is_pickup boolean)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.pickup_sender_feedback (sender_key, pickup_count, not_pickup_count)
  values (p_sender, case when p_is_pickup then 1 else 0 end, case when p_is_pickup then 0 else 1 end)
  on conflict (sender_key) do update set
    pickup_count = public.pickup_sender_feedback.pickup_count + (case when p_is_pickup then 1 else 0 end),
    not_pickup_count = public.pickup_sender_feedback.not_pickup_count + (case when p_is_pickup then 0 else 1 end),
    updated_at = now();
$$;

grant execute on function public.bump_pickup_feedback(text, boolean) to authenticated, service_role;

commit;
