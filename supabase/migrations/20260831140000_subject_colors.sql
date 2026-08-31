-- 과목별 색
--
-- 담당자: "수업시간표의 경우 구성 너무 좋은데 시간표 안에 과목들 색이 달랐으면 좋겠어.
--         일단 알아서 과목별로 색을 지정해주고, 그 색을 자유롭게 바꿀 수도 있도록."
--
-- 색은 **과목 이름**을 열쇠로 삼습니다. wr_subjects의 행이 아니라요.
--   · 시간표(wr_timetable)는 과목을 이름 글자로 적습니다 - wr_subjects와 id로 이어져 있지
--     않습니다. 이름이 아니면 시간표 칸에 색을 붙일 방법이 없습니다.
--   · 그리고 학기가 바뀌면 과목반 세팅은 새로 짜지만 "수학"은 계속 수학입니다. 색이 학기마다
--     흩어지면 매 학기 다시 칠해야 합니다.
--
-- 여기 아무것도 없어도 화면은 색이 나옵니다 - 이름을 섞어 정해진 팔레트에서 자동으로
-- 고르기 때문입니다(src/lib/subjectColor.ts). 이 표는 **그 자동 색이 마음에 안 들 때만**
-- 채워지는 덮어쓰기 목록입니다. 그래서 비어 있는 것이 정상입니다.

create table if not exists public.wr_subject_colors (
  name text primary key,
  color text not null,
  updated_by text,
  updated_at timestamptz not null default now()
);

comment on table public.wr_subject_colors is
  '과목 이름별 색 덮어쓰기. 비어 있으면 이름을 섞어 자동으로 고른 색이 쓰입니다.';

alter table public.wr_subject_colors enable row level security;

drop policy if exists wr_subject_colors_all on public.wr_subject_colors;
create policy wr_subject_colors_all
  on public.wr_subject_colors
  for all
  using (true)
  with check (true);
