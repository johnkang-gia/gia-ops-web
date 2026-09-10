import { matchStudent, normalizeName, type RosterEntry } from "@/lib/pickupParse";
import { nameSurfaces } from "@/lib/attendanceIntent";

/**
 * **글에 적힌 이름을 명부의 아이에게 잇습니다** — 이 판단은 여기 한 곳에서만 합니다.
 *
 * ── 무엇이 문제였나 ──────────────────────────────────────────────────
 *
 * 동명이인이 아닌데도 자동으로 안 붙는 건이 아주 많았습니다. 이유가 셋이었습니다.
 *
 * **하나. 가르쳐도 픽업은 못 알아들었습니다.**
 * 출결 인박스에는 🔎 「가르치기」가 있습니다. 「마야 = 김마야」라고 한 번 알려주면
 * `attendance_learning_rules` 에 남고, 다음부터 출결은 알아봅니다. 그런데 **픽업 쪽은
 * 그 표를 읽지 않았습니다.** 같은 아이를 같은 표기로 몇 번을 가르쳐도 픽업에서는 매번
 * 처음 보는 이름이었습니다. 가르치는 사람 입장에서는 «가르쳐도 안 되는 기능»입니다.
 *
 * **둘. 한국말로 부르는 이름을 못 읽었습니다.**
 * 학부모는 성을 빼고 조사를 붙여 씁니다 - 「예온이 오늘 픽업할게요」, 「지음이가 아파서」.
 * 명부에는 「이예온」·「박지음」으로 있습니다. 글자 그대로 견주면 한 글자도 안 맞습니다.
 * 출결 쪽은 이미 이걸 읽고 있었는데(nameSurfaces) 픽업만 못 읽었습니다.
 *
 * **셋. 왜 못 붙였는지 아무 데도 안 남았습니다.**
 * 못 붙이면 그냥 「확인 필요」였습니다. 이름을 못 뽑은 건지, 명부에 없는 건지, 둘 중
 * 누구인지 몰라서인지가 화면에서 똑같아 보입니다. 그래서 **어느 것이 제일 많은지 아무도
 * 몰랐고**, 모르니 고칠 자리도 정할 수 없었습니다.
 *
 * ── 무엇을 지키나 ────────────────────────────────────────────────────
 *
 * 픽업은 아이를 누구에게 보내느냐의 문제라, **틀리느니 묻는 편이 낫습니다.** 그래서
 * 넓히되 한 명으로 좁혀질 때만 인정합니다. 둘 이상이면 후보를 그대로 돌려주고, 화면이
 * 「둘 중 누구?」를 사람에게 묻습니다 - 그리고 사람이 고른 답은 별칭으로 남아, 같은
 * 표기를 두 번 묻지 않습니다.
 */

export type MatchHow =
  /** 명부의 이름·영문명과 그대로 같습니다. */
  | "이름"
  /** 사람이 가르쳐 둔 표기입니다. */
  | "별칭"
  /** 성이 잘려 왔지만 앞에서부터 이어집니다("dongha k" ⊂ "dongha kim"). */
  | "앞부분"
  /** 성을 빼고 부른 이름입니다("예온이" → 이예온). 한 명뿐일 때만 인정합니다. */
  | "부르는이름";

export type MatchWhy =
  /** 글에서 이름을 아예 못 뽑았습니다. */
  | "이름없음"
  /** 명부에 그런 표기가 없습니다. 새로 온 아이거나, 별칭을 가르쳐야 합니다. */
  | "명부에없음"
  /** 후보가 여럿인데 못 좁혔습니다. 사람이 고르면 됩니다. */
  | "여럿";

export type MatchResult = {
  student: RosterEntry | null;
  how: MatchHow | null;
  why: MatchWhy | null;
  /** 못 좁힌 후보. 화면이 이걸로 고르는 버튼을 만듭니다. */
  candidates: RosterEntry[];
  /** 사람이 읽는 한 줄. 화면에 그대로 적습니다. */
  note: string | null;
};

/** 사람이 가르쳐 둔 표기. `attendance_learning_rules` 의 kind='alias' 줄입니다. */
export type AliasRule = { pattern: string; student_id: string | null; student_name?: string | null };

