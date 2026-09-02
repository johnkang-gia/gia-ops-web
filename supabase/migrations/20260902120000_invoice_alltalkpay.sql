-- 인보이스 → 올톡페이 청구 연결에 필요한 칸
--
-- 올톡페이는 **엑셀 대량 업로드**로 청구서를 보냅니다(공개 API가 없습니다). 그래서 우리가
-- 할 수 있는 것은 "보낼 파일을 정확히 만들어 주는 것"과 "이미 보낸 것을 두 번 안 보내게
-- 막는 것" 두 가지입니다.
--
-- 두 번 보내는 것이 실제 위험입니다. 엑셀은 올려도 아무 표시가 남지 않아서, 다음 사람이
-- 같은 명단을 다시 올리면 학부모에게 청구서가 두 번 갑니다.

-- 발행 시점의 보호자 연락처를 굳혀 둡니다. 명부의 번호가 나중에 바뀌어도, 그때 어느 번호로
-- 청구했는지가 남아야 대사(맞춰보기)가 됩니다.
alter table public.invoices add column if not exists guardian_phone text;

-- 올톡페이용 파일로 내보낸 시각과 묶음 이름. 값이 있으면 화면에서 '보냄'으로 표시하고
-- 다시 내보낼 때 경고합니다.
alter table public.invoices add column if not exists exported_at timestamptz;
alter table public.invoices add column if not exists export_batch text;

comment on column public.invoices.exported_at is
  '올톡페이 대량발송 엑셀로 내보낸 시각. 같은 청구서를 두 번 올려 학부모에게 두 번 가는 것을 막습니다.';

create index if not exists invoices_exported_at_idx on public.invoices (exported_at);
