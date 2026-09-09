import { parseChannelLabel, type RosterEntry } from "@/lib/pickupParse";
import { resolveStudent, matchKey, stripParticle, type MatchResult } from "@/lib/studentMatch";
import { nameSurfaces } from "@/lib/attendanceIntent";

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

export type ChannelSuggestion = {
  label: string;
  grades: string[];
  isSibling: boolean;
  /** 방 이름에 적힌 순서대로. 못 이은 이름은 `student: null` 로 남겨 사람이 봅니다. */
  picks: { raw: string; student: RosterEntry | null; why: MatchResult["why"]; candidates: RosterEntry[] }[];
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
  aliases?: Map<string, RosterEntry>,
): ChannelSuggestion | null {
  const parsed = parseChannelLabel(label);
  if (!parsed) return null;
  const picks = parsed.names.map((raw, i) => {
    const r = resolveStudent(raw, roster, { grade: parsed.grades[i] ?? parsed.grades[0] ?? null, aliases });
    return { raw, student: r.student, why: r.why, candidates: r.candidates };
  });
  return {
    label,
    grades: parsed.grades,
    isSibling: parsed.isSibling,
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
export function othersMentioned(
  text: string,
  roster: RosterEntry[],
  ownerIds: string[],
): { student: RosterEntry; surface: string }[] {
  const own = new Set(ownerIds);
  const flat = String(text ?? "").normalize("NFC");
  const out: { student: RosterEntry; surface: string }[] = [];
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
      seen.add(s.id);
      out.push({ student: s, surface });
      break;
    }
  }
  return out;
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
