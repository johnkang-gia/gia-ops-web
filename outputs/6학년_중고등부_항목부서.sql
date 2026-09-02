-- ═══════════════════════════════════════════════════════════════════════════
-- 6학년을 중고등부로 + 학비외 항목 부서 나누기 — Supabase SQL Editor 붙여넣기용
--
-- 여러 번 실행해도 됩니다.
-- ═══════════════════════════════════════════════════════════════════════════

-- 6학년을 중고등부로, 그리고 학비외 항목을 부서별로
--
-- 이 학교는 6학년을 중고등부에서 운영합니다. 그동안은 학년 숫자만 보고 7학년부터 중고등부로
-- 나눠서, 6학년이 초등부로 묶여 있었습니다.

-- ── 1. 6학년 학생·반을 중고등부로 ──────────────────────────────────────
--
-- 학년 표기가 `6`, `6학년`, `G6` 으로 섞여 있어서 숫자만 뽑아 봅니다.
update public.wr_students
set department = '중고등부'
where coalesce(department, '') <> '중고등부'
  and nullif(regexp_replace(coalesce(grade, ''), '[^0-9]', '', 'g'), '')::int = 6;

update public.wr_classes
set department = '중고등부'
where coalesce(department, '') <> '중고등부'
  and nullif(regexp_replace(coalesce(grade, ''), '[^0-9]', '', 'g'), '')::int = 6;

-- ── 2. 학비외 항목에 부서 ──────────────────────────────────────────────
--
-- 초등과 중고등은 사는 교재가 아예 다릅니다. 한 목록에 섞어두면 인보이스 표의 열이 두 배로
-- 늘어나고, 중고등 교재가 초등 아이 줄에 붙을 수 있는 자리가 생깁니다.
--
-- 비워두면(`null`) **양쪽 모두**에 쓰는 항목입니다 - 교복처럼 학교 전체가 사는 것이 있습니다.
alter table public.fee_items add column if not exists department text
  check (department is null or department in ('초등부', '중고등부'));

comment on column public.fee_items.department is
  '이 항목을 쓰는 부서. 비어 있으면 초등·중고등 양쪽 모두에 씁니다(교복처럼 학교 전체가 사는 것).';

create index if not exists fee_items_department_idx on public.fee_items (department);

-- 지금까지 등록한 항목은 전부 초등부 것입니다(중고등부는 이제 시작합니다).
update public.fee_items set department = '초등부' where department is null;

insert into supabase_migrations.schema_migrations (version, name)
values ('20260902240000', 'grade6_secondary_and_fee_department')
on conflict (version) do nothing;

-- 확인 ①: 6학년이 전부 중고등부로 갔는지. 아래가 0줄이어야 합니다.
select name, grade, department
from public.wr_students
where nullif(regexp_replace(coalesce(grade, ''), '[^0-9]', '', 'g'), '')::int = 6
  and coalesce(department, '') <> '중고등부';

-- 확인 ②: 부서별 학생 수.
select coalesce(department, '(비어 있음)') as 부서, count(*) as 인원
from public.wr_students
where is_demo = false and status in ('active', '재학')
group by 1 order by 2 desc;

-- 확인 ③: 학비외 항목의 부서.
select coalesce(department, '공통') as 부서, count(*) as 항목수
from public.fee_items where active group by 1 order by 1;
