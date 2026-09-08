-- 구글챗: 여러 방 · 사진 · 멤버(@멘션)
--
-- ── 무엇이 문제였나 ──────────────────────────────────────────────────
--
-- 지금까지 구글챗 미러링은 **환경변수에 적힌 방 두 개**만 봤습니다(그나마 하나만 켜져
-- 있었습니다). 방을 하나 더 보려면 Vercel 환경변수를 고치고 다시 배포해야 했는데, 방은
-- 학기 중에도 생깁니다 - 학년 방, 행사 방, 급한 일이 생기면 그때 만드는 방.
--
-- 그리고 사진이 통째로 빠졌습니다. 미러링은 `text` 만 저장하고, 사진만 올라온 메시지는
-- 본문이 없어서 **아예 저장조차 되지 않았습니다.** 다친 아이 사진이 그렇게 올라옵니다 -
-- 화면에는 그 메시지가 «없는 것»으로 보이고, 아무 오류도 남지 않습니다.
--
-- ── 그래서 ───────────────────────────────────────────────────────────
--
-- 방 목록을 표로 옮기고(화면에서 켜고 끕니다), 첨부를 우리 저장소로 복사하고, 방 멤버를
-- 받아둡니다(@멘션에 쓸 사람 목록).

-- ── 방 목록 ─────────────────────────────────────────────────────────
--
-- 구글챗의 방 이름(`spaces/AAAA...`)이 곧 열쇠입니다. 우리가 따로 번호를 매기면 같은 방이
-- 두 줄로 들어올 수 있습니다.
create table if not exists public.google_chat_spaces (
  google_space_id text primary key,
  display_name text,
  -- 예전 두 방은 화면 곳곳이 이 이름으로 걸러 읽습니다(출결내역·출결알림). 그래서 지웠다가는
  -- 그 화면들이 통째로 빈 칸이 됩니다. 새로 켜는 방은 이 칸이 비어 있고, 방 이름으로 갈립니다.
  source_key text check (source_key in ('attendance', 'teacher_requests')),
  -- 끄면 폴링에서 빠집니다. 지우지 않는 이유: 지나간 메시지는 남아 있어야 하고, 다시 켤 때
  -- 「이 방을 봤었다」는 사실이 남아 있어야 합니다.
  enabled boolean not null default true,
  sort_order int not null default 100,
  last_polled_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.google_chat_spaces is
  '미러링할 구글챗 방 목록. 환경변수 대신 이 표를 봅니다 - 방은 학기 중에도 생깁니다.';

alter table public.google_chat_spaces enable row level security;

drop policy if exists "wr_manager_select_google_chat_spaces" on public.google_chat_spaces;
create policy "wr_manager_select_google_chat_spaces" on public.google_chat_spaces
  for select using (public.is_wr_manager());
drop policy if exists "wr_manager_write_google_chat_spaces" on public.google_chat_spaces;
create policy "wr_manager_write_google_chat_spaces" on public.google_chat_spaces
  for all using (public.is_wr_manager()) with check (public.is_wr_manager());

-- ── 방 멤버 (@멘션용) ────────────────────────────────────────────────
--
-- 구글챗에서 @멘션은 **글자가 아니라 사람 번호**입니다. 본문에 `<users/1234>` 라고 써야
-- 상대에게 알림이 갑니다. 「@김선생님」이라고 글자만 적으면 그냥 글자입니다 - 보낸 쪽은
-- 불렀다고 생각하고, 받는 쪽은 알림을 못 받습니다. 이게 가장 나쁜 종류의 조용한 실패입니다.
create table if not exists public.google_chat_members (
  google_space_id text not null,
  google_user_id text not null,               -- 'users/1234567890'
  display_name text,
  email text,
  updated_at timestamptz not null default now(),
  primary key (google_space_id, google_user_id)
);

comment on table public.google_chat_members is
  '방에 있는 사람 목록. @멘션은 사람 번호(users/…)로 보내야 알림이 갑니다.';

alter table public.google_chat_members enable row level security;
drop policy if exists "wr_manager_select_google_chat_members" on public.google_chat_members;
create policy "wr_manager_select_google_chat_members" on public.google_chat_members
  for select using (public.is_wr_manager());
drop policy if exists "wr_manager_write_google_chat_members" on public.google_chat_members;
create policy "wr_manager_write_google_chat_members" on public.google_chat_members
  for all using (public.is_wr_manager()) with check (public.is_wr_manager());

-- ── 메시지: 방 이름으로도 갈릴 수 있게 ───────────────────────────────
--
-- `source_key` 는 「출결알림/선생님요청」 둘만 허용하고 있었습니다. 새 방에서 온 메시지는
-- 넣을 값이 없어 저장 자체가 실패합니다. 새 방은 'room' 으로 넣고, **어느 방인지는
-- google_space_id 로** 갈립니다. 기존 두 값은 그대로 둡니다 - 화면 여러 곳이 읽고 있습니다.
alter table public.google_chat_mirror_messages
  drop constraint if exists google_chat_mirror_messages_source_key_check;
alter table public.google_chat_mirror_messages
  add constraint google_chat_mirror_messages_source_key_check
  check (source_key in ('attendance', 'teacher_requests', 'room'));

-- 사진·파일. 우리 저장소로 복사한 뒤의 경로를 함께 적습니다.
--   [{ name, contentType, path, savedAt }]
-- `path` 가 비어 있으면 **가져오지 못한 것**입니다. 화면이 그렇게 알려줍니다 - 빈 칸으로
-- 두면 사진이 없었던 것인지 못 가져온 것인지 아무도 모릅니다.
alter table public.google_chat_mirror_messages add column if not exists attachments jsonb;

comment on column public.google_chat_mirror_messages.attachments is
  '구글챗 첨부를 우리 저장소로 복사한 목록. path 가 비면 복사 실패(화면이 알려줍니다).';

-- 사진만 올라온 메시지는 본문이 없습니다. 지금까지는 본문이 없다고 통째로 버렸는데,
-- 다친 아이 사진이 바로 그렇게 올라옵니다.
alter table public.google_chat_mirror_messages alter column content drop not null;

create index if not exists google_chat_mirror_messages_space_created_idx
  on public.google_chat_mirror_messages(google_space_id, created_at_google desc);

-- ── 첨부 보관함 ─────────────────────────────────────────────────────
--
-- 비공개입니다. 아이 얼굴·다친 자리가 올라오는 자리라 공개 주소를 만들지 않고, 볼 때마다
-- 짧게 사는 서명 주소를 받습니다.
insert into storage.buckets (id, name, public)
values ('chat-attachments', 'chat-attachments', false)
on conflict (id) do nothing;

drop policy if exists chat_attachments_read on storage.objects;
create policy chat_attachments_read on storage.objects
  for select using (bucket_id = 'chat-attachments' and public.is_wr_manager());

drop policy if exists chat_attachments_write on storage.objects;
create policy chat_attachments_write on storage.objects
  for insert with check (bucket_id = 'chat-attachments' and public.is_wr_manager());

drop policy if exists chat_attachments_delete on storage.objects;
create policy chat_attachments_delete on storage.objects
  for delete using (bucket_id = 'chat-attachments' and public.is_wr_manager());
