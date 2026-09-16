-- ═══════════════════════════════════════════════════════════════════════
-- 긴 준비 기간이 달력을 통째로 덮었습니다
-- ═══════════════════════════════════════════════════════════════════════
--
-- 「크리스마스 콘서트 준비」를 9월 7일~12월 18일로 넣으니, 그 사이 **모든 날**에 막대가
-- 그어졌습니다. 학사 일정은 대개 이렇게 길게 준비하므로, 일정이 몇 개만 늘어도 달력은
-- 막대로 가득 차고 정작 그날 무엇을 하는지는 안 보입니다.
--
-- ── 바꾸는 방향 ─────────────────────────────────────────────────────────
--
-- 긴 준비 기간은 **기간이 아니라 점들**입니다. 9월 7일부터 12월 18일까지 매일 무언가를
-- 하는 것이 아니라, 그 사이 **몇 번 모여서 정하고** 마지막에 행사를 합니다. 그래서:
--
--   · 행사 당일 → 달력에 **하루짜리 큰 칩**
--   · 준비 기간 → 달력에 **안 그림**. 회의·마일스톤 날짜에만 작은 점
--   · 진행 상황 → 달력 아래 한 줄로 「D-93 · 다음 회의 9/24」
--
-- 「행사 당일이 아직 미정」인 경우가 실제로 있습니다. 가짜 날짜를 넣으면 그 날짜가 확정처럼
-- 읽혀 준비가 그날로 굳습니다. 그래서 **날짜 없이 「12월 중」만** 적을 수 있게 둡니다.
alter table public.academic_checklist_items
  -- 이 줄이 무엇인가. '행사'는 당일이 주인공이고, 나머지는 지금까지와 같습니다.
  add column if not exists kind text not null default '일반',
  -- 행사 당일. **비어 있을 수 있습니다** - 아직 안 정한 것과 오늘인 것은 다릅니다.
  add column if not exists event_date date,
  -- 날짜를 못 정했을 때 사람이 적는 말. 「12월 중」·「기말 뒤」.
  add column if not exists event_when_note text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'academic_checklist_items_kind_ck') then
    alter table public.academic_checklist_items
      add constraint academic_checklist_items_kind_ck check (kind in ('일반', '행사'));
  end if;
end $$;

comment on column public.academic_checklist_items.kind is
  '행사면 당일(event_date)이 주인공이고 준비 기간은 달력에 막대로 그리지 않습니다.';
comment on column public.academic_checklist_items.event_date is
  '행사 당일. 비어 있으면 아직 안 정한 것입니다 - 가짜 날짜를 넣으면 확정처럼 읽힙니다.';

-- ── 누가 고쳤는가 ───────────────────────────────────────────────────────
--
-- 학사 일정은 **여러 사람이 함께** 준비합니다. 등록한 사람만 고칠 수 있으면 그 사람이
-- 자리에 없는 날 아무것도 못 고치고, 결국 옆에 새 줄을 하나 더 만듭니다 - 그러면 같은
-- 일이 두 줄이 되어 어느 쪽이 맞는지 아무도 모릅니다.
--
-- 그래서 **누구나 고칠 수 있게** 하되, 고친 내력을 남깁니다. 잠그는 대신 보이게 하는
-- 쪽이 학교 일에 맞습니다 - 되돌릴 수 있고, 물어볼 사람을 알 수 있습니다.
create table if not exists public.academic_item_log (
  id uuid primary key default gen_random_uuid(),
  item_id uuid references public.academic_checklist_items(id) on delete cascade,
  -- 줄이 지워져도 무엇이었는지는 남습니다.
  item_title text not null,
  action text not null,                       -- '고침' '완료' '되돌림' '지움'
  -- 무엇이 무엇으로. 화면이 그대로 읽어 「제목: A → B」로 적습니다.
  changes jsonb,
  changed_by text not null,
  changed_by_name text,
  changed_at timestamptz not null default now()
);

create index if not exists academic_item_log_item_idx
  on public.academic_item_log (item_id, changed_at desc);

comment on table public.academic_item_log is
  '학사일정을 누가 언제 무엇으로 고쳤는지. 누구나 고칠 수 있게 하는 대신 내력을 남깁니다.';

-- 로그는 학사 일정을 보는 사람이면 읽고 쓸 수 있습니다. 항목 표와 같은 범위입니다.
alter table public.academic_item_log enable row level security;
drop policy if exists academic_item_log_rw on public.academic_item_log;
create policy academic_item_log_rw on public.academic_item_log
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
