-- 입학일(첫 등교일)
--
-- 명부 시트에는 `Starting Day` 로 적혀 있는데 앱에는 담을 칸이 없었습니다. 그래서 학생을
-- 손으로 추가할 때마다 「이 아이 언제부터 왔더라」를 다시 물어봐야 했고, 학기 중간에 온
-- 아이의 학비를 일할 계산할 근거도 화면 어디에도 없었습니다.
--
-- 졸업·전출일은 지금 `status` 로만 관리합니다. 나중에 필요해지면 그때 칸을 만듭니다 -
-- 안 쓰는 칸은 비어 있는 채로 남아서, 다음 사람이 「이건 왜 비었지」를 묻게 만듭니다.

alter table public.wr_students add column if not exists enrolled_on date;

comment on column public.wr_students.enrolled_on is
  '첫 등교일. 구글시트 명부의 Starting Day.';
