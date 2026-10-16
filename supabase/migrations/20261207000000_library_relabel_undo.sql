-- ===== 재등록 되돌리기 =====
--
-- 요청: "재등록한 것도 다시 할 수 있도록 되돌리기 버튼이랑 수정 버튼도 만들어줘."
--
-- ── 되돌리려면 '바꾸기 전 모습'이 남아 있어야 합니다 ──────────────────────
-- 재등록은 줄을 **고쳐 씁니다**. 고친 뒤에는 전에 무엇이 적혀 있었는지 어디에도 없습니다.
-- 화면에만 들고 있으면 새로고침 한 번에 사라지고, 그러면 되돌리기 버튼은 거짓말이 됩니다.
--
-- 그래서 바꾸기 **전에** 그 줄을 통째로 적어 둡니다(before_json). 되돌리기는 그걸 그대로
-- 다시 써 넣는 일이 됩니다.
--
-- ── 자리 기록도 함께 적습니다 ─────────────────────────────────────────────
-- 한 권만 남은 줄이 다른 ISBN 줄로 합쳐질 때 그 줄은 사라지고, 그 줄에 붙어 있던 자리 기록
-- (lib_shelf_check)도 함께 지워집니다. 자리는 책장을 한 칸씩 비워 가며 찍어 만든 자료라,
-- 되돌릴 때 같이 돌아오지 않으면 그 칸을 다시 찍어야 합니다. 그래서 before_json 안에 함께
-- 담습니다.
--
-- ── 그 뒤에 또 바꿨으면 되돌리지 않습니다 ─────────────────────────────────
-- 12권짜리 줄에서 한 권을 뗀 뒤 또 한 권을 떼면, 첫 번째를 되돌리는 것은 두 번째를 지우는
-- 일이 됩니다. 그런 경우에는 거절하고 그렇다고 말합니다 - 조용히 어긋나게 만드는 것보다
-- "이건 못 돌립니다"가 낫습니다.

alter table public.lib_relabel_log
  /** 바꾸기 전 그 줄의 모습과 자리 기록. {"book": {...}, "checks": [...]} */
  add column if not exists before_json jsonb,
  /** 여러 권 줄에서 한 권을 떼며 새로 만든 '남은 권수' 줄. */
  add column if not exists leftover_id uuid,
  /** 이미 있던 ISBN 줄로 보낸 경우 그 줄. */
  add column if not exists target_id uuid,
  /** 되돌린 시각. 비어 있으면 아직 살아 있는 재등록입니다. */
  add column if not exists undone_at timestamptz,
  add column if not exists undone_by text;

comment on column public.lib_relabel_log.before_json is
  '바꾸기 전 그 줄과 자리 기록. 되돌리기는 이것을 그대로 다시 써 넣습니다. 고친 뒤에는 전 모습이 어디에도 남지 않으므로 바꾸기 전에 적어 둡니다.';
comment on column public.lib_relabel_log.undone_at is
  '되돌린 시각. 진행 상황(몇 권 바꿨나)은 이 칸이 비어 있는 줄만 셉니다.';

-- 진행 상황을 셀 때마다 보는 조건입니다.
create index if not exists lib_relabel_log_live_idx
  on public.lib_relabel_log (from_product, undone_at);

notify pgrst, 'reload schema';
