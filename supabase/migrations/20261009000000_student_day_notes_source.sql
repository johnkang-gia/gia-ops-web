-- **특이사항이 어느 연락에서 나왔는가.**
--
-- ── 무엇이 문제였나 ────────────────────────────────────────────────────────
--
-- 픽업 인박스에서 고를 수 있는 것은 「픽업 확정 · 결석 · 지각 · 픽업 아님」뿐이었습니다.
-- 그런데 토들로 오는 연락의 상당수는 그 넷 중 어디에도 안 들어갑니다 - 「약 좀 챙겨
-- 주세요」·「오늘 결제할게요」·「체육복 안 챙겨 보냈어요」.
--
-- 담당자가 할 수 있는 일은 **「픽업 아님」뿐**이었고, 그러면 그 연락은 인박스에서 내려가고
-- **아무 데도 안 남습니다.** 오류가 아니라 「처리됨」으로 보입니다.
--
-- ── 왜 칸을 하나 더 두나 ───────────────────────────────────────────────────
--
-- 인박스에서 특이사항으로 확정하면 자국이 **두 곳**에 남습니다.
--
--   ① `pickup_requests.status = '무시'`   — 인박스에서 내려감
--   ② `student_day_notes` 새 줄           — 학생 하루 보드에 뜸
--
-- 나중에 「사실은 픽업이었다」로 되돌릴 때 ①만 고치면 ②가 그대로 남습니다. 그 아이는
-- 보드에서 픽업이면서 동시에 약을 먹는 아이가 되고, 어느 쪽이 맞는지 화면으로는 알 수
-- 없습니다(CLAUDE.md §2-9 — 넣기와 내리기는 짝으로).
--
-- 이 칸이 그 짝을 잇습니다. 연락 줄이 정리돼도 특이사항은 남아야 하므로
-- `on delete set null` 입니다 - 이음이 끊길 뿐, 적어둔 내용이 사라지면 안 됩니다.

alter table public.student_day_notes
  add column if not exists source_inquiry_id uuid null
    references public.pickup_requests(id) on delete set null;

-- 되돌릴 때 「이 연락에서 나온 줄」을 찾는 자리. 색인이 없으면 전수 훑기가 됩니다.
create index if not exists student_day_notes_source_idx
  on public.student_day_notes (source_inquiry_id)
  where source_inquiry_id is not null;

comment on column public.student_day_notes.source_inquiry_id is
  '픽업 인박스에서 특이사항으로 확정한 경우 그 연락. 되돌릴 때 짝으로 내립니다.';
