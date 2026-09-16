-- 특이사항에 **「물건」** 갈래를 더합니다.
--
-- ── 무엇이 문제였나 ──────────────────────────────────────────────────
--
-- 「오늘 유겸이가 학교에 두고 온 것들을 챙겨갈 수 있게 부탁드려요 — 잠바 2개, 수학학원
-- 파일, 간식 가방」 같은 연락이 옵니다. 지금은 「준비물」이나 「기타」로 들어갔는데, 이 둘은
-- **행정실이 보는 칸**입니다.
--
-- 두고 간 물건은 성격이 다릅니다. 아이가 **차에 타기 전에** 손에 들려 보내야 하고, 그걸
-- 확인할 수 있는 사람은 담임과 하원 차량 담당자입니다. 하원 시간에 그 둘이 보는 화면은
-- 도착체크 화면 하나뿐인데, 거기에는 이 부탁이 뜨지 않았습니다.
--
-- 못 챙기면 그날 그 물건은 학교에 남습니다. 오류로 안 보이고 「그냥 안 챙긴 것」으로
-- 보이므로 아무도 못 찾습니다.
--
-- ── 그래서 ───────────────────────────────────────────────────────────
--
-- 갈래를 따로 둡니다. 갈래가 따로여야 **도착체크 화면이 이것만 골라 띄울 수 있습니다** -
-- 「준비물」에 섞어두면 약·결제까지 하원 화면에 쏟아지고, 그러면 아무도 안 봅니다.
--
-- 기존 줄은 건드리지 않습니다. 「준비물」로 들어간 옛 줄이 갑자기 하원 화면에 나타나면,
-- 사람이 적은 적 없는 일이 화면에 생기는 것입니다.

alter table public.student_day_notes
  drop constraint if exists student_day_notes_kind_check;
alter table public.student_day_notes
  add constraint student_day_notes_kind_check
  check (kind in ('약', '결제', '준비물', '물건', '건강', '기타'));

comment on column public.student_day_notes.kind is
  '약 | 결제 | 준비물 | 물건 | 건강 | 기타. 「물건」은 두고 간 물건을 하원 전에 챙겨 보내야 하는 건이라, 도착체크 화면이 이 갈래만 따로 띄웁니다.';

-- 하원 화면이 「오늘 · 물건」만 골라 읽습니다. 139명 × 하루치라 크지 않지만, 하원 시간에
-- 3초마다 도는 조회라 색인을 답니다.
create index if not exists student_day_notes_object_idx
  on public.student_day_notes (on_date, kind)
  where kind = '물건';

-- ── 챙겼는지 표시 ────────────────────────────────────────────────────
--
-- 물건은 **챙겼다는 것을 확인해야 끝나는 일**입니다. 적어두기만 하면 하원 화면에는 하루 종일
-- 같은 줄이 떠 있고, 그러면 챙긴 것과 안 챙긴 것이 구별되지 않습니다 - 며칠 지나면 그 줄
-- 자체를 아무도 안 봅니다.
--
-- 누가 언제 챙겼는지도 남깁니다. 「분명히 챙겨 보냈다는데 집에 안 왔다」가 실제로 생기고,
-- 그때 답할 수 있어야 합니다.
alter table public.student_day_notes
  add column if not exists done boolean not null default false,
  add column if not exists done_at timestamptz null,
  add column if not exists done_by text null;

comment on column public.student_day_notes.done is
  '챙겨 보냈는가. 「물건」 갈래에서 도착체크 화면이 체크합니다. 다른 갈래는 쓰지 않습니다.';
