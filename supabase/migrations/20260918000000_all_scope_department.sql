-- 「전체」 소속 — 부서가 나뉘지 않는 사람의 자리
--
-- ── 무엇이 문제였나 ─────────────────────────────────────────────────────────
--
-- 최고관리자는 초등부·중고등부를 모두 맡습니다. 그런데 소속은 한 곳만 고를 수 있었습니다.
-- 한 곳을 고르면 나머지 부서 화면에서 안 보이고, 비워두면 **부서로 거르는 화면 전부에서
-- 사라집니다** - 교직원 목록에도, 부서 업무에도 안 뜹니다. 오류가 아니라 빈 자리라 아무도
-- 이상하게 여기지 않습니다.
--
-- ── 그래서 ───────────────────────────────────────────────────────────────────
--
-- 「전체」를 소속의 한 갈래로 둡니다. 값이 있으니 화면이 안 깨지고, 부서로 거를 때는 모든
-- 부서에 함께 나옵니다(코드의 `inDepartment()` 한 곳에서 판정합니다).
--
-- ── 순서가 중요합니다 ───────────────────────────────────────────────────────
--
-- 처음에는 이 파일이 값을 넣기만 하고, 검사(check)를 고치는 일은 **다음 파일**에 있었습니다.
-- 그래서 이 파일이 「전체」를 넣는 순간 아직 세 부서만 허용하는 검사에 걸려 멈췄고,
--
--   new row for relation "app_users" violates check constraint "app_users_department_check"
--
-- 다음 파일은 아예 실행되지 않았습니다. **자기가 넣을 값을 허용하지 않는 검사를 남겨둔 채로
-- 값을 넣으면 안 됩니다** - 뒤 파일이 고쳐줄 것이라고 기대할 수 없습니다. 실패한 파일에서
-- 줄이 멈추기 때문입니다.

-- ── ① 소속 목록에 「전체」 ──────────────────────────────────────────────────
insert into public.departments (name, color, sort_order)
select '전체', '#64748b', 0
where not exists (select 1 from public.departments where name = '전체');

-- ── ② 표의 검사에도 「전체」 ────────────────────────────────────────────────
--
-- 검사 이름이 환경마다 다를 수 있습니다. 이름을 찍어 지우면 이름이 다른 곳에서는 조용히
-- 아무 일도 안 일어나고, 같은 오류가 다음 배포에서 다시 납니다. 그래서 **표에 걸린 검사를
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

-- ── ③ 이미 최고관리자인 사람의 소속 맞추기 ─────────────────────────────────
--
-- 앞으로는 직위를 올리는 그 자리에서 같이 바뀌므로(`scopeForPosition`), 이 일은 한 번만 합니다.
update public.app_users
   set department = '전체'
 where position in ('최고관리자', '개발자')
   and (department is null or department <> '전체');
