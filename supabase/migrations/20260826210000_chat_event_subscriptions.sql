-- 구글챗 푸시 구독의 상태를 우리 쪽에 기록해 둡니다.
--
-- Workspace 구독은 영구가 아니라 만료됩니다. 구글 문서의 권고는 "만료 임박 알림에 기대지 말고
-- 만료 시각을 직접 추적해 갱신하라"입니다. 그러려면 구독 이름과 만료 시각을 우리가 들고
-- 있어야 합니다 - 이 표가 그 자리입니다.
--
-- 스페이스 하나에 구독 하나라서 space_id를 그대로 기본키로 씁니다.

create table if not exists public.google_chat_event_subscriptions (
  space_id text primary key,
  subscription_name text not null,
  uid text,
  expire_time timestamptz,
  updated_at timestamptz not null default now()
);

comment on table public.google_chat_event_subscriptions is
  '구글챗 새 메시지 푸시 구독(Workspace Events API) 상태. 크론이 매일 갱신합니다.';
comment on column public.google_chat_event_subscriptions.subscription_name is
  '구글이 준 구독 이름(subscriptions/xxx). 갱신·삭제할 때 이 값을 씁니다.';
comment on column public.google_chat_event_subscriptions.expire_time is
  '구독 만료 시각. 이 값이 하루 앞도 안 남았다면 갱신 크론이 멈춘 것입니다.';

-- 이 표에는 사용자가 접근할 이유가 전혀 없습니다.
--
-- 구독 이름은 그 자체로 비밀은 아니지만, 알면 남의 구독을 지우거나 딴 데로 돌릴 수 있는
-- 손잡이입니다. RLS를 켜고 정책을 **하나도 두지 않으면** 로그인 사용자에게는 완전히 닫히고,
-- 서비스 롤 키를 쓰는 서버 라우트(크론)만 읽고 쓸 수 있습니다.
-- google_chat_oauth_tokens와 같은 방식입니다.
alter table public.google_chat_event_subscriptions enable row level security;
