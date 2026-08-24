-- ===== 109. 교사 자기반 대시보드 - 데모 격리용 is_demo + 데모 문의 =====
--
-- 요청: "교사 권한으로 로그인했을때 (...) 자기반 아이들 어머님께서 문의하신 사항을 띄울 수 있게
-- 만들어주고, 픽업의 경우 시간을 명시한경우 담임선생님께 누가 몇시에 픽업인지 알려줄 수 있는
-- 자기반 대시보드를 (...) 더미에서 볼 수 있도록 더미계정도 만들어줘".
--
-- 교사 대시보드는 pickup_requests(학부모 문의·픽업)를 담임 이메일(homeroom_email)로 걸러 보여줍니다.
-- 신입교사 오리엔테이션용 데모 계정(gia-demo…)에서도 이 화면이 "실제처럼" 보여야 하는데, 데모
-- 문의가 실제 행정실 문의 목록·운영 대시보드에 섞이면 안 됩니다. 그래서 학생·반과 같은 방식으로
-- is_demo 칸을 하나 붙여, 데모 문의는 데모 계정에만 보이고 실제 화면에는 전혀 나타나지 않게 합니다.

alter table pickup_requests add column if not exists is_demo boolean not null default false;
create index if not exists pickup_requests_is_demo_idx on pickup_requests(is_demo);

-- ── 데모 학부모 문의·픽업 ────────────────────────────────────────────────────
-- 데모 담임반(3 Demo, gia-demo@giamicro.com)의 학생들에 대한 예시입니다. 고정 UUID라 다시
-- 실행해도 늘어나지 않습니다. service_date는 "오늘"로 두어 픽업이 오늘 것으로 보이게 합니다.
insert into pickup_requests
  (id, service_date, source, source_ref, channel_label, sender_name, received_at,
   raw_text, ai_is_pickup, ai_student_name, ai_pickup_time, ai_confidence, ai_note,
   student_id, matched_name, status, kind, inquiry_type, summary, urgency, homeroom_email, is_demo)
values
  -- 시간이 명시된 픽업 두 건(대시보드 "오늘 픽업"에 시각과 함께 뜹니다)
  ('d0000000-0000-4000-a100-000000000001', current_date, '토들', 'demo-pickup-1',
   'G3_Seojun Kim_Office', '김서준 어머니', now(),
   '오늘 김서준 3시 40분에 제가 직접 데리러 갈게요. 셔틀 안 태워주셔도 됩니다.',
   true, '김서준', '15:40', 0.95, '시간 명시된 픽업',
   'd0000000-0000-4000-b000-000000000001', '김서준', '확정', '픽업', '차량·하원',
   '오늘 15:40 보호자 직접 픽업(셔틀 미탑승)', '보통', 'gia-demo@giamicro.com', true),
  ('d0000000-0000-4000-a100-000000000002', current_date, '토들', 'demo-pickup-2',
   'G3_Jiwoo Choi_Office', '최지우 어머니', now(),
   '지우 오늘 4시 10분에 데리러 갑니다. 병원 예약이 있어서요.',
   true, '최지우', '16:10', 0.92, '시간 명시된 픽업',
   'd0000000-0000-4000-b000-000000000004', '최지우', '확정', '픽업', '차량·하원',
   '오늘 16:10 보호자 직접 픽업(병원)', '보통', 'gia-demo@giamicro.com', true),
  -- 일반 문의 세 건(대시보드 "우리 반 문의"에 뜹니다)
  ('d0000000-0000-4000-a100-000000000003', current_date, '토들', 'demo-inq-1',
   'G3_Hayun Lee_Office', '이하윤 어머니', now() - interval '40 minutes',
   '하윤이가 어제 배운 받아쓰기를 어려워하는데 집에서 어떻게 도와주면 좋을까요?',
   false, null, null, null, '학습 관련 문의',
   'd0000000-0000-4000-b000-000000000002', '이하윤', '확인대기', '문의', '수업·학습',
   '받아쓰기 가정학습 방법 문의', '낮음', 'gia-demo@giamicro.com', true),
  ('d0000000-0000-4000-a100-000000000004', current_date, '토들', 'demo-inq-2',
   'G3_Doyun Park_Office', '박도윤 어머니', now() - interval '2 hours',
   '도윤이가 아침부터 살짝 열이 있어요. 혹시 열이 오르면 바로 연락 부탁드립니다.',
   false, null, null, null, '건강 관련 문의',
   'd0000000-0000-4000-b000-000000000003', '박도윤', '확인대기', '문의', '건강·안전',
   '미열 있음 - 상태 악화 시 연락 요청', '높음', 'gia-demo@giamicro.com', true),
  ('d0000000-0000-4000-a100-000000000005', current_date, '토들', 'demo-inq-3',
   'G3_Yuna Kang_Office', '강유나 어머니', now() - interval '1 day',
   '유나가 요즘 쉬는 시간에 혼자 있는다고 해서 걱정입니다. 반 친구들과 잘 지내는지 궁금해요.',
   false, null, null, null, '교우관계 문의',
   'd0000000-0000-4000-b000-000000000006', '강유나', '확인대기', '문의', '생활·교우',
   '교우관계 - 쉬는 시간 어울림 확인 요청', '보통', 'gia-demo@giamicro.com', true)
on conflict (id) do update
  set service_date = excluded.service_date,
      received_at = excluded.received_at,
      raw_text = excluded.raw_text,
      ai_pickup_time = excluded.ai_pickup_time,
      summary = excluded.summary,
      inquiry_type = excluded.inquiry_type,
      urgency = excluded.urgency,
      kind = excluded.kind,
      homeroom_email = excluded.homeroom_email,
      is_demo = true;
