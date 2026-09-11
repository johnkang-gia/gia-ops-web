import type { SupabaseClient } from "@supabase/supabase-js";
import { setBoardingStatus } from "@/lib/boardingWrite";

/**
 * **출결 한 건을 적용하고, 되돌립니다.**
 *
 * ── 무엇이 문제였나 ─────────────────────────────────────────────────────────
 *
 * 인박스에서 「결석」을 누르면 **셔틀 체크표에만** 반영됐습니다. 그래서 셔틀을 안 타는
 * 아이는 「셔틀 배정이 없습니다」로 거절당하고 **아무 데도 안 남았습니다** - 임주한이
 * 그랬습니다. 연락은 왔는데 출석부는 비어 있고, 화면에는 오류가 아니라 「처리 못 함」으로만
 * 보입니다.
 *
 * 결석은 **셔틀 이야기가 아니라 학교 이야기**입니다. 차를 타든 안 타든 그날 학교에 안 온
 * 것이고, 그건 출석부에 남아야 합니다. 셔틀은 그 아이가 차를 타는 경우에 딸려오는 일입니다.
 *
 * ── 자동으로 넣은 것은 되돌릴 수 있어야 합니다 ──────────────────────────────
 *
 * 연락을 잘못 읽었거나 사람이 잘못 누를 수 있습니다. 그때 손으로 지우게 두면 어디를 지워야
 * 하는지(셔틀? 출석부? 둘 다?) 매번 다시 찾아야 하고, 한쪽만 지우면 **다른 화면에 그대로
 * 살아 있습니다**(CLAUDE.md 2-9).
 *
 * 그래서 넣기와 되돌리기를 **한 짝으로** 둡니다. 되돌릴 때는 이 자리가 넣은 줄만 지웁니다 -
 * 담임이 직접 찍은 줄(`confirmed_by_human`)은 건드리지 않습니다. 자동이 사람 판단을 뒤집는
 * 일은 없어야 합니다.
 */

/** 인박스·체크표에서 고를 수 있는 상태. `예정` 은 되돌리기입니다. */
export type AttendanceAction = "결석" | "지각" | "조퇴" | "픽업" | "탑승" | "예정";

/** 출석부(`attendance_records`)에 남는 상태. 픽업·탑승은 출석부와 무관합니다. */
const REGISTER_STATUS: Partial<Record<AttendanceAction, "결석" | "지각" | "조퇴">> = {
  결석: "결석",
  지각: "지각",
  조퇴: "조퇴",
};

/** 셔틀 체크표에 쓰는 상태. 지각·조퇴는 하원과 상관없어 체크표를 건드리지 않습니다. */
const BOARDING_STATUS: Partial<Record<AttendanceAction, "결석" | "픽업" | "탑승" | "예정">> = {
  결석: "결석",
  픽업: "픽업",
  탑승: "탑승",
  예정: "예정",
};

export type ApplyResult = {
  /** 셔틀 체크표에서 바꾼 배정 줄 수. 0이면 그 아이는 그날 차를 안 탑니다. */
  boardings: number;
  /** 출석부에 넣었는가 / 지웠는가. */
  register: "넣음" | "이미 있음" | "지움" | "해당 없음";
  /** 사람에게 그대로 보여줄 한 줄. 무엇이 되고 무엇이 안 됐는지 적습니다. */
  note: string;
  errors: string[];
};

