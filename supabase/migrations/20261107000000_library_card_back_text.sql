-- ===== 도서카드 뒷면 문구를 학교가 고칠 수 있게 =====
--
-- 뒷면의 '도서관 이용 안내'는 지금까지 코드 안에 글자로 박혀 있었습니다. 규칙 숫자(권수·기간·
-- 연장)는 설정에서 바꿀 수 있었지만, 제목과 안내 문장은 바꾸려면 개발자를 불러야 했습니다.
--
-- 카드는 한 번 뽑으면 졸업할 때까지 씁니다. 그 사이에 규칙도 문구도 바뀝니다. 바뀔 것이
-- 분명한 글을 코드에 두면, 바뀌는 날 아무도 못 고칩니다.

alter table public.lib_settings add column if not exists card_back_title text
  default '도서관 이용 안내';
alter table public.lib_settings add column if not exists card_back_note text
  default '연장은 책을 가지고 왔을 때만 됩니다. 빌린 책이 늦으면 새로 빌릴 수 없습니다.';
alter table public.lib_settings add column if not exists card_back_found text
  default '주우셨다면 아래로 전해 주세요';
-- 규칙 세 줄(권수·기간·연장)을 뒷면에 넣을지. 규칙이 자주 바뀌는 해에는 빼고 뽑을 수 있게
-- 둡니다 - 카드에 적힌 숫자와 실제 규칙이 다르면 안 적은 것만 못합니다.
alter table public.lib_settings add column if not exists card_back_show_rules boolean
  default true;
-- 이름 적는 줄(큰 카드). 코팅 전에 아이가 제 이름을 적어 넣으면 잃어버린 카드가 돌아올
-- 확률이 올라갑니다.
alter table public.lib_settings add column if not exists card_back_name_line boolean
  default true;

comment on column public.lib_settings.card_back_title is '도서카드 뒷면 제목.';
comment on column public.lib_settings.card_back_note is '도서카드 뒷면 안내 문장.';
comment on column public.lib_settings.card_back_found is '카드를 주웠을 때 안내하는 한 줄.';

-- 이미 들어 있는 설정 행에도 기본값을 채워 둡니다. default 는 새로 만드는 행에만 붙습니다.
update public.lib_settings
   set card_back_title = coalesce(card_back_title, '도서관 이용 안내'),
       card_back_note = coalesce(card_back_note, '연장은 책을 가지고 왔을 때만 됩니다. 빌린 책이 늦으면 새로 빌릴 수 없습니다.'),
       card_back_found = coalesce(card_back_found, '주우셨다면 아래로 전해 주세요'),
       card_back_show_rules = coalesce(card_back_show_rules, true),
       card_back_name_line = coalesce(card_back_name_line, true)
 where id = 1;
