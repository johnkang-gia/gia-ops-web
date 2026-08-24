-- 문의 처리 표시와 기록 보관
--
-- 요청: "체크박스를 만들어서 체크를 하면 대시보드, 학부모 문의에서 빼주고 (대신 문의기록으로
-- 저장해줘 나중에 문의사항 검색할 수 있게) 혹시나 다른 직원이 답글을 달았다면 해결된 것으로
-- 체크해줘"
--
-- 지우지 않고 남깁니다. "그때 그 학부모가 뭐라고 하셨더라"를 나중에 찾을 수 있어야 하고,
-- 같은 문의가 반복되면 그것 자체가 고쳐야 할 신호입니다.

alter table public.pickup_requests
  -- 누가 어떻게 끝냈는지. '수동'은 직원이 체크한 것, '답글'은 토들에서 답글이 확인된 것.
  add column if not exists answered_via text,
  -- 토들에서 마지막으로 답글을 단 선생님과 시각. 대시보드의 초록 체크 표시에 씁니다.
  add column if not exists replied_by text,
  add column if not exists replied_at timestamptz;

-- 처리된 것을 뺀 목록을 자주 조회하므로, 미처리 건만 빠르게 찾도록 합니다.
create index if not exists pickup_requests_open_inquiries
  on public.pickup_requests (kind, answered_at, received_at desc);

-- 나중에 내용으로 찾을 수 있도록. 한국어는 형태소 분석기가 없으면 to_tsvector가 잘 안 듣기
-- 때문에, 단순하지만 확실한 trigram 색인을 씁니다(ILIKE '%...%' 검색이 빨라집니다).
create extension if not exists pg_trgm;

create index if not exists pickup_requests_text_search
  on public.pickup_requests using gin (raw_text gin_trgm_ops);

create index if not exists pickup_requests_summary_search
  on public.pickup_requests using gin (summary gin_trgm_ops);
