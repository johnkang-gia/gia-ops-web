-- 출결 등록 상태 - 인박스와 대시보드가 함께 보는 **하나의 진실**.
--
-- 왜 만드나요?
--
-- 지금까지 대시보드의 결석·지각 칸은 세 곳을 각각 읽어 합쳤습니다.
--   ① attendance_records (선생님이 직접 입력)
--   ② google_chat_mirror_messages (구글챗 출결알림을 그때그때 파싱)
--   ③ pickup_requests (토들 문의를 그때그때 파싱)
--
-- ②③은 **"처리했다"는 개념이 아예 없습니다.** 원본 메시지를 매번 다시 파싱하는 구조라,
-- 업무보드에서 아무리 체크하고 지워도 다음 새로고침에 그대로 되살아납니다.
-- (담당자: "아직도 업무대시보드 체크가 제대로 안돼, 기존게 계속 남아있어")
--
-- 지운 것이 되살아나는 건 화면 문제가 아니라 구조 문제입니다. 지울 자리가 없었으니까요.
-- 그래서 "행정실이 등록한 출결"을 담는 자리를 따로 만들고, 대시보드는 **이 표만** 봅니다.
-- 원본 메시지는 이 표를 만드는 재료일 뿐, 더 이상 대시보드의 입력이 아닙니다.
--
-- 기간을 담는 이유(담당자 요청): "수요일까지라던지 이번주 금요일, 아니면 특정날짜까지 반영해서
-- 출결특이사항에 반영해줘." 하루로만 적으면 나머지 날은 아무 데도 안 남아, 그 며칠 동안
-- 아이를 찾게 됩니다.

create table if not exists public.attendance_entries (
  id uuid primary key default gen_random_uuid(),

  -- 어디서 왔는지. 'googlechat' | 'toddle' | 'manual'
  source text not null check (source in ('googlechat', 'toddle', 'manual')),
  -- 원본 메시지 id. 같은 메시지를 두 번 등록하지 않기 위한 열쇠입니다(manual은 null).
  source_message_id text,

  student_id uuid,
  student_name text not null,
  grade text,
  class_name text,

  status text not null check (status in ('결석', '지각', '조퇴', '픽업')),
  date_from date not null,
  date_to date not null,

  -- '등록'   : 대시보드에 뜹니다.
  -- '확인필요': 자동 판단이 애매해 사람 확인을 기다립니다. 대시보드에 뜨지 않습니다.
  -- '무시'   : 사람이 아니라고 판단했습니다. **다시 만들지 않습니다**(이게 되살아남을 막는 자리).
  state text not null default '확인필요' check (state in ('등록', '확인필요', '무시')),

  -- 사람이 손댄 적이 있는지. true면 자동 갱신이 덮어쓰지 않습니다.
  -- 자동 판단이 사람 판단을 이기는 일은 없어야 합니다.
  touched_by_human boolean not null default false,

  -- 왜 확인이 필요한지("학생을 못 찾음", "날짜가 없음"). 화면의 물음표에 그대로 보여줍니다.
  reason text,
  note text,
  raw_text text,

  registered_by text,
  registered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint attendance_entries_range_ok check (date_from <= date_to)
);

-- 같은 메시지에서 같은 학생·같은 종류가 두 번 만들어지지 않게.
-- 자동 스캔은 이 제약에 기대어 "있으면 두고, 없으면 만들기"로 단순해집니다.
create unique index if not exists attendance_entries_source_uniq
  on public.attendance_entries (source, source_message_id, student_name, status)
  where source_message_id is not null;

-- 대시보드의 주 질의: "오늘이 기간에 드는 등록된 건".
create index if not exists attendance_entries_active_idx
  on public.attendance_entries (state, date_from, date_to);

create index if not exists attendance_entries_msg_idx
  on public.attendance_entries (source_message_id);

comment on table public.attendance_entries is
  '행정실이 등록한 출결(기간 포함). 대시보드는 state=''등록''인 것만 읽습니다.';
comment on column public.attendance_entries.state is
  '등록=대시보드에 뜸 / 확인필요=사람 확인 대기 / 무시=아니라고 판단(다시 만들지 않음)';
comment on column public.attendance_entries.touched_by_human is
  'true면 자동 스캔이 덮어쓰지 않습니다 - 자동 판단이 사람 판단을 이기면 안 됩니다.';

alter table public.attendance_entries enable row level security;

-- 교직원(교사 포함)은 읽을 수 있고, 등록·수정은 행정실 담당자만.
-- 출결은 셔틀 배차와 급식 인원까지 흔드는 값이라, 아무나 바꾸면 곤란합니다.
drop policy if exists attendance_entries_select on public.attendance_entries;
create policy attendance_entries_select on public.attendance_entries
  for select using (is_giamicro_user());

drop policy if exists attendance_entries_write on public.attendance_entries;
create policy attendance_entries_write on public.attendance_entries
  for all using (is_wr_manager()) with check (is_wr_manager());

-- updated_at 자동 갱신.
create or replace function public.touch_attendance_entries()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists attendance_entries_touch on public.attendance_entries;
create trigger attendance_entries_touch
  before update on public.attendance_entries
  for each row execute function public.touch_attendance_entries();
