-- 학사일정 규칙: **어느 학기에 적용되나**
--
-- ── 무엇이 문제였나 ──────────────────────────────────────────────────
--
-- 규칙을 하나 만들면 **모든 학기**에 적용됐습니다. 그런데 정규학기와 캠프는 하는 일이
-- 전혀 다릅니다.
--
--   · 정규학기 — 반배정, 시간표, 교과서 준비, 학기 리포트
--   · 캠프     — 모집 공고, 신청서 마감, 반 편성, 캠프 안내문
--
-- 섞여 있으면 여름캠프가 시작될 때 「교과서 준비」가 업무보드에 올라오고, 정규학기에는
-- 「캠프 모집 공고」가 올라옵니다. 그런 업무는 사람이 매번 지워야 하는데, **지워야 하는
-- 업무가 몇 개 섞이면 사람은 목록 전체를 안 믿게 됩니다.**
--
-- ── 그래서 ───────────────────────────────────────────────────────────
--
-- 규칙마다 「어느 학기 종류에 적용되나」를 적습니다. 비어 있으면 지금까지처럼 모든
-- 학기입니다 - 이미 만들어 둔 규칙이 갑자기 안 도는 일이 없어야 합니다.

alter table public.academic_checklist_templates
  add column if not exists term_types text[];

comment on column public.academic_checklist_templates.term_types is
  '이 규칙이 적용되는 학기 종류(1학기·여름캠프1 등). 비어 있으면 모든 학기 - 예전에 만든 규칙이 그대로 돌도록 한 기본값입니다.';

-- 「이 학기에 걸리는 규칙」이 주 질의라 배열 인덱스를 답니다.
create index if not exists academic_checklist_templates_term_types_idx
  on public.academic_checklist_templates using gin (term_types);

-- ── 「며칠 전」뿐 아니라 「며칠 후」도 ────────────────────────────────
--
-- `offset_days` 는 **양수가 「전」**입니다(기준일에서 그만큼 빼기). 음수를 넣으면 「후」가
-- 되는데, 화면이 0 이상만 받게 막고 있어서 쓸 수가 없었습니다.
--
-- 학교 일은 앞뒤가 다 있습니다 - 「학기 시작 2주 전 안내문」도 있고 「학기 시작 1주 후
-- 적응 점검」, 「캠프 종료 3일 후 정산」도 있습니다. 뒤엣것을 못 적으면 사람은 그것만
-- 따로 기억하게 되고, 따로 기억하는 것은 빠집니다.
--
-- 계산은 이미 음수를 받으므로 데이터 쪽에 바꿀 것은 없습니다. 다만 터무니없는 값이
-- 들어오면 몇 해 뒤 날짜가 조용히 만들어지므로 범위만 잠급니다(앞뒤로 1년).
alter table public.academic_checklist_templates
  drop constraint if exists academic_checklist_templates_offset_range_ck;
alter table public.academic_checklist_templates
  add constraint academic_checklist_templates_offset_range_ck
  check (offset_days between -365 and 365);