export async function applyAttendance(
  supabase: SupabaseClient,
  input: {
    studentId: string | null;
    studentName: string;
    serviceDate: string;
    action: AttendanceAction;
    /** 그날 이 아이의 셔틀 배정 줄. 없으면 빈 배열 - 그래도 출석부는 씁니다. */
    assignments: { id: string; student_name_raw: string }[];
    actor: { email: string; name: string | null };
    /** 어디서 온 연락인가. 출석부의 「출처」 칸에 그대로 뜹니다. */
    source: "토들" | "구글챗" | "직접 등록";
  },
): Promise<ApplyResult> {
  const errors: string[] = [];
  const { studentId, studentName, serviceDate, action, assignments, actor } = input;

  // ── ① 셔틀 체크표 ─────────────────────────────────────────────────────────
  let boardings = 0;
  const boardingStatus = BOARDING_STATUS[action];
  if (boardingStatus) {
    for (const a of assignments) {
      const { error } = await setBoardingStatus(supabase, {
        serviceDate,
        assignmentId: a.id,
        studentName: a.student_name_raw,
        status: boardingStatus,
        actor,
      });
      if (error) errors.push(`셔틀 체크표: ${error}`);
      else boardings += 1;
    }
  }

  // ── ② 출석부 ──────────────────────────────────────────────────────────────
  //
  // 학생 번호가 없으면 출석부에 쓸 수 없습니다(`attendance_records.student_id` 는 필수).
  // 조용히 넘기지 않고 그 사실을 적어 돌려줍니다 - 사람이 학생을 이어주면 됩니다.
  const registerStatus = REGISTER_STATUS[action];
  let register: ApplyResult["register"] = "해당 없음";

  if (action === "예정") {
    // 되돌리기. **이 자리가 자동으로 넣은 줄만** 지웁니다.
    if (studentId) {
      const { data, error } = await supabase
        .from("attendance_records")
        .delete()
        .eq("student_id", studentId)
        .eq("date", serviceDate)
        .eq("confirmed_by_human", false)
        .select("id");
      if (error) errors.push(`출석부 되돌리기: ${error.message}`);
      else register = (data ?? []).length > 0 ? "지움" : "해당 없음";
    }
  } else if (registerStatus) {
    if (!studentId) {
      errors.push("학생이 연결되지 않아 출석부에 남기지 못했습니다. 인박스에서 학생을 골라주세요.");
    } else {
      // **사람이 찍어둔 줄은 덮어쓰지 않습니다.** (학생, 날짜)가 유일해서 upsert 로 밀면
      // 담임이 정한 값이 조용히 바뀝니다.
      const { data: existing, error: readErr } = await supabase
        .from("attendance_records")
        .select("id, confirmed_by_human")
        .eq("student_id", studentId)
        .eq("date", serviceDate)
        .maybeSingle();
      if (readErr) {
        errors.push(`출석부 조회: ${readErr.message}`);
      } else if (existing) {
        register = "이미 있음";
      } else {
        const { error } = await supabase.from("attendance_records").insert({
          student_id: studentId,
          date: serviceDate,
          status: registerStatus,
          // 사유는 연락 글에서 가릴 수 없습니다. 비워두고 사람이 고르게 합니다 - 여기서
          // 「질병」을 찍어두면 아무도 다시 안 봅니다.
          reason_type: null,
          source: input.source,
          // 자동으로 들어왔다는 표시. 되돌릴 때 이 줄만 지웁니다.
          confirmed_by_human: false,
          checked_by: actor.email,
          checked_by_name: actor.name,
          checked_at: new Date().toISOString(),
        });
        if (error) errors.push(`출석부 기록: ${error.message}`);
        else register = "넣음";
      }
    }
  }

  // ── ③ 사람이 읽을 한 줄 ───────────────────────────────────────────────────
  const parts: string[] = [];
  if (action === "예정") {
    parts.push(boardings > 0 ? `셔틀 ${boardings}건을 되돌렸습니다` : "셔틀에 되돌릴 줄이 없습니다");
    if (register === "지움") parts.push("출석부에서도 지웠습니다");
  } else {
    if (boardingStatus) {
      parts.push(boardings > 0 ? `셔틀 ${boardings}건 ${action}` : "그날 셔틀 배정은 없습니다");
    }
    if (registerStatus) {
      parts.push(
        register === "넣음"
          ? `출석부에 ${registerStatus}으로 남겼습니다`
          : register === "이미 있음"
            ? "출석부에는 이미 오늘 기록이 있어 그대로 두었습니다"
            : "출석부에는 남기지 못했습니다",
      );
    }
  }

  return { boardings, register, note: `${studentName} — ${parts.join(" · ")}`, errors };
}
