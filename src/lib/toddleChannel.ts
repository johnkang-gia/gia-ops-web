import { parseChannelLabel, type RosterEntry } from "@/lib/pickupParse";
import { resolveStudent, matchKey, stripParticle, type MatchResult } from "@/lib/studentMatch";
import { nameSurfaces } from "@/lib/attendanceIntent";
import { birthFits, givenFits, splitPerson, surnameFits } from "@/lib/familyName";

/**
 * **토들 채팅방을 학생에게 잇습니다** — 그리고 방 주인이 아닌 아이가 언급된 경우를 가려냅니다.
 *
 * ── 왜 방 이름이 가장 믿을 만한가 ────────────────────────────────────
 *
 * 토들 방 이름은 학교가 정한 규칙입니다('G2_Reina Park_Office'). 본문은 사람이 그때그때
 * 쓰는 말이라 오차가 크지만, 방 이름은 학기 내내 안 바뀝니다. **한 번 이어두면 그 뒤로는
 * 풀 일이 없습니다.**
 *
 * ── 방 주인이 아닌 아이 ──────────────────────────────────────────────
 *
 * 서우 어머님 방에 「오늘 하라도 픽업할게요」가 옵니다. 서우만 처리하면 하라가 셔틀에
 * 남아 있고, 둘 다 자동으로 처리하면 **남의 집 아이의 하원을 다른 학부모가 정한 것**이
 * 됩니다. 어느 쪽도 그냥 두면 안 됩니다.
 *
 * 그래서 갈라 놓습니다.
 * - 방 주인(서우) → 지금까지대로 자동 판단
 * - 본문에 나온 **다른 집 아이**(하라) → 줄은 만들되 **확인 필요**로 둡니다
 *
 * 학부모에게는 남의 아이 하원을 정할 권한이 없습니다. 그렇다고 못 본 척하면, 하라
 * 어머님도 따로 연락하셨겠거니 하고 아무도 확인하지 않습니다. 학교가 한 번 봐야 합니다.
 */

export type ChannelLink = {
  id: string;
  label: string;
  /** 사람이 확인한 방인가. **확인 전 제안은 판단에 쓰지 않습니다.** */
  confirmed: boolean;
  studentIds: string[];
};

/** 방 이름을 열쇠로 씁니다. 대소문자·공백·기호 차이로 못 찾는 일이 없도록 납작하게. */
export function channelKey(label: string | null | undefined): string {
  return String(label ?? "").normalize("NFC").trim().toLowerCase().replace(/\s+/g, " ");
}

export function buildChannelIndex(links: ChannelLink[] | null | undefined): Map<string, ChannelLink> {
  const m = new Map<string, ChannelLink>();
  for (const l of links ?? []) {
    const k = channelKey(l.label);
    if (k) m.set(k, l);
  }
  return m;
}

export type ChannelPick = {
  raw: string;
  /** 방 이름의 마지막 낱말 = 그 집 성. 형제방이면 모두에게 같은 성이 붙습니다. */
  surname: string | null;
  student: RosterEntry | null;
  why: MatchResult["why"];
  candidates: RosterEntry[];
  /**
   * **이름은 맞는데 성이 달라 뺀 아이.**
   *
   * 「Egeon」은 정이건도 고이건도 될 수 있습니다. 방 성이 Jeong 이면 고이건은 아닙니다.
   * 그냥 빼면 「왜 이 아이가 안 걸리지」로 남으므로, 뺐다는 사실을 화면에 적습니다.
   */
  ruledOut: RosterEntry[];
};

export type ChannelSuggestion = {
  label: string;
  grades: string[];
  isSibling: boolean;
  /** 방 이름에서 읽은 그 집 성. 못 읽으면 null. */
  surname: string | null;
  /** 방 이름에 적힌 순서대로. 못 이은 이름은 `student: null` 로 남겨 사람이 봅니다. */
  picks: ChannelPick[];
  /** 사람 손 없이 그대로 확정해도 되는가 — **이름이 하나도 안 빠졌을 때만**. */
  complete: boolean;
};

