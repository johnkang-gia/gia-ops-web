-- ===== 도서관이 운영앱의 학기를 읽을 수 있게 =====
--
-- 요청: "학생의 도서기록을 월별, 학기별, 년도별로 정리해서 부모님께 보낼 '도서기록'을 ... "
-- 그리고 "같은 데이터베이스를 사용하는 운영앱에 학기 등록이 되어 있어. 그 학기를 따라가면 돼."
--
-- ── 왜 그냥 못 읽는가 ──────────────────────────────────────────────────────
-- 학기는 운영앱의 terms 표에 있고, 그 표의 정책은 is_giamicro_user() 입니다. 도서관 가계정
-- (gia-library)은 운영앱의 모든 표에서 일부러 차단되어 있어서 terms 도 못 읽습니다.
--
-- ── 왜 정책을 더하지 않고 뷰를 두는가 ──────────────────────────────────────
-- terms 에는 학기마다 적어 둔 good / lack / suggest(잘된 점·부족한 점·제안) 자유 서술이 함께
-- 들어 있습니다. 도서관이 필요한 건 **학기 이름과 기간뿐**입니다. 정책을 더하면 칸을 가릴 수
-- 없어서 그 서술까지 다 열립니다. 그래서 필요한 칸만 담은 뷰를 둡니다.
--
-- ── 뷰의 권한을 못박습니다 ────────────────────────────────────────────────
-- 뷰는 기본적으로 **만든 사람의 권한으로** 돌기 때문에 밑의 표가 잠겨 있어도 뷰로는 읽힙니다.
-- 여기서는 그게 목적이지만, 그대로 두면 Supabase 가 public 뷰를 **로그인 안 한 열쇠(anon)
-- 에게도** 엽니다. 그래서 anon 에서 거두고 로그인한 사용자에게만 내줍니다.
-- (같은 실수를 lib_shelf_check_summary 에서 한 번 했습니다 - 20261121002000 참고.)

create or replace view public.lib_terms as
select
  t.id,
  t.term_type,
  t.year,
  t.start_date,
  t.end_date,
  t.status
from public.terms t
where t.start_date is not null
  and t.end_date is not null;

comment on view public.lib_terms is
  '도서관 앱이 읽는 학기 목록. 운영앱 terms 에서 이름과 기간만 추려 낸 것입니다(자유 서술은 뺍니다).';

revoke all on public.lib_terms from anon;
revoke all on public.lib_terms from public;
grant select on public.lib_terms to authenticated;

notify pgrst, 'reload schema';
