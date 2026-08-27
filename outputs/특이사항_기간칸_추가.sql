-- 지속 특이사항 표 + 기간 칸 (하나로 합친 판)
--
-- 앞서 드린 SQL이 "relation does not exist"로 실패했습니다. 표를 만드는 마이그레이션
-- (20260825120000)이 아직 안 돌아간 상태였고, 저는 그 표가 있다고 전제하고 칸만 더하려
-- 했습니다. 순서를 지켜야 하는 SQL을 나눠 드리면 결국 하나는 빠집니다 - 그래서 표를 만드는
-- 것부터 기간 칸까지 **한 파일**에 담았습니다. 이미 있는 것은 건너뜁니다.
--
-- ※ 표가 없었다는 건, 하원체크표 왼쪽의 '지속 특이사항' 위젯이 지금까지 한 번도 저장되지
--    않았다는 뜻이기도 합니다. 적어도 조용히 실패했을 겁니다.

-- ── ① 표 ─────────────────────────────────────────────────────────────────
create table if not exists public.shuttle_persistent_notes (
  id uuid primary key default gen_random_uuid(),
  term text not null default '정규학기',
  student_name text not null,
  student_id uuid null references public.wr_students(id) on delete set null,
  route_no text null,                 -- 동명이인 구분용(예: "4호"). 없으면 같은 이름 전체에 적용
  content text not null,              -- 담당자가 적은 원문
  effect_kind text not null default 'none',
  effect_days int[] not null default '{}',  -- skip_days용 (1=월 ... 5=금)
  active boolean not null default true,
  created_by text null,
  created_at timestamptz not null default now()
);

-- ── ② 기간 칸 ────────────────────────────────────────────────────────────
--
-- 담당자: "'~까지 픽업', '언제까지 결석' 문구가 나오면 특이사항에 올려서 그 기간 동안
--          반영되게 만들어야 해."
alter table public.shuttle_persistent_notes
  add column if not exists effect_from date,
  add column if not exists effect_to   date,
  add column if not exists request_id  uuid references public.pickup_requests(id) on delete set null;

comment on column public.shuttle_persistent_notes.effect_from is
  '적용 시작일. 비어 있으면 학기 내내.';
comment on column public.shuttle_persistent_notes.effect_to is
  '마지막 날(이 날 포함). 비어 있으면 끝나지 않습니다.';
comment on column public.shuttle_persistent_notes.effect_kind is
  'none=표시만 / skip_days=그 요일엔 안 탐 / no_shuttle=셔틀 안 탐 / pickup=그 기간 매일 픽업 / absent=그 기간 매일 결석';

-- ── ③ 값 제약 ────────────────────────────────────────────────────────────
-- 표를 새로 만들 때든 이미 있을 때든 같은 결과가 되도록, 지우고 다시 겁니다.
alter table public.shuttle_persistent_notes
  drop constraint if exists shuttle_persistent_notes_effect_kind_check;

alter table public.shuttle_persistent_notes
  add constraint shuttle_persistent_notes_effect_kind_check
  check (effect_kind in ('none', 'skip_days', 'no_shuttle', 'pickup', 'absent'));

-- ── ④ 인덱스 ─────────────────────────────────────────────────────────────
create index if not exists shuttle_persistent_notes_term_active_idx
  on public.shuttle_persistent_notes (term, active);

-- 매일 아침 크론이 "오늘 해당하는 것"만 꺼내갑니다.
create index if not exists shuttle_persistent_notes_period_idx
  on public.shuttle_persistent_notes (active, effect_kind, effect_from, effect_to);

-- ── ⑤ 접근 권한 ──────────────────────────────────────────────────────────
-- 하원 체크표는 동승 선생님을 포함한 로그인 교직원 전체가 쓰는 화면이라(픽업/결석 토글과
-- 같은 정책), 로그인 사용자 전체에게 읽기/쓰기를 허용합니다.
alter table public.shuttle_persistent_notes enable row level security;

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

-- ── 확인 ─────────────────────────────────────────────────────────────────
select column_name as "칸 이름", data_type as "형식"
  from information_schema.columns
 where table_schema = 'public' and table_name = 'shuttle_persistent_notes'
 order by ordinal_position;
