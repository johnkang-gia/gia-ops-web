import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import { applyPickup } from "@/lib/pickupIngest";
import { logApiError } from "@/lib/logging";
import { todayKst, kstWeekday } from "@/lib/kst";
import { assumeAfternoon } from "@/lib/pickupParse";
import { addDays as addDaysIso, rangeAppliesOn, weekStartOf } from "@/lib/dismissalWeek";

/**
 * **하원수단을 넣고, 오늘 것이면 셔틀 체크표까지 바로 겁니다.**
 *
 * ── 무엇이 문제였나 ──────────────────────────────────────────────────
 *
 * 하원수단을 적어두면 그건 `student_dismissal_plans` 에만 들어갑니다. 하원 체크표는 그 표를
 * 직접 읽어 화면에서 반영하지만, **안내보드·도착체크·사무실 대시보드는 `shuttle_boardings`
 * 만 봅니다.** 그 표에 거는 일은 다음 날 아침 크론이 합니다.
 *
 * 그래서 오후에 「오늘 얘는 할머니가 데려가요」를 넣으면, 체크표에는 뜨는데 안내보드에는
 * 계속 「타는 아이」로 남습니다. 화면마다 다른 답을 하면 **결국 아무도 안 믿습니다.**
 *
 * ── 그래서 ───────────────────────────────────────────────────────────
 *
 * 넣은 것이 **오늘 요일이고 셔틀이 아니면** 그 자리에서 `applyPickup` 을 부릅니다. 아침
 * 크론이 쓰는 것과 **같은 함수**입니다 - 두 곳에 각각 쓰면 아침에 걸린 것과 낮에 걸린 것이
 * 다른 모양이 되고, 어느 쪽이 맞는지 알 수 없게 됩니다.
 *
 * **사람이 이미 정해둔 줄은 덮지 않습니다.** `applyPickup` 안에 그 검사가 있습니다 -
 * 「오늘은 그래도 탄다」고 담당자가 눌러둔 것을 자동이 되돌리면, 그 아이는 명단에서 빠진 채
 * 차가 떠납니다.
 */

export const dynamic = "force-dynamic";

type Body = {
  studentId?: string;
  studentName?: string;
  weekdays?: number[];
  kind?: string;
  label?: string | null;
  time?: string | null;
  note?: string | null;
  /** 그 주의 월요일. 비어 있으면 매주입니다. */
  weekStart?: string | null;
  /** 기간 지정. 주면 weekStart 는 무시하고 그 기간의 주별 줄로 펼쳐 넣습니다. */
  range?: { start?: string; end?: string } | null;
};

const ISO = /^\d{4}-\d{2}-\d{2}$/;

const KINDS = new Set(["셔틀", "외부버스", "보호자픽업", "도보", "기타"]);

