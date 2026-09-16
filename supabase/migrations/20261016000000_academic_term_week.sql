-- 학사일정 규칙: **학기 시작 후 몇 주차 무슨 요일**
--
-- ── 무엇이 문제였나 ──────────────────────────────────────────────────
--
-- 매 학기 되풀이되는 일정은 「학기 시작일 기준 며칠 전·후」로만 적을 수 있었습니다. 그래서
-- 학기 **한가운데** 있는 일은 적을 자리가 마땅치 않았습니다 - 크리스마스 콘서트 준비는
-- 학기 시작에서 백 며칠 뒤인데, 그 숫자를 사람이 세어 넣어야 했습니다.
--
-- 날짜로 적어두면 해마다 어긋납니다. 「12월 18일」은 올해 학기 16주차 금요일인데, 내년에
-- 학기 시작이 한 주 밀리면 15주차가 됩니다. **준비 기간이 한 주 짧아진 것인데 달력에는 그
-- 사실이 안 보입니다** - 날짜는 그대로 있으니 아무도 이상하다고 느끼지 않고, 준비가 모자란
-- 채로 그날이 옵니다.
--
-- 학교 일은 학기 안에서의 자리로 굴러갑니다. 「학기 3주차 월요일에 준비 시작」이라고
-- 적어두면 시작일이 언제로 바뀌든 같은 흐름이 나옵니다.
--
-- ── 정규와 캠프를 먼저 가릅니다 ──────────────────────────────────────
--
-- 정규학기는 스무 주, 캠프는 서너 주입니다. 주차를 섞어 쓰면 캠프에 「12주차」 일정이
-- 생기는데, 그 날짜는 캠프가 끝난 뒤입니다 - 달력에는 뜨지만 아무도 못 하는 일입니다.
-- 어느 갈래의 주차인지를 함께 적고, 화면이 그 갈래의 학기에만 겁니다.
--
-- ── 기존 규칙은 그대로 돕니다 ────────────────────────────────────────
--
-- `week_no` 가 비어 있으면 예전처럼 anchor + offset_days 로 계산합니다. 새 칸이 생겼다고
-- 이미 만들어 둔 규칙의 날짜가 바뀌면, 그건 고친 적 없는 일정이 혼자 움직인 것입니다.

alter table public.academic_checklist_templates
  add column if not exists week_no integer,
  add column if not exists week_dow integer,
  add column if not exists term_kind text;

comment on column public.academic_checklist_templates.week_no is
  '학기 시작 주가 1주차. 채워져 있으면 anchor·offset_days 대신 이 값으로 날짜를 정합니다.';
comment on column public.academic_checklist_templates.week_dow is
  '0=일 … 6=토. 비어 있으면 그 주 월요일 - 안 적었다고 날짜를 비우면 그 일정은 달력에 안 뜨고, 안 뜨는 일은 아무도 못 합니다.';
comment on column public.academic_checklist_templates.term_kind is
  '정규 | 캠프. 주차의 길이가 다르므로 섞어 쓰지 않습니다. 비어 있으면 term_types 가 정합니다.';

-- 터무니없는 값이 들어오면 몇 해 뒤 날짜가 조용히 만들어집니다. 한 해를 넘지 않게 잠급니다.
alter table public.academic_checklist_templates
  drop constraint if exists academic_checklist_templates_week_no_ck;
alter table public.academic_checklist_templates
  add constraint academic_checklist_templates_week_no_ck
  check (week_no is null or week_no between 1 and 53);

alter table public.academic_checklist_templates
  drop constraint if exists academic_checklist_templates_week_dow_ck;
alter table public.academic_checklist_templates
  add constraint academic_checklist_templates_week_dow_ck
  check (week_dow is null or week_dow between 0 and 6);

alter table public.academic_checklist_templates
  drop constraint if exists academic_checklist_templates_term_kind_ck;
alter table public.academic_checklist_templates
  add constraint academic_checklist_templates_term_kind_ck
  check (term_kind is null or term_kind in ('정규', '캠프'));
