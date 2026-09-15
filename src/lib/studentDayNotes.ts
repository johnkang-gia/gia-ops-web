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
