-- ===== 107. 픽업 인박스 - 어느 채널로 오든 한 곳에 모아 자동 처리 =====
--
-- 요청: "전체 학부모의 채팅을 하나하나 실시간으로 보면서 아이들의 픽업을 처리하는게 너무 힘든데
-- 이부분을 어떻게 자동화 할 수 있는 방안이 없을까? 게다가 전화로 픽업을 오는경우도 많고, 교사에게
-- 픽업을 알리는 경우도 많아서 픽업체크가 정말 어려워"
--
-- 지금 흐름
--   학부모가 토들 개인 채팅방(100개)에 "오늘 3시에 픽업할게요" → 행정직원이 방을 하나하나 열어
--   확인 → 구글챗 출결방에 "오늘 OO 픽업입니다"를 옮겨 적음 → 그걸 보고 앱에 체크
--   오후 4시가 되면 직원들이 하원 지도를 나가서, 그 시간에 온 메시지는 놓칩니다.
--
-- 바꾸는 흐름
--   토들·전화·교사·구글챗 어디로 들어오든 이 표에 한 줄로 쌓이고, AI가 "픽업인지 / 누구인지 /
--   몇 시인지"를 뽑아 명부와 대조합니다. 확신이 서면 바로 픽업으로 체크되고, 애매하면 확인
--   대기로 남아 담당자가 한 번 눌러 확정합니다. 사람이 100개 방을 도는 일이 사라집니다.
--
-- 개인정보를 최소로 남기는 설계
--   학부모 대화를 쌓아두는 시스템이 되면 안 됩니다. 그래서
--     · 픽업이 아니라고 판단되면 원문(raw_text)을 저장하지 않고 비웁니다. 다만 어느 메시지를
--       이미 처리했는지는 알아야 해서(안 그러면 같은 메시지를 매번 다시 AI에 보냅니다) 출처
--       식별자만 남깁니다.
--     · 픽업 건의 원문도 보관 기간이 지나면 크론이 지웁니다(위치 기록 삭제 크론과 같은 방식).

create table if not exists pickup_requests (
  id uuid primary key default gen_random_uuid(),

  -- 어느 날짜의 하원에 대한 픽업인지. "내일 픽업할게요" 같은 경우도 있어 받은 날짜와 다를 수
  -- 있습니다. AI가 판단하지 못하면 받은 날짜(한국 기준)를 씁니다.
  service_date date not null,

  -- 어디로 들어왔는지. 나중에 "어느 경로가 제일 많은가"를 보고 안내를 조정할 수 있습니다.
  source text not null check (source in ('토들', '전화', '교사', '구글챗', '직접입력', '학부모링크')),
  -- 같은 메시지를 두 번 처리하지 않기 위한 출처 쪽 고유값(예: 토들 메시지 id).
  -- 수집기가 재시작하거나 같은 화면을 다시 읽어도 중복이 생기지 않습니다.
  source_ref text,

  -- 토들 채널 이름(예: 'G2_Reina Park_Office'). 이름 안에 학년과 학생 이름이 들어 있어서,
  -- 본문을 해석하지 않아도 누구 이야기인지 거의 확정됩니다. 형제 채널
  -- (예: 'G2_Sophia & Bella Hwang_Office')만 본문에서 누구인지 가려내야 합니다.
  channel_label text,
  sender_name text,
  received_at timestamptz not null default now(),

  -- 원문. 픽업이 아니면 null로 둡니다(위 설계 메모 참고).
  raw_text text,

  -- ── AI 판단 결과 ─────────────────────────────────────────────────────────
  ai_is_pickup boolean,
  ai_student_name text,          -- AI가 읽어낸 학생 이름(원문 표기 그대로)
  ai_pickup_time text,           -- 'HH:MM' 또는 null(시각 언급이 없으면)
  ai_confidence numeric,         -- 0~1. 낮으면 자동 확정하지 않고 사람에게 넘깁니다.
  ai_note text,                  -- 판단 근거 한 줄(담당자가 확인할 때 도움이 됩니다)

  -- ── 명부 대조 결과 ───────────────────────────────────────────────────────
  student_id uuid references wr_students(id) on delete set null,
  matched_name text,             -- 실제로 연결된 명부상 이름

  -- 확인대기: 사람이 한 번 봐야 함 / 확정: 픽업으로 처리됨 / 무시: 픽업이 아님 또는 취소
  status text not null default '확인대기' check (status in ('확인대기', '확정', '무시')),
  resolved_by text,
  resolved_at timestamptz,

  created_at timestamptz not null default now()
);

-- 같은 메시지를 두 번 넣지 않도록. source_ref가 없는 건(직접입력·전화 등)은 중복 검사 대상이
-- 아니므로, null이 여러 개여도 되는 부분 인덱스를 씁니다.
create unique index if not exists pickup_requests_source_ref_idx
  on pickup_requests(source, source_ref) where source_ref is not null;

create index if not exists pickup_requests_date_idx on pickup_requests(service_date, status);
create index if not exists pickup_requests_student_idx on pickup_requests(student_id);

alter table pickup_requests enable row level security;
drop policy if exists "giamicro_all_pickup_requests" on pickup_requests;
create policy "giamicro_all_pickup_requests" on pickup_requests
  for all using (is_giamicro_user()) with check (is_giamicro_user());

-- ── 수집기 생존 신호 ────────────────────────────────────────────────────────
-- 토들 수집기(사무실 PC 크롬 확장)가 조용히 멈추는 것이 가장 나쁜 실패입니다. 멈춘 줄 모르면
-- 그날 픽업을 통째로 놓칩니다. 그래서 수집기가 주기적으로 여기에 신호를 남기고, 하원 시간대에
-- 신호가 끊기면 운영 대시보드가 빨간 경고를 띄웁니다("죽으면 시끄럽게").
create table if not exists integration_heartbeats (
  key text primary key,                  -- 예: 'toddle-collector'
  last_seen_at timestamptz not null default now(),
  status text,                           -- 'ok' | 'login_required' | 'error'
  detail text,
  updated_at timestamptz not null default now()
);

alter table integration_heartbeats enable row level security;
drop policy if exists "giamicro_all_integration_heartbeats" on integration_heartbeats;
create policy "giamicro_all_integration_heartbeats" on integration_heartbeats
  for all using (is_giamicro_user()) with check (is_giamicro_user());
