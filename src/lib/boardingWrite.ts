import type { SupabaseClient } from "@supabase/supabase-js";
import { logChecklist, type ChecklistReason, type LogActor } from "./checklistLog";

/**
 * **탑승 상태를 바꾸는 일은 여기 한 곳에서만 합니다.**
 *
 * ── 무엇이 문제였나 ──────────────────────────────────────────────────
 *
 * 「누가 픽업으로 바꿨는지」를 볼 수 있게 활동 기록(`shuttle_checklist_log`)을 만들어 뒀는데,
 * 정작 **하원 체크표에서 누른 것만** 기록에 남았습니다. 같은 표(`shuttle_boardings`)를 고치는
 * 자리가 다섯 곳이나 더 있었기 때문입니다.
 *
 *   · 담임 픽업체크 화면          · 출결내역 원클릭 처리
 *   · 현장 도착체크(로그인 없음)  · 아침 크론·AI 자동 반영
 *
 * 이 자리들에서 바꾸면 표시는 바뀌는데 **기록에는 아무것도 안 남습니다.** 그러면 체크표에서
 * 「이 아이 누가 픽업으로 바꿨지?」를 물었을 때 답할 곳이 없고, 화면에는 오류가 아니라
 * 그냥 «아무도 안 한 것»처럼 보입니다. 강서우·김도은이 그렇게 보였습니다.
 *
 * ── 그래서 ───────────────────────────────────────────────────────────
 *
 * 상태 바꾸기와 기록 남기기를 **한 번의 부름으로 묶습니다.** 둘을 따로 두면 새 화면을 만들
 * 때마다 한쪽을 잊고, 잊었다는 사실은 몇 주 뒤 「누가 했지?」를 물을 때에야 드러납니다.
 *
 * `npm run build` 가 `scripts/check-boarding-log.mjs` 를 돌려, 이 함수를 거치지 않고 상태를
 * 바꾸는 코드를 찾아 막습니다.
 */

/** 누가 바꿨는가. 로그인 없는 화면은 email 대신 자리 이름을 적습니다("하원지도(현장)"). */
export type BoardingActor = LogActor;

export type BoardingStatus = "예정" | "탑승" | "미탑승" | "결석" | "픽업";

/** 표에 적히는 「누가」. 이름을 알면 이름, 모르면 메일, 둘 다 없으면 자리 이름입니다. */
export function actorLabel(actor: BoardingActor): string {
  return (actor.name ?? "").trim() || actor.email || "확인 안 됨";
}

/**
 * 한 아이의 오늘 탑승 상태를 바꾸고, 누가 바꿨는지 기록까지 남깁니다.
 *
 * **기록이 실패해도 상태 변경은 되돌리지 않습니다.** 픽업 표시는 아이가 차를 타느냐 마느냐의
 * 문제고, 기록은 나중에 되돌아보기 위한 것입니다. 둘의 무게가 다릅니다 - 다만 기록 실패는
 * 서버 로그에 소리를 냅니다(`logChecklist`).
 */
export async function setBoardingStatus(
  supabase: SupabaseClient,
  args: {
    serviceDate: string;
    /** 학기. 기록을 학기별로 되짚을 때 씁니다. 모르면 비워둡니다. */
    term?: string | null;
    assignmentId: string;
    /** 기록에 남길 이름. 배정 번호만으로는 나중에 누구인지 못 읽습니다. */
    studentName: string;
    status: BoardingStatus;
    /** 바뀌기 전 상태. 모르면 비워둡니다 - 기록에 「? → 픽업」으로 남습니다. */
    before?: BoardingStatus | string | null;
    actor: BoardingActor;
    /**
     * **왜 바꿨는가.** 자동으로 바꾸는 자리는 반드시 채웁니다 - 「토들」은 창구 이름이지
     * 사람이 아니라, 이것이 없으면 나중에 물어볼 곳이 없습니다. 사람이 직접 누른 자리는
     * 비워둡니다(누가 눌렀는지가 곧 근거입니다).
     */
    reason?: ChecklistReason | null;
  },
): Promise<{ error: string | null }> {
  const { error } = await supabase.from("shuttle_boardings").upsert(
    {
      service_date: args.serviceDate,
      assignment_id: args.assignmentId,
      status: args.status,
      // **누가** 눌렀는지를 줄 자체에 남깁니다. 「담임」·「체크표」처럼 자리 이름만 적으면
      // 근거 창이 "담임님이 체크표에서 픽업으로 표시했습니다"라고 말합니다 - 물어볼 사람이
      // 여전히 없습니다.
      checked_by: actorLabel(args.actor),
      checked_at: new Date().toISOString(),
    },
    { onConflict: "service_date,assignment_id" },
  );
  if (error) return { error: error.message };

  await logChecklist(supabase, {
    serviceDate: args.serviceDate,
    term: args.term ?? null,
    assignmentId: args.assignmentId,
    studentName: args.studentName,
    action: "상태변경",
    before: args.before ?? null,
    after: args.status,
    actor: args.actor,
    reason: args.reason ?? null,
  });
  return { error: null };
}
