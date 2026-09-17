-- 출결 등록표의 유일 열쇠에 **날짜**를 더합니다.
--
-- ── 무엇이 문제였나 ──────────────────────────────────────────────────
--
-- 「Yeni will be absent next monday and wednesday」는 **한 글에 결석이 두 번**입니다. 서로
-- 붙어 있지 않으므로 기간 한 줄로는 담을 수 없고, 날마다 한 줄이어야 합니다.
--
-- 그런데 유일 열쇠가 (창구 · 글 번호 · 학생 이름 · 갈래) 넷뿐이라, 같은 글에서 나온 월요일
-- 줄과 수요일 줄이 **같은 줄로 취급됩니다.** 앱은 `ignoreDuplicates` 로 넣으므로 뒤엣것이
-- 오류 없이 조용히 버려집니다 - 화면에는 「월요일 결석 한 건」으로 보이고, 수요일 아침에
-- 그 아이를 찾기 전까지 아무도 모릅니다.
--
-- 날짜를 열쇠에 더하면 두 줄이 서로 다른 줄이 됩니다. 같은 날 같은 갈래가 두 번 들어오는
-- 것은 여전히 막힙니다 - 그건 진짜 중복입니다.

drop index if exists public.attendance_entries_source_uniq;

create unique index if not exists attendance_entries_source_uniq
  on public.attendance_entries (source, source_message_id, student_name, status, date_from);
