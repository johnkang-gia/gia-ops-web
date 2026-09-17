-- 뷰가 RLS를 통째로 지나가고 있었습니다 — **로그인 없이 학부모 연락처 138명이 읽혔습니다.**
--
-- ── 무엇이 문제였나 ──────────────────────────────────────────────────
--
-- 표에는 자물쇠를 채웠습니다(20260913700000_finance_rls). 그런데 **그 표 위에 얹은 뷰에는
-- 채우지 않았습니다.**
--
-- 포스트그레스에서 뷰는 기본적으로 **뷰를 만든 사람의 권한으로** 돕니다. 즉 뷰를 읽는
-- 사람이 밑에 깔린 표를 읽을 수 있는지 **묻지 않습니다.** 그래서 `wr_students` 는 잠겨
-- 있는데 `students_without_billing_phone` 은 열려 있었습니다. 같은 자료인데 한쪽 문만
-- 잠근 셈입니다.
--
-- 게다가 Supabase 는 public 스키마의 뷰를 `anon`(로그인 안 한 사람)에게도 읽게 열어 둡니다.
-- 공개 키는 앱 화면 안에 들어 있으므로 **주소만 알면 누구나** 받아갈 수 있었습니다.
--
-- 실제로 확인된 것:
--
--   · students_without_billing_phone — 재학생 138명의 이름·학년·반 + 어머니·아버지·보호자
--     전화번호. 가장 나쁩니다
--   · students_without_class        — 학생 36명의 이름·학년·반
--   · student_siblings              — 형제 관계 20쌍(양쪽 이름·학년·반)
--   · prepaid_balances              — 학생 이름·학년·반 + 남은 금액
--   · finance_monthly               — 월별 청구·수납 합계
--   · finance_item_monthly          — 항목별 청구·수납 합계
--   · finance_key_holders           — 재무 열쇠를 가진 직원의 메일·이름·직위
--   · payment_import_progress       — 올린 사람 메일·파일 이름·승인 금액
--   · toddle_channels_unlinked      — 연결 안 된 채널 이름
--
-- 몇몇 뷰(`wr_students_basic`, `demo_isolation_check`, `term_archive`,
-- `applied_migrations`)는 만들 때 `revoke ... from anon` 을 적어 두어 막혀 있었습니다.
-- **규칙은 있었고 적는 것을 잊은 자리가 더 많았습니다** - 기억으로 지키던 것이라 그렇습니다.
--
-- ── 이 마이그레이션이 하는 일 ────────────────────────────────────────
--
-- 뷰 하나씩 적지 않고 **public 의 뷰 전부**를 훑습니다. 이름을 손으로 적으면 다음에 만드는
-- 뷰가 또 빠지고, 빠진 것은 오류로 안 보입니다.
--
--   ① `security_invoker = on` — 뷰가 **읽는 사람의 권한으로** 돌게 합니다. 이제 밑에 깔린
--      표의 RLS가 그대로 적용됩니다. 재무 뷰는 재무 열쇠가 있어야 보이고, 없으면 빈 목록이
--      옵니다. 서버(크론·API)는 서비스 키로 돌아 그대로 동작합니다.
--   ② `revoke all from anon` — 로그인 안 한 사람은 아예 못 붙습니다. ①만으로도 막히지만,
--      **자물쇠는 두 개를 겁니다.** 나중에 누가 표의 정책을 느슨하게 바꾸면 ①은 같이
--      느슨해지는데, ②는 그것과 상관없이 남습니다.
--
-- 읽어야 하는 쪽은 그대로입니다 - 재무 월별 화면(`finance_item_monthly`)은 재무 열쇠가
-- 있는 사람만 여는 화면이고, 진단 화면의 점검 뷰들은 개발자만 엽니다.

do $$
declare
  v record;
begin
  for v in
    select schemaname, viewname
      from pg_views
     where schemaname = 'public'
  loop
    -- 읽는 사람의 권한으로 돌게 합니다. 이미 켜져 있어도 다시 켜는 것은 안전합니다.
    execute format('alter view public.%I set (security_invoker = on)', v.viewname);
    -- 로그인 안 한 사람은 아예 못 붙습니다.
    execute format('revoke all on public.%I from anon', v.viewname);
  end loop;
end $$;

-- ── 앞으로 만들 뷰도 자동으로 ────────────────────────────────────────
--
-- 기본 권한을 바꿔, 앞으로 만드는 뷰·표에도 `anon` 이 붙지 않게 합니다. 이것을 안 걸어두면
-- 다음에 만든 뷰가 또 열린 채로 몇 주를 돕니다 - 이번 일이 정확히 그렇게 났습니다.
--
-- 이미 있는 것에는 영향이 없고(위에서 이미 훑었습니다), 새로 만드는 것에만 적용됩니다.
alter default privileges in schema public revoke all on tables from anon;

-- rls-ok: 이 파일은 표를 만들지 않습니다. 이미 있는 뷰의 권한만 좁힙니다.
