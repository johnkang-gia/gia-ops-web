-- 매일 도는 조회에 인덱스 붙이기
--
-- ── 어떻게 골랐나 ───────────────────────────────────────────────────
--
-- 짐작이 아니라 **코드를 세어서** 골랐습니다. 각 표를 어떤 칸으로 거르는지(`eq`·`gte`·
-- `order`) 전부 긁어, 많이 쓰이는데 인덱스가 없는 자리만 남겼습니다.
--
-- 지금은 표가 작아서 인덱스가 없어도 빠릅니다. 문제는 **표가 커지는 속도가 화면이 느려지는
-- 속도와 같다**는 것입니다. 출결·탑승 기록은 매 수업일마다 학생 수만큼 쌓이므로, 한 학기면
-- 몇 만 줄이 됩니다. 그때 느려지면 원인을 찾기가 훨씬 어렵습니다 - 어제까지 멀쩡했으니까요.

-- ── 출석부 ──────────────────────────────────────────────────────────
--
-- 「그날의 출결」이 이 표의 주된 질문인데(코드 다섯 곳), 있던 인덱스는 학기(term_id) 하나
-- 뿐이었습니다. 학기로 거르면 그 학기 전체가 걸리므로 날짜를 좁히는 데 도움이 안 됩니다.
create index if not exists attendance_records_date_idx
  on public.attendance_records (date);

-- 학생 한 명의 지난 기록(학생 상세 화면).
create index if not exists attendance_records_student_date_idx
  on public.attendance_records (student_id, date desc);

-- ── 셔틀 탑승 ───────────────────────────────────────────────────────
--
-- `service_date` 로 거르는 자리가 열여섯 곳인데 인덱스가 **하나도 없었습니다.** 하원
-- 체크표·안내보드·도착체크가 모두 이 표를 그날짜로 읽습니다 - 하원 시간대에 가장 자주
-- 도는 질의가 가장 느린 상태였습니다.
create index if not exists shuttle_boardings_date_idx
  on public.shuttle_boardings (service_date);

-- ── 픽업 인박스 ─────────────────────────────────────────────────────
create index if not exists pickup_requests_received_idx
  on public.pickup_requests (received_at desc);
create index if not exists pickup_requests_service_date_idx
  on public.pickup_requests (service_date);

-- ── 주간 관찰기록 ───────────────────────────────────────────────────
--
-- 학생별로 지난 기록을 훑는 화면이 주 용도입니다. 학생 수 × 격주 × 학기라 가장 빨리
-- 불어나는 표 중 하나입니다.
create index if not exists wr_reports_student_date_idx
  on public.wr_reports (student_id, report_date desc);

-- ── 업무 ────────────────────────────────────────────────────────────
--
-- 흐름판은 «완료가 아닌 것»만 봅니다. 완료된 업무는 계속 쌓이기만 하므로, 시간이 갈수록
-- 안 쓰는 줄을 훑는 시간이 늘어납니다. 부분 인덱스로 살아 있는 것만 담습니다.
create index if not exists tasks_open_idx
  on public.tasks (department, status)
  where status <> '완료';

-- ── 출결 연락(인박스) ───────────────────────────────────────────────
--
-- 「오늘이 기간에 드는 등록된 건」이 주 질의입니다. state·date_from·date_to 인덱스는 이미
-- 있고, 여기서는 **학생별로 되짚는 길**을 더합니다(학생 상세에서 근거를 찾을 때).
create index if not exists attendance_entries_student_idx
  on public.attendance_entries (student_id, date_from desc)
  where student_id is not null;
