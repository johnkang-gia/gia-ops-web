-- ===== 101. 운영 대시보드 짧은 주소 =====
-- 요청: "운영안내 대시보드 주소 간결하게 만들어주고,(다른곳에서 바로 주소만쳐서 들어갈 수 있게"
--
-- 지금 대시보드 주소는 /ops-board/3f2a9c1e-... 처럼 36자리 토큰이 붙어 있어서, 사무실 모니터나
-- 다른 컴퓨터에서 주소창에 직접 치는 것이 사실상 불가능합니다. 안내보드에 이미 같은 문제로
-- 짧은 주소(/b/{코드})를 만들어 뒀으므로, 같은 방식으로 /d/{코드}를 둡니다(d = dashboard).
--
-- 토큰을 짧게 바꾸는 것이 아니라 짧은 코드를 하나 더 두는 방식인 이유는, 토큰 자체를 짧게 하면
-- 아무나 몇 번 찍어보는 것만으로 대시보드를 열 수 있게 되기 때문입니다. 짧은 코드는 "우리
-- 직원이 주소창에 치기 위한 지름길"일 뿐이고, 이 화면에는 학생 개인정보(연락처·주소)가 없으며
-- 사용을 멈추려면 [중지] 한 번으로 즉시 막힙니다.

alter table ops_board_links add column if not exists short_code text;
-- null인 행끼리는 서로 겹쳐도 되므로 부분 유니크 인덱스를 씁니다.
create unique index if not exists ops_board_links_short_code_idx
  on ops_board_links(short_code) where short_code is not null;

-- 이미 만들어 둔 링크에도 코드를 하나씩 채워줍니다. 관리자가 화면에서 원하는 값으로 바꿀 수
-- 있으니 여기서는 겹치지 않는 아무 값이면 충분합니다.
--
-- 글자 후보에서 0·o·1·i·l을 뺐습니다. 이 코드는 눈으로 보고 손으로 옮겨 치는 용도라, 가장 흔한
-- 실수가 0과 O를 헷갈리는 것입니다.
do $do$
declare
  r record;
  candidate text;
  chars text := '23456789abcdefghjkmnpqrstuvwxyz';
  i int;
begin
  for r in select id from ops_board_links where short_code is null loop
    -- 겹치면 다시 뽑습니다. 4자리(약 92만 가지)라 실제로 겹칠 일은 거의 없습니다.
    for i in 1..20 loop
      candidate := '';
      candidate := candidate || substr(chars, 1 + floor(random() * length(chars))::int, 1);
      candidate := candidate || substr(chars, 1 + floor(random() * length(chars))::int, 1);
      candidate := candidate || substr(chars, 1 + floor(random() * length(chars))::int, 1);
      candidate := candidate || substr(chars, 1 + floor(random() * length(chars))::int, 1);
      exit when not exists (select 1 from ops_board_links where short_code = candidate);
    end loop;
    update ops_board_links set short_code = candidate where id = r.id;
  end loop;
end
$do$;