/**
 * 비교용 열쇠. 대소문자·공백·기호를 걷어내고 한글 자모를 합칩니다(NFC).
 *
 * 맥에서 붙여넣은 한글은 자모가 떨어져 있습니다("이예온" 이 ㅇ+ㅣ+ㅇ+ㅖ+…). 눈에는
 * 똑같은데 글자로는 다릅니다 - 이것 때문에 안 붙는 건이 실제로 있었습니다.
 */
export function matchKey(raw: string | null | undefined): string {
  return String(raw ?? "")
    .normalize("NFC")
    .toLowerCase()
    .replace(/[^a-z0-9가-힣]/g, "");
}

/**
 * 이름 뒤에 붙는 한국어 조사·호칭을 뗍니다.
 *
 * 「예온이가」·「지음이는」·「도은아」처럼 씁니다. 조사를 안 떼면 명부의 어느 이름과도
 * 안 맞는데, 화면에는 그냥 「확인 필요」로만 보입니다.
 *
 * 뗀 결과가 두 글자보다 짧아지면 떼지 않습니다 - 「이가」를 떼서 한 글자만 남으면
 * 그건 이름이 아니라 아무 글자입니다.
 */
export function stripParticle(raw: string): string {
  const s = matchKey(raw);
  if (!/[가-힣]/.test(s)) return s;
  // 긴 것부터 봅니다. 「이가」를 「가」보다 먼저 떼야 합니다.
  const PARTICLES = ["이랑", "이가", "이는", "이를", "이도", "이한테", "이의", "랑", "와", "과", "이", "가", "는", "은", "를", "을", "도", "야", "아", "님"];
  for (const p of PARTICLES) {
    if (s.length > p.length + 1 && s.endsWith(p)) return s.slice(0, -p.length);
  }
  return s;
}

/**
 * 가르쳐 둔 별칭을 학생에 잇습니다.
 *
 * 학생이 명부에서 사라졌으면(졸업·전학) 그 규칙은 버립니다 - 없는 아이를 가리키는
 * 별칭은 붙는 순간 틀립니다.
 */
export function buildAliasIndex(rules: AliasRule[] | null | undefined, roster: RosterEntry[]): Map<string, RosterEntry> {
  const byId = new Map(roster.map((s) => [s.id, s]));
  const out = new Map<string, RosterEntry>();
  for (const r of rules ?? []) {
    if (!r.student_id) continue;
    const s = byId.get(r.student_id);
    const k = matchKey(r.pattern);
    if (!s || !k) continue;
    out.set(k, s);
  }
  return out;
}

/**
 * 성을 뺀 이름·영문 이름으로 후보를 모읍니다.
 *
 * 명부 쪽 표기는 `nameSurfaces` 가 만듭니다 - 출결에서 쓰던 것과 **같은 함수**입니다.
 * 두 벌로 만들면 출결에서는 붙는데 픽업에서는 안 붙는 일이 또 생깁니다.
 */
function byCalledName(candidate: string, roster: RosterEntry[]): RosterEntry[] {
  const key = stripParticle(candidate);
  if (key.length < 2) return [];
  return roster.filter((s) => nameSurfaces(s.name, s.name_en).some((surface) => matchKey(surface) === key));
}

function label(s: RosterEntry): string {
  const where = (s.class_name ?? "").trim() || (s.grade ? `${s.grade}학년` : "");
  return where ? `${s.name}(${where})` : s.name;
}

/**
 * 이름 하나를 명부에 잇습니다.
 *
 * 순서에 뜻이 있습니다.
 * 1. **사람이 가르친 별칭이 먼저입니다.** 규칙이 아무리 그럴듯해도 사람이 정한 것을
 *    덮으면 안 됩니다 - 그러면 가르쳐도 안 고쳐지는 것이 됩니다.
 * 2. 그대로 같은 이름 (지금까지 하던 것. 동명이인은 생일·반·학년으로 좁힙니다)
 * 3. 성 빼고 부르는 이름 - **한 명으로 좁혀질 때만.**
 */
