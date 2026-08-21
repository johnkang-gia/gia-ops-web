-- ===== 102. 운영 대시보드 하원 종료 시각 =====
-- 요청: "지금 cctv프로그램하고 화면을 분할해서 반반 쓰고 있는데 하원시간에는 전체화면으로
-- 전환되고 하원종료버튼을 누르거나 종료시간이 되면 다시 화면 되돌리게 만들어줘"
--
-- 지금까지는 전환 시각(기본 16:00)만 있고 "언제 끝나는지"가 없어서, 한 번 하원 화면으로 바뀌면
-- 자정까지 그대로 남아 있었습니다. 종료 시각을 두면 하원이 끝난 뒤 자동으로 평소 대시보드로
-- 돌아오고, 전체화면도 함께 풀려 CCTV 반반 화면이 원래대로 복구됩니다.
--
-- 기본값 17:30 - 16:00에 출발해 노선을 다 돌고 마지막 차가 복귀하기까지 걸리는 시간을 기준으로
-- 잡았습니다. 실제 운행에 맞지 않으면 관리 화면에서 바꾸면 됩니다.
alter table ops_board_links add column if not exists shuttle_end_hour int not null default 17;
alter table ops_board_links add column if not exists shuttle_end_minute int not null default 30;

alter table ops_board_links drop constraint if exists ops_board_links_shuttle_end_hour_check;
alter table ops_board_links add constraint ops_board_links_shuttle_end_hour_check
  check (shuttle_end_hour between 0 and 23);
alter table ops_board_links drop constraint if exists ops_board_links_shuttle_end_minute_check;
alter table ops_board_links add constraint ops_board_links_shuttle_end_minute_check
  check (shuttle_end_minute between 0 and 59);
