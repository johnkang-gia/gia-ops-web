// 픽업 요청을 학생과 연결하는 도우미입니다.
//
// 왜 채널 이름이 중요한가요?
//   토들의 학부모 채널 이름이 '학년_학생이름_Office' 형식입니다(예: 'G2_Reina Park_Office').
//   즉 본문을 해석하지 않아도 누구 이야기인지 거의 확정됩니다. 자유 문장에서 이름을 뽑아내는
//   일은 오차가 크지만, 채널 이름은 학교가 정한 규칙이라 훨씬 믿을 만합니다.
//
//   예외는 형제 채널입니다.
//     'G2_Sophia & Bella Hwang_Office'      - 같은 학년 두 자녀
//     'G3&G6_Ije & Ryeomyeong Kang_Office'  - 다른 학년 두 자녀
//   이때만 본문에서 누구인지 가려내야 하고, 가려내지 못하면 사람에게 넘깁니다.

export type ChannelParse = {
  grades: string[];
  /** 채널 이름에서 뽑은 학생 이름 후보(형제면 둘 이상). */
  names: string[];
  /** 형제 채널인지. 둘 이상이면 본문으로 한 명을 골라야 합니다. */
  isSibling: boolean;
};

// 이름 비교용 정규화. 대소문자·공백·마침표·괄호 안 애칭을 걷어냅니다.
// 'G4_Hayim (Peyton) Jung_Office' 처럼 애칭이 괄호로 붙는 경우가 있어, 괄호는 통째로 빼고
// 비교하되 애칭 자체도 별도 후보로 남겨둡니다.
export function normalizeName(raw: string): string {
  return raw
    .replace(/\([^)]*\)/g, " ")
    .replace(/[.\-_'’]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

// 괄호 안 애칭만 따로 뽑습니다('Hayim (Peyton) Jung' → 'Peyton').
function nicknames(raw: string): string[] {
  return [...raw.matchAll(/\(([^)]+)\)/g)].map((m) => m[1].trim()).filter(Boolean);
}

/**
 * 'G2_Reina Park_Office' → { grades: ['G2'], names: ['Reina Park'], isSibling: false }
 * 'G3&G6_Ije & Ryeomyeong Kang_Office' → { grades: ['G3','G6'], names: ['Ije Kang','Ryeomyeong Kang'], isSibling: true }
 *
 * 형제 채널의 이름은 보통 성을 한 번만 씁니다('Ije & Ryeomyeong Kang'). 그래서 뒤쪽 이름의
 * 마지막 낱말(성)을 앞쪽 이름에도 붙여 후보를 만듭니다 - 그래야 명부의 'Ije Kang'과 맞습니다.
 */
export function parseChannelLabel(label: string | null | undefined): ChannelParse | null {
  if (!label) return null;
  const parts = label.split("_").map((p) => p.trim()).filter(Boolean);
  if (parts.length < 2) return null;

  // 첫 칸이 학년('G2', 'G3&G6'), 마지막 칸은 보통 'Office' 같은 꼬리표입니다.
  const gradePart = parts[0];
  const grades = gradePart.split(/[&,/]/).map((g) => g.trim()).filter((g) => /^[A-Za-z]*\d+$/.test(g));
  if (grades.length === 0) return null;

  // 학년과 꼬리표(Office 등)를 뺀 가운데가 이름입니다. 가운데가 여러 칸이면 이어 붙입니다.
  const middle = parts.slice(1, parts.length > 2 ? parts.length - 1 : undefined).join(" ").trim();
  if (!middle) return null;

  const rawNames = middle.split(/\s*&\s*|\s*,\s*/).map((n) => n.trim()).filter(Boolean);
  if (rawNames.length === 0) return null;

  if (rawNames.length === 1) {
    return { grades, names: [rawNames[0]], isSibling: false };
  }

  // 형제 - 마지막 사람의 성을 앞사람들에게도 붙여줍니다.
  const last = rawNames[rawNames.length - 1];
  const lastTokens = last.split(/\s+/);
  const surname = lastTokens.length > 1 ? lastTokens[lastTokens.length - 1] : "";
  const names = rawNames.map((n, i) => {
    if (i === rawNames.length - 1) return n;
    return n.split(/\s+/).length === 1 && surname ? `${n} ${surname}` : n;
  });
  return { grades, names, isSibling: true };
}

export type RosterEntry = { id: string; name: string; name_en: string | null; grade: string | null };

/**
 * 이름 후보 하나를 명부와 대조합니다. 완전히 같은 이름만 인정합니다 - 픽업은 아이를 누구에게
 * 보내느냐의 문제라, 애매하면 자동으로 정하지 않고 사람에게 넘기는 편이 안전합니다.
 * 후보가 둘 이상이면(동명이인) null을 돌려 확인 대기로 보냅니다.
 */
export function matchStudent(candidate: string, roster: RosterEntry[], grade?: string | null): RosterEntry | null {
  const target = normalizeName(candidate);
  if (!target) return null;

  const nickTargets = nicknames(candidate).map(normalizeName).filter(Boolean);

  const hits = roster.filter((s) => {
    const forms = [s.name, s.name_en ?? ""].filter(Boolean).map(normalizeName);
    // 명부 쪽에도 애칭이 괄호로 들어 있을 수 있어 함께 비교합니다.
    for (const s2 of [s.name, s.name_en ?? ""]) for (const n of nicknames(s2)) forms.push(normalizeName(n));
    if (forms.includes(target)) return true;
    return nickTargets.some((n) => forms.includes(n));
  });

  if (hits.length === 1) return hits[0];
  if (hits.length > 1 && grade) {
    // 동명이인이라도 학년이 다르면 채널 이름의 학년으로 가릴 수 있습니다.
    const g = grade.toLowerCase().replace(/[^a-z0-9]/g, "");
    const byGrade = hits.filter((s) => (s.grade ?? "").toLowerCase().replace(/[^a-z0-9]/g, "") === g);
    if (byGrade.length === 1) return byGrade[0];
  }
  return null;
}

/**
 * 본문에서 형제 중 누구를 가리키는지 고릅니다. 한 명만 언급되면 그 사람, 둘 다 또는 아무도
 * 언급되지 않으면 null(사람이 확인).
 */
export function pickSiblingFromText(text: string, names: string[]): string | null {
  const body = normalizeName(text);
  const mentioned = names.filter((n) => {
    const first = normalizeName(n).split(" ")[0];
    return first.length >= 2 && body.includes(first);
  });
  return mentioned.length === 1 ? mentioned[0] : null;
}

// 'HH:MM' 형태인지 확인합니다. AI가 엉뚱한 값을 돌려줘도 그대로 저장하지 않도록 거릅니다.
export function normalizeTime(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const m = raw.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}
