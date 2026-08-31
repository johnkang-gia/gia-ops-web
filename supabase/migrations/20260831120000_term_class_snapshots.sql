-- 학기별 반·담임·과목 세팅 보관본
--
-- 담당자 요청: "반/담임 배정관리와 과목의 경우도 정규학기 안에 포함되도록 해서, 학기를 바꾸면
--              이전 학기 반 세팅이 나오도록 만들어줘."
--
-- 왜 wr_classes에 term_id를 넣지 않았는가:
--   wr_classes를 읽는 화면이 31곳입니다(담임 화면, 출결, 학생 프로필, 시간표, 픽업, 안내보드,
--   온보딩...). 거기에 학기 칸을 넣고 전부 "현재 학기"로 거르게 만들면, 한 곳만 빠뜨려도
--   담임 선생님 화면이 통째로 비어 보입니다. 그리고 그 31곳이 묻는 것은 전부 "지금 반이
--   뭐냐"이지 "작년 2학기 반이 뭐였냐"가 아닙니다.
--
-- 그래서 나눕니다.
--   · wr_classes / wr_subjects  = **지금** 세팅. 지금까지처럼 한 벌만 있습니다.
--   · 이 표                      = **지난 학기** 세팅의 보관본. 학기가 끝날 때 통째로 뜹니다.
--
-- 보관본은 참조(id)가 아니라 **값**으로 적습니다. 반이 없어지거나 교사가 퇴사해도, 이름이
-- 바뀌어도, 그 학기에 실제로 어떤 반과 담임이 있었는지는 그대로 남아야 하기 때문입니다.
-- 참조로 두면 원본이 지워지는 순간 기록도 같이 사라집니다.

create table if not exists public.wr_term_class_snapshots (
  id uuid primary key default gen_random_uuid(),
  term_id uuid not null references public.terms(id) on delete cascade,
  taken_at timestamptz not null default now(),
  taken_by text,
  -- [{ grade, class_name, teacher_name, sub_teacher_name, student_count, students: [{name, student_no, grade}] }]
  classes jsonb not null default '[]'::jsonb,
  -- [{ name, teacher_name, class_name, color, student_count, students: [name] }]
  subjects jsonb not null default '[]'::jsonb,
  -- 자동(학기 종료 크론) / 수동(관리자 버튼) 중 어느 쪽으로 떴는지.
  source text not null default '수동',
  note text,
  created_at timestamptz not null default now(),
  -- 학기당 한 벌. 다시 뜨면 덮어씁니다 - 학기 중에 반이 바뀌면 마지막 모습이 남아야 합니다.
  unique (term_id)
);

comment on table public.wr_term_class_snapshots is
  '학기별 반·담임·과목 세팅 보관본. 지금 세팅은 wr_classes/wr_subjects에 있고, 이 표는 지난 학기를 되짚어 보기 위한 값 사본입니다.';

create index if not exists wr_term_class_snapshots_term_idx
  on public.wr_term_class_snapshots (term_id);

alter table public.wr_term_class_snapshots enable row level security;

-- 다른 표들과 같은 규칙: 로그인한 사용자는 읽고 쓸 수 있습니다(화면 단에서 관리자만 들어갑니다).
drop policy if exists wr_term_class_snapshots_all on public.wr_term_class_snapshots;
create policy wr_term_class_snapshots_all
  on public.wr_term_class_snapshots
  for all
  using (true)
  with check (true);
