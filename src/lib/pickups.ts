import type { SupabaseClient } from "@supabase/supabase-js";
import { assumeAfternoon, extractTimeFromText } from "@/lib/pickupParse";
import { loadActiveEntries } from "@/lib/attendanceEntries";
import { isHumanSet } from "@/lib/pickupIngest";

/**
 * 오늘 픽업인 아이 — **여기 한 곳에서만 정합니다.**
 *
 * ── 왜 필요한가 ────────────────────────────────────────────────────────
 *
 * 픽업은 들어오는 길이 셋인데, 도착하는 표도 셋이었습니다.
 *
 *   ① 토들·전화로 온 학부모 연락      → `pickup_requests`      (status='확정')
 *   ② 구글챗 출결내역에서 사람이 등록  → `attendance_entries`   (status='픽업', state='등록')
 *   ③ 하원 체크표·담임 픽업체크에서 클릭 → `shuttle_boardings`  (status='픽업')
 *
 * 그리고 화면마다 이 셋 중 **다른 조합**을 읽었습니다.
 *
 *   · 중앙 대시보드 — ①③만 봤습니다. ②로 등록한 픽업이 끝내 안 떴습니다.
 *   · 하원 체크표   — ①③만 봤습니다(②는 결석만 읽었습니다).
 *
 * 같은 자리에서 같은 버튼을 눌렀는데 화면마다 답이 달랐고, 그러면 사람은 등록이 안 된 줄
 * 알고 다시 누릅니다. 표를 하나로 합치는 것은 이미 쌓인 기록 때문에 위험하니, **읽는 규칙을**
 * 한 곳으로 모읍니다. 화면은 이 함수만 부릅니다.
 *
 * ── 누가 이기는가 ──────────────────────────────────────────────────────
 *
 * 규칙 하나입니다. **사람이 체크표에서 정한 것이 언제나 이깁니다.**
 *
 * 오늘 체크표에 줄이 찍힌 학생(탄다·픽업·결석 무엇이든)은 사람이 이미 보고 정한 것입니다.
 * 그 위에 자동으로 들어온 값을 덧씌우면, 되돌린 것이 다음 새로고침에 되살아납니다. 이건
 * 이 저장소에서 이미 두 번 났던 사고입니다.
 *
 * 체크표에 줄이 아예 없는 학생(차량을 안 타는 아이)만 ①②에서 가져옵니다.
 */

export type PickupSource = "체크표" | "출결내역" | "학부모연락";

export type TodayPickup = {
  /** 명부의 전체 이름. 성이 빠진 탑승표 이름 대신 명부 이름을 씁니다. */
  name: string;
  studentId: string | null;
  /** 몇 시에 데리러 오는가. 모르면 null - 화면은 「미정」으로 적습니다. */
  time: string | null;
  /** 어디서 온 픽업인가. 화면에서 「왜 이 아이가 떴지」를 답하는 값입니다. */
  source: PickupSource;
};

export type PickupInputs = {
  /** 체크표에서 픽업으로 찍힌 학생. */
  boardingPickups: { name: string; studentId: string | null }[];
  /** 오늘 체크표에 줄이 하나라도 찍힌 학생 이름 — 탄다·픽업·결석 무엇이든. */
  decidedNames: Set<string>;
  /** 출결내역에서 픽업으로 등록된 건. */
  entries: { name: string; studentId: string | null; time: string | null }[];
  /** 확정된 학부모 연락. */
  requests: { name: string; studentId: string | null; time: string | null }[];
};

/**
 * 세 갈래를 한 목록으로. **순수 함수라 시험할 수 있습니다** — 화면과 서버가 같은 답을
 * 내는지는 눈으로 보는 대신 검사로 확인합니다.
 */
export function mergePickups(input: PickupInputs): TodayPickup[] {
  const out = new Map<string, TodayPickup>();

  // 시각은 어느 갈래에서 왔든 모읍니다. 체크표 클릭에는 시각이 없어서, 같은 아이의 학부모
  // 연락에 적힌 시각을 붙여줘야 「몇 시에 데려와야 하는지」가 화면에 남습니다.
  const timeOf = new Map<string, string>();
  for (const r of [...input.requests, ...input.entries]) {
    if (r.time && !timeOf.has(r.name)) timeOf.set(r.name, r.time);
  }

  // ① 체크표 — 가장 세다.
  for (const b of input.boardingPickups) {
    out.set(b.name, { name: b.name, studentId: b.studentId, time: timeOf.get(b.name) ?? null, source: "체크표" });
  }

  // ②③ 체크표에 줄이 없는 아이만. 줄이 있는데 픽업이 아니라면 사람이 「픽업 아님」으로
  //     정한 것이고, 그 판단을 자동이 뒤집으면 안 됩니다.
  for (const r of [...input.entries, ...input.requests]) {
    if (out.has(r.name)) continue;
    if (input.decidedNames.has(r.name)) continue;
    out.set(r.name, {
      name: r.name,
      studentId: r.studentId,
      time: timeOf.get(r.name) ?? null,
      source: input.entries.some((e) => e.name === r.name) ? "출결내역" : "학부모연락",
    });
  }

  // 시각이 있는 아이가 먼저, 그중에서도 이른 시각부터. 대시보드는 «다음에 무엇을 해야 하나»
  // 순서로 읽히는 게 맞습니다. 시각을 모르는 아이는 뒤로 보내되 빼지는 않습니다.
  return [...out.values()].sort(
    (a, b) => (a.time ?? "99:99").localeCompare(b.time ?? "99:99") || a.name.localeCompare(b.name, "ko"),
  );
}

