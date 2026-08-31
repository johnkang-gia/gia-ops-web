-- 학사일정 자동화 (요청 ④⑤⑥)
--
-- 지금 있는 것: 템플릿(anchor = 학기 시작/종료, offset_days = 며칠 전)으로 학기마다 항목을
-- 하루짜리 마감일 하나로 만들어줍니다. 담당자 요청 중 "학기 기준 몇 주 전"은 **이미**
-- 돌아가고 있습니다.
--
-- 없던 것 세 가지를 더합니다.
--   ④ **기간** - 지금은 마감일 하루뿐입니다. "3월 2일~3월 13일 반배정"처럼 걸쳐 있는 일을
--      하루로 적으면, 시작한 날부터 챙겨야 하는데 마지막 날에야 눈에 띕니다.
--   ⑤ **회의** - 담당자: "적어도 2주에 걸쳐 2번의 회의(주당 1번, 그 한 주 동안 일을 맡아
--      처리하고 다시 모여 처리한 일과 결정한 일에 대해 회의)". 회의는 일정의 곁가지가
--      아니라 그 일이 굴러가는 방식 자체라, 일정에 딸린 줄로 만들어 둡니다.
--   ⑥ **반복 여부** - 매 학기 되풀이되는 일인지 표시해두면, 학기준비 화면에서 "이 일은
--      지난 학기에 언제 했고 제때 끝났나"를 학기끼리 견줄 수 있습니다.
--
-- 그리고 ④⑤ 모두 **업무보드에 저절로 올라가야** 뜻이 있습니다. 달력에만 적혀 있으면
-- 달력을 열어본 사람만 압니다.

-- ── 템플릿(규칙) ────────────────────────────────────────────────
alter table public.academic_checklist_templates
  -- 기간. 0이면 하루짜리(지금까지와 같음). 종료일 = 시작일 + duration_days.
  add column if not exists duration_days integer not null default 0,
  -- 회의가 필요한 일인가. 켜면 항목이 만들어질 때 회의 줄도 함께 생깁니다.
  add column if not exists needs_meeting boolean not null default false,
  -- 몇 번 모일지. 담당자 기준 최소 2번.
  add column if not exists meeting_count integer not null default 2,
  -- 회의 간격(일). 주당 1번이 기본이라 7.
  add column if not exists meeting_interval_days integer not null default 7,
  -- 업무보드에 저절로 올릴지.
  add column if not exists auto_task boolean not null default true,
  -- 마감 며칠 전에 업무로 올릴지. 너무 일찍 올리면 보드가 먼 일로 가득 차고,
  -- 너무 늦게 올리면 올라온 순간 이미 늦습니다.
  add column if not exists task_lead_days integer not null default 7,
  -- 매 학기 되풀이되는 일인가(학기준비 분석용).
  add column if not exists recurring boolean not null default true;

alter table public.academic_checklist_templates
  drop constraint if exists academic_checklist_templates_meeting_count_ck;
alter table public.academic_checklist_templates
  add constraint academic_checklist_templates_meeting_count_ck
  check (meeting_count between 1 and 12);

-- ── 항목(그 학기의 실제 발생 건) ─────────────────────────────────
alter table public.academic_checklist_items
  -- 기간의 끝. null이면 due_date 하루짜리입니다(기존 데이터가 전부 여기 해당).
  add column if not exists end_date date,
  -- 업무보드에 올라간 업무. 한 번 올리면 다시 안 올리기 위한 표시이기도 합니다.
  add column if not exists task_id uuid references public.tasks(id) on delete set null,
  add column if not exists task_created_at timestamptz;

create index if not exists academic_checklist_items_due_idx
  on public.academic_checklist_items (due_date);

-- ── 회의 ────────────────────────────────────────────────────────
-- 왜 별도 표인가: 회의는 각각 **자기 날짜와 자기 완료 여부**를 가집니다. 항목 한 줄에
-- 날짜 배열로 우겨넣으면 "2차 회의는 했고 3차는 안 했다"를 적을 데가 없습니다.
create table if not exists public.academic_checklist_meetings (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.academic_checklist_items(id) on delete cascade,
  term_id uuid references public.terms(id) on delete cascade,
  -- 1차, 2차… 사람이 부르는 순서 그대로.
  seq integer not null,
  meet_date date not null,
  title text,
  note text,
  done boolean not null default false,
  done_by text,
  done_at timestamptz,
  -- 이 회의가 업무보드에 올라간 업무.
  task_id uuid references public.tasks(id) on delete set null,
  task_created_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (item_id, seq)
);

comment on table public.academic_checklist_meetings is
  '학사일정 항목에 딸린 회의. 한 주씩 나눠 맡고 다시 모여 결정하는 방식을 일정에 새겨둡니다.';

create index if not exists academic_checklist_meetings_date_idx
  on public.academic_checklist_meetings (meet_date);

alter table public.academic_checklist_meetings enable row level security;

drop policy if exists academic_checklist_meetings_all on public.academic_checklist_meetings;
create policy academic_checklist_meetings_all
  on public.academic_checklist_meetings
  for all
  using (true)
  with check (true);
