-- 상담실 태블릿·QR 링크
--
-- 상담실에서 «시작»·«종료»를 누르는 사람이 누구일지 미리 알 수 없습니다(그날 들어오는 선생님이
-- 바뀝니다). 로그인한 담당 선생님만 누를 수 있게 두면, 계정이 없는 분이나 다른 선생님이 들어온
-- 방은 상태가 «상담중»에 멈추고 대기 시간 계산이 통째로 틀어집니다.
--
-- 그래서 상담실마다 열쇠(추측할 수 없는 uuid)를 둡니다. 그 방에 놓인 태블릿, 또는 문에 붙인 QR을
-- 찍은 아무 휴대폰이나 그 방의 예약만 호출·시작·종료할 수 있습니다. 다른 방의 예약이나 명단 전체,
-- 전화번호·메모는 이 길로 나가지 않습니다.

alter table public.consult_rooms
  add column if not exists room_token uuid not null default gen_random_uuid();

-- 태블릿 주소창에 손으로 칠 짧은 주소(/cr/코드). 헷갈리는 0·1 은 다른 글자로 바꿉니다.
alter table public.consult_rooms
  add column if not exists room_short_code text not null
    default translate(substr(md5(random()::text || clock_timestamp()::text), 1, 8), '01', 'xy');

create unique index if not exists consult_rooms_room_token_key on public.consult_rooms (room_token);
create unique index if not exists consult_rooms_room_short_code_key on public.consult_rooms (room_short_code);

-- 행사 단위로 상담실 링크를 끌 수 있게 합니다(행사가 끝나면 «종료»로도 닫힙니다).
alter table public.consult_events
  add column if not exists room_links_enabled boolean not null default true;

notify pgrst, 'reload schema';