/**
 * 방 이름 하나에서 학생 후보를 뽑습니다. **저장하지 않습니다** — 화면이 보여주고
 * 사람이 확인한 뒤에 저장합니다.
 *
 * 형제방은 성을 한 번만 씁니다('Ije & Ryeomyeong Kang'). 그 처리는 `parseChannelLabel`
 * 이 이미 합니다 - 여기서 다시 만들지 않습니다.
 */
export function suggestForChannel(
  label: string,
  roster: RosterEntry[],
  /** 사람이 가르친 별칭. **선택이 아닙니다** - 안 넘기면 「E.L = 정이엘」 같은 것을 영영 못 풉니다. */
  aliases: Map<string, RosterEntry>,
): ChannelSuggestion | null {
  const parsed = parseChannelLabel(label);
  if (!parsed) return null;

  // 그 집 성. 방 이름의 **마지막 사람**에게만 성이 붙어 오는 경우가 많아
  // (「E.L, Egeon & Elizabeth Jeong」), 뒤에서부터 찾아 앞사람들에게도 씁니다.
  const familySurname =
    parsed.names
      .map((n) => splitPerson(n).surname)
      .filter((x): x is string => !!x)
      .pop() ?? null;

  const picks: ChannelPick[] = parsed.names.map((raw, i) => {
    const grade = parsed.grades[i] ?? parsed.grades[0] ?? null;
    const { given, surname, birth } = splitPerson(raw);
    const family = surname ?? familySurname;

    // 사람이 가르친 별칭이 가장 먼저입니다. 성으로 가르는 규칙보다 셉니다 -
    // 「E.L = 정이엘」처럼 규칙으로는 절대 못 푸는 것을 사람이 알려준 것이니까요.
    const taught = aliases.get(matchKey(raw)) ?? aliases.get(matchKey(given));
    if (taught) return { raw, surname: family, student: taught, why: null, candidates: [], ruledOut: [] };

    // 이름이 맞는 아이를 모으고, **성과 생일로 거릅니다.**
    //
    // 생일은 김재이 셋을 가르는 유일한 재료입니다 - 셋 다 영문명이 「Jay Kim」이라
    // 이름으로도 성으로도 안 갈라집니다. 그래서 방 이름에 괄호로 적어 오십니다.
    const byGiven = roster.filter((s) => givenFits(given, s));
    const fits = byGiven.filter((s) => surnameFits(family, s) && birthFits(birth, s));
    const ruledOut = byGiven.filter((s) => !(surnameFits(family, s) && birthFits(birth, s)));

    if (fits.length === 1) return { raw, surname: family, student: fits[0], why: null, candidates: [], ruledOut };
    if (fits.length > 1) {
      // 학년이 적혀 있으면 한 번 더 좁힙니다. 형제방은 학년이 사람마다 다릅니다.
      const g = String(grade ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
      const byGrade = g ? fits.filter((s) => String(s.grade ?? "").toLowerCase().replace(/[^a-z0-9]/g, "") === g) : [];
      if (byGrade.length === 1) return { raw, surname: family, student: byGrade[0], why: null, candidates: [], ruledOut };
      return { raw, surname: family, student: null, why: "여럿", candidates: fits, ruledOut };
    }

    // 이름으로 아무도 못 찾은 경우. 지금까지 쓰던 대조를 마지막으로 한 번 더 해봅니다
    // (한글로 적힌 방, 애칭이 괄호로 붙은 방 등). 방 이름 전체를 힌트로 함께 넘깁니다 -
    // 괄호 안 생일·반 이름이 거기 있습니다.
    const r = resolveStudent(raw, roster, { grade, aliases, context: label });
    // **성이 어긋나면 그 답도 버립니다.** 여기서 봐주면 위에서 거른 뜻이 없어집니다.
    if (r.student && !surnameFits(family, r.student)) {
      return { raw, surname: family, student: null, why: "여럿", candidates: [], ruledOut: [...ruledOut, r.student] };
    }
    return { raw, surname: family, student: r.student, why: r.why, candidates: r.candidates, ruledOut };
  });

  return {
    label,
    grades: parsed.grades,
    isSibling: parsed.isSibling,
    surname: familySurname,
    picks,
    // 한 명이라도 못 이었으면 통째로 사람에게 넘깁니다. 「둘 중 하나만 이어진 방」은
    // 화면에서 이어진 것처럼 보여서, 빠진 아이를 아무도 다시 안 봅니다.
    complete: picks.length > 0 && picks.every((p) => !!p.student),
  };
}

/**
 * 글에서 **방 주인이 아닌 아이**를 찾습니다.
 *
 * 찾는 방법은 명부 쪽 표기(`nameSurfaces`: 「이하라」·「하라」·영문 이름)를 글에서 그대로
 * 훑는 것입니다. 규칙으로 이름을 «생성»하지 않습니다 - 명부에 있는 표기만 찾으면 없는
 * 아이를 만들어낼 일이 없습니다.
 *
 * **두 글자 이름은 짝이 잘 맞습니다.** 「하라」가 「하라고 하셨어요」 안에도 들어 있습니다.
 * 그래서 이름 뒤에 조사나 공백·문장부호가 오는 자리만 인정하고, 그마저도 자동 확정은
 * 하지 않습니다 - 이 결과는 언제나 사람이 한 번 봅니다.
 */
export type OthersRead = {
  /** 그 표기가 **한 아이만** 가리킬 때. 이 아이들만 줄을 만듭니다. */
  found: { student: RosterEntry; surface: string }[];
  /**
   * 여러 아이가 나눠 쓰는 표기라 누구인지 가릴 수 없는 것. **줄을 만들지 않습니다.**
   * 만들면 한 번의 연락이 세 아이의 하원을 바꿉니다.
   */
  ambiguous: { surface: string; students: RosterEntry[] }[];
};

/**
 * 표기 하나가 명부에서 **몇 명을 가리키는가**를 미리 세어 둡니다.
 *
 * `nameSurfaces` 는 「김재이」에서 성을 뗀 「재이」와 영문 이름 「Jay」를 함께 만듭니다.
 * 그런데 이 학교에는 김재이·심재이·유재이가 있고 셋 다 영문명이 「Jay ○」입니다. 그래서
 * **「재이」도 「Jay」도 세 아이 모두의 표기**입니다 - 그 글자만으로는 누구인지 알 수 없습니다.
 */
function surfaceOwners(roster: RosterEntry[]): Map<string, RosterEntry[]> {
  const m = new Map<string, RosterEntry[]>();
  for (const s of roster) {
    for (const surface of nameSurfaces(s.name, s.name_en)) {
      const k = surface.toLowerCase();
      const list = m.get(k);
      if (list) list.push(s);
      else m.set(k, [s]);
    }
  }
  return m;
}

export function othersMentioned(text: string, roster: RosterEntry[], ownerIds: string[]): OthersRead {
  const own = new Set(ownerIds);
  const owners = surfaceOwners(roster);
  const flat = String(text ?? "").normalize("NFC");
  const found: OthersRead["found"] = [];
  const ambiguous = new Map<string, RosterEntry[]>();
  const seen = new Set<string>();

  for (const s of roster) {
    if (own.has(s.id)) continue;
    for (const surface of nameSurfaces(s.name, s.name_en)) {
      // 한 글자 조각은 보지 않습니다. 두 글자도 위험하지만, 한국 이름 대부분이 두 글자라
      // 빼면 「하라」·「서우」가 통째로 안 잡힙니다.
      if (surface.length < 2) continue;
      // 나온 자리를 **모두** 봅니다. 첫 자리가 낱말 속이라고 넘겨버리면
      // 「확인하라는 말씀이죠. 하라도 픽업할게요」에서 진짜 언급을 놓칩니다.
      let hit = false;
      for (let at = flat.indexOf(surface); at >= 0; at = flat.indexOf(surface, at + 1)) {
        // 이름 **앞뒤**를 함께 봅니다. 한쪽만 보면 「확인하라는」의 「하라」가 걸립니다 -
        // 뒤의 「는」은 멀쩡한 조사라 뒤만으로는 가릴 수 없고, 앞의 「인」이 답입니다.
        // 이름은 낱말의 시작에 옵니다.
        const before = at === 0 ? "" : flat[at - 1];
        if (before && /[가-힣a-zA-Z0-9]/.test(before)) continue;
        if (!isNameBoundary(flat.slice(at + surface.length))) continue;
        hit = true;
        break;
      }
      if (!hit) continue;
      if (seen.has(s.id)) continue;

      // ── 그 표기가 이 아이만 가리키는가 ────────────────────────────────
      //
      // 여기가 김재이·심재이·유재이 셋이 한꺼번에 픽업으로 들어간 자리입니다. 예전에는
      // 표기가 걸리기만 하면 그 아이의 줄을 만들었습니다. 「재이」는 세 아이 모두의
      // 표기이므로 **한 번의 연락이 세 줄**을 만들었고, 셋 다 픽업으로 떴습니다.
      //
      // 그 글자가 누구인지 모르면 아무도 고르지 않습니다. 아이 하나를 잘못 태우는 것도,
      // 남의 집 아이 셋의 하원을 건드리는 것도 되돌릴 수 없습니다.
      const sharers = owners.get(surface.toLowerCase()) ?? [s];
      if (sharers.length > 1) {
        // **방 주인이 후보에 들어 있으면 아무 말도 하지 않습니다.** 김재이 어머님 방의
        // 「재이」는 그 집 재이입니다. 그걸 「누구인지 모르겠다」로 띄우면 매번 뜨고,
        // 매번 뜨는 경고는 곧 아무도 안 읽습니다.
        if (!sharers.some((x) => own.has(x.id))) ambiguous.set(surface, sharers);
        continue;
      }

      seen.add(s.id);
      found.push({ student: s, surface });
      break;
    }
  }
  return { found, ambiguous: [...ambiguous.entries()].map(([surface, students]) => ({ surface, students })) };
}

/** 못 가른 표기를 사람에게 그대로 알립니다. 조용히 넘기면 그 아이는 아무 데도 안 뜹니다. */
export function ambiguousNote(a: OthersRead["ambiguous"]): string | null {
  if (a.length === 0) return null;
  return a
    .map(
      ({ surface, students }) =>
        `「${surface}」라고만 적혀 있어 ${students
          .map((s) => `${s.name}(${(s.class_name ?? "").trim() || `${s.grade ?? "?"}학년`})`)
          .join("·")} 중 누구인지 가릴 수 없습니다. 학교가 확인해주세요.`,
    )
    .join(" ");
}

/**
 * 이름이 거기서 끝났는가.
 *
 * 끝(빈 문자열)·공백·문장부호면 이름입니다. 한글이 이어지면 **조사일 때만** 이름입니다 -
 * 「하라도」·「하라가」는 이름이고 「하라고」는 아닙니다. 「고」는 조사가 아닙니다.
 */
function isNameBoundary(after: string): boolean {
  if (after.length === 0) return true;
  const ch = after[0];
  if (/[\s.,!?~·・)\]}"'\n]/.test(ch)) return true;
  if (!/[가-힣]/.test(ch)) return true; // 영문·숫자가 붙는 경우는 드물고, 붙으면 다른 낱말입니다
  // 한글이 이어지면 조사인지 봅니다. 조사만 남고 뒤가 끝나거나 경계면 이름으로 봅니다.
  const PARTICLES = ["이랑", "이가", "이는", "이를", "이도", "한테", "에게", "까지", "부터", "랑", "와", "과", "이", "가", "는", "은", "를", "을", "도", "만", "의", "야", "아", "님"];
  for (const p of [...PARTICLES].sort((a, b) => b.length - a.length)) {
    if (!after.startsWith(p)) continue;
    const rest = after.slice(p.length);
    if (rest.length === 0 || !/[가-힣]/.test(rest[0])) return true;
  }
  return false;
}

/** 화면·근거에 적을 한 줄. 왜 이 아이가 확인 필요인지 사람이 바로 알아야 합니다. */
export function otherChildNote(ownerNames: string[], otherName: string): string {
  const who = ownerNames.filter(Boolean).join("·") || "이 방";
  return `${who} 학부모 연락에 ${otherName} 학생이 함께 적혔습니다. 다른 집 아이라 학교가 한 번 확인해주세요.`;
}

export { matchKey, stripParticle };
