/**
 * **오늘 이 아이에 대해 알아야 할 것** — 종류와 보여주는 규칙을 한 곳에 둡니다.
 *
 * 업무보드(적는 자리)와 중앙 대시보드(읽는 자리)가 **같은 색·같은 이름**을 써야 합니다.
 * 두 곳에 따로 적으면 한쪽에서 「약」이 노란색이고 다른 쪽에서 빨간색이 되는데, 공용
 * 모니터를 멀리서 보는 사람은 색으로 먼저 읽습니다.
 */

export const NOTE_KINDS = ["약", "결제", "준비물", "건강", "기타"] as const;
export type NoteKind = (typeof NOTE_KINDS)[number];

export type DayNote = {
  id: string;
  studentId: string;
  studentName: string;
  onDate: string;
  /**
   * 몇 시에 해야 하는가. **비어 있을 수 있습니다.**
   *
   * 「오늘 중에 교재 전달」처럼 시각이 없는 것도 많습니다. 반드시 적게 하면 사람은 아무
   * 시각이나 넣게 되고, 그렇게 들어간 시각으로 알람이 울리면 알람 자체를 못 믿게 됩니다.
   */
  atTime: string | null;
  kind: NoteKind;
  content: string;
  createdByName: string | null;
  createdAt: string;
};

/** 화면에 붙이는 표시. 아이콘은 글자보다 멀리서 먼저 읽힙니다. */
export const KIND_LOOK: Record<NoteKind, { icon: string; /** 밝은 화면(업무보드) */ chip: string; /** 어두운 화면(중앙 대시보드) */ dark: string; darkText: string }> = {
  약: { icon: "💊", chip: "bg-rose-100 text-rose-800 ring-1 ring-rose-300", dark: "#3f1d2b", darkText: "#fda4af" },
  결제: { icon: "💳", chip: "bg-emerald-100 text-emerald-800 ring-1 ring-emerald-300", dark: "#0f2f22", darkText: "#6ee7b7" },
  준비물: { icon: "🎒", chip: "bg-amber-100 text-amber-800 ring-1 ring-amber-300", dark: "#2f2206", darkText: "#fcd34d" },
  건강: { icon: "🩹", chip: "bg-sky-100 text-sky-800 ring-1 ring-sky-300", dark: "#0c2740", darkText: "#7dd3fc" },
  기타: { icon: "📌", chip: "bg-slate-100 text-slate-700 ring-1 ring-slate-300", dark: "#1e2a44", darkText: "#cbd5e1" },
};

export function isNoteKind(v: unknown): v is NoteKind {
  return typeof v === "string" && (NOTE_KINDS as readonly string[]).includes(v);
}

/**
 * 날짜를 사람이 읽는 말로. **「오늘」과 「내일」은 글자로 적습니다** — 숫자로만 적으면
 * 오늘 화면에서 내일 것이 오늘 것처럼 읽히고, 그러면 사람이 하루 일찍 움직입니다.
 */
