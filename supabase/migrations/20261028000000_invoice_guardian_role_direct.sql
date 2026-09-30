-- 청구서 발행이 실패하고 있었습니다 — `guardian_role` 에 `direct` 가 없습니다.
--
-- ── 무엇이 문제였나 ──────────────────────────────────────────────────
--
-- 같은 뜻의 값 목록이 **두 표에 따로** 적혀 있었고, 한쪽만 넓혀졌습니다.
--
--   · wr_students.billing_phone_role  (2026-09-26) — mother · father · guardian · **direct**
--   · invoices.guardian_role          (2026-09-03) — mother · father · guardian · manual
--
-- 「결제번호」 기능(`direct` — 명부 세 칸 중 아무도 아닌 번호를 따로 등록)을 2026-09-26 에
-- 넣으면서 **학생 쪽 제약만 넓히고 청구서 쪽을 잊었습니다.**
--
-- 그래서 결제번호를 `direct` 로 정해 둔 학생에게 청구서를 발행하면 데이터베이스가 거부합니다.
--
--   new row for relation "invoices" violates check constraint "invoices_guardian_role_check"
--
-- 화면에는 「0장 기록 · 1장 실패」로 뜹니다. 개발자 오류 기록에 2026-09-21 ~ 10-01 사이
-- 열두 번 남아 있었습니다 — **그 학생들은 그동안 청구서가 안 나갔습니다.**
--
-- ── 무엇을 하나 ──────────────────────────────────────────────────────
--
-- 청구서 쪽 제약에 `direct` 를 넣습니다. `manual` 은 그대로 둡니다 - 올톡페이 발송에서
-- 사람이 번호를 직접 고친 건을 가리키는 값이고, 학생 명부에는 없는 개념입니다.
--
-- **목록이 또 어긋나지 않게** `check-role-values.mjs` 를 빌드 게이트에 붙였습니다. 코드의
-- `GuardianRole` 에 값을 더하면 두 제약에 모두 들어 있어야 통과합니다.

alter table public.invoices drop constraint if exists invoices_guardian_role_check;
alter table public.invoices add constraint invoices_guardian_role_check
  check (guardian_role is null or guardian_role in ('mother', 'father', 'guardian', 'direct', 'manual'));

comment on column public.invoices.guardian_role is
  '이 청구서를 어느 번호 앞으로 보냈는지. mother/father/guardian 은 명부의 그 칸, direct 는 학생별 결제번호, manual 은 발송할 때 사람이 직접 적은 번호. 번호만으로는 나중에 알 수 없어 함께 남깁니다.';

-- rls-ok: 이 파일은 표를 만들지 않습니다. 이미 있는 제약만 넓힙니다.
