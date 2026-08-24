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

/**
 * 화면에 보여줄 이름을 한글로 다듬습니다.
 *
 * 요청: "영어이름으로 문의를 올렸다면 학생명부와 대조후에 한글이름으로 올려줘 지금
 * 'diane & sunwoo lim'으로 되어있는것도 그렇고, 'soo j'로 되어있는것도"
 *
 * 학부모 채팅방 이름은 영어입니다("Diane & Sunwoo Lim"). 화면에 그대로 뜨면 우리 직원이
 * 누구인지 한 번 더 머릿속에서 바꿔야 합니다. 그래서 명부와 대조해 한글 이름으로 바꿉니다.
 *
 *   - 형제방("Diane & Sunwoo Lim")은 각각을 대조해 "임다이앤 & 임선우"처럼 이어 붙입니다.
 *   - 한 명이면 그 사람 한글 이름.
 *   - 이미 한글이거나 명부에서 못 찾으면 원래 값을 그대로 둡니다(억지로 바꾸지 않습니다).
 */
export function toKoreanDisplayName(
  current: string | null | undefined,
  channelLabel: string | null | undefined,
  roster: RosterEntry[]
): string | null {
  const has = (v: string | null | undefined) => !!v && v.trim().length > 0;
  // 이미 한글이 섞여 있으면 손대지 않습니다.
  const hasHangul = (v: string) => /[가-힣]/.test(v);
  if (has(current) && hasHangul(current as string)) return current as string;

  // 채널 이름에서 사람들을 뽑아 각각 대조합니다. 채널이 가장 규칙적이라 먼저 씁니다.
  const parsed = parseChannelLabel(channelLabel);
  if (parsed) {
    const kos = parsed.names.map((n) => {
      const grade = parsed.grades[0] ?? null;
      const m = matchStudent(n, roster, grade);
      return m?.name ?? null;
    });
    // 모두 한글로 바뀌었을 때만 채널 기반 이름을 씁니다. 하나라도 못 찾으면 아래로 넘어갑니다.
    if (kos.every(Boolean)) return kos.join(" & ");
  }

  // 채널이 없거나 일부만 맞으면, 지금 값 자체를 한 명으로 보고 대조해봅니다("Soo J").
  if (has(current)) {
    const m = matchStudent(current as string, roster);
    if (m?.name) return m.name;

    // 마지막 수단: 이름이 잘려 온 경우("Soo J" → "Soo Jin Kim"). 영문명이 이 값으로
    // 시작하는 학생이 **딱 한 명**일 때만 바꿉니다. 여럿이면 누구인지 알 수 없으니 그대로 둡니다
    // - 엉뚱한 학생 이름으로 바꾸는 것이 영어로 두는 것보다 나쁩니다.
    const prefix = normalizeName(current as string);
    if (prefix.length >= 3) {
      const starts = roster.filter((r) => {
        const en = normalizeName(r.name_en ?? "");
        const ko = normalizeName(r.name);
        return (en && en.startsWith(prefix)) || (ko && ko.startsWith(prefix));
      });
      if (starts.length === 1) return starts[0].name;

      // 여럿이 걸리는 경우(예: 'Soo J' → 'Soo Ji'(지수)와 'Soo Jin'(수진)이 함께 걸림).
      // 이름에 공백이 있어 "이름 + 성/두번째이름의 첫머리"처럼 꽤 구체적으로 적혔을 때만,
      // '가장 가깝게 완성되는'(덧붙는 글자가 가장 적은) 한 명을 고릅니다. 'Soo J'는 'Soo Ji'
      // (한 글자 더)가 'Soo Jin'(두 글자 더)보다 가까우므로 지수로 확정됩니다. 짧은 한 단어
      // (예: 'Min')만 온 경우는 후보가 너무 벌어져 이 규칙을 쓰지 않습니다 - 잘못 고르면
      // 영어로 두는 것보다 나쁩니다.
      if (starts.length > 1 && prefix.includes(" ")) {
        const scored = starts
          .map((r) => {
            const forms = [normalizeName(r.name_en ?? ""), normalizeName(r.name)].filter((f) => f.startsWith(prefix));
            return { r, len: Math.min(...forms.map((f) => f.length)) };
          })
          .sort((a, b) => a.len - b.len);
        // 가장 가까운 후보가 '유일하게' 가장 가까울 때만 확정합니다(동점이면 여전히 애매).
        if (scored.length === 1 || scored[0].len < scored[1].len) return scored[0].r.name;
      }
    }
  }

  return has(current) ? (current as string) : null;
}
