-- ===== 구글챗 멘션을 좌표로 저장합니다 =====
--
-- 지금까지 멘션은 **글자로 추측**했습니다. `@` 뒤에 오는 대문자 낱말을 한두 개 집어 교직원
-- 명단과 맞춰보고, 안 맞으면 두 낱말까지 지우는 식입니다. 그 추측이 두 방향으로 틀립니다.
--
--   · 명단에 없는 새 선생님을 부르면 성함 일부가 본문에 남아 학생 이름처럼 읽힙니다.
--   · 멘션 바로 뒤에 학생 이름이 오면(“@John Kang Vivian, Sophia pick up today”)
--     지우는 범위가 학생 이름을 먹습니다.
--
-- 그런데 구글챗 API 는 처음부터 **어디부터 어디까지가 멘션인지**를 좌표로 알려줍니다
-- (annotations[].type = 'USER_MENTION', startIndex, length). 우리는 그걸 버리고 본문만
-- 저장한 뒤, 버린 정보를 글자로 되짚고 있었습니다.
--
-- 좌표를 그대로 남깁니다. 추측할 일이 없어집니다.
--
-- 모양: [{"start": 0, "length": 13, "name": "Minkyung Kim", "email": "..."}]
-- 옛 줄은 null 입니다 - 그때는 예전 방식(글자 추측)으로 읽습니다.

alter table public.google_chat_mirror_messages
  add column if not exists mentions jsonb;

comment on column public.google_chat_mirror_messages.mentions is
  '구글챗이 알려준 멘션 구간. [{start,length,name,email}] · null이면 좌표를 못 받은 옛 줄이라 글자로 추측합니다.';
