/**
 * **이용 기록에 담아도 되는 것만 담는 자리.**
 *
 * 화면이 백 개 가까이 되는데 **어떤 화면이 실제로 쓰이는지 아무도 모릅니다.** 안 쓰이는
 * 화면을 지우려면 「안 쓰인다」를 보여줄 수 있어야 하고, 고칠 화면을 고르려면 「여기가 제일
 * 많이 열린다」를 보여줄 수 있어야 합니다.
 *
 * 그런데 주소에는 학생 번호·청구서 번호가 그대로 들어 있습니다(`/students/9f3c…`). 그걸
 * 그대로 쌓으면 이 표가 **두 번째 명부**가 되고, 「누가 누구의 기록을 열어봤나」까지 남습니다.
 * 그건 화면 사용량을 보려고 만든 표가 감당할 성격의 자료가 아닙니다.
 *
 * 그래서 **번호는 지우고 자리만 남깁니다** — `/students/:id`. 어떤 화면이 몇 번 열렸는지는
 * 그대로 세어지고, 누구의 기록인지는 남지 않습니다.
 */

/** 주소에서 개별 식별자를 지웁니다. 화면을 세는 데는 자리만 있으면 됩니다. */
export function scrubPath(pathname: string): string {
  const [base] = (pathname || "/").split("?");
  return base
    .split("/")
    .map((seg) => {
      if (!seg) return seg;
      // uuid
      if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(seg)) return ":id";
      // 토큰처럼 긴 글자 (안내보드·도착체크 링크)
      if (seg.length >= 16 && !seg.includes("-")) return ":token";
      // 숫자만
      if (/^\d+$/.test(seg)) return ":n";
      // 날짜
      if (/^\d{4}-\d{2}-\d{2}$/.test(seg)) return ":date";
      return seg;
    })
    .join("/");
}

/**
 * 주소를 사람이 읽는 이름으로.
 *
 * 주소만 쌓아두면 몇 달 뒤에 아무도 못 읽습니다 — `/work/dismissal` 이 무엇이었는지
 * 그때는 기억이 안 납니다. 목록에 없으면 첫 칸을 그대로 씁니다(없는 것보다 낫습니다).
 */
const LABELS: Record<string, string> = {
  "/home": "홈",
  "/work": "업무보드",
  "/work/history": "업무 기록",
  "/work/report": "업무 리포트",
  "/work/dismissal": "하원 일괄",
  "/work/inquiry-search": "문의 검색",
  "/work/trash": "업무 휴지통",
  "/pickup": "픽업 인박스",
  "/shuttle": "셔틀 현황",
  "/shuttle/checklist": "하원 체크표",
  "/shuttle/assignment": "탑승 배정",
  "/shuttle/routes": "노선 관리",
  "/shuttle/links": "링크·기기",
  "/students": "학생 조회",
  "/students/:id": "학생 기록",
  "/school": "학교",
  "/school/toddle": "토들 채널",
  "/attendance": "출석부",
  "/finance": "재무",
  "/finance/tuition": "학비 청구",
  "/finance/invoices": "학비외 청구",
  "/finance/payments": "수납",
  "/finance/unpaid": "미납",
  "/finance/receipts": "현금영수증",
  "/finance/plans": "납부 항목·할인",
  "/finance/statement": "학생별 거래내역",
  "/staff": "교직원",
  "/ops-board": "운영 대시보드",
  "/weekly-report": "주간 관찰기록",
  "/dev": "개발자",
  "/dev/usage": "이용 기록",
  "/dev/diagnostics": "진단",
  "/dev/errors": "오류",
  "/account": "내 계정",
};

export function labelOf(scrubbed: string): string {
  return LABELS[scrubbed] ?? scrubbed.split("/").filter(Boolean)[0] ?? "홈";
}

export type UsageEventIn = {
  session_id: string;
  kind: "view" | "action";
  path: string;
  label?: string | null;
  action?: string | null;
  duration_ms?: number | null;
};

/**
 * 보내기 전에 한 번 더 거릅니다.
 *
 * 화면 쪽 코드가 실수로 이름이나 본문을 `action` 에 담아 보낼 수 있습니다. 그런 일은
 * **막는 자리가 한 곳**이어야 합니다 - 화면마다 조심하기로 하면 언젠가 한 화면이 빠집니다.
 */
export function sanitizeEvent(e: UsageEventIn): UsageEventIn {
  return {
    session_id: String(e.session_id).slice(0, 64),
    kind: e.kind === "action" ? "action" : "view",
    path: scrubPath(String(e.path)).slice(0, 200),
    label: (e.label ?? "").toString().slice(0, 60) || null,
    // 동작 이름은 **짧은 낱말**만 담습니다. 길면 본문이 섞여 들어온 것입니다.
    action: (e.action ?? "").toString().slice(0, 40) || null,
    duration_ms:
      typeof e.duration_ms === "number" && e.duration_ms >= 0 && e.duration_ms < 6 * 60 * 60 * 1000
        ? Math.round(e.duration_ms)
        : null,
  };
}

/** 밀리초를 사람이 읽는 말로. 「0초」와 「안 잼」은 다릅니다. */
export function humanDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return "—";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}초`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}분`;
  const h = Math.floor(m / 60);
  return `${h}시간 ${m % 60}분`;
}
