import type { ChecklistItem, ChecklistRoute, PersistentNote } from "@/components/shuttle/ShuttleChecklistClient";
import { nameKey } from "@/lib/studentKey";

// 요일마다 다른 셔틀을 타는 학생을 같은 색으로 묶기 위한 팔레트(테두리·링용). 파스텔 계열로
// 골라, 오늘 타는 셔틀에서는 선명하게, 안 타는 날 셔틀에서는 옅게 보여줍니다.
const GROUP_COLORS = [
  "#0ea5e9", "#f97316", "#8b5cf6", "#10b981", "#ec4899",
  "#eab308", "#ef4444", "#14b8a6", "#6366f1", "#a855f7",
  "#f43f5e", "#22c55e", "#3b82f6", "#d946ef", "#f59e0b",
];

/**
 * **지속 특이사항의 효과를 오늘 명단에 덧씌웁니다** — PC 체크표와 모바일 체크표가 함께 씁니다.
 *
 * 개별하원·요일 제외·기간 결석·기간 픽업은 표에 저장되지 않고 화면이 그때그때 계산합니다(지우면
 * 저절로 원래대로). 이 계산이 PC 화면 안에만 있으면 모바일은 그 아이를 「타는 아이」로 그립니다 -
 * 같은 명단을 보는 두 화면이 다른 답을 하게 됩니다(CLAUDE.md 2-13).
 */
export function applyPersistentNotes(
  items: ChecklistItem[],
  notes: PersistentNote[],
  routeById: Map<string, ChecklistRoute>,
  homonymKeySet: Set<string>,
  today: string,
): ChecklistItem[] {
  const normName = (s: string) => (s ?? "").replace(/\s+/g, "").trim();
  // 요일별로 다른 노선(homeRouteId)에 배정된 같은 학생을 찾아 색을 배정합니다.
  const routesByKey = new Map<string, Set<string>>();
  for (const it of items) {
    const key = it.studentId ?? `n:${normName(it.studentName)}`;
    const set = routesByKey.get(key) ?? new Set<string>();
    set.add(it.homeRouteId);
    routesByKey.set(key, set);
  }
  const colorByKey = new Map<string, string>();
  let ci = 0;
  for (const [key, set] of routesByKey) {
    if (set.size > 1) {
      colorByKey.set(key, GROUP_COLORS[ci % GROUP_COLORS.length]);
      ci += 1;
    }
  }
  const routeNoOf = (routeId: string) => routeById.get(routeId)?.route_no ?? "";
  // 요일도 한국 기준으로 셉니다.
  const todayW = new Date(`${today}T12:00:00+09:00`).getDay();
  // 특이사항 ↔ 표의 아이는 **학생 번호로** 짝짓습니다(CLAUDE.md 2-4-6). 예전에는 한쪽에만 번호가
  // 있으면 이름으로 넘어가서, 번호 없는 「김재이 픽업」 한 줄이 김재이 셋 모두에게 걸렸습니다.
  // 이름 길은 명부에 한 명뿐인 이름이거나, 호차(route_no)가 적혀 있어 그 차의 아이로 좁혀질 때만.
  const matches = (note: PersistentNote, it: ChecklistItem) => {
    if (note.studentId && it.studentId) {
      if (note.studentId !== it.studentId) return false;
    } else {
      if (normName(note.studentName) !== normName(it.studentName)) return false;
      if (homonymKeySet.has(nameKey(note.studentName)) && !note.routeNo) return false;
    }
    if (note.routeNo) return routeNoOf(it.homeRouteId).replace(/\s+/g, "") === note.routeNo.replace(/[호\s]/g, "");
    return true;
  };
  return items.map((it) => {
    const key = it.studentId ?? `n:${normName(it.studentName)}`;
    let riding = it.ridingToday;
    let individual = false;
    // 특이사항이 정하는 오늘 상태. 사람이 표에서 이미 손으로 바꿔둔 것은 건드리지
    // 않습니다 - 사람이 마지막에 본 것이 맞습니다.
    let forcedStatus: "픽업" | "결석" | null = null;
    for (const note of notes) {
      if (!matches(note, it)) continue;
      // 기간이 적힌 특이사항은 **오늘이 그 기간 안일 때만** 듣습니다.
      // 9/23~9/28 결석을 9/10에 미리 등록해도 9/10에는 아무 일이 없어야 합니다 -
      // 그게 "미리 넣어둘 수 있다"의 뜻입니다.
      const inPeriod =
        (!note.effectFrom || note.effectFrom <= today) && (!note.effectTo || today <= note.effectTo);

      if (note.effectKind === "no_shuttle") {
        individual = true;
        riding = false;
      } else if (note.effectKind === "skip_days" && note.effectDays.includes(todayW)) {
        riding = false;
      } else if (note.effectKind === "absent" && inPeriod) {
        // 결석은 셔틀만 빼는 게 아니라 그날 상태 자체가 결석입니다.
        riding = false;
        forcedStatus = "결석";
      } else if (note.effectKind === "pickup" && inPeriod) {
        // 픽업도 마찬가지 - 차는 안 타고, 보호자가 데려갑니다.
        // 요일이 적혀 있으면(매주 수요일 픽업) 그 요일에만 겁니다.
        if (note.effectDays.length === 0 || note.effectDays.includes(todayW)) {
          riding = false;
          forcedStatus = "픽업";
        }
      }
    }
    // **담당자가 탑승으로 눌러둔 아이는 오늘 탑니다.**
    //
    // 바로 위 줄들은 `status` 만 지키고 `riding` 은 지키지 않았습니다. 그래서 담당자가
    // 탑승으로 바꿔놓아도 특이사항(개별하원·요일제외·기간결석·픽업)이 매번 다시 계산되어
    // "안 탐"으로 되돌려 놓았습니다. 표에는 흐린 회색 이름으로 남으니 눌러둔 사람도
    // 되돌아간 줄 모르고, 그 아이는 명단에서 빠진 채 차가 떠납니다.
    //
    // 특이사항은 **아직 아무도 안 본 아이**를 미리 빼두라는 표시이지, 사람이 오늘 사정을
    // 듣고 내린 판단을 뒤집으라는 뜻이 아닙니다.
    const humanRiding = it.status === "탑승";
    return {
      ...it,
      ridingToday: humanRiding ? true : riding,
      // **평소에 오늘 타는 아이인가** - 사람이 누른 것을 빼고 본 사실입니다.
      //
      // 위의 `ridingToday` 는 사람이 [탑승]을 누르면 true 로 바뀝니다. 표가 그 값만 보고
      // 버튼을 고르니, 한 번 누른 뒤에는 [탑승] 버튼 자체가 사라져 **되돌릴 수가
      // 없었습니다.** 눌러놓고 아니었네 하고 다시 누르려 해도 누를 자리가 없습니다.
      //
      // 그래서 「평소 안 타는 아이」라는 사실은 따로 남깁니다. 표는 이 값으로 [탑승]
      // 스위치를 그리고, 그래서 몇 번이든 켰다 껐다 할 수 있습니다.
      baseRiding: riding,
      // 사람이 표에서 이미 바꿔둔 줄은 그대로 둡니다 - 사람이 마지막에 본 것이 맞습니다.
      status: it.status === "예정" && forcedStatus ? forcedStatus : it.status,
      // 개별하원 표시는 사실 그대로 둡니다. 오늘만 타는 것이지 평소 개별하원인 것은
      // 맞아서, 지워버리면 담당자가 왜 이 아이가 특별한지 알 수 없게 됩니다.
      individualPickup: individual,
      groupColor: colorByKey.get(key) ?? null,
    };
  });
}
