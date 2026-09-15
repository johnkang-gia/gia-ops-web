-- **오늘 이 아이에 대해 알아야 할 것** — 하루짜리 학생 특이사항.
--
-- ── 무엇이 없었나 ──────────────────────────────────────────────────────────
--
-- 「서후 약 점심에 챙겨주세요」, 「오늘 어머니가 픽업 오시면서 교재비 결제하신다고
-- 하셨어요」 같은 말은 아침에 전화·토들·복도에서 들어옵니다. 그런데 **적을 자리가
-- 없었습니다.** 출결도 아니고 픽업도 아니고 업무도 아닙니다 - 그냥 오늘 하루 알고
-- 있어야 하는 것입니다.
--
-- 그래서 지금까지는 포스트잇, 또는 「제가 기억하고 있을게요」였습니다. 그 말을 들은
-- 사람이 자리를 비우면 아무도 모릅니다. 약은 안 챙겨지고, 결제는 그냥 지나갑니다.
--
-- ── 왜 셔틀 특이사항과 따로 두나 ───────────────────────────────────────────
--
-- `shuttle_persistent_notes` 는 **차를 어떻게 태울 것인가**를 정합니다(요일 제외 ·
-- 셔틀 전면 제외 · 결석 기간). 그래서 호차·요일·효과 칸이 붙어 있고, 하원 체크표와
-- 동승 선생님 화면이 그것을 읽습니다.
--
-- 약·결제·준비물은 **차와 아무 상관이 없습니다.** 그 줄을 체크표에 섞으면, 종이로
-- 뽑아 쓰는 하원 명단에 하원과 무관한 줄이 끼어 정작 탈 아이가 묻힙니다. 하는 일이
-- 다르므로 표도 따로 둡니다.
--
-- ── 이름이 아니라 번호로 붙입니다 ──────────────────────────────────────────
--
-- 김재이가 셋입니다(CLAUDE.md §2-4-1). 이름으로 적어두면 어느 김재이의 약인지 알 수
-- 없고, 그 상태로 약을 주는 것은 안 주는 것보다 나쁩니다. 그래서 `student_id` 는
-- **반드시** 있어야 하고, 화면은 검색해서 명부에서 고르게 합니다.
--
-- 적힌 당시의 이름은 함께 남깁니다 - 아이가 전학 가서 명부에서 지워져도 그날 무슨
-- 일이 있었는지는 읽을 수 있어야 합니다.

create table if not exists public.student_day_notes (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.wr_students(id) on delete cascade,
  -- 적힌 당시의 이름. 보여줄 때는 명부를 우선 쓰고, 명부에서 사라진 줄에만 씁니다.
  student_name text not null,
  -- 어느 날의 일인가. 대개 오늘이지만, 「내일 병원 갔다 늦게 옵니다」를 미리 적어둘 수
  -- 있어야 합니다 - 미리 못 적으면 그날 아침에 또 누군가 기억하고 있어야 합니다.
  on_date date not null,
  -- 종류. 화면에서 색으로 갈라 보여줍니다 - 약은 시간을 놓치면 안 되고 결제는 사람이
  -- 올 때 맞춰야 해서, 해야 할 일의 성격이 다릅니다.
  kind text not null default '기타' check (kind in ('약', '결제', '준비물', '건강', '기타')),
  content text not null,
  created_by text null,
  created_by_name text null,
  created_at timestamptz not null default now(),
  -- 잘못 적은 줄을 내립니다. **지우지 않습니다** - 「없었다」와 「아니라고 판단했다」는
  -- 다른 말이고, 누가 왜 내렸는지 물어볼 일이 생깁니다.
  deleted_at timestamptz null,
  deleted_by text null
);

-- 화면은 언제나 「어느 날짜의 살아 있는 줄」을 묻습니다.
create index if not exists student_day_notes_date_idx
  on public.student_day_notes (on_date, deleted_at);
create index if not exists student_day_notes_student_idx
  on public.student_day_notes (student_id, on_date);

alter table public.student_day_notes enable row level security;

-- 행정실이 쓰고 교직원이 봅니다. 약·준비물은 담임도 알아야 하고(교실에서 챙깁니다),
-- 적는 일은 전화를 받은 사람이 그 자리에서 해야 합니다 - 「행정실에 말해두세요」를
-- 한 단계 더 두면 그 단계에서 사라집니다.
drop policy if exists student_day_notes_select on public.student_day_notes;
create policy student_day_notes_select on public.student_day_notes
  for select using (auth.role() = 'authenticated');

drop policy if exists student_day_notes_insert on public.student_day_notes;
create policy student_day_notes_insert on public.student_day_notes
  for insert with check (auth.role() = 'authenticated');

drop policy if exists student_day_notes_update on public.student_day_notes;
create policy student_day_notes_update on public.student_day_notes
  for update using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- 지우기는 없습니다. 내리는 것은 `deleted_at` 을 채우는 update 입니다.

-- ── 중앙 대시보드가 바로 받아보게 ──────────────────────────────────────────
--
-- 대시보드는 「번호가 바뀌었나」만 물어보고, 안 바뀌었으면 자료를 아예 안 읽습니다
-- (`board_revisions`). 새 표에 번호 올리는 트리거를 안 걸면 **적어도 화면에 안 뜨고**,
-- 그건 오류가 아니라 「적었는데 안 보이네」로 보입니다. 최대 3분 뒤에는 안전장치가
-- 훑어주지만, 아침에 적은 약이 3분 뒤에 뜨는 것은 적는 사람을 못 믿게 만듭니다.
do $$
begin
  if to_regclass('public.board_revisions') is not null then
    drop trigger if exists bump_ops_student_day_notes on public.student_day_notes;
    create trigger bump_ops_student_day_notes
      after insert or update or delete on public.student_day_notes
      for each statement execute function public.bump_ops();
  end if;
end $$;
