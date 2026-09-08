-- 시트 ID·시트 이름을 앱이 기억합니다
--
-- 스크립트를 다시 복사할 일이 생각보다 잦습니다 - 토큰을 재발급했을 때, 주소가 바뀌었을 때,
-- 스크립트가 고쳐졌을 때. 그때마다 담당자는 시트 주소를 열어 `/d/` 와 `/edit` 사이의 긴
-- 글자를 다시 찾아 붙여넣어야 했습니다. 한 글자만 틀려도 「그런 시트가 없습니다」로 끝나고,
-- 왜 틀렸는지는 화면에 안 보입니다.
--
-- 한 번 넣어두면 앱이 스크립트에 채워 줍니다. 옮겨 적는 일이 사라지면 옮겨 적다 틀리는 일도
-- 사라집니다.
--
-- 비밀값이 아닙니다. 시트 ID 는 주소에 그대로 들어 있고, 이걸 안다고 남이 시트를 볼 수
-- 있는 것도 아닙니다(구글 쪽 공유 권한이 따로 막습니다). 토큰과 달리 숨길 이유가 없습니다.

alter table public.roster_sync_links add column if not exists sheet_id text;
alter table public.roster_sync_links add column if not exists sheet_name text;

comment on column public.roster_sync_links.sheet_id is
  '구글시트 주소의 /d/ 와 /edit 사이 글자. 스크립트에 채워 넣는 용도.';
comment on column public.roster_sync_links.sheet_name is
  '시트 아래쪽 탭에 적힌 이름(예: Student List).';
