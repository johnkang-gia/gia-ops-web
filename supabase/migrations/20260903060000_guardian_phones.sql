-- ===== 보호자 연락처를 세 칸으로 =====
--
-- 지금은 학생 한 명에 연락처가 `parent_phone` 한 칸뿐입니다. 그런데 청구서를 보낼 때는
-- **누구에게 보낼지**가 실제로 갈립니다 - 어머니 번호로 받는 집, 아버지가 결제하는 집,
-- 부모가 아닌 분(조부모·친척)이 맡는 집이 다 있습니다. 한 칸에 하나만 담아두면 그때마다
-- 명부를 고쳐야 하고, 고치는 순간 다른 화면(출결 연락·셔틀)의 번호까지 함께 바뀝니다.
--
-- 그래서 칸을 셋으로 나눕니다.
--   · mother_phone  어머니 (M)
--   · father_phone  아버지 (F)
--   · parent_phone  보호자 - 부모가 아닌 분을 위한 자리. **이미 있는 칸을 그대로 씁니다.**
--
-- 기존 값을 어머니 칸으로 옮기지 않습니다. 지금 들어 있는 번호가 어머니 것인지 아버지 것인지
-- 아무도 확인해 주지 않았기 때문입니다. 추측으로 옮겨두면 그 뒤로는 틀린 줄도 모르고 씁니다.
-- 대신 청구 대상을 고를 때 **어머니 → 아버지 → 보호자** 순으로 있는 번호를 씁니다. 어머니
-- 칸을 채우기 전까지는 지금과 똑같이 동작하고, 채우는 대로 자동으로 어머니 번호로 넘어갑니다.

alter table public.wr_students add column if not exists mother_phone text;
alter table public.wr_students add column if not exists father_phone text;

comment on column public.wr_students.mother_phone is '어머니 연락처(M). 청구서는 이 번호를 우선으로 보냅니다.';
comment on column public.wr_students.father_phone is '아버지 연락처(F).';
comment on column public.wr_students.parent_phone is '보호자 연락처 - 부모가 아닌 분(조부모·친척 등)을 위한 자리. 어머니·아버지 칸이 비었을 때 청구서가 이 번호로 갑니다.';


-- ── 청구서에 "누구에게 보냈는지"를 남깁니다 ─────────────────────────────────
--
-- `guardian_phone`(번호)은 이미 굳혀 두고 있습니다. 그런데 번호만 남으면 나중에 그 번호가
-- 어머니 것이었는지 아버지 것이었는지 알 수 없습니다. 명부의 번호가 바뀌면 더더욱 알 수
-- 없습니다. 대사(맞춰보기)를 할 때 "이 집은 아버지 앞으로 보냈다"가 남아 있어야 합니다.
--
-- 값은 mother / father / guardian / manual 넷입니다. manual 은 명부에 없는 번호를 그 청구서
-- 한 건에만 손으로 적어 넣은 경우입니다.
alter table public.invoices add column if not exists guardian_role text;

alter table public.invoices drop constraint if exists invoices_guardian_role_check;
alter table public.invoices add constraint invoices_guardian_role_check
  check (guardian_role is null or guardian_role in ('mother', 'father', 'guardian', 'manual'));

comment on column public.invoices.guardian_role is
  '이 청구서를 어느 보호자 앞으로 보냈는지(mother/father/guardian/manual). 번호만으로는 나중에 알 수 없어 함께 남깁니다.';
