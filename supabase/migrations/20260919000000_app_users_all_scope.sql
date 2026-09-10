-- app_users 의 소속 검사에 「전체」를 넣습니다
--
-- ── 무엇이 문제였나 ─────────────────────────────────────────────────────────
--
-- 최고관리자에게 「전체」 소속을 주도록 코드를 고쳤는데, 표의 검사(check)에는 아직 세 부서만
-- 적혀 있었습니다. 그래서 직위를 최고관리자로 올리는 순간
--
--   new row for relation "app_users" violates check constraint "app_users_department_check"
--
-- 로 막혔습니다. **코드와 표가 서로 다른 목록을 들고 있었던 것**입니다 - 코드만 고치고 표를
-- 안 고치면 이렇게 됩니다.
--
-- ── 왜 이름을 확인하고 지우나 ───────────────────────────────────────────────
--
-- 검사 이름이 환경마다 다를 수 있습니다. 이름을 찍어 지우면 이름이 다른 곳에서는 조용히
-- 아무 일도 안 일어나고, 다음 배포에서 같은 오류가 다시 납니다. 그래서 **표에 걸린 검사를
-- 찾아서** 지웁니다.

do $$
declare
  c record;
begin
  for c in
    select conname
      from pg_constraint
     where conrelid = 'public.app_users'::regclass
       and contype = 'c'
       and pg_get_constraintdef(oid) ilike '%department%'
  loop
    execute format('alter table public.app_users drop constraint %I', c.conname);
  end loop;
end $$;

alter table public.app_users
  add constraint app_users_department_check
  check (department is null or department in ('전체', '유치부', '초등부', '중고등부'));
