-- 학사일정: 되풀이 방식과 「다른 일정 기준」
--
-- ── 지금까지 되던 것 ────────────────────────────────────────────────
--
-- 규칙(academic_checklist_templates)은 **학기 시작·종료일 기준 며칠 전**만 알았습니다.
-- 「학기 시작 2주 전 안내문」은 이미 잘 돌아갑니다.
--
-- ── 안 되던 것 두 가지 ──────────────────────────────────────────────
--
-- ① **학기 말고 다른 주기.** 매년 같은 날 하는 일(신입생 모집 공고), 매달 하는 일(월간
--    안전점검), 매주 하는 일(주간 회의)은 학기와 아무 상관이 없습니다. 그런 일들은
--    규칙에 적을 자리가 없어서 결국 사람이 매번 손으로 업무를 만들었고, 손으로 만드는
--    일은 바쁜 주에 빠집니다. **빠져도 아무 표시가 안 납니다.**
--
-- ② **다른 학사일정을 기준으로.** 학교 일은 사슬로 엮여 있습니다 - 「반배정 2주 전에
--    학생명단 확정」처럼요. 기준을 학기 시작으로만 적으면, 반배정 날짜가 밀렸을 때
--    앞의 일정은 옛 날짜에 그대로 남습니다. 사람은 두 날짜를 다 기억하지 못합니다.

alter table public.academic_checklist_templates
  -- 되풀이 방식. 'term'(지금까지의 동작) · 'year' · 'month' · 'week'.
  add column if not exists repeat_kind text not null default 'term',
  -- 매년: 몇 월. 매달·매주에서는 비어 있습니다.
  add column if not exists repeat_month integer,
  -- 매년·매달: 며칠. 그 달에 없는 날(2월 31일)이면 **그 달의 마지막 날**로 당깁니다.
  -- 건너뛰지 않는 이유: 건너뛰면 그 달만 일이 사라지는데, 사라진 것은 아무도 못 봅니다.
  add column if not exists repeat_day integer,
  -- 매주: 요일(0=일 … 6=토).
  add column if not exists repeat_dow integer,
  -- **다른 규칙을 기준으로.** 이 값이 있으면 anchor(학기 시작·종료) 대신 그 규칙이
  -- 이번 학기에 만든 항목의 날짜에서 offset_days 만큼 앞으로 잡습니다.
  add column if not exists anchor_template_id uuid references public.academic_checklist_templates(id) on delete set null;

comment on column public.academic_checklist_templates.repeat_kind is
  '되풀이 방식: term(학기 기준) · year(매년) · month(매달) · week(매주).';
comment on column public.academic_checklist_templates.anchor_template_id is
  '기준이 되는 다른 학사일정 규칙. 그 일정이 밀리면 이 일정도 함께 밀립니다 - 사람이 두 날짜를 따로 기억하지 않아도 되도록.';

alter table public.academic_checklist_templates
  drop constraint if exists academic_checklist_templates_repeat_kind_ck;
alter table public.academic_checklist_templates
  add constraint academic_checklist_templates_repeat_kind_ck
  check (repeat_kind in ('term', 'year', 'month', 'week'));

-- 자기 자신을 기준으로 삼으면 날짜를 영원히 못 정합니다. 한 단계짜리 고리는 여기서 막고,
-- 여러 단계로 도는 고리는 계산하는 쪽(academicRepeat.ts)이 끊습니다.
alter table public.academic_checklist_templates
  drop constraint if exists academic_checklist_templates_anchor_self_ck;
alter table public.academic_checklist_templates
  add constraint academic_checklist_templates_anchor_self_ck
  check (anchor_template_id is null or anchor_template_id <> id);

-- ── 항목: 되풀이가 만든 여러 건을 구분 ──────────────────────────────
--
-- 지금은 unique(template_id, term_id) 라 **한 학기에 한 건**만 만들어집니다. 매주·매달
-- 되풀이는 한 학기에 여러 건이 나와야 하므로, 그 건이 「몇 번째 회차인가」를 함께 적습니다.
alter table public.academic_checklist_items
  add column if not exists occurrence_key text;

comment on column public.academic_checklist_items.occurrence_key is
  '되풀이 회차 열쇠(대개 그 회차의 날짜). 같은 규칙이 한 학기에 여러 번 나올 때 중복 생성을 막습니다.';

-- 옛 유일 제약은 한 학기 한 건을 강제합니다. 회차까지 넣은 것으로 바꿉니다.
-- occurrence_key 가 비어 있는 옛 줄은 coalesce 로 빈 문자열이 되어 지금과 똑같이 동작합니다.
--
-- 이 표는 마이그레이션 자동화가 생기기 전에 만들어져서 제약 **이름을 알 수 없습니다.**
-- 이름을 찍어 지우면 이름이 다를 때 조용히 아무 일도 안 일어나고, 그러면 매주 되풀이는
-- 두 번째 회차부터 23505 로 막힙니다 - 화면에는 「등록됨」으로 보이는 채로요.
-- 그래서 이름이 아니라 **모양(template_id, term_id 두 칸짜리 유일 제약)**으로 찾아 지웁니다.
do $$
declare
  c record;
begin
  for c in
    select con.conname
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace ns on ns.oid = rel.relnamespace
    where ns.nspname = 'public'
      and rel.relname = 'academic_checklist_items'
      and con.contype = 'u'
      and array_length(con.conkey, 1) = 2
      -- **`::text` 캐스팅이 없으면 여기서 통째로 멈춥니다.**
      --
      -- `attname` 은 `name` 타입이라 `array_agg` 결과가 `name[]` 이고, 오른쪽
      -- `array['template_id','term_id']` 는 `text[]` 입니다. 포스트그레스에는 그 둘을 견주는
      -- 연산자가 없어서 `operator does not exist: name[] = text[]` 로 실패합니다.
      --
      -- 이 한 줄 때문에 마이그레이션이 **일곱 판(#134~#140) 연속으로 실패**했고, 그 뒤에 줄
      -- 서 있던 재무 자물쇠·백업·학사일정·하원수단이 하나도 반영되지 않았습니다. 앞의 파일이
      -- 막히면 뒤는 시도조차 안 되기 때문입니다.
      and (
        select array_agg(att.attname::text order by att.attname::text)
        from unnest(con.conkey) k
        join pg_attribute att on att.attrelid = con.conrelid and att.attnum = k
      ) = array['template_id', 'term_id']
  loop
    execute format('alter table public.academic_checklist_items drop constraint %I', c.conname);
  end loop;
end $$;

create unique index if not exists academic_checklist_items_template_term_occ_idx
  on public.academic_checklist_items (template_id, term_id, coalesce(occurrence_key, ''))
  where template_id is not null;
