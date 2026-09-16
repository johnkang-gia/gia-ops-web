/**
 * **학생 하루 보드 — 「오늘 이 아이에게 평소와 다른 무슨 일이 있는가」를 한 곳에 모읍니다.**
 *
 * ── 무엇이 문제였나 ─────────────────────────────────────────────────────────
 *
 * 백서아를 알려면 화면 네 개를 열어야 했습니다. 픽업은 [오늘 변동사항]에, 약 이야기는
 * [학생 특이사항]에, 원문은 [픽업 인박스]에, 하원은 [하원 체크표]에 있습니다. 네 곳을
 * **사람이 눈으로 이어야** 「백서아 = 13:55 픽업 + 1시 이후 약」이 됩니다.
 *
 * 그 이어붙이는 일을 코드가 한 번 하고, 화면은 결과만 그립니다.
 *
 * ── 새 표를 만들지 않습니다 ─────────────────────────────────────────────────
 *
 * 「모아 둔 표」를 만들면 같은 사실이 두 곳에 적힙니다. 픽업을 취소했는데 모아둔 표에
 * 남으면 보드는 계속 「픽업」이라 말하고, 화면에는 오류가 아니라 **그냥 다른 답**으로
 * 보입니다. 이 저장소가 이미 그 실수를 했습니다(`pickups.ts` 의 하원수단 중복).
 * CLAUDE.md §2-12 의 「계산은 저장하지 않습니다」와 같은 이유입니다.
 *
 * 자료는 각자 제 표에 그대로 있고, 이 파일은 **읽어서 묶기만** 합니다.
 *
 * ── 평소와 다른 것만 올라옵니다 ─────────────────────────────────────────────
 *
 * 이 줄이 없으면 보드는 첫날부터 139줄이 됩니다 - 셔틀 타는 아이 전원이 매일 올라오니까요.
 * 139줄짜리 보드는 아무도 안 봅니다. 늘 타던 차를 오늘도 타는 것은 **소식이 아닙니다.**
 *
 * ── 묶는 열쇠는 학생 번호입니다 ─────────────────────────────────────────────
 *
 * 이름으로 묶으면 김재이 셋이 한 줄이 되고, 화면에는 「김재이 한 명이 픽업 + 약 + 결석」
 * 으로 보입니다(CLAUDE.md §2-4-1, 다섯 번 난 사고). 번호가 없는 줄은 **억지로 붙이지 않고**
 * 「누구인지 모릅니다」 칸으로 내려보냅니다 - 「재이」를 셋 중 하나에 붙이면 나머지 둘의
 * 보호자는 아무 소식도 못 받습니다.
 */

/** 갈래. 화면의 색·아이콘이 여기서 나옵니다. */
export type DayItemKind = "픽업" | "결석" | "지각" | "조퇴" | "약" | "결제" | "준비물" | "건강" | "문의" | "기타";

export type DayItem = {
  id: string;
  kind: DayItemKind;
  /** 몇 시. 없으면 「오늘 중에」. */
  at: string | null;
  /** 한 줄 요약. 「어머니 픽업」·「감기약 한 봉」 */
  text: string;
  /** 어느 날의 일인가. 오늘이 아니면 화면이 날짜를 붙입니다. */
  onDate: string;
  /**
   * **어디서 왔는가.** 「왜 이 줄이 떴지」에 답하는 값입니다. 이게 없으면 사람은 보드를
   * 못 믿고 결국 원래 화면 네 개를 다시 엽니다.
   */
  from: { table: string; screen: string };
  /** 아직 사람이 한 번 봐야 하는가(미답 문의 등). */
  pending: boolean;
  /**
   * **왜 이 줄이 떴는가 — 사람이 읽을 수 있는 근거.**
   *
   * 「어디서 왔는가」(`from`)는 표 이름이라 사람에게는 아무 말도 아닙니다. 토들에서 온
   * 것이면 **학부모가 쓴 글 그대로**를 보여줘야, 요약이 잘못됐을 때 사람이 알아챕니다.
   * 근거가 안 보이면 담당자는 보드를 안 믿고 결국 원래 화면을 다시 엽니다.
   */
  evidence?: {
    /** 「토들 · G3_Grace Lim_Office」 처럼 어디서 온 것인지 한 줄. */
    label: string;
    /** 원문. 없을 수 있습니다(하원수단처럼 글이 아닌 근거). */
    raw: string | null;
    /** 고칠 수 있는 자리면 그 줄의 번호. */
    sourceId?: string | null;
  };
};

