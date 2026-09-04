import { genCaseId } from "./caseId";

/**
 * 픽업 한 건을 업무보드에 남기는 규칙.
 *
 * 픽업은 «알고만 있으면 되는 일»이 아닙니다. 시각이 되면 행정직원이 교실로 가서 아이를
 * 데려와야 하는, 사람이 몸으로 하는 일입니다. 그런데 지금까지 픽업은 인박스와 하원
 * 체크표에만 남았습니다 — 둘 다 «지금 상태»를 보여주는 화면이지 «누가 무엇을 언제
 * 해야 하는가»를 관리하는 자리가 아닙니다.
 *
 * 그래서 업무로도 남깁니다. 마감시각을 픽업 시각으로 두면 업무보드가 알아서 임박·지연을
 * 표시하고, 하루가 끝난 뒤 «오늘 픽업 몇 건을 처리했나»가 기록으로 남습니다.
 *
 * 문의(to-task)와 달리 **자동으로** 만듭니다. 문의는 하루 수십 건이라 사람이 골라야
 * 하지만, 픽업은 확정된 순간 이미 «해야 하는 일»이 확정된 것이라 고를 여지가 없습니다.
 */

export type PickupTaskInput = {
  studentName: string;
  /** 'HH:MM'. 없으면 마감시각을 안 겁니다 - 모르는 시각을 지어내면 알림이 거짓말을 합니다. */
  pickupTime: string | null;
  /** 'YYYY-MM-DD' (한국 날짜). */
  serviceDate: string;
  /** 학년·반·교실. 어디로 가야 하는지가 제목에 있어야 화면을 더 안 열어봅니다. */
  place: string | null;
  department: string | null;
  ownerEmail: string;
  assigneeEmails: string[];
  rawText: string | null;
  sourceLabel: string | null;
  sourceUrl: string | null;
};

/** 'HH:MM' + 한국 날짜 → ISO. 시각이 없으면 null(마감 없음). */
export function pickupDueAt(serviceDate: string, pickupTime: string | null): string | null {
  const m = (pickupTime ?? "").match(/^(\d{1,2}):(\d{2})/);
  if (!m || !/^\d{4}-\d{2}-\d{2}$/.test(serviceDate)) return null;
  const hh = String(Math.min(23, Number(m[1]))).padStart(2, "0");
  // 한국 시각으로 못박습니다. `new Date("...T15:40")` 은 서버 시간대를 따라가서,
  // 배포 환경이 UTC면 아홉 시간 뒤가 마감이 됩니다.
  return new Date(`${serviceDate}T${hh}:${m[2]}:00+09:00`).toISOString();
}

export function buildPickupTask(input: PickupTaskInput) {
  const time = input.pickupTime ? `${input.pickupTime} ` : "";
  const place = input.place ? ` · ${input.place}` : "";
  return {
    case_id: genCaseId("TSK"),
    title: `[픽업] ${time}${input.studentName}${place}`.slice(0, 80),
    status: "예정" as const,
    // 시각이 정해진 일이라 늦으면 그대로 사고입니다. 보통으로 두면 목록에서 묻힙니다.
    priority: "긴급" as const,
    department: input.department,
    owner_email: input.ownerEmail,
    assignee_emails: input.assigneeEmails,
    position: Date.now(),
    due_at: pickupDueAt(input.serviceDate, input.pickupTime),
    description: [
      `${input.serviceDate} ${input.pickupTime ?? "시각 미정"} 픽업`,
      input.place ? `데리러 갈 곳: ${input.place}` : null,
      input.rawText ? `학부모 연락:\n${input.rawText}` : null,
      input.sourceLabel ? `출처: ${input.sourceLabel}` : null,
      input.sourceUrl ? `원문: ${input.sourceUrl}` : null,
    ]
      .filter(Boolean)
      .join("\n\n"),
  };
}

/**
 * 픽업까지 남은 시간(분). 지났으면 음수.
 *
 * 알림은 **5분 전 한 번**입니다. 계속 울리면 사람은 알림을 끄고, 끄면 없는 것과 같습니다.
 */
export function minutesUntil(dueAtIso: string | null, now: Date = new Date()): number | null {
  if (!dueAtIso) return null;
  const t = new Date(dueAtIso).getTime();
  if (!Number.isFinite(t)) return null;
  return Math.round((t - now.getTime()) / 60000);
}

/** 지금 알려야 하는가. 5분 전부터 시각까지를 «곧»으로 봅니다. */
export const ALERT_LEAD_MINUTES = 5;

export function isDueSoon(dueAtIso: string | null, now: Date = new Date()): boolean {
  const m = minutesUntil(dueAtIso, now);
  return m !== null && m <= ALERT_LEAD_MINUTES && m >= 0;
}
