import { NextResponse } from "next/server";
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
      action?: string;
      serviceDate?: string;
      inquiryId?: string;
    } | null;

    const rawName = (body?.studentName ?? "").trim();
    const action = body?.action ?? "";
    if (!rawName) return NextResponse.json({ error: "학생 이름이 없습니다." }, { status: 400 });
    if (!["결석", "픽업", "탑승", "예정"].includes(action)) {
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
      .select("id, student_name_raw, weekdays");
    if (aErr) throw aErr;

    const todays = ((assignments as { id: string; student_name_raw: string; weekdays: number[] }[] | null) ?? []).filter((a) =>
      (a.weekdays ?? []).includes(weekday)
    );

    const matches = todays.filter((a) => compareKey(a.student_name_raw ?? "") === key);

    if (matches.length === 0) {
      // 셔틀을 안 타는 학생이거나(도보·자차 하원), 배정표 이름이 명부와 다르게 적힌 경우입니다.
      // 어느 쪽인지는 사람이 봐야 알 수 있으므로 그대로 알려줍니다.
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
    const rows = matches.map((a) => ({
      service_date: serviceDate,
      assignment_id: a.id,
      status: action,
      checked_by: me.email,
      checked_at: new Date().toISOString(),
    }));

    const { error: bErr } = await supabase
      .from("shuttle_boardings")
      .upsert(rows, { onConflict: "service_date,assignment_id" });
    if (bErr) throw bErr;

    // 이 문의는 처리된 것으로 표시합니다 - 셔틀에 반영해 놓고 인박스에는 그대로 남아 있으면,
    // 다음 사람이 또 처리하거나 "아직 안 했나?" 하고 다시 확인하게 됩니다.
    if (body?.inquiryId) {
      await supabase
        .from("pickup_requests")
        .update({ answered_at: new Date().toISOString(), answered_by: me.email, answered_via: "출결처리" })
        .eq("id", body.inquiryId);
    }

    return NextResponse.json({
      ok: true,
      matched: matches.length,
      studentName: matches[0].student_name_raw,
      serviceDate,
      status: action,
    });
  } catch (err) {
    await logApiError(supabase, "work:attendance-action", err);
    return NextResponse.json({ error: "처리하지 못했습니다." }, { status: 500 });
  }
}
