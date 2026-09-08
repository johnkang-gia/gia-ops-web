-- 매일 커지는 표에 색인을 답니다
--
-- 지금은 137명 · 한 학기라 색인이 없어도 화면이 빠릅니다. 표가 작으면 Postgres 가 통째로
-- 훑어도 순식간이기 때문입니다. 문제는 **그 상태가 조용히 나빠진다**는 점입니다 - GPS 기록과
-- 하원 체크는 하루에 수백 줄씩 쌓이고, 학년이 올라가면 학생 관련 표도 몇 배가 됩니다.
-- 그때 느려지면 원인이 안 보입니다. 화면은 그냥 «좀 느려진» 것으로만 보이니까요.
--
-- 여기 넣은 것은 전부 **화면이 실제로 거는 조건**입니다. 코드에서 `.eq(...)` · `.gte(...)` 로
-- 무엇을 거는지 세어보고 그대로 옮겼습니다. 쓰지도 않는 색인은 넣기만 하는 만큼 저장·수정이
-- 느려지므로 달지 않았습니다. 값이 몇 개뿐인 설정 표(요금제·색상 등)도 그대로 둡니다.

-- ── 매일 쌓이는 것 ─────────────────────────────────────────────────────────
-- 날짜로 자르고 노선으로 좁힙니다. 하원 화면이 여는 순간 거는 조건 그대로입니다.
create index if not exists shuttle_stop_arrivals_day_idx
  on public.shuttle_stop_arrivals (service_date, route_id);
create index if not exists shuttle_checklist_log_day_idx
  on public.shuttle_checklist_log (service_date, created_at desc);
create index if not exists shuttle_ride_alongs_day_idx
  on public.shuttle_ride_alongs (service_date);
create index if not exists shuttle_ride_alongs_student_idx
  on public.shuttle_ride_alongs (student_id);

-- ── 학생 한 명을 펼칠 때 함께 읽는 것 ───────────────────────────────────────
-- 학생 기록 화면은 이 표들을 학생 하나로 한 번에 훑습니다. 색인이 없으면 학생 수가 늘수록
-- 화면 하나에 드는 시간이 학생 수에 비례해 늘어납니다.
create index if not exists student_dismissal_plans_student_idx
  on public.student_dismissal_plans (student_id, weekday);
create index if not exists student_fee_enrollments_student_idx
  on public.student_fee_enrollments (student_id, term_id);
create index if not exists student_fee_discounts_student_idx
  on public.student_fee_discounts (student_id, term_id);
create index if not exists student_group_members_student_idx
  on public.student_group_members (student_id);
create index if not exists student_group_members_group_idx
  on public.student_group_members (group_id);
create index if not exists wr_enrollments_student_idx
  on public.wr_enrollments (student_id, term_id);
create index if not exists wr_enrollments_class_idx
  on public.wr_enrollments (class_id);
create index if not exists pickup_schedules_student_idx
  on public.pickup_schedules (student_id, service_date);
create index if not exists pickup_schedules_day_idx
  on public.pickup_schedules (service_date, status);

-- ── 출결 ───────────────────────────────────────────────────────────────────
-- 출석부는 «이 반, 이 기간»으로 읽습니다. 날짜만으로 훑으면 학기가 쌓일수록 느려집니다.
create index if not exists attendance_records_student_day_idx
  on public.attendance_records (student_id, date);
create index if not exists attendance_records_day_idx
  on public.attendance_records (date);
-- 인박스에서 「아직 등록 안 된 것」을 고르는 조건. 상태로 먼저 좁힙니다.
create index if not exists attendance_entries_state_idx
  on public.attendance_entries (state, date_from);
-- 같은 메시지가 두 번 들어오는지 확인하는 자리. 없으면 메시지가 쌓일수록 확인이 느려집니다.
create index if not exists attendance_entries_source_idx
  on public.attendance_entries (source_message_id);

-- ── 그 밖에 ────────────────────────────────────────────────────────────────
create index if not exists apparel_orders_term_idx on public.apparel_orders (term_id, status);
create index if not exists wr_term_class_snapshots_term_idx on public.wr_term_class_snapshots (term_id);
-- 누가 재무 권한을 언제 받았는지. 최근 것부터 봅니다.
create index if not exists finance_access_log_at_idx on public.finance_access_log (changed_at desc);
-- 구글시트 대기함은 「대기」인 줄만 봅니다.
create index if not exists roster_sync_inbox_status_idx on public.roster_sync_inbox (status, created_at);
