/**
 * 오늘 픽업 명단 — 누가, 몇 시에, 어디로 데리러 오는가.
 *
 * 픽업 연락이 오면 지금까지는 "셔틀에서 뺀다"까지만 했습니다. 그런데 픽업에는 두 가지가
 * 섞여 있고, 행정실이 해야 할 일이 서로 다릅니다.
 *
 *   · **셔틀을 타는 아이** — 오늘 그 차에서 빼야 합니다. 안 빼면 기사님이 안 오는 아이를
 *     기다리고, 동승선생님은 명단과 실제가 안 맞아 확인 전화를 겁니다.
 *   · **셔틀을 안 타는 아이** — 원래 보호자가 데려갑니다. 차에서 뺄 것이 없습니다. 대신
 *     **보호자가 몇 시에 오고 그 아이가 어느 교실에 있는지**를 알아야 안내할 수 있습니다.
 *
 * 두 번째가 지금까지 아무 화면에도 없었습니다. 픽업으로 분류만 되고 끝나서, 보호자가
 * 현관에 오면 그때부터 아이를 찾았습니다.
 *
 * 대조 기준은 **오늘 요일의 셔틀 배정**입니다. 배정 자체가 아니라 요일까지 봅니다 -
 * 화·목만 타는 아이는 월요일에는 안 타는 아이와 같습니다.
 */

export type PickupSourceRow = {
  id: string;
  studentId: string | null;
  /** 명부와 대조된 이름. 없으면 AI 가 읽어낸 이름. */
  name: string;
  /** 'HH:MM'. 연락에 시각이 없으면 null. */
  pickupTime: string | null;
  source: string | null;
  channelLabel: string | null;
  senderName: string | null;
  note: string | null;
  status: string;
};

export type PickupRosterStudent = {
  id: string;
  name: string;
  grade: string | null;
  className: string | null;
  classId: string | null;
};

export type PickupClass = {
  id: string;
  grade: string | null;
  className: string | null;
  room: string | null;
  teacherName: string | null;
};

/** 오늘 요일에 셔틀을 타는 배정. 학생 연결이 없는 옛 줄이 있어 이름도 함께 받습니다. */
export type TodayRideAssignment = {
  studentId: string | null;
  studentName: string;
  weekdays: number[];
};

export type TodayPickupItem = {
  requestId: string;
  studentId: string | null;
  name: string;
  grade: string | null;
  className: string | null;
  /** 반의 교실 위치. 안 적혀 있으면 null - 화면에는 반 이름만 나옵니다. */
  room: string | null;
  teacherName: string | null;
  pickupTime: string | null;
  /** 오늘 셔틀을 타는 아이인가. 이것이 두 묶음을 가릅니다. */
  ridesShuttle: boolean;
  source: string | null;
  channelLabel: string | null;
  senderName: string | null;
  note: string | null;
  /** 명부에서 찾지 못한 아이. 반도 교실도 모르니 사람이 봐야 합니다. */
  unmatched: boolean;
};

export const normPickupName = (s: string): string => (s ?? "").replace(/\s+/g, "").trim();

/**
 * 시각 정렬용 값. 시각이 없는 건은 **맨 뒤**로 보냅니다.
 *
 * 앞에 두면 아직 시각을 모르는 건이 목록 머리를 차지해서, 정작 곧 도착하는 보호자가
 * 아래로 밀립니다.
 */
function timeKey(t: string | null): number {
  const m = (t ?? "").match(/^(\d{1,2}):(\d{2})/);
  if (!m) return 99_999;
  return Number(m[1]) * 60 + Number(m[2]);
}

export function buildTodayPickupList(
  requests: PickupSourceRow[],
  roster: PickupRosterStudent[],
  classes: PickupClass[],
  assignments: TodayRideAssignment[],
  todayWeekday: number,
): TodayPickupItem[] {
  const studentById = new Map(roster.map((s) => [s.id, s]));
  const studentByName = new Map<string, PickupRosterStudent>();
  for (const s of roster) {
    const k = normPickupName(s.name);
    // 동명이인은 이름으로 못 가립니다. 두 번째가 오면 그 이름은 아예 비워 둡니다 -
    // 둘 중 하나를 골라두면 절반은 틀린 아이를 가리키는데, 화면에는 맞는 것처럼 보입니다.
    if (studentByName.has(k)) studentByName.set(k, null as unknown as PickupRosterStudent);
    else studentByName.set(k, s);
  }

  const classById = new Map(classes.map((c) => [c.id, c]));
  const classByLabel = new Map<string, PickupClass>();
  for (const c of classes) {
    if (c.className) classByLabel.set(`${(c.grade ?? "").trim()}|${c.className.trim()}`, c);
  }

  // 오늘 타는 아이들. id 와 이름 두 벌로 들고 있습니다.
  const ridingIds = new Set<string>();
  const ridingNames = new Set<string>();
  for (const a of assignments) {
    if (!a.weekdays.includes(todayWeekday)) continue;
    if (a.studentId) ridingIds.add(a.studentId);
    if (a.studentName) ridingNames.add(normPickupName(a.studentName));
  }

  const seen = new Set<string>();
  const out: TodayPickupItem[] = [];

  for (const r of requests) {
    const key = r.studentId ?? normPickupName(r.name);
    if (!key) continue;
    // 같은 아이에게 연락이 두 번 왔으면 한 줄로 봅니다. 앞의 것이 더 최근입니다
    // (부르는 쪽에서 최신순으로 넘깁니다).
    if (seen.has(key)) continue;
    seen.add(key);

    const stu =
      (r.studentId ? studentById.get(r.studentId) : undefined) ?? studentByName.get(normPickupName(r.name)) ?? null;

    const cls = stu
      ? (stu.classId ? classById.get(stu.classId) : undefined) ??
        classByLabel.get(`${(stu.grade ?? "").trim()}|${(stu.className ?? "").trim()}`) ??
        null
      : null;

    const ridesShuttle = stu
      ? ridingIds.has(stu.id) || ridingNames.has(normPickupName(stu.name))
      : ridingNames.has(normPickupName(r.name));

    out.push({
      requestId: r.id,
      studentId: stu?.id ?? r.studentId ?? null,
      name: stu?.name ?? r.name,
      grade: stu?.grade ?? null,
      className: stu?.className ?? cls?.className ?? null,
      room: cls?.room ?? null,
      teacherName: cls?.teacherName ?? null,
      pickupTime: r.pickupTime,
      ridesShuttle,
      source: r.source,
      channelLabel: r.channelLabel,
      senderName: r.senderName,
      note: r.note,
      unmatched: !stu,
    });
  }

  return out.sort(
    (a, b) => timeKey(a.pickupTime) - timeKey(b.pickupTime) || a.name.localeCompare(b.name, "ko"),
  );
}

/** 화면에 쓸 장소 한 줄. 교실이 안 적혀 있으면 반 이름만 나옵니다. */
export function placeLabel(item: TodayPickupItem): string {
  const cls = [item.grade ? `${item.grade}학년` : "", item.className ?? ""].filter(Boolean).join(" ");
  if (!cls && !item.room) return "반 미배정";
  if (!item.room) return cls || "반 미배정";
  return cls ? `${cls} · ${item.room}` : item.room;
}