export type StudentDay = {
  studentId: string;
  /** 명부의 지금 이름. 각 표에 적힌 이름이 아닙니다. */
  name: string;
  grade: string | null;
  className: string | null;
  items: DayItem[];
  /** 가장 이른 시각. 보드를 세우는 열쇠입니다. */
  firstTime: string | null;
  pendingCount: number;
};

/** 누구 이야기인지 못 가린 줄. **억지로 붙이지 않고 여기 모읍니다.** */
export type UnknownItem = DayItem & {
  /** 화면에 보여줄 단서 — 채널 이름·적힌 이름. 사람이 이걸 보고 연결합니다. */
  hint: string | null;
  /**
   * **이 방에 이어 둔 아이들.**
   *
   * 형제방(황라원·황라윤)은 학기 초에 사람이 이미 이어 두었습니다. 그런데 본문이 누구인지
   * 안 가르면 화면은 그냥 「미연결」로 떴습니다 — 이어 둔 것이 있는데도 아무것도 모르는
   * 것처럼 보였고, 그러면 사람은 연결이 안 된 줄 알고 처음부터 다시 찾습니다.
   *
   * 이어 둔 것이 있으면 **그 집 아이 전부가 기본**입니다. 그중 한 명만 해당하면 사람이
   * 한 번 눌러 좁힙니다. 비어 있으면 정말로 방이 안 이어진 것입니다.
   */
  house: { id: string; name: string }[];
};

export type DayBoard = {
  date: string;
  days: StudentDay[];
  unknown: UnknownItem[];
  /** 읽다가 실패한 것. **비어 있지 않으면 화면이 그대로 보여줍니다**(조용한 실패 금지). */
  problems: string[];
};

/** 조립에 들어가는 재료. 표에서 읽은 그대로의 모양입니다. */
export type BoardInput = {
  date: string;
  /** 이 보드가 다루는 학생(부서로 좁힌 뒤). 여기 없는 번호는 「모름」으로 갑니다. */
  roster: { id: string; name: string; grade: string | null; className: string | null }[];
  items: { studentId: string | null; hint: string | null; item: DayItem; house?: { id: string; name: string }[] }[];
};

/**
 * **순수 함수입니다 — 화면 없이 시험할 수 있습니다.**
 *
 * 학생 번호로 묶고, 시각순으로 세우고, 못 가린 것은 따로 내립니다.
 */
export function buildBoard(input: BoardInput, problems: string[] = []): DayBoard {
  const byId = new Map(input.roster.map((s) => [s.id, s]));
  const days = new Map<string, StudentDay>();
  const unknown: UnknownItem[] = [];

  for (const row of input.items) {
    const student = row.studentId ? byId.get(row.studentId) : undefined;
    if (!student) {
      // 번호가 없거나, 있어도 이 보드의 명단 밖(다른 부서·졸업)입니다.
      //
      // **번호가 있는데 명단 밖인 것은 조용히 버립니다** - 중고등부 아이의 픽업을 초등부
      // 모니터의 「누구인지 모름」에 올리면, 앞에 선 사람은 할 수 있는 일이 없는데 고칠
      // 것이 있는 줄 압니다. 번호가 **아예 없는** 것만 사람에게 묻습니다.
      if (!row.studentId) unknown.push({ ...row.item, hint: row.hint, house: row.house ?? [] });
      continue;
    }
    let day = days.get(student.id);
    if (!day) {
      day = {
        studentId: student.id,
        name: student.name,
        grade: student.grade,
        className: student.className,
        items: [],
        firstTime: null,
        pendingCount: 0,
      };
      days.set(student.id, day);
    }
    day.items.push(row.item);
  }

  for (const day of days.values()) {
    day.items.sort(sortItems);
    // 오늘 것의 가장 이른 시각. 앞날 것의 시각으로 오늘 보드를 세우면, 내일 9시 건이
    // 오늘 아침 맨 위로 올라옵니다.
    day.firstTime = day.items.find((i) => i.onDate === input.date && i.at)?.at ?? null;
    day.pendingCount = day.items.filter((i) => i.pending).length;
  }

  return {
    date: input.date,
    days: [...days.values()].sort(sortDays),
    unknown: unknown.sort(sortItems),
    problems,
  };
}

