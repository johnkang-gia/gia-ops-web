// 채팅에 "@강경원 내일까지 이서아 입금확인해주세요"라고 치면, @태그된 사람의 업무대기에
// "이서아 입금확인" (마감: 내일)로 자동 등록되도록 돕는 파서입니다. @멘션 태그와 마감기한
// 표현을 문장에서 찾아내 제목만 깔끔하게 남기고, 마감기한은 실제 타임스탬프(due_at)로
// 변환합니다.
export type ParsedTaskFromMessage = {
  cleanTitle: string;
  dueAt: string | null;
  deadlineLabel: string | null;
};

const WEEKDAY_NAMES = ["일", "월", "화", "수", "목", "금", "토"];

function endOfDay(d: Date): Date {
  const r = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59);
  return r;
}

function addDays(base: Date, days: number): Date {
  return new Date(base.getFullYear(), base.getMonth(), base.getDate() + days);
}

// "이번주"/"다음주" + 요일에서 실제 날짜를 계산합니다(이번주는 월요일 시작 기준).
function resolveWeekday(weekdayChar: string, nextWeek: boolean): Date | null {
  const targetDow = WEEKDAY_NAMES.indexOf(weekdayChar);
  if (targetDow < 0) return null;
  const now = new Date();
  const curDow = now.getDay(); // 0=일
  const mondayOffset = curDow === 0 ? -6 : 1 - curDow;
  const monday = addDays(now, mondayOffset);
  const targetOffsetFromMonday = targetDow === 0 ? 6 : targetDow - 1; // 월=0 ... 일=6
  let target = addDays(monday, targetOffsetFromMonday);
  if (nextWeek) target = addDays(target, 7);
  return target;
}

// 텍스트에서 마감기한 표현을 찾아 { date, matchedText, label }를 반환합니다(못 찾으면 null).
function extractDeadline(text: string): { date: Date; matched: string; label: string } | null {
  const patterns: { re: RegExp; resolve: (m: RegExpMatchArray) => { date: Date; label: string } | null }[] = [
    { re: /오늘까지|오늘/, resolve: () => ({ date: new Date(), label: "오늘" }) },
    { re: /내일까지|내일/, resolve: () => ({ date: addDays(new Date(), 1), label: "내일" }) },
    { re: /모레까지|모레/, resolve: () => ({ date: addDays(new Date(), 2), label: "모레" }) },
    { re: /글피까지|글피/, resolve: () => ({ date: addDays(new Date(), 3), label: "글피" }) },
    {
      re: /(다음주|이번주)\s*([일월화수목금토])요일까지|(다음주|이번주)\s*([일월화수목금토])요일/,
      resolve: (m) => {
        const week = m[1] || m[3];
        const day = m[2] || m[4];
        const date = resolveWeekday(day, week === "다음주");
        if (!date) return null;
        return { date, label: `${week} ${day}요일` };
      },
    },
    {
      re: /(\d+)\s*일\s*(후|뒤)까지|(\d+)\s*일\s*(후|뒤)/,
      resolve: (m) => {
        const n = Number(m[1] || m[3]);
        if (!n) return null;
        return { date: addDays(new Date(), n), label: `${n}일 후` };
      },
    },
    {
      re: /(\d{1,2})월\s*(\d{1,2})일까지|(\d{1,2})월\s*(\d{1,2})일/,
      resolve: (m) => {
        const month = Number(m[1] || m[3]);
        const day = Number(m[2] || m[4]);
        if (!month || !day) return null;
        const now = new Date();
        const date = new Date(now.getFullYear(), month - 1, day);
        return { date, label: `${month}월 ${day}일` };
      },
    },
  ];

  for (const p of patterns) {
    const m = text.match(p.re);
    if (m) {
      const result = p.resolve(m);
      if (result) return { date: result.date, matched: m[0], label: result.label };
    }
  }
  return null;
}

// "이서아 입금확인해주세요" 같은 요청형 어미를 지우고 "이서아 입금확인"만 남깁니다.
function stripPoliteSuffix(text: string): string {
  const suffixes = [
    "해주시기 바랍니다",
    "확인 부탁드립니다",
    "부탁드립니다",
    "부탁드려요",
    "부탁해요",
    "부탁합니다",
    "바랍니다",
    "해주십시오",
    "해주세요",
    "해 주세요",
    "해줘요",
    "해줘",
    "주세요",
  ];
  let t = text.trim();
  for (const s of suffixes) {
    if (t.endsWith(s)) {
      t = t.slice(0, -s.length).trim();
      break;
    }
  }
  return t;
}

export function parseTaskFromMessage(rawText: string): ParsedTaskFromMessage {
  // @멘션 토큰 전부 제거
  let text = rawText.replace(/@\S+/g, " ").replace(/\s+/g, " ").trim();

  const deadline = extractDeadline(text);
  let dueAt: string | null = null;
  let deadlineLabel: string | null = null;
  if (deadline) {
    text = text.replace(deadline.matched, " ").replace(/\s+/g, " ").trim();
    dueAt = endOfDay(deadline.date).toISOString();
    deadlineLabel = deadline.label;
  }

  text = stripPoliteSuffix(text);
  // 남은 문장부호(., !, ~ 등) 정리
  text = text.replace(/[.!~,]+$/g, "").trim();

  return {
    cleanTitle: text || rawText.trim(),
    dueAt,
    deadlineLabel,
  };
}
