-- ===== 대출 기록의 주인을 둘 중 하나로 =====
--
-- 점검용 카드(GIA-9000-0001)로 실제로 빌려 보다가 막혔습니다:
--   null value in column "student_id" of relation "lib_loans" violates not-null constraint
--
-- ── 그 NOT NULL 은 실수가 아닙니다 ─────────────────────────────────────────
-- 20260827090000_lock_student_fk.sql 이 일부러 건 것입니다. "학생과 연결되지 않은 행은 저장
-- 자체가 안 되게" 해서, 주인을 잃은 기록이 생길 여지를 구조로 없앤 것입니다. 6년치 성장기록을
-- 남기는 것이 이 시스템의 목적이라 그 규칙은 맞습니다. **풀면 안 됩니다.**
--
-- ── 그래서 칸을 하나 더 둡니다 ─────────────────────────────────────────────
-- 지키려던 것은 "student_id 가 차 있어야 한다"가 아니라 **"모든 기록에 주인이 있어야 한다"**
-- 입니다. 주인이 될 수 있는 종류가 둘(학생 / 학생이 아닌 카드)로 늘었으니, 칸을 하나 더 두고
-- **둘 중 정확히 하나**만 차도록 검사를 겁니다. 규칙은 그대로 살아 있고, 주인 없는 기록은
-- 여전히 저장되지 않습니다.
--
-- 같은 저장소의 셔틀 표가 이미 같은 모양을 씁니다(20260827110000: student_id 가 비면 사유가
-- 반드시 있어야 함). 새로운 방식이 아니라 이 집의 방식입니다.

alter table public.lib_loans
  add column if not exists extra_card_id uuid references public.lib_extra_cards(id) on delete restrict;

comment on column public.lib_loans.extra_card_id is
  '학생이 아닌 도서카드(점검용·교직원)로 빌린 경우의 주인. student_id 와 둘 중 하나만 찹니다.';

-- 학생 쪽 칸을 비울 수 있게 합니다. 대신 아래 검사가 '둘 중 하나는 반드시'를 지킵니다.
alter table public.lib_loans alter column student_id drop not null;

alter table public.lib_loans drop constraint if exists lib_loans_owner_ck;
alter table public.lib_loans add constraint lib_loans_owner_ck check (
  (student_id is not null and extra_card_id is null)
  or (student_id is null and extra_card_id is not null)
);

create index if not exists lib_loans_extra_card_idx
  on public.lib_loans (extra_card_id) where extra_card_id is not null;

notify pgrst, 'reload schema';
