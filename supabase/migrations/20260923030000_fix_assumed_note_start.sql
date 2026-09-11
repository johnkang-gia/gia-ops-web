-- 기간 특이사항의 **시작일이 앞당겨진 줄**을 사람이 등록한 출결 기간에 맞춥니다.
--
-- ── 무엇이 났나 ────────────────────────────────────────────────────────────
--
-- 한우영의 결석은 9/16 ~ 9/23 인데, 9월 11일 금요일 하원 체크표에 결석으로 떠 있었습니다.
-- 그날 아침 담당자가 손으로 「탑승」으로 되돌려야 했습니다.
--
-- 원인은 **정정 글**이었습니다. 9/09 에 「결석은 23일까지가 맞습니다」라는 글이 왔는데,
-- 그 글에는 시작일이 없습니다. 날짜 읽기는 시작이 없으면 **글이 온 날**로 채웁니다 -
-- 새 통보라면 그게 맞지만, 이미 알고 있는 기간을 고쳐 주는 글에서는 기간이 통째로
-- 앞당겨집니다. 그래서 9/09 ~ 9/23 짜리 특이사항이 **하나 더** 생겼고, 9월 11일이 그 안에
-- 들어갔습니다.
--
-- 화면에는 오류가 아니라 「오늘 결석인 아이」로 보입니다. 그래서 사람이 매일 아침 손으로
-- 되돌리게 됩니다.
--
-- ── 무엇을 고치나 ──────────────────────────────────────────────────────────
--
-- **끝날이 같은데 시작만 앞당겨진 줄**만 고칩니다. 끝날이 같다는 것은 두 줄이 같은 사건을
-- 가리킨다는 뜻이고, 그중 사람이 등록한 출결 기간(`attendance_entries`, state='등록')이
-- 더 정확합니다 - 그건 사람이 보고 넣은 값입니다.
--
-- 넓혀 잡지 않습니다. 「겹치면 다 맞춘다」로 하면 정말 따로인 두 기간을 하나로 만들 수
-- 있고, 그건 지금 문제보다 나쁩니다.

update public.shuttle_persistent_notes n
   set effect_from = e.date_from
  from public.attendance_entries e
 where n.active
   and n.effect_kind = 'absent'
   and e.student_id = n.student_id
   and e.status = '결석'
   and e.state = '등록'
   and n.effect_to = e.date_to
   and n.effect_from < e.date_from;

-- 고친 줄의 설명도 같이 맞춥니다. 본문에 옛 기간이 적혀 있으면, 칸은 고쳐졌는데 읽는
-- 사람은 옛 기간을 믿습니다.
update public.shuttle_persistent_notes n
   set content = regexp_replace(
         n.content,
         '^결석 · \d{4}-\d{2}-\d{2} ~ \d{4}-\d{2}-\d{2}',
         '결석 · ' || n.effect_from::text || ' ~ ' || n.effect_to::text
       )
 where n.active
   and n.effect_kind = 'absent'
   and n.content ~ '^결석 · \d{4}-\d{2}-\d{2} ~ \d{4}-\d{2}-\d{2}'
   and n.content !~ ('^결석 · ' || n.effect_from::text || ' ~ ' || n.effect_to::text);
