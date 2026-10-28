-- 학생 특이사항 메모 — 사건이 없어도 적어 두는 아이 이야기
--
-- 지금까지 학생별 기록은 **무슨 일이 일어나야** 남았습니다(사건기록·출결·픽업·하루 메모). 그래서
-- 「펜싱 학원 가기 싫어해서 아프다고 하거나 부모님께 전화하는 일이 잦다」처럼 사건이 아닌 **성향·관계·
-- 사정**은 담당자 머릿속과 카톡에만 있었고, 그 사람이 없으면 다른 행정직원은 전화를 받고도 몰랐습니다.
--
-- 항목을 나누지 않습니다. 성향·교우관계·가정 사정·건강처럼 칸을 만들면 어디에 적을지 고민하다 안
-- 적습니다. 메모 한 칸에 자유롭게 적고, 계속 고치거나 덧붙입니다.
--
-- 학기마다 새로 씁니다. 메모는 적은 시점의 학기(`term_id`)에 묶이고, 학기가 바뀌면 지난 학기 메모는
-- 「이전 특이사항」으로 접혀 보이며 이번 학기 칸은 비어 시작합니다. 지난 학기 메모는 고치지 않습니다 -
-- 그때 그렇게 보였다는 기록입니다.

create table if not exists public.student_profile_notes (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.wr_students(id) on delete cascade,
  -- 적은 시점의 학기. 진행중 학기가 없을 때 적은 메모는 비어 있고 「학기 미지정」으로 보입니다.
  term_id uuid references public.terms(id) on delete set null,
  body text not null,
  author_email text not null,
  author_name text,
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- 지우기는 내리기입니다. 아이에 대해 적은 글을 흔적 없이 없애지 않습니다.
  deleted_at timestamptz,
  deleted_by text,
  constraint student_profile_notes_body_ck check (btrim(body) <> '')
);

comment on table public.student_profile_notes is
  '학생 특이사항 메모(자유 서술). 학기별로 묶이고, 지난 학기 메모는 이전 특이사항으로 접힙니다. 지우기는 deleted_at.';

create index if not exists student_profile_notes_student_idx
  on public.student_profile_notes (student_id, created_at desc) where deleted_at is null;

drop trigger if exists student_profile_notes_updated_at on public.student_profile_notes;
create trigger student_profile_notes_updated_at
  before update on public.student_profile_notes
  for each row execute function set_updated_at();

-- ── 자물쇠 ──────────────────────────────────────────────────────────────────
-- 아이의 성향·가정 사정이 적힙니다. 교직원(giamicro 계정)만 읽고 씁니다. 학부모 계정은 이 앱에 없습니다.
alter table public.student_profile_notes enable row level security;

drop policy if exists student_profile_notes_staff on public.student_profile_notes;
create policy student_profile_notes_staff on public.student_profile_notes
  for all to authenticated using (public.is_giamicro_user()) with check (public.is_giamicro_user());

revoke all on public.student_profile_notes from anon;

notify pgrst, 'reload schema';
