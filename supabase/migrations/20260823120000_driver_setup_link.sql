-- ===== 106. 기사님 설정 링크 - 문자로 링크 하나 보내면 끝나도록 =====
-- 요청: "어플의 설정을 편하게 웹앱을 통해서 발급받을 수 있는 페이지를 만들어줄 수 있어?
-- 기사님들이 오셔서 기기를 맡기면 오분이내에 설정이 완료되어야 하는데 매번 기사님 핸드폰으로
-- 앱다운받고 거기서 숫자다적고 하기가 힘들어, 웹앱으로 몇호차 기사님께 보내기하면 기사님
-- 카톡이나 문자로 링크가 가서 누르면 웹앱으로 접속되고..."
--
-- 지금까지는 담당자가 기사님 휴대폰을 받아서 서버 주소(60자 넘는 URL)와 기기 ID 8자리를
-- 손으로 쳐 넣어야 했습니다. 남의 휴대폰 자판으로 URL을 치는 건 오타가 나기 쉽고 시간도
-- 오래 걸립니다. 그래서 기기마다 짧은 설정 링크(/s/{코드})를 하나씩 발급해, 그 링크만 열면
-- 값이 이미 채워진 안내 화면이 뜨고 눌러서 복사만 하면 되도록 했습니다.
--
-- setup_code를 device_id와 따로 두는 이유
--   device_id는 위치를 보내는 열쇠라서, 유출되면 남이 가짜 위치를 밀어 넣을 수 있습니다.
--   반면 설정 링크는 문자·카카오톡으로 나가기 때문에 전달 과정에서 남을 가능성이 훨씬 큽니다.
--   두 값을 분리해두면, 링크가 새어 나갔을 때 setup_code만 새로 발급해서 링크를 무효로 만들 수
--   있고 기사님 휴대폰의 설정은 건드리지 않아도 됩니다.

alter table shuttle_tracker_devices add column if not exists setup_code text;
-- 기사님이 링크를 처음 열어본 시각. 담당자가 "보내드렸는데 하셨나?"를 전화로 묻지 않아도
-- 되도록 남깁니다. 기사님 성함·연락처는 이미 shuttle_routes에 있으므로 여기에 또 두지
-- 않습니다(같은 값이 두 군데 있으면 언젠가 서로 달라집니다).
alter table shuttle_tracker_devices add column if not exists setup_opened_at timestamptz;

-- 이미 등록된 기기에도 링크를 하나씩 만들어 줍니다. 헷갈리는 글자(0/O, 1/l/I)는 빼고,
-- 주소창에 직접 칠 수도 있을 만큼 짧은 6자리로 만듭니다.
do $$
declare
  d record;
  candidate text;
  alphabet text := 'abcdefghjkmnpqrstuvwxyz23456789';
begin
  for d in select id from shuttle_tracker_devices where setup_code is null loop
    loop
      candidate := '';
      for i in 1..6 loop
        candidate := candidate || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
      end loop;
      exit when not exists (select 1 from shuttle_tracker_devices where setup_code = candidate);
    end loop;
    update shuttle_tracker_devices set setup_code = candidate where id = d.id;
  end loop;
end $$;

create unique index if not exists shuttle_tracker_devices_setup_code_idx
  on shuttle_tracker_devices(setup_code);