export async function POST(req: Request) {
  const supabase = await createClient();
  try {
    const me = await getCurrentAppUser();
    if (!me) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

    const body = (await req.json().catch(() => null)) as Body | null;
    const studentId = (body?.studentId ?? "").trim();
    const kind = (body?.kind ?? "").trim();
    const weekdays = (body?.weekdays ?? []).filter((w) => Number.isInteger(w) && w >= 1 && w <= 5);
    if (!studentId) return NextResponse.json({ error: "학생을 골라주세요." }, { status: 400 });
    if (!KINDS.has(kind)) return NextResponse.json({ error: "하원수단을 골라주세요." }, { status: 400 });
    if (weekdays.length === 0) return NextResponse.json({ error: "요일을 하나 이상 골라주세요." }, { status: 400 });

    const weekStart = body?.weekStart ?? null;
    // **날짜가 정해진 하원수단은 모두 기간입니다.** 「이번주만·다음주만」도 그 주 월~금 기간으로
    // 넣습니다. 그래야 기간 묶음(range_id)이 생기고, 지속 특이사항과 서로 따라 바뀝니다
    // (마이그레이션 20261122003000 의 트리거). 묶음이 없으면 한쪽만 바뀌고, 두 화면이 다른 말을 합니다.
    const asRange =
      body?.range ??
      (weekStart && ISO.test(weekStart) ? { start: weekStart, end: addDaysIso(weekStart, 4) } : null);
    const range = asRange && ISO.test(asRange.start ?? "") && ISO.test(asRange.end ?? "") ? { start: asRange.start!, end: asRange.end! } : null;
    if (body?.range && !range) return NextResponse.json({ error: "기간의 시작일과 종료일을 달력에서 골라주세요." }, { status: 400 });
    if (range && range.end < range.start) return NextResponse.json({ error: "종료일이 시작일보다 앞입니다." }, { status: 400 });
    const saved: number[] = [];

    if (range) {
      // 이 학생의 이번 기간 전체가 한 묶음입니다 - 요일이 여럿이어도 한 번에 보여주고 지웁니다.
      const rangeId = crypto.randomUUID();
      let rows = 0;
      for (const w of weekdays) {
        const { data, error } = await supabase.rpc("set_dismissal_range", {
          p_student: studentId,
          p_weekday: w,
          p_kind: kind,
          p_label: (body?.label ?? "").trim() || null,
          p_time: assumeAfternoon((body?.time ?? "").trim() || null),
          p_note: (body?.note ?? "").trim() || null,
          p_start: range.start,
          p_end: range.end,
          p_range_id: rangeId,
          p_by: me.name ?? me.email,
        });
        if (error) {
          return NextResponse.json(
            { error: `${["", "월", "화", "수", "목", "금"][w]}요일을 저장하지 못했습니다: ${error.message}`, saved },
            { status: 500 },
          );
        }
        rows += Number(data ?? 0);
        saved.push(w);
      }
      // 기간 안에 고른 요일이 한 번도 없으면 아무 줄도 안 생깁니다. 「저장됨」으로 보이면 넣은 줄 압니다.
      if (rows === 0) return NextResponse.json({ error: "고른 기간 안에 고른 요일이 없습니다. 요일이나 날짜를 확인해주세요." }, { status: 400 });
    }

    for (const w of range ? [] : weekdays) {
      const { error } = await supabase.rpc("set_dismissal_plan", {
        p_student: studentId,
        p_weekday: w,
        p_kind: kind,
        p_label: (body?.label ?? "").trim() || null,
        // 넣을 때도 바로잡습니다. 사람이 「3:35」로 치면 오후 3시 35분입니다 - 읽는 쪽에서도
        // 같은 규칙으로 한 번 더 걸러내지만, 저장된 값 자체가 맞는 편이 낫습니다.
        p_time: assumeAfternoon((body?.time ?? "").trim() || null),
        p_note: (body?.note ?? "").trim() || null,
        p_week_start: weekStart,
        p_by: me.name ?? me.email,
      });
      // 한 요일이 실패하면 거기서 멈춥니다. 나머지를 마저 넣고 「저장했습니다」를 돌려주면
      // 빠진 요일이 있는 줄 모른 채 창을 닫습니다.
      if (error) {
        return NextResponse.json(
          { error: `${["", "월", "화", "수", "목", "금"][w]}요일을 저장하지 못했습니다: ${error.message}`, saved },
          { status: 500 },
        );
      }
      saved.push(w);
    }

    // ── 오늘 것이면 셔틀 체크표까지 바로 ──────────────────────────────────
    const today = todayKst();
    const todayWd = kstWeekday();
    const appliesToday =
      todayWd >= 1 &&
      todayWd <= 5 &&
      // rides-ok: 이 weekdays 는 셔틀 배정이 아니라 **하원수단을 넣은 요일**입니다.
      // 체크표와는 다른 것을 셉니다.
      weekdays.includes(todayWd) &&
      kind !== "셔틀" &&
      // 「다음 주만」으로 넣은 것은 오늘 걸면 안 됩니다. 기간이면 오늘이 그 안일 때만.
      (range ? rangeAppliesOn(range.start, range.end, todayWd, today) : weekStart === null || weekStart === weekStartOf(today));

    let applied = 0;
    if (appliesToday) {
      const label = [(body?.time ?? "").trim(), (body?.label ?? "").trim()].filter(Boolean).join(" ");
      applied = await applyPickup(supabase, studentId, today, `하원수단(${kind}${label ? ` ${label}` : ""})`, {
        text: `하원수단을 「${kind}${label ? ` ${label}` : ""}」로 등록해 오늘 셔틀에서 뺐습니다.`,
        source: "하원수단",
        from: me.name || me.email,
      });
    }

    return NextResponse.json({
      ok: true,
      saved: saved.length,
      // 몇 자리가 걸렸는지 그대로 돌려줍니다. 「반영됨」만 뜨면 정말 걸렸는지 알 수 없고,
      // 셔틀 배정이 없는 아이는 0이 나오는 것이 정상입니다.
      appliedSeats: applied,
      appliesToday,
    });
  } catch (err) {
    await logApiError(supabase, "work:dismissal", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "저장하지 못했습니다." }, { status: 500 });
  }
}

/** 한 줄 지우기. 어느 갈래(매주/그 주만)인지 함께 받아야 엉뚱한 줄을 지우지 않습니다. */
export async function DELETE(req: Request) {
  const supabase = await createClient();
  try {
    const me = await getCurrentAppUser();
    if (!me) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

    const body = (await req.json().catch(() => null)) as { studentId?: string; weekday?: number; weekStart?: string | null; rangeId?: string | null } | null;
    // 기간으로 넣은 줄은 기간째 지웁니다(그 요일의 주별 줄 전부). 한 주씩 지우게 두면 몇 주가 남습니다.
    if (body?.rangeId) {
      const { data, error } = await supabase.rpc("clear_dismissal_range", {
        p_range_id: body.rangeId,
        p_weekday: Number.isInteger(body.weekday) ? body.weekday : null,
      });
      if (error) return NextResponse.json({ error: `지우지 못했습니다: ${error.message}` }, { status: 500 });
      return NextResponse.json({ ok: true, removed: Number(data ?? 0) });
    }
    if (!body?.studentId || !Number.isInteger(body.weekday)) {
      return NextResponse.json({ error: "학생과 요일이 필요합니다." }, { status: 400 });
    }
    const { error } = await supabase.rpc("clear_dismissal_plan", {
      p_student: body.studentId,
      p_weekday: body.weekday,
      p_week_start: body.weekStart ?? null,
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    // 오늘 걸어둔 픽업 표시는 **자동으로 지우지 않습니다.**
    //
    // 하원수단을 지우는 것과 「오늘 이 아이는 차를 탄다」는 다른 판단입니다. 여기서 같이
    // 지우면, 아이가 이미 보호자와 갔는데도 명단에 다시 올라와 기사님이 기다립니다.
    // 오늘 표시를 되돌리는 일은 체크표에서 사람이 누릅니다.
    return NextResponse.json({ ok: true });
  } catch (err) {
    await logApiError(supabase, "work:dismissal:delete", err);
    return NextResponse.json({ error: "지우지 못했습니다." }, { status: 500 });
  }
}
