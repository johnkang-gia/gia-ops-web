-- rls-ok: 칸만 하나 붙입니다. `student_day_notes` 의 자물쇠는 그대로입니다.

-- **몇 시에 해야 하는 일인가.**
--
-- ── 무엇이 부족했나 ────────────────────────────────────────────────────────
--
-- 「서후 약 챙겨주세요」는 적을 수 있게 됐는데, **언제** 챙기는지는 못 적었습니다. 그런데
-- 약은 대개 「점심 먹고」이고, 결제는 「어머니 오시는 3시 반쯤」입니다. 시각을 모르면
-- 목록에 적혀 있어도 사람이 시계를 봐야 하고, 시계를 보는 일은 결국 안 하게 됩니다 -
-- 픽업에서 이미 겪은 일입니다(5분 전 알람을 그래서 만들었습니다).
--
-- ── 비워둘 수 있습니다 ─────────────────────────────────────────────────────
--
-- 「오늘 중에 교재 전달」처럼 시각이 없는 것도 많습니다. 시각을 **반드시** 적게 하면
-- 사람은 아무 시각이나 넣게 되고, 그렇게 들어간 시각으로 알람이 울리면 알람 자체를
-- 못 믿게 됩니다. 비어 있으면 알리지 않고 목록에만 남습니다.

alter table public.student_day_notes add column if not exists at_time time null;

comment on column public.student_day_notes.at_time is
  '몇 시에 해야 하는가. 비어 있으면 알람을 울리지 않고 목록에만 남습니다.';

-- 알람은 「오늘 · 시각이 있는 것」만 훑습니다.
create index if not exists student_day_notes_alarm_idx
  on public.student_day_notes (on_date, at_time)
  where at_time is not null and deleted_at is null;
