-- ===== 구글시트 수신 결과를 «읽을 수 있게» 남깁니다 =====
--
-- 스크립트는 성공했다는데 대기함이 비어 있는 일이 생겼습니다. 실제로는 성공이 맞을 수
-- 있습니다 - 시트의 모든 줄이 이미 명부와 같으면 대기함에 넣을 것이 없습니다. 문제는
-- **그 사실이 화면 어디에도 안 적혀 있다**는 것입니다. 「받은 줄 20, 대기함에 0」만 보고는
-- 「다 같아서 0인지, 못 읽어서 0인지」를 가릴 수 없습니다.
--
-- 그래서 무엇을 읽고 무엇으로 판단했는지를 그대로 남깁니다.

alter table public.roster_sync_links
  add column if not exists last_detail text,
  add column if not exists last_header text,
  add column if not exists last_columns text;

comment on column public.roster_sync_links.last_detail is
  '마지막 수신에서 무엇이 몇 줄이었나(새로 등록/바뀜/그대로/확인 필요). 대기함이 비어 있는 이유를 여기서 읽습니다.';
comment on column public.roster_sync_links.last_header is
  '마지막으로 받은 머리줄 그대로. 칸을 못 알아봤을 때 무엇이 왔는지 봐야 고칠 수 있습니다.';
comment on column public.roster_sync_links.last_columns is
  '머리줄에서 알아본 칸. 이름 칸이 없으면 한 줄도 못 들어옵니다.';
