import { ridesToday } from "@/lib/ridesToday";
import { NextResponse } from "next/server";
import { applyAttendance, type AttendanceAction } from "@/lib/attendanceApply";
import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import { logApiError } from "@/lib/logging";
import { normalizeName } from "@/lib/studentName";

export const dynamic = "force-dynamic";

// 문의 한 건을 읽은 자리에서 곧바로 셔틀 출결까지 끝내는 곳입니다.
//
// 요청: "학부모 문의 중에 출결에 관한 부분은 또 셔틀에 가서 입력하고, 다시 와서 또 보고 하는
// 과정이 들어가서 힘들어."
//
// 예전 흐름: 인박스에서 "오늘 지호 결석해요"를 읽음 → [셔틀 → 하원 체크표]로 이동 → 명단에서
// 지호를 찾음 → 결석 체크 → 다시 업무 보드로 돌아옴 → 어디까지 처리했는지 다시 확인.
// 화면을 두 번 오가고, 그 사이에 다른 문의가 들어오면 놓칩니다.
//
// 지금 흐름: 문의 카드의 [결석]·[픽업]·[탑승] 버튼 한 번. 이 라우트가 이름 → 오늘 배정 →
// shuttle_boardings 까지 한 번에 처리합니다. 하원 체크표가 쓰는 표와 같은 곳에 같은 모양으로
// 쓰기 때문에, 체크표·안내보드·도착체크·운영 대시보드에 그대로 실시간 반영됩니다.
//
// 셔틀을 안 타는 학생(배정 없음)이라도 "결석"은 의미가 있으므로, 배정이 없으면 그 사실을
// 분명히 알려줍니다(조용히 성공한 척하지 않습니다).

// 배정표 이름은 "김연우A"처럼 뒤에 표기가 붙거나 괄호 영문·학년이 섞일 수 있어서, 비교할
// 때만 괄호 뒤와 공백을 떼고 맞춰봅니다.
//
// 다듬는 규칙은 `src/lib/studentName.ts` 것을 씁니다. 여기서 또 만들면 앱 안에 서로 다른
// 답이 생깁니다 - 실제로 그렇게 흩어져 있던 탓에 같은 오류가 자리를 바꿔가며 났습니다.
// 괄호 **뒤를 버리는 것**만 여기 사정이라 앞에서 한 번 자릅니다.
function compareKey(name: string): string {
  return normalizeName((name ?? "").split("(")[0]);
}

// 'YYYY-MM-DD' → 요일 번호(일=0). 배정표의 weekdays와 맞춰보기 위해 씁니다.
function weekdayOf(iso: string): number {
  // 정오로 두어 시간대 차이로 하루가 밀리는 일을 막습니다.
  return new Date(`${iso}T12:00:00+09:00`).getDay();
}

function kstToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

