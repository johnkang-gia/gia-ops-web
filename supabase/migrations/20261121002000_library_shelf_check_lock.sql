-- 도서관 자리 등록 요약 뷰 잠그기
--
-- 20261121001500_library_shelf_check.sql 이 lib_shelf_check_summary 뷰를 잠그지 않은 채 먼저
-- 적용됐습니다. 뷰는 만든 사람의 권한으로 돌기 때문에 밑의 표(lib_shelf_check)가 is_lib_user()
-- 로 잠겨 있어도 뷰로는 그대로 읽히고, Supabase 는 public 뷰를 로그인 안 한 열쇠(anon)에도
-- 엽니다. 원래 파일에도 같은 두 줄을 넣었지만 이미 돈 마이그레이션은 다시 돌지 않으므로 여기서
-- 한 번 더 겁니다(두 번 돌려도 안전합니다).
alter view if exists public.lib_shelf_check_summary set (security_invoker = on);
revoke all on public.lib_shelf_check_summary from anon;

notify pgrst, 'reload schema';