/**
 * 세 표를 읽어 오늘 픽업을 냅니다.
 *
 * `nameOfStudent` 는 학생 번호를 명부 이름으로 바꾸는 함수입니다. 탑승표에 적힌 이름은
 * 성이 빠져 있을 수 있어서, 번호가 있으면 명부 이름이 언제나 맞습니다.
 */
export async function loadTodayPickups(
  supabase: SupabaseClient,
  dateKey: string,
  nameOfStudent: (studentId: string) => string | null,
): Promise<TodayPickup[]> {
  const [boardRes, entryRows, reqRes] = await Promise.all([
    // `checked_by` 를 함께 읽습니다. **누가 정했는지가 판단의 재료**입니다 - 아래를 보세요.
    supabase.from("shuttle_boardings").select("assignment_id, status, checked_by").eq("service_date", dateKey),
    loadActiveEntries(supabase, dateKey),
    supabase
      .from("pickup_requests")
      .select("student_id, pickup_time")
      .eq("kind", "픽업")
      .eq("status", "확정")
      .eq("service_date", dateKey)
      .eq("is_demo", false)
      .limit(300),
  ]);

  const boardings = (boardRes.data as { assignment_id: string; status: string; checked_by: string | null }[] | null) ?? [];
  const asgIds = boardings.map((b) => b.assignment_id);
  const { data: asgRows } = asgIds.length
    ? await supabase.from("shuttle_assignments").select("id, student_id, student_name_raw").in("id", asgIds)
    : { data: [] as { id: string; student_id: string | null; student_name_raw: string }[] };
  const asgById = new Map(((asgRows as { id: string; student_id: string | null; student_name_raw: string }[] | null) ?? []).map((a) => [a.id, a]));

  const nameOfAsg = (id: string): string | null => {
    const a = asgById.get(id);
    if (!a) return null;
    return (a.student_id ? nameOfStudent(a.student_id) : null) || a.student_name_raw || null;
  };

  const boardingPickups: { name: string; studentId: string | null }[] = [];
  const decidedNames = new Set<string>();
  for (const b of boardings) {
    const nm = nameOfAsg(b.assignment_id);
    if (!nm) continue;
    // **사람이 정한 줄만 「정해진 것」입니다.**
    //
    // 예전에는 줄이 있기만 하면 전부 정해진 것으로 봤습니다. 그런데 체크표에는 사람이 안
    // 누른 줄도 생깁니다 - 아침 크론이 걸어둔 것, 기사님 체크인이 찍은 것, 자동이 만든 것.
    // 그런 줄 하나 때문에 출결내역에서 사람이 등록한 픽업이 **통째로 가려졌습니다.**
    // 권수호가 그랬습니다: 출결내역에서 픽업으로 등록했는데 중앙 대시보드에 안 떴습니다.
    //
    // 여기 적힌 규칙은 원래 「사람이 체크표에서 정한 것이 이긴다」였는데, 코드가 그보다
    // 넓게 막고 있었습니다.
    if (isHumanSet(b.checked_by)) decidedNames.add(nm);
    if (b.status === "픽업") boardingPickups.push({ name: nm, studentId: asgById.get(b.assignment_id)?.student_id ?? null });
  }

  const entries = entryRows
    .filter((e) => e.status === "픽업")
    .map((e) => ({
      name: e.student_name as string,
      studentId: (e.student_id as string | null) ?? null,
      // **저장해둔 시각이 먼저입니다.** 그건 그 아이를 가리키는 조각에서 읽은 값이라,
      // 한 글에 아이가 둘일 때 옆 아이의 시각이 옮겨붙지 않습니다. 그 칸이 생기기 전에
      // 쌓인 줄만 예전처럼 원문에서 뽑습니다 - 못 읽으면 null, 억지로 추측하지 않습니다.
      time:
        assumeAfternoon(((e.pickup_time as string | null) ?? "").slice(0, 5) || null) ??
        extractTimeFromText((e.raw_text as string | null) ?? (e.note as string | null)),
    }));

  // 학생 연결이 없거나 명부에서 못 찾은 건도 **버리지 않습니다.**
  //
  // 앞 판은 student_id 가 없으면 조용히 뺐습니다. 그런데 학부모 연락은 이름이 영문이거나
  // 형제방이라 학생을 못 잇는 경우가 실제로 있고, 그 아이는 픽업 목록 어디에도 안 떴습니다.
  // 「연락은 왔는데 화면에 없다」가 가장 나쁜 실패입니다 - 아무도 그 아이를 데리러 가지
  // 않습니다. 이름이라도 있으면 올리고, 화면이 「학생 미연결」로 표시합니다.
  const requests = (((reqRes.data as
    | { student_id: string | null; pickup_time: string | null; matched_name: string | null; ai_student_name: string | null }[]
    | null) ?? [])
    .map((r) => {
      const nm =
        (r.student_id ? nameOfStudent(r.student_id) : null) ||
        (r.matched_name ?? "").trim() ||
        (r.ai_student_name ?? "").trim();
      // 인박스에 03:40 으로 저장된 옛 줄도 오후로 읽습니다. 저장을 고치지 않고 읽을 때
      // 바로잡는 이유는, 이미 쌓인 줄이 있고 그것들도 오늘 화면에 떠야 하기 때문입니다.
      return nm ? { name: nm, studentId: r.student_id, time: assumeAfternoon(r.pickup_time) } : null;
    })
    .filter((v): v is { name: string; studentId: string | null; time: string | null } => !!v));

  return mergePickups({ boardingPickups, decidedNames, entries, requests });
}