export async function POST(req: Request) {
  const supabase = await createClient();
  try {
    const me = await getCurrentAppUser();
    if (!me) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

    const body = (await req.json().catch(() => null)) as {
      studentName?: string;
      /** 학생 번호. **이게 있으면 이것만 씁니다** - 이름은 겹치고 번호는 안 겹칩니다. */
      studentId?: string;
      action?: string;
      serviceDate?: string;
      inquiryId?: string;
      /** 어디서 온 연락인가. 출석부의 「출처」 칸에 그대로 뜹니다. */
      source?: "토들" | "구글챗" | "직접 등록";
      /**
       * 근거가 된 글. 화면이 이미 들고 있으면 그대로 넘깁니다 - 서버가 다시 읽으면
       * 그 사이에 연락이 정리됐을 때 근거가 비어버립니다.
       */
      reasonText?: string;
      reasonFrom?: string;
    } | null;

    const rawName = (body?.studentName ?? "").trim();
    const action = body?.action ?? "";
    if (!rawName) return NextResponse.json({ error: "학생 이름이 없습니다." }, { status: 400 });
    // 지각·조퇴가 빠져 있었습니다. 학부모 연락은 픽업만 오는 것이 아닌데 고를 수 있는 것이
    // 넷뿐이라, 지각 연락을 받으면 인박스에서 할 수 있는 일이 없었습니다.
    if (!["결석", "지각", "조퇴", "픽업", "탑승", "예정"].includes(action)) {
      return NextResponse.json({ error: "처리할 수 없는 상태입니다." }, { status: 400 });
    }
    // '예정'은 되돌리기(취소)입니다 - 잘못 눌렀을 때 체크표에서 지우는 것과 같은 효과.
    const serviceDate = /^\d{4}-\d{2}-\d{2}$/.test(body?.serviceDate ?? "") ? body!.serviceDate! : kstToday();
    const weekday = weekdayOf(serviceDate);
    const key = compareKey(rawName);

    // 그 날 실제로 차를 타기로 되어 있는 배정만 봅니다(요일제 학생이 있어서, 요일을 무시하면
    // 안 타는 날에 결석 표시가 붙습니다).
    const { data: assignments, error: aErr } = await supabase
      .from("shuttle_assignments_basic")
      .select("id, student_name_raw, weekdays, student_id");
    if (aErr) throw aErr;

    // ── 이름이 겹치면 이름으로 처리하지 않습니다 ──────────────────────────
    //
    // 여기가 김재이·심재이·유재이가 한꺼번에 처리되던 자리 중 하나입니다. 아래에서 배정을
    // **이름으로** 골라 걸리는 것을 전부 같은 상태로 바꿉니다. 한 아이가 두 노선에 걸쳐
    // 있을 때는 그게 맞지만, **같은 이름의 다른 아이 셋**과 구별할 방법이 없었습니다.
    // 결석 한 번이 세 아이를 결석으로 만들고, 그건 화면에 오류로 안 보입니다.
    //
    // 번호가 오면 번호만 씁니다. 번호가 없는데 이름이 겹치면 **하지 않고 되돌려 보냅니다** -
    // 셋 중 누구인지 모르는 채로 손대는 것보다 사람에게 묻는 편이 낫습니다.
    const studentId = (body?.studentId ?? "").trim() || null;
    if (!studentId) {
      const { data: same } = await supabase
        .from("wr_students")
        .select("id, name, grade, class_name")
        .eq("is_demo", false)
        .eq("name", rawName);
      const rows = (same as { id: string; grade: string | null; class_name: string | null }[] | null) ?? [];
      if (rows.length > 1) {
        return NextResponse.json(
          {
            ok: false,
            reason: "homonym",
            message: `${rawName} 학생이 ${rows.length}명입니다(${rows
              .map((r) => (r.class_name ?? "").trim() || `${r.grade ?? "?"}학년`)
              .join("·")}). 누구인지 정해야 처리할 수 있습니다 - 인박스에서 학생을 연결해주세요.`,
          },
          { status: 200 },
        );
      }
    }

    // 오늘만 타기로 체크표에서 바꾼 아이도 대상입니다. 요일만 보면, 그 아이를 결석·픽업으로
    // 바꾸려 할 때 「셔틀을 안 타는 학생」이라는 엉뚱한 답이 돌아옵니다.
    const { data: dayBoardings } = await supabase
      .from("shuttle_boardings")
      .select("assignment_id, status")
      .eq("service_date", serviceDate);
    const todays = ridesToday(
      (assignments as { id: string; student_name_raw: string; weekdays: number[]; student_id: string | null }[] | null) ?? [],
      (dayBoardings as { assignment_id: string; status: string | null }[] | null) ?? [],
      weekday,
    );

    // 번호가 있으면 번호로 고릅니다. 옛 배정 줄에는 번호가 안 붙어 있어서, 번호로 하나도
    // 못 찾으면 이름으로 한 번 더 봅니다 - 다만 위에서 이미 겹치는 이름은 걸러냈습니다.
    const byId = studentId ? todays.filter((a) => a.student_id === studentId) : [];
    const matches = byId.length > 0 ? byId : todays.filter((a) => compareKey(a.student_name_raw ?? "") === key);

    // ── 셔틀 배정이 없어도 멈추지 않습니다 ───────────────────────────────
    //
    // 예전에는 여기서 거절했습니다. 그래서 셔틀을 안 타는 아이의 결석은 **아무 데도 안
    // 남았습니다** - 연락은 왔는데 출석부는 비어 있고, 화면에는 「처리 못 함」으로만
    // 보입니다. 결석은 셔틀 이야기가 아니라 학교 이야기입니다.
    //
    // 픽업·탑승은 셔틀에서만 뜻이 있으므로, 그때만 배정이 없다고 알려줍니다.
    if (matches.length === 0 && (action === "픽업" || action === "탑승")) {
      return NextResponse.json(
        {
          ok: false,
          reason: "no_assignment",
          message: `${rawName} 학생은 ${serviceDate}에 셔틀 배정이 없습니다(도보·자차 하원이거나 배정표 이름이 다를 수 있습니다).`,
        },
        { status: 200 }
      );
    }

    // 같은 이름이 여러 배정에 걸린 경우(형제 채널·요일 분할 탑승)에는 전부 같은 상태로
    // 처리합니다 - 한 명이 두 노선에 걸쳐 있을 때 한쪽만 결석으로 두면 반대쪽 차가 기다립니다.
    // 상태 바꾸기와 「누가 바꿨는지」 기록을 한 부름으로 묶습니다. 예전에는 여기서 표만
    // 고쳐서, 하원 체크표의 활동 기록에는 아무 줄도 안 남았습니다 - 표시는 바뀌어 있는데
    // 「누가 했지?」를 물을 곳이 없었습니다.
    //
    // **셔틀과 출석부를 한 짝으로 처리합니다**(`applyAttendance`). 두 곳을 따로 고치면
    // 한쪽만 되고 다른 쪽은 안 된 상태가 생기는데, 그건 화면에 오류로 안 보입니다.
    // ── 왜 바꿨는가를 함께 굳힙니다 ──────────────────────────────────────
    //
    // 「토들」만 남으면 며칠 뒤 체크표에서 「왜 결석이지?」를 물었을 때 답할 것이 창구
    // 이름뿐입니다. 화면이 원문을 들고 있으면 그것을 쓰고, 없으면 연락 줄에서 한 번 읽어
    // 옵니다 - 두 번째 길이 없으면 구글챗 알림처럼 원문을 안 들고 오는 화면에서 근거가
    // 통째로 빕니다.
    let reasonText = (body?.reasonText ?? "").trim();
    let reasonFrom = (body?.reasonFrom ?? "").trim() || null;
    let reasonUrl: string | null = null;
    if (!reasonText && body?.inquiryId) {
      const { data: src } = await supabase
        .from("pickup_requests")
        .select("raw_text, channel_label, sender_name, source_url")
        .eq("id", body.inquiryId)
        .maybeSingle();
      reasonText = ((src?.raw_text as string | null) ?? "").trim();
      reasonFrom = reasonFrom ?? ((src?.channel_label as string | null) ?? (src?.sender_name as string | null) ?? null);
      reasonUrl = (src?.source_url as string | null) ?? null;
    }

    const applied = await applyAttendance(supabase, {
      studentId: studentId ?? matches.find((m) => m.student_id)?.student_id ?? null,
      studentName: matches[0]?.student_name_raw ?? rawName,
      serviceDate,
      action: action as AttendanceAction,
      assignments: matches.map((a) => ({ id: a.id, student_name_raw: a.student_name_raw })),
      actor: { email: me.email, name: me.name ?? null },
      source: body?.source ?? "토들",
      // 근거가 없으면 **없다고 둡니다.** 「담당자가 눌렀습니다」 같은 빈 문장을 채워 넣으면
      // 근거가 있는 줄과 구별이 사라집니다.
      reason: reasonText
        ? { text: reasonText, source: body?.source ?? "토들", from: reasonFrom, url: reasonUrl }
        : null,
    });

    // 이 문의는 처리된 것으로 표시합니다 - 셔틀에 반영해 놓고 인박스에는 그대로 남아 있으면,
    // 다음 사람이 또 처리하거나 "아직 안 했나?" 하고 다시 확인하게 됩니다.
    if (body?.inquiryId) {
      await supabase
        .from("pickup_requests")
        .update({ answered_at: new Date().toISOString(), answered_by: me.email, answered_via: "출결처리" })
        .eq("id", body.inquiryId);
    }

    return NextResponse.json({
      ok: applied.errors.length === 0,
      matched: applied.boardings,
      register: applied.register,
      studentName: matches[0]?.student_name_raw ?? rawName,
      serviceDate,
      status: action,
      // 무엇이 되고 무엇이 안 됐는지 한 줄로. 조용히 성공한 척하지 않습니다.
      message: applied.errors.length > 0 ? `${applied.note} (${applied.errors.join(" / ")})` : applied.note,
    });
  } catch (err) {
    await logApiError(supabase, "work:attendance-action", err);
    return NextResponse.json({ error: "처리하지 못했습니다." }, { status: 500 });
  }
}