/**
 * **가르친 별칭이 없는 자리**에 씁니다. 이름이 붙어 있어서 «빠뜨린 것»과 «없는 것»이
 * 화면에서도 코드에서도 구별됩니다.
 *
 * 예전에는 `aliases` 가 선택 인자여서, 안 넘기면 규칙이 조용히 안 붙었습니다. 사람은
 * 「마야 = 김마야」를 한 번 가르쳤다고 생각하는데 어떤 화면에서는 안 붙었고, 그건 오류가
 * 아니라 «못 찾은 이름»으로 보였습니다. 이제 넘기지 않으면 **빌드가 안 됩니다.**
 */
export const NO_ALIASES: Map<string, RosterEntry> = new Map();

export function resolveStudent(
  candidate: string | null | undefined,
  roster: RosterEntry[],
  opts: {
    grade?: string | null;
    /** 이름이 나온 문장 전체. 반·생일 힌트가 여기 있습니다. */
    context?: string | null;
    /**
     * 사람이 가르친 별칭. **반드시 넘깁니다** - 규칙은 이름에 붙어 다녀야 하고, 화면이
     * 「이번엔 안 넘겨도 되겠지」를 정할 자리가 아닙니다. 정말 없으면 `NO_ALIASES`.
     */
    aliases: Map<string, RosterEntry>;
  },
): MatchResult {
  const raw = String(candidate ?? "").trim();
  if (!raw) {
    return { student: null, how: null, why: "이름없음", candidates: [], note: "글에서 학생 이름을 찾지 못했습니다." };
  }

  // 1. 가르친 별칭. 조사를 뗀 꼴로도 한 번 더 봅니다("마야가" → "마야").
  const alias = opts?.aliases;
  if (alias) {
    const hit = alias.get(matchKey(raw)) ?? alias.get(stripParticle(raw));
    if (hit) return { student: hit, how: "별칭", why: null, candidates: [], note: null };
  }

  // 2. 지금까지 하던 대조. 동명이인 좁히기까지 여기서 끝납니다.
  const exact = matchStudent(raw, roster, opts?.grade ?? null, opts?.context ?? null);
  if (exact) {
    // 「앞부분」인지 「이름」인지는 화면에 굳이 나눠 적지 않아도 되지만, 어떻게 붙었는지
    // 남겨두면 나중에 잘못 붙은 건을 되짚을 때 어느 규칙이 범인인지 바로 압니다.
    const same = normalizeName(exact.name) === normalizeName(raw) || normalizeName(exact.name_en ?? "") === normalizeName(raw);
    return { student: exact, how: same ? "이름" : "앞부분", why: null, candidates: [], note: null };
  }

  // 3. 성을 빼고 부르는 이름. 한 명뿐일 때만 인정합니다.
  const called = byCalledName(raw, roster);
  if (called.length === 1) {
    return { student: called[0], how: "부르는이름", why: null, candidates: [], note: null };
  }
  if (called.length > 1) {
    return {
      student: null,
      how: null,
      why: "여럿",
      candidates: called,
      note: `「${raw}」로 불리는 아이가 ${called.length}명입니다 (${called.map(label).join(" · ")}). 누구인지 골라주세요.`,
    };
  }

  // 동명이인이라 못 좁힌 경우도 여기로 옵니다 - matchStudent 가 null 을 주기 때문입니다.
  // 그 경우 후보를 다시 모아 화면이 고를 수 있게 합니다.
  const homonyms = roster.filter(
    (s) => normalizeName(s.name) === normalizeName(raw) || normalizeName(s.name_en ?? "") === normalizeName(raw),
  );
  if (homonyms.length > 1) {
    return {
      student: null,
      how: null,
      why: "여럿",
      candidates: homonyms,
      note: `「${raw}」이(가) ${homonyms.length}명입니다 (${homonyms.map(label).join(" · ")}). 누구인지 골라주세요.`,
    };
  }

  return {
    student: null,
    how: null,
    why: "명부에없음",
    candidates: [],
    note: `명부에서 「${raw}」을(를) 찾지 못했습니다. 표기가 다르면 🔎 로 한 번 가르쳐 주세요 - 다음부터는 저절로 붙습니다.`,
  };
}