export function dayLabel(onDate: string, today: string): string {
  if (onDate === today) return "오늘";
  const diff = Math.round((Date.parse(`${onDate}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
  if (diff === 1) return "내일";
  if (diff === -1) return "어제";
  return onDate.slice(5).replace("-", "/");
}

/**
 * 보여줄 순서.
 *
 * 오늘 것이 먼저입니다 - 앞날 것은 알아두면 좋은 정도이고, 오늘 것은 안 하면 그날
 * 못 합니다. 그 안에서는 **적은 순서**를 지킵니다. 종류로 줄을 세우면 아침에 적은
 * 약이 점심에 적은 결제 아래로 내려가는 일이 생기고, 적은 사람이 자기 줄을 못 찾습니다.
 */
export function sortNotes(notes: DayNote[], today: string): DayNote[] {
  return [...notes].sort(
    (a, b) =>
      Number(b.onDate === today) - Number(a.onDate === today) ||
      a.onDate.localeCompare(b.onDate) ||
      // **같은 날 안에서는 시각순**입니다. 시각이 적힌 것은 그 순서대로 해야 하는 일이고,
      // 시각이 없는 것은 「오늘 중에」라 뒤로 보냅니다.
      (a.atTime ?? "99:99").localeCompare(b.atTime ?? "99:99") ||
      a.createdAt.localeCompare(b.createdAt),
  );
}

/** 「14:30」 모양인지. 이 모양이 아니면 알람이 시각을 못 읽습니다. */
export function isClockTime(v: unknown): v is string {
  return typeof v === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
}

/**
 * **원문에서 종류와 시각을 짐작합니다 — 짐작일 뿐이라 사람이 확정합니다.**
 *
 * 픽업 인박스로 들어온 연락이 픽업이 아니라 「약 좀 챙겨주세요」일 때, 담당자가 종류를
 * 고르고 시각을 치고 내용을 옮겨 적게 하면 그 일을 안 하게 됩니다. 그러면 그 연락은
 * 「픽업 아님」으로 내려가고 **아무 데도 안 남습니다** — 지금이 그렇습니다.
 *
 * 그렇다고 짐작한 값을 **그대로 저장하지는 않습니다.** 이 저장소에서 이름을 짐작해 붙인
 * 자리는 매번 사고가 났습니다(CLAUDE.md §2-4-1). 짐작은 **입력칸을 미리 채우는 데까지만**
 * 쓰고, 저장은 사람이 보고 누를 때 일어납니다.
 *
 * 순수 함수입니다 — 화면 없이 시험할 수 있습니다.
 */
export type NoteGuess = { kind: NoteKind; atTime: string | null };

export function guessNote(text: string): NoteGuess {
  return { kind: guessKind(text), atTime: guessTime(text) };
}

/**
 * 종류 짐작. **먼저 걸리는 것이 이깁니다.**
 *
 * 「감기약」에는 감기(건강)와 약이 함께 있습니다. 이때 담당자가 해야 할 일은 «약을 먹이는
 * 것»이지 «아픈 것을 아는 것»이 아니라, 약이 먼저입니다. 할 일이 있는 갈래를 앞에 둡니다.
 */
function guessKind(text: string): NoteKind {
  const t = text.toLowerCase();
  if (/(약|투약|해열제|시럽|알약|물약|먹여|먹이|medicine|medication)/.test(t)) return "약";
  if (/(결제|납부|입금|송금|계좌|카드로|현금|수납|학비|payment|pay\b)/.test(t)) return "결제";
  if (/(준비물|교재|책|체육복|도시락|가져|챙겨\s*보|제출|숙제|bring)/.test(t)) return "준비물";
  if (/(열이|열나|아파|아프|감기|기침|콧물|배탈|병원|진료|알레르기|다쳐|다쳤|컨디션|fever|sick)/.test(t)) return "건강";
  return "기타";
}

/**
 * 시각 짐작.
 *
 * **오전·오후가 안 적힌 한 자리 시각은 오후로 봅니다.** 「1시 이후 약 주세요」의 1시는
 * 새벽 1시일 수가 없습니다 - 학교에 아이가 있는 시간은 8시부터 6시까지입니다. 반대로
 * 8~11시는 오전일 수 있어 그대로 둡니다.
 *
 * 못 읽으면 **null 입니다.** 아무 시각이나 채워 넣으면 그 시각에 알람이 울리고, 한 번
 * 엉뚱하게 울린 알람은 그 뒤로 아무도 안 봅니다.
 */
function guessTime(text: string): string | null {
  const colon = text.match(/\b([01]?\d|2[0-3])\s*:\s*([0-5]\d)\b/);
  if (colon) {
    const h = Number(colon[1]);
    const m = Number(colon[2]);
    if (h <= 23) return clock(h, m);
  }

  const k = text.match(/(오전|오후|아침|점심|저녁|낮)?\s*(\d{1,2})\s*시\s*(반|(\d{1,2})\s*분)?/);
  if (k) {
    const mark = k[1] ?? "";
    let h = Number(k[2]);
    const m = k[3] === "반" ? 30 : Number(k[4] ?? 0);
    if (h > 23 || m > 59) return null;
    if (/(오후|저녁|점심|낮)/.test(mark) && h < 12) h += 12;
    else if (!mark && h >= 1 && h <= 7) h += 12;
    return clock(h, m);
  }
  return null;
}

function clock(h: number, m: number): string {
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}
