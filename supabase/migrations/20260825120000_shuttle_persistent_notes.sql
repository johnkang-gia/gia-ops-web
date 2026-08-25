-- 하원 체크표 "지속 특이사항" 창구 (요청: 왼쪽에 지속 반영사항을 적는 창구를 만들고,
-- 적으면 오른쪽에 요약 위젯으로 계속 띄우고, 차량 셔틀도 자동으로 수정되며, 나중에
-- 삭제하면 원래 셔틀로 복귀). 예: "이라엘 수요일 수영학원 → 수요일 셔틀 제외",
-- "4호 김재이 당분간 개별하원(셔틀 안 탐)".
--
-- 효과(effect_kind)는 셔틀 배정을 파괴적으로 바꾸지 않고 "덧씌우는" 방식이라, 이 행을
-- 비활성(active=false)으로 지우면 체크표가 자동으로 원래 배정으로 되돌아옵니다.
--   none       : 메모만 (셔틀 그대로)
--   skip_days  : effect_days 요일에는 이 학생을 셔틀에서 제외 (예: 수영학원 가는 요일)
--   no_shuttle : 당분간 셔틀 전면 제외 (개별하원)
create table if not exists public.shuttle_persistent_notes (
  id uuid primary key default gen_random_uuid(),
  term text not null default '정규학기',
  student_name text not null,
  student_id uuid null references public.wr_students(id) on delete set null,
  route_no text null,                 -- 동명이인 구분용(예: "4호"). 없으면 같은 이름 전체에 적용
  content text not null,              -- 담당자가 적은 원문
  effect_kind text not null default 'none' check (effect_kind in ('none','skip_days','no_shuttle')),
  effect_days int[] not null default '{}',  -- skip_days용 (1=월 ... 5=금)
  active boolean not null default true,
  created_by text null,
  created_at timestamptz not null default now()
);

create index if not exists shuttle_persistent_notes_term_active_idx
  on public.shuttle_persistent_notes (term, active);

alter table public.shuttle_persistent_notes enable row level security;

-- 하원 체크표는 동승 선생님을 포함한 로그인 교직원 전체가 쓰는 화면이라(픽업/결석 토글과
-- 동일 정책), 로그인 사용자 전체에게 읽기/쓰기를 허용합니다.
drop policy if exists shuttle_persistent_notes_select on public.shuttle_persistent_notes;
create policy shuttle_persistent_notes_select on public.shuttle_persistent_notes
  for select using (auth.role() = 'authenticated');

drop policy if exists shuttle_persistent_notes_insert on public.shuttle_persistent_notes;
create policy shuttle_persistent_notes_insert on public.shuttle_persistent_notes
  for insert with check (auth.role() = 'authenticated');

drop policy if exists shuttle_persistent_notes_update on public.shuttle_persistent_notes;
create policy shuttle_persistent_notes_update on public.shuttle_persistent_notes
  for update using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

drop policy if exists shuttle_persistent_notes_delete on public.shuttle_persistent_notes;
create policy shuttle_persistent_notes_delete on public.shuttle_persistent_notes
  for delete using (auth.role() = 'authenticated');
