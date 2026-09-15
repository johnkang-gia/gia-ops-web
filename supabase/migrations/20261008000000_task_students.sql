-- **업무가 어느 아이에 관한 것인가 — 이름이 아니라 번호로.**
--
-- ── 무엇이 문제였나 ────────────────────────────────────────────────────────
--
-- `tasks` 에는 학생 번호가 없습니다. 그래서 학생 프로필 화면은 업무를 `ilike '%이름%'`
-- 으로 찾고 있었습니다.
--
--   · 「김재이」로 찾으면 **김재이 셋의 업무가 전부** 나옵니다.
--   · 「이준」으로 찾으면 이준서·이준우·이준혁에 다 걸립니다.
--   · 반대로 제목에 이름이 안 적힌 업무는 그 아이 것인데도 **안 나옵니다.**
--
-- 화면에는 오류가 아니라 «그 아이의 업무 목록»으로 보입니다. 그래서 아무도 못 찾습니다
-- (CLAUDE.md §2-4-1, 이름을 열쇠로 쓰면 안 되는 이유).
--
-- ── 왜 `tasks` 에 칸을 붙이지 않나 ─────────────────────────────────────────
--
-- 한 업무가 **여러 아이에 걸립니다.** 「G2 교재 배부」는 스무 명이고, 「형제 둘 하원 변경」은
-- 두 명입니다. 칸 하나로는 담을 수 없고, 배열로 담으면 「이 아이의 업무」를 찾을 때마다
-- 배열을 훑어야 해서 색인이 안 먹습니다.
--
-- ── 옛 업무는 백필하지 않습니다 ────────────────────────────────────────────
--
-- 제목의 이름으로 짐작해 넣고 싶어집니다. 하지 않습니다 - 김재이 셋 중 누구인지 모르는
-- 채로 넣으면 **틀린 연결이 영구히 남고**, 그건 아무 연결도 없는 것보다 나쁩니다. 없으면
-- 사람이 「아직 안 이었구나」를 알지만, 틀리게 이어져 있으면 맞는 줄 압니다.
--
-- 앞으로 등록되는 업무부터 붙습니다.

create table if not exists public.task_students (
  task_id uuid not null references public.tasks(id) on delete cascade,
  student_id uuid not null references public.wr_students(id) on delete cascade,
  -- 누가 이었는지. 자동이 이은 것과 사람이 고른 것을 나중에 갈라야 할 수 있습니다.
  linked_by text null,
  created_at timestamptz not null default now(),
  primary key (task_id, student_id)
);

-- 「이 아이의 업무」를 찾는 자리. 학생 하루 보드가 이 색인으로 읽습니다.
create index if not exists task_students_student_idx on public.task_students (student_id);

alter table public.task_students enable row level security;

-- 업무 자체와 같은 기준입니다. 이 표에는 이음 정보만 있고 내용은 `tasks` 에 있으므로,
-- 여기만 열려 있어도 업무 내용이 새지 않습니다.
drop policy if exists task_students_select on public.task_students;
create policy task_students_select on public.task_students
  for select using (auth.role() = 'authenticated');

drop policy if exists task_students_insert on public.task_students;
create policy task_students_insert on public.task_students
  for insert with check (auth.role() = 'authenticated');

drop policy if exists task_students_delete on public.task_students;
create policy task_students_delete on public.task_students
  for delete using (auth.role() = 'authenticated');

-- 중앙 대시보드가 바로 받아보게. 안 걸면 이은 업무가 최대 3분 뒤에야 보드에 뜹니다.
do $$
begin
  if to_regclass('public.board_revisions') is not null then
    drop trigger if exists bump_ops_task_students on public.task_students;
    create trigger bump_ops_task_students
      after insert or update or delete on public.task_students
      for each statement execute function public.bump_ops();
  end if;
end $$;

comment on table public.task_students is
  '업무 ↔ 학생. 이름이 아니라 번호로 잇습니다. 옛 업무는 일부러 백필하지 않았습니다.';
