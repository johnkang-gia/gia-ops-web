/**
 * **출결 등록표의 유일 열쇠.** 데이터베이스의 `attendance_entries_source_uniq` 와 글자 그대로
 * 같아야 합니다. 열쇠가 바뀌면(20261022 에 날짜가 더해졌습니다) upsert 하는 자리 전부가 함께
 * 바뀌어야 하는데, 일곱 군데에 손으로 적혀 있어서 한 곳만 바뀌었습니다. 나머지 여섯은 42P10
 * (no unique or exclusion constraint matching the ON CONFLICT) 으로 2주 동안 실패했고,
 * 「넘기기」·「직접 등록」·「오늘만 이 아이로」가 전부 안 됐습니다. 여기 한 곳에서만 적습니다.
 *
 * 따로 떼어 둔 이유: 자료 등기소(화면에서도 읽음)가 같은 열쇠로 중복을 셉니다. 출결 계산 전체를
 * 화면에 실어 보내지 않고 열쇠만 나눠 씁니다.
 */
export const ATTENDANCE_ENTRY_KEY = "source,source_message_id,student_name,status,date_from";