/** 시각이 있는 것이 먼저, 그 안에서는 이른 것부터. 시각 없는 것은 뒤. */
function sortItems(a: DayItem, b: DayItem): number {
  return (
    a.onDate.localeCompare(b.onDate) ||
    (a.at ?? "99:99").localeCompare(b.at ?? "99:99") ||
    a.kind.localeCompare(b.kind, "ko")
  );
}

/**
 * 학생 줄 세우기.
 *
 * **시각이 있는 아이가 먼저입니다** - 그 시각에 사람이 움직여야 하고, 놓치면 그날 못
 * 합니다. 시각 없는 아이는 「오늘 중에」라 이름순이면 충분합니다(139명 중에서 찾을 때는
 * 이름순이 가장 빠릅니다).
 */
function sortDays(a: StudentDay, b: StudentDay): number {
  if (a.firstTime && b.firstTime) return a.firstTime.localeCompare(b.firstTime) || a.name.localeCompare(b.name, "ko");
  if (a.firstTime) return -1;
  if (b.firstTime) return 1;
  return a.name.localeCompare(b.name, "ko");
}

/**
 * **화면을 세 묶음으로만 가릅니다.**
 *
 * 갈래(픽업·결석·약)로 가르지 않습니다 - 사람이 하는 질문은 「누가 몇 시에 무엇을 해야
 * 하나」이지 「결석이 몇 명인가」가 아닙니다. 갈래로 가르면 백서아가 두 칸에 나뉘어
 * 다시 눈으로 이어야 합니다.
 *
 *   지남   — 시각이 지난 것. 접어둡니다(했을 수도 있고, 놓쳤을 수도 있습니다).
 *   오늘   — 오늘 할 것. 시각 있는 것이 위.
 *   앞날   — 내일 이후. 알아두면 좋은 정도라 접어둡니다.
 */
export type DayBucket = "지남" | "오늘" | "앞날";

export function bucketOf(day: StudentDay, date: string, nowMinutes: number): DayBucket {
  const today = day.items.filter((i) => i.onDate === date);
  if (today.length === 0) return "앞날";
  // 오늘 것 중 하나라도 아직 안 지났으면 「오늘」입니다. 시각 없는 것은 「오늘 중에」라
  // 지날 수가 없습니다.
  const alive = today.some((i) => !i.at || toMinutes(i.at) >= nowMinutes - LATE_KEEP_MIN);
  return alive ? "오늘" : "지남";
}

/** 시각이 지나도 이만큼은 「오늘」에 남깁니다 - 방금 지난 건은 아직 처리 중일 수 있습니다. */
const LATE_KEEP_MIN = 20;

export function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

/** 갈래마다의 색·아이콘. 업무보드와 중앙 대시보드가 **같은 뜻의 색**을 씁니다. */
export const ITEM_LOOK: Record<DayItemKind, { icon: string; chip: string; dark: string; darkText: string }> = {
  픽업: { icon: "🚗", chip: "bg-blue-100 text-blue-800 ring-1 ring-blue-300", dark: "#0c2740", darkText: "#7dd3fc" },
  결석: { icon: "🏥", chip: "bg-red-100 text-red-800 ring-1 ring-red-300", dark: "#3f1d1d", darkText: "#fca5a5" },
  지각: { icon: "🕗", chip: "bg-orange-100 text-orange-800 ring-1 ring-orange-300", dark: "#2f1e06", darkText: "#fdba74" },
  조퇴: { icon: "🚪", chip: "bg-orange-100 text-orange-800 ring-1 ring-orange-300", dark: "#2f1e06", darkText: "#fdba74" },
  약: { icon: "💊", chip: "bg-rose-100 text-rose-800 ring-1 ring-rose-300", dark: "#3f1d2b", darkText: "#fda4af" },
  결제: { icon: "💳", chip: "bg-emerald-100 text-emerald-800 ring-1 ring-emerald-300", dark: "#0f2f22", darkText: "#6ee7b7" },
  준비물: { icon: "🎒", chip: "bg-amber-100 text-amber-800 ring-1 ring-amber-300", dark: "#2f2206", darkText: "#fcd34d" },
  건강: { icon: "🩹", chip: "bg-sky-100 text-sky-800 ring-1 ring-sky-300", dark: "#0c2740", darkText: "#7dd3fc" },
  문의: { icon: "💬", chip: "bg-violet-100 text-violet-800 ring-1 ring-violet-300", dark: "#241a3f", darkText: "#c4b5fd" },
  기타: { icon: "📌", chip: "bg-slate-100 text-slate-700 ring-1 ring-slate-300", dark: "#1e2a44", darkText: "#cbd5e1" },
};

