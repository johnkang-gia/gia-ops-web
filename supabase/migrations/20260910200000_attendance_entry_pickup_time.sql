-- 픽업 시각을 **줄에 적어둡니다**
--
-- ── 무엇이 문제였나 ──────────────────────────────────────────────────
--
-- 픽업 줄에는 시각 칸이 없어서, 화면이 읽을 때마다 원문에서 시각을 다시 뽑았습니다. 두 가지가
-- 잘못됐습니다.
--
--   ① 원문은 **글 전체**가 저장돼 있습니다. 한 글에 아이가 둘이면 둘 다 같은 시각을 물려받아,
--      「Rogan 2:30 픽업 … 김도은 오늘 픽업」 한 줄에서 김도은도 2:30 이 됐습니다. 아무도
--      안 오는 시각에 아이를 문 앞에 세워두게 됩니다.
--   ② 사람이 시각을 고칠 자리가 없었습니다. 원문을 고칠 수는 없으니까요.
--
-- 그래서 그 아이를 가리키는 조각에서 읽은 시각을 **저장할 때 한 번** 정해 둡니다. 읽는 쪽은
-- 이 값을 먼저 보고, 없을 때만 예전처럼 원문에서 뽑습니다(이미 쌓인 줄을 위해).

alter table public.attendance_entries add column if not exists pickup_time time;

comment on column public.attendance_entries.pickup_time is
  '픽업 시각. 저장할 때 그 아이를 가리키는 문장 조각에서 한 번 읽습니다. 오후로 읽는 규칙(1~7시 → 13~19시)이 이미 적용된 값입니다.';

create index if not exists attendance_entries_pickup_time_idx
  on public.attendance_entries(date_from, status)
  where pickup_time is not null;
