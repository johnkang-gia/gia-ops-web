-- ===== 도서관: 학생 사진 + 데모 학생 분리 =====
--
-- 요청: "운영앱 학생데이터에 학생 사진도 넣었어, 도서관 카드 만들때 학생사진도 넣어서 뽑을 수
-- 있게 만들어줘".
--
-- 사진은 이미 운영앱이 여권 규격(35×45mm)으로 잘라 student-photos 버킷에 넣어두었습니다.
-- 도서관 앱이 그걸 그대로 쓰면 되는데, 지금은 두 곳이 막혀 있습니다.
--
--   ① lib_students 뷰에 사진 경로 칸이 없습니다.
--   ② student-photos 버킷 정책이 is_giamicro_user()를 쓰는데, 이 함수는 도서관 가계정을
--      일부러 제외합니다(도서관 노트북이 운영앱 개인정보를 못 보게 만든 장치).
--
-- 두 곳을 여는데, **읽기만** 엽니다. 도서관 노트북은 사진을 보고 카드를 인쇄할 뿐이고
-- 올리거나 지우지 못합니다. 사진 관리는 계속 운영앱에서만 합니다.
--
-- 개인정보 관점: 도서관 노트북은 하루 종일 로그인된 채 데스크에 놓입니다. 그래서 이 계정은
-- 원래 학생 이름·학년·반·고유번호까지만 볼 수 있었고, 이번에 얼굴 사진이 더해집니다.
-- 사진은 카드에 인쇄되어 아이가 들고 다니는 것이라 노출 수준이 크게 달라지지는 않지만,
-- 판단이 필요한 변경이라 여기에 적어 둡니다.

-- ── ① 뷰에 사진 경로 더하기 + 데모 학생 걸러내기 ───────────────────────────
--
-- 요청: "도서관 학생명부에 데모애들도 들어가 있어, 데모애들은 더미파일이니까 철저하게 분리해줘".
--
-- 운영앱에는 신입교사 오리엔테이션용 가짜 학생들이 있고 wr_students.is_demo = true 로
-- 표시되어 있습니다. 운영앱은 "보는 사람이 데모 계정인가"와 이 값을 맞춰서 걸렀는데,
-- 도서관 뷰는 그 조건을 빠뜨려서 가짜 학생이 그대로 딸려 들어왔습니다.
--
-- 도서관에는 데모 상황이 아예 없습니다. 실제 아이가 실제 책을 빌리는 곳뿐입니다.
-- 그래서 조건을 붙이지 않고 **아예 못 들어오게** 막습니다(is_demo = false 고정).
-- 카드 인쇄·이름 검색·학생별 이력 등 도서관의 모든 화면이 이 뷰 하나만 보므로,
-- 여기 한 줄이면 전부 걸러집니다.
--
-- 사진 경로는 경로만 넘깁니다. 실제 이미지는 버킷에서 짧게 사는 서명 주소로 받아옵니다
-- (공개 URL을 만들면 주소를 아는 누구나 아이 얼굴을 볼 수 있게 됩니다).
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
  s.status,
  s.photo_path
from wr_students s
where is_lib_user()
  and coalesce(s.is_demo, false) = false;

revoke all on lib_students from anon;
grant select on lib_students to authenticated;

-- ── ② 도서관 계정에도 사진 '읽기'만 허용 ────────────────────────────────────
-- 기존 정책(student_photos_read)은 그대로 두고, 도서관용 읽기 정책을 따로 추가합니다.
-- 정책은 OR로 합쳐지므로 교직원 접근에는 아무 영향이 없고, 나중에 이 한 줄만 지우면
-- 도서관 쪽 접근만 깔끔하게 닫힙니다.
drop policy if exists student_photos_read_library on storage.objects;
create policy student_photos_read_library on storage.objects
  for select using (bucket_id = 'student-photos' and public.is_library_account());


-- ── ③ 이미 들어온 데모 기록 확인 ────────────────────────────────────────────
-- 뷰를 막으면 앞으로는 안 들어오지만, 그 전에 데모 학생 이름으로 빌린 기록이 남아 있을 수
-- 있습니다. 지우지는 않습니다(무엇이 지워지는지 사람이 보고 정하는 편이 안전합니다).
-- 아래 질의로 확인하고, 나올 경우에만 지우세요.
--
--   select l.id, l.student_no, l.student_name, l.borrowed_at, l.status
--     from lib_loans l
--     join wr_students s on s.student_no = l.student_no
--    where s.is_demo = true
--    order by l.borrowed_at desc;
--
--   -- 확인한 뒤 지울 때
--   -- delete from lib_loans l
--   --  using wr_students s
--   --  where s.student_no = l.student_no and s.is_demo = true;
-- ===== 도서카드 발급 기록 =====
--
-- 요청: "한번 인쇄한 아이들은 체크해주고, 잃어버렸을때 다시 뽑을 때 그것도 기록해주고".
--
-- 종이 카드는 잃어버립니다. 그래서 "누가 받았나"만으로는 부족하고 "몇 번째 카드인가"까지
-- 남아야 합니다. 한 학생에 여러 줄이 쌓이는 기록표로 만든 이유입니다 - 마지막 줄이 지금 그
-- 아이가 들고 있는 카드이고, 줄 수가 곧 재발급 횟수입니다.
--
-- 카드를 '취소'하거나 '무효화'하지는 않습니다. 바코드에 담기는 값은 학생 고유번호 하나뿐이라,
-- 잃어버린 카드를 주워도 그 아이 이름으로 빌리는 것 말고는 할 수 있는 일이 없습니다. 대출
-- 창구에 사람이 서 있는 구조라 그 위험은 충분히 낮습니다. 나중에 출입문 자동 개폐처럼 사람이
-- 없는 곳에 쓰게 되면 그때 무효화 개념을 더하면 됩니다.

create table if not exists lib_card_issues (
  id uuid primary key default gen_random_uuid(),
  -- 학생 고유번호로 잡습니다. 학생 행이 지워져도 기록은 남아야 하므로 외래키를 걸지 않습니다.
  student_no text not null,
  -- 그때의 이름·반을 함께 적어둡니다. 나중에 반이 바뀌어도 "언제 어느 반일 때 뽑았는지"가
  -- 남습니다.
  student_name text,
  student_class text,
  issued_at timestamptz not null default now(),
  issued_by text,
  -- 최초 발급인지 다시 뽑은 것인지. 다시 뽑은 이유(분실·훼손 등)는 note에 적습니다.
  reason text not null default '최초' check (reason in ('최초', '재발급')),
  note text
);

create index if not exists lib_card_issues_student_idx
  on lib_card_issues(student_no, issued_at desc);

alter table lib_card_issues enable row level security;

drop policy if exists lib_all_card_issues on lib_card_issues;
create policy lib_all_card_issues on lib_card_issues
  for all using (is_lib_user()) with check (is_lib_user());

-- ── 학생별 발급 현황 요약 ───────────────────────────────────────────────────
-- 카드 인쇄 화면이 "이 아이는 뽑았나, 몇 번 뽑았나, 마지막이 언제인가"를 한 번에 물어보도록
-- 만든 뷰입니다. 화면에서 매번 세는 것보다 가볍고, 학생 수가 늘어도 그대로 씁니다.
drop view if exists lib_card_status;
create view lib_card_status as
select
  student_no,
  count(*)                                  as issue_count,
  max(issued_at)                            as last_issued_at,
  (count(*) filter (where reason = '재발급')) as reissue_count
from lib_card_issues
where is_lib_user()
group by student_no;

revoke all on lib_card_status from anon;
grant select on lib_card_status to authenticated;
