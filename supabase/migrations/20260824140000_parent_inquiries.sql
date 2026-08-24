-- ===== 108. 학부모 문의사항 - 픽업만이 아니라 문의도 함께 분류 =====
--
-- 요청: "이토들로 문의사항도 많이 넣어주셔, 담임선생님도 같이 답변해주시고, 혹시 이런 문의사항도
-- 분류해서 업무에 넣어줄 수 있어?... 학부모 문의사항탭을 넣고 거기에서 토들에 문의한 내용을
-- 학생과 대조해서 분류해서 뜨도록하고, 그부분 클릭하면 바로 토들 메세지 창으로 연결"
--
-- 지금까지는 픽업이 아닌 메시지를 그냥 버렸습니다. 그런데 학부모 연락의 대부분은 픽업이 아니라
-- 문의이고, 그건 버릴 게 아니라 "누가 답했는지"를 관리해야 하는 일입니다. 그래서 같은 표에
-- 문의도 담되, 픽업과 문의를 kind로 나눠 각자 다른 화면에서 다룹니다.
--
-- 표를 새로 만들지 않고 pickup_requests를 넓힌 이유
--   들어오는 통로(토들 수집기·전화·교사·직접입력)와 중복 방지 규칙이 완전히 같습니다. 표를
--   둘로 나누면 같은 메시지가 양쪽에 들어가거나, 한쪽에만 중복 방지가 걸리는 사고가 납니다.

-- 픽업인지 문의인지. 기존 행은 전부 픽업 판정을 거친 것이므로 그대로 '픽업'으로 둡니다.
alter table pickup_requests add column if not exists kind text not null default '픽업';
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'pickup_requests_kind_check'
  ) then
    alter table pickup_requests add constraint pickup_requests_kind_check
      check (kind in ('픽업', '문의', '기타'));
  end if;
end $$;

-- ── 문의 분류 ───────────────────────────────────────────────────────────────
-- 유형은 행정실이 실제로 나눠 처리하는 갈래에 맞췄습니다. 담당이 갈리는 기준이기도 합니다
-- (출결·차량은 행정실, 수업·생활은 담임, 건강은 보건 담당).
alter table pickup_requests add column if not exists inquiry_type text;
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'pickup_requests_inquiry_type_check'
  ) then
    alter table pickup_requests add constraint pickup_requests_inquiry_type_check
      check (inquiry_type is null or inquiry_type in
        ('출결', '수업·학습', '생활·교우', '건강·안전', '차량·하원', '행사·일정', '납부·행정', '기타'));
  end if;
end $$;

-- 한 줄 요약. 목록에서 원문 대신 이걸 보여줍니다 - 학부모가 길게 쓰신 글을 그대로 늘어놓으면
-- 목록을 훑을 수 없고, 무엇보다 화면에 학부모 문장이 그대로 박제됩니다.
alter table pickup_requests add column if not exists summary text;

-- 답이 늦으면 곤란한 정도. '높음'만 화면 위로 올립니다(예: 아이가 아프다, 지금 데리러 왔다).
alter table pickup_requests add column if not exists urgency text;
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'pickup_requests_urgency_check'
  ) then
    alter table pickup_requests add constraint pickup_requests_urgency_check
      check (urgency is null or urgency in ('높음', '보통', '낮음'));
  end if;
end $$;

-- ── 원문으로 돌아가는 길 ────────────────────────────────────────────────────
-- 요청: "그부분 클릭하면 바로 토들 메세지 창으로 연결될 수 있도록"
-- 토들 메시지 주소는 web.toddleapp.com/platform/{학교}/messaging/{채팅방} 형식입니다. 채팅방
-- 번호를 수집기가 이미 알고 있으므로 그대로 저장해 두면 링크를 만들 수 있습니다. 여는 사람의
-- 브라우저 로그인으로 열리므로, 그 방 멤버인 선생님은 바로 열리고 아니면 토들이 막습니다.
alter table pickup_requests add column if not exists source_url text;
alter table pickup_requests add column if not exists source_chat_id text;

-- ── 처리 상태 ───────────────────────────────────────────────────────────────
-- 문의는 픽업과 달리 "확정/무시"가 아니라 "답했는가"가 관건입니다. status는 픽업 쪽 뜻을
-- 유지하고, 문의 전용으로 답변 여부를 따로 둡니다.
alter table pickup_requests add column if not exists answered_at timestamptz;
alter table pickup_requests add column if not exists answered_by text;

-- 요청: "문의탭에서만 우선보이고 클릭해서 업무로 등록할 수 있도록"
-- 자동으로 업무를 만들지 않습니다 - 하루 수십 건이 업무 목록에 쏟아지면 원래 업무가 묻힙니다.
-- 담당자가 "이건 일이다" 싶은 것만 넘기고, 넘긴 뒤에는 어느 업무가 되었는지 여기에 남깁니다.
alter table pickup_requests add column if not exists task_id uuid references tasks(id) on delete set null;

-- 담임 연결 - 채널 이름으로 학생을 찾으면 그 학생의 반 담임을 함께 적어둡니다. 문의 목록을
-- 담임별로 묶어 보거나, 업무로 넘길 때 담당자를 미리 채우는 데 씁니다.
alter table pickup_requests add column if not exists homeroom_email text;

create index if not exists pickup_requests_kind_idx on pickup_requests(kind, received_at desc);
create index if not exists pickup_requests_answered_idx on pickup_requests(kind, answered_at);
