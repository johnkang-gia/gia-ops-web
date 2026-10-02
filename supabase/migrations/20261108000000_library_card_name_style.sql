-- ===== 도서카드에 이름을 어떻게 적을지 =====
--
-- 국제학교라 아이마다 사정이 다릅니다. 한국 이름이 본명인 아이는 한글이 커야 하고, 마야·마리아
-- 처럼 **영어 이름이 본명**인 아이는 한글 표기가 오히려 어색합니다. 음차로 적어 둔 한글을
-- 크게 박아 두면 그 아이 카드만 이상해집니다.
--
-- 그래서 세 가지 중에서 고릅니다.
--   ko       한글 크게 · 영어 작게   (한국 이름이 본명인 아이)
--   en       영어 크게 · 한글 작게   (영어 이름이 본명이지만 한글도 쓰는 아이)
--   en_only  영어만                  (한글 표기가 아예 어색한 아이)
--
-- 학교 전체 기본값을 두고, **아이마다 따로** 정할 수 있게 합니다. 대부분은 기본값으로 두고
-- 몇 명만 바꾸면 되는 구조라, 전교생을 하나하나 고르게 만들지 않습니다.

alter table public.lib_settings add column if not exists card_name_style text default 'ko';

alter table public.lib_settings drop constraint if exists lib_settings_card_name_style_check;
alter table public.lib_settings add constraint lib_settings_card_name_style_check
  check (card_name_style is null or card_name_style in ('ko', 'en', 'en_only'));

comment on column public.lib_settings.card_name_style is
  '도서카드 이름 표기의 학교 기본값(ko/en/en_only). 아이마다 다르게 하려면 lib_card_prefs 에 적습니다.';

update public.lib_settings set card_name_style = coalesce(card_name_style, 'ko') where id = 1;


-- ── 아이마다 다르게 ─────────────────────────────────────────────────────────
--
-- 학생 표(wr_students)에 칸을 더하지 않는 이유: 이것은 **도서관이 카드를 뽑을 때의 취향**이지
-- 학생의 신상이 아닙니다. 운영앱 명부에 섞어 두면 명부를 보는 모든 화면이 이 값을 지고
-- 다녀야 하고, 나중에 지우기도 어렵습니다. 도서관 쪽에 따로 둡니다.
--
-- 학생 고유번호로 잡습니다. 아이가 전학 가서 명부에서 빠져도 이 줄은 남는데, 그래도
-- 괜찮습니다 - 다시 돌아오면 그때 설정이 그대로 살아납니다.
create table if not exists public.lib_card_prefs (
  student_no text primary key,
  name_style text not null check (name_style in ('ko', 'en', 'en_only')),
  updated_at timestamptz not null default now(),
  updated_by text
);

comment on table public.lib_card_prefs is
  '도서카드를 뽑을 때 아이마다 다르게 할 것들. 지금은 이름 표기 방식 하나뿐입니다.';

alter table public.lib_card_prefs enable row level security;

drop policy if exists lib_all_card_prefs on public.lib_card_prefs;
create policy lib_all_card_prefs on public.lib_card_prefs
  for all using (public.is_lib_user()) with check (public.is_lib_user());

notify pgrst, 'reload schema';
