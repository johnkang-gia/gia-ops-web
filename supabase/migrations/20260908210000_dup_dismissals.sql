-- ===== 「이 둘은 다른 아이입니다」를 기억합니다 =====
--
-- 명부 점검의 중복 목록은 이름이 같은 줄을 올립니다. 그런데 김재이가 셋, 이준서가 둘인
-- 학교라 **정말 다른 아이인 묶음**이 늘 몇 개 남습니다.
--
-- 지금은 그걸 내릴 방법이 없습니다. 합칠 수도 없고(다른 아이니까) 지울 수도 없어서, 매번
-- 같은 묶음을 다시 보고 다시 판단하게 됩니다. 그러면 목록에 진짜 중복이 새로 올라와도
-- **늘 있던 것들 사이에 묻혀서** 눈에 안 띕니다.
--
-- 그래서 「확인했고 다른 아이다」를 남깁니다. 지우는 것이 아니라 **판단을 기록하는 것**입니다.
-- 학생 줄은 그대로 있고, 목록에서만 내려갑니다.

create table if not exists public.student_dup_dismissals (
  id uuid primary key default gen_random_uuid(),
  -- 이 묶음을 가리키는 열쇠. 학생 번호를 정렬해 이어 붙입니다.
  -- 한 명이라도 더 생기면 열쇠가 달라져 **다시 올라옵니다** - 새 줄은 다시 봐야 합니다.
  group_key text not null unique,
  -- 무엇을 내렸는지 사람이 읽을 수 있게. 나중에 「왜 이 묶음이 목록에 없지」에 답합니다.
  label text,
  -- 왜 다른 아이라고 판단했는지. 비워둘 수 없게 화면에서 막습니다.
  reason text,
  dismissed_by text,
  created_at timestamptz not null default now()
);

alter table public.student_dup_dismissals enable row level security;

drop policy if exists student_dup_dismissals_rw on public.student_dup_dismissals;
create policy student_dup_dismissals_rw on public.student_dup_dismissals
  for all using (public.is_giamicro_user()) with check (public.is_giamicro_user());

comment on table public.student_dup_dismissals is
  '「이름은 같지만 다른 아이」로 확인한 묶음. 학생 줄은 그대로 두고 명부 점검 목록에서만 내립니다. 줄이 하나라도 늘면 열쇠가 달라져 다시 올라옵니다.';
