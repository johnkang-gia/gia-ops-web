-- 청구서 「미납 확인」 도장
--
-- 올톡페이로 보낸 뒤 학부모가 읽고도 결제하지 않는 장이 있습니다. 앱은 올톡 안을 볼 수 없고, 매번 대조 파일을
-- 받아 올리는 것도 일이라, 사람이 청구 회차 화면에서 장마다 «✓ 결제됨 / 미납»을 누르게 합니다.
--   · ✓ 결제됨 → 입금 한 줄(올톡페이)이 붙어 완납으로 계산됩니다. 따로 적는 칸이 없습니다.
--   · 미납     → 이 두 칸에 «누가 언제 확인했나»만 남깁니다. 상태가 아닙니다 - 미납은 잔액에서 계산합니다(§2-12).
--               나중에 입금이 붙으면 이 도장은 그대로 남되 화면에서 의미를 잃습니다(완납이 이깁니다).
-- 도장이 없는 장이 «아직 안 본 장»이라, 회차 화면이 「미확인 N장」을 셀 수 있습니다.
alter table public.invoices add column if not exists unpaid_checked_at timestamptz;
alter table public.invoices add column if not exists unpaid_checked_by text;
comment on column public.invoices.unpaid_checked_at is '사람이 «미납»으로 확인한 시각. 상태가 아니라 확인 기록. 비어 있으면 아직 안 본 장.';
comment on column public.invoices.unpaid_checked_by is '미납으로 확인한 사람(메일).';