/** 화면에 찍는 짧은 날짜. 오늘·내일은 글자로 — 숫자만 적으면 하루 일찍 움직입니다. */
export function whenLabel(onDate: string, at: string | null, today: string): string {
  const day =
    onDate === today
      ? ""
      : Math.round((Date.parse(`${onDate}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000) === 1
        ? "내일 "
        : `${onDate.slice(5).replace("-", "/")} `;
  return `${day}${at ?? ""}`.trim();
}

/**
 * **문의가 무엇에 관한 것인가 — 한 글자 이름표.**
 *
 * ── 왜 필요한가 ─────────────────────────────────────────────────────────────
 *
 * 특이사항 칸에 「💬 문의」가 넷 서 있으면, 어느 것이 내 일인지 열어봐야 압니다. 성적
 * 이야기는 담임이, 차량 이야기는 행정실이, 병결은 출결 담당이 봅니다 - **누가 볼 것인가가
 * 갈리는데 화면에는 다 같은 「문의」**였습니다.
 *
 * 그래서 글에서 주제를 읽어 이름표를 붙입니다. 짐작이므로 **틀릴 수 있고, 틀려도 줄이
 * 사라지지는 않습니다** - 이름표는 훑는 순서를 돕는 것이지 무엇을 감추는 것이 아닙니다.
 *
 * 순수 함수입니다.
 */
export type Topic = "학사" | "차량" | "출결" | "납부" | "건강" | "기타";

export const TOPIC_LOOK: Record<Topic, { chip: string; dark: string; darkText: string }> = {
  학사: { chip: "bg-indigo-100 text-indigo-800", dark: "#1e1b4b", darkText: "#a5b4fc" },
  차량: { chip: "bg-sky-100 text-sky-800", dark: "#0c2740", darkText: "#7dd3fc" },
  출결: { chip: "bg-orange-100 text-orange-800", dark: "#2f1e06", darkText: "#fdba74" },
  납부: { chip: "bg-emerald-100 text-emerald-800", dark: "#0f2f22", darkText: "#6ee7b7" },
  건강: { chip: "bg-rose-100 text-rose-800", dark: "#3f1d2b", darkText: "#fda4af" },
  기타: { chip: "bg-slate-100 text-slate-600", dark: "#1e2a44", darkText: "#cbd5e1" },
};

/**
 * 주제 읽기. **먼저 걸리는 것이 이깁니다** — 「병원 때문에 결석합니다」는 출결이 아니라
 * 결석 처리를 해야 하는 일이므로 출결이 먼저이고, 「차 타고 병원 갑니다」는 차량입니다.
 * 한 글에 둘이 섞이면 **해야 할 일이 있는 쪽**을 고릅니다.
 */
export function topicOf(text: string): Topic {
  const t = text.toLowerCase();
  if (/(결석|지각|조퇴|등원\s*안|안\s*가|못\s*가|병결|출석|쉬(어|겠|려)|absent|late)/.test(t)) return "출결";
  if (/(픽업|하원|등원|차량|셔틀|버스|정류장|기사|태워|데리러|행선지|타고\s*가|pick\s*up)/.test(t)) return "차량";
  if (/(성적|수업|과제|숙제|시험|평가|리포트|교재|수업료\s*외|담임|교실|학습|상담|과목|레슨|방과후)/.test(t)) return "학사";
  if (/(납부|결제|입금|청구|환불|카드|계좌|학비|영수증|payment)/.test(t)) return "납부";
  if (/(아파|아프|열이|열나|감기|기침|병원|약|진료|알레르기|다쳐|다쳤|치과|건강)/.test(t)) return "건강";
  return "기타";
}
