-- **결제번호** — 이 아이의 청구서가 실제로 나갈 번호.
--
-- ── 무엇이 문제였나 ────────────────────────────────────────────────────────
--
-- 명부에는 번호가 셋 있습니다(어머니·아버지·보호자). 그런데 **결제를 하는 분**은 집마다
-- 다르고, 셋 중 아무도 아닌 경우도 있습니다 - 실제로 결제만 담당하는 분의 번호를 따로
-- 알려주시는 집이 있습니다.
--
-- 지금까지는 청구서를 **발행할 때마다** 셋 중 하나를 골랐습니다. 그래서 같은 아이의 청구서가
-- 이번 달은 어머니에게, 다음 달은 아버지에게 갔습니다. 어느 쪽도 틀린 값은 아니라서 화면에는
-- 오류로 보이지 않고, 학부모가 「저는 못 받았는데요」라고 말해야 드러납니다.
--
-- ── 어떻게 담나 ────────────────────────────────────────────────────────────
--
-- **번호를 베껴 두지 않고 「누구인가」를 저장합니다.**
--
-- 「어머니로 하겠다」를 고르면 `billing_phone_role = 'mother'` 만 남기고, 번호는 그때그때
-- 명부의 어머니 칸에서 읽습니다. 번호를 베껴 두면 어머니가 번호를 바꿨을 때 명부는 새 번호,
-- 결제번호는 옛 번호가 되는데 **둘 다 그럴듯해 보여서** 어느 쪽이 맞는지 알 수 없습니다.
--
-- 셋 중 아무도 아닌 번호를 새로 등록할 때만(`'direct'`) 번호 자체를 `billing_phone` 에
-- 적습니다. 그건 명부에 원본이 없으니 여기가 원본입니다.
--
-- 아직 안 정한 아이는 `billing_phone_role` 이 비어 있고, 지금까지처럼 어머니 → 아버지 →
-- 보호자 순으로 있는 번호를 씁니다. 「안 정함」과 「없음」을 구별하기 위해 기본값을 두지
-- 않습니다.

alter table public.wr_students add column if not exists billing_phone_role text;
alter table public.wr_students add column if not exists billing_phone text;

alter table public.wr_students drop constraint if exists wr_students_billing_phone_role_check;
alter table public.wr_students add constraint wr_students_billing_phone_role_check
  check (billing_phone_role is null or billing_phone_role in ('mother', 'father', 'guardian', 'direct'));

-- 「직접 등록」인데 번호가 비어 있으면 청구서가 그 아이만 조용히 안 나갑니다. 있을 수 없는
-- 짝이므로 데이터베이스가 막습니다 - 코드로만 막으면 화면 하나를 빠뜨렸을 때 드러나지
-- 않습니다.
alter table public.wr_students drop constraint if exists wr_students_billing_phone_pair_check;
alter table public.wr_students add constraint wr_students_billing_phone_pair_check
  check (billing_phone_role is distinct from 'direct' or coalesce(btrim(billing_phone), '') <> '');

comment on column public.wr_students.billing_phone_role is
  '결제번호를 누구 것으로 할지. mother/father/guardian 은 명부의 그 칸을 그때그때 읽고, direct 는 billing_phone 을 씁니다. 비어 있으면 아직 안 정한 것입니다.';
comment on column public.wr_students.billing_phone is
  '명부 세 칸 중 아무도 아닌 번호. billing_phone_role = ''direct'' 일 때만 뜻이 있습니다.';

-- rls-ok: wr_students 는 이미 RLS가 걸려 있습니다. 칸만 늘리는 마이그레이션이라 정책을 새로
-- 만들지 않습니다 - 여기서 정책을 다시 쓰면 기존 정책을 덮어써 오히려 구멍이 납니다.

-- 결제번호를 아직 안 정한 아이를 한눈에 봅니다. 「누구에게 보내는지 정해지지 않은 아이」는
-- 청구를 돌리기 전에 알아야 합니다 - 돌리고 나서 알면 이미 엉뚱한 분께 가 있습니다.
create or replace view public.students_without_billing_phone as
select
  s.id,
  s.name,
  s.grade,
  s.class_name,
  s.mother_phone,
  s.father_phone,
  s.parent_phone,
  -- 정하지 않았어도 쓸 번호가 하나라도 있으면 청구는 나갑니다. 급한 정도가 다릅니다.
  (coalesce(btrim(s.mother_phone), '') <> ''
   or coalesce(btrim(s.father_phone), '') <> ''
   or coalesce(btrim(s.parent_phone), '') <> '') as has_any_phone
from public.wr_students s
where s.status = 'active'
  and s.is_demo = false
  and s.billing_phone_role is null;

comment on view public.students_without_billing_phone is
  '결제번호를 아직 정하지 않은 재학생. has_any_phone 이 false 면 청구서가 아예 안 나갑니다.';
