-- '출결 아님'으로 내리는 줄은 학생이 없어도 되게 합니다.
--
-- 왜 필요한가
-- ───────────
-- attendance_entries.student_id는 NOT NULL로 잠겨 있습니다(20260827090000_lock_student_fk).
-- 그 판단 자체는 맞습니다 - 학생과 연결되지 않은 **출결 기록**은 아무 쓸모가 없습니다.
--
-- 그런데 '무시'는 출결 기록이 아니라 **"이건 출결이 아니다"라는 사람의 판단**입니다.
-- 그리고 내려야 하는 것들은 대부분 애초에 학생을 못 찾은 것들입니다.
--
--   "@Paul Lee @John Kang 오늘 임예나 3시 픽업입니다"
--     → 선생님 멘션이 학생 영문명과 겹쳐 이준서·김요한이 유령으로 잡힘
--     → 명부에 그런 출결은 없으니 student_id를 채울 방법이 없음
--     → 내리려고 ✕를 누르면 NOT NULL에 막힘
--
-- **가장 지워야 할 것을 가장 지울 수 없는 구조**였습니다.
--
-- 그래서 NOT NULL을 조건부로 바꿉니다.
--   · state <> '무시'  → 학생이 반드시 있어야 합니다 (원래 의도 그대로)
--   · state  = '무시'  → 학생이 없어도 됩니다 (판단만 남기는 줄)
--
-- 외래키는 그대로 둡니다. 값이 들어 있다면 여전히 실제 학생이어야 합니다.

alter table public.attendance_entries
  alter column student_id drop not null;

alter table public.attendance_entries
  drop constraint if exists attendance_entries_student_required;

alter table public.attendance_entries
  add constraint attendance_entries_student_required
  check (state = '무시' or student_id is not null);

comment on constraint attendance_entries_student_required on public.attendance_entries is
  '출결로 쓰이는 줄(등록·확인필요)은 반드시 학생과 연결되어야 합니다. ''무시''는 "출결이 아니다"라는 판단만 남기는 줄이라 예외입니다.';

-- 확인
select
  (select count(*) from public.attendance_entries where state <> '무시' and student_id is null) as "학생 없는 출결(0이어야 함)",
  (select count(*) from public.attendance_entries where state = '무시') as "내려둔 줄";
