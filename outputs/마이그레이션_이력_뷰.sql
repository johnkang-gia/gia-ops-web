-- ═══════════════════════════════════════════════════════════════════════════
-- 마이그레이션 실행 이력 보기 — Supabase SQL Editor 붙여넣기용
--
-- 진단 화면 ⑧ 마이그레이션 칸이 아직 "아직 볼 수 없습니다"로 뜹니다. 폴더의 파일과 DB에
-- 실제로 실행된 기록을 대조하려면 이 뷰가 필요합니다.
--
--   supabase/migrations/20260830120000_applied_migrations_view.sql
--
-- 여는 것은 실행된 버전 번호와 이름뿐입니다. SQL 본문은 넣지 않습니다.
-- ═══════════════════════════════════════════════════════════════════════════

begin;

-- 어떤 마이그레이션이 실제로 돌았는지 앱에서 볼 수 있게 합니다.
--
-- 이번 주에 `column a.choice_group does not exist` 오류를 겪었습니다. 원인은 단순합니다 -
-- **무엇이 돌았고 무엇이 안 돌았는지 아무도 몰랐습니다.** 파일은 폴더에 있고, 실행 기록은
-- Supabase 안쪽(supabase_migrations 스키마)에 있어서, 둘을 맞춰보려면 매번 사람이
-- SQL을 쳐야 했습니다.
--
-- 이 뷰 하나면 진단 화면이 "파일은 55개인데 DB에는 53개만 있다"고 바로 말해줍니다.
--
-- 여는 것은 **실행된 버전 번호와 이름뿐**입니다. SQL 본문(statements)은 넣지 않습니다.
-- 스키마 변경 내역 전체를 웹에 노출할 이유가 없습니다.

create or replace view public.applied_migrations as
select
  m.version,
  m.name
from supabase_migrations.schema_migrations m
where is_giamicro_user();

revoke all on public.applied_migrations from anon;
grant select on public.applied_migrations to authenticated;

comment on view public.applied_migrations is
  '실제로 실행된 마이그레이션 목록(버전·이름만). 진단 화면이 파일 목록과 대조하는 데 씁니다.';

insert into supabase_migrations.schema_migrations (version, name)
values ('20260830120000', 'applied_migrations_view')
on conflict (version) do nothing;

commit;

-- 확인 — 실행된 마이그레이션 개수가 나오면 성공입니다.
select count(*) as 실행된_마이그레이션_수 from public.applied_migrations;
