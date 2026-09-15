/**
 * **한 글에 부탁이 여럿 들어 있습니다.**
 *
 * ── 무엇이 문제였나 ─────────────────────────────────────────────────────────
 *
 * 실제로 들어온 글입니다.
 *
 *   「선생님 안녕하세요 연우가 감기기운이 있어서 점심후에 약 부탁드립니다 (콜대원 2포)
 *     그리고 혹시 학교에 갈색 자라 후디 없나요 ? 어디 두고온것 같은데 ㅠ」
 *
 * 해야 할 일이 **둘**입니다 — ① 점심 뒤 약 먹이기 ② 갈색 후디 찾기. 그런데 특이사항은
 * 한 글에 한 건만 만들 수 있었고, 담당자는 둘 중 하나를 고르거나 두 가지를 한 칸에 몰아
 * 적어야 했습니다.
 *
 * 한 칸에 몰아 적으면 **종류가 하나로 뭉갭니다.** 「약」으로 적으면 후디는 약 옆에 붙은
 * 딸린 말이 되어 아무도 안 찾고, 시각도 하나뿐이라 약 시각에 맞추면 후디는 시각이 없는
 * 것이 됩니다. 화면에는 오류가 아니라 **한 줄로 적힌 것**으로 보입니다.
 *
 * ── 어떻게 나누나 ───────────────────────────────────────────────────────────
 *
 * 문장으로 자르고, **부탁이 새로 시작되는 자리**에서만 새 건을 엽니다. 문장마다 한 건씩
 * 만들면 「(콜대원 2포)」·「어디 두고온것 같은데」 같은 꼬리가 저마다 한 건이 되어, 사람이
 * 지우는 일이 더 늘어납니다.
 *
 * **여기서 나온 것은 짐작이고, 확정은 사람이 합니다.** 화면이 이 결과로 칸을 미리 채우고,
 * 사람은 지우거나 고치거나 더할 수 있습니다(CLAUDE.md §2-4-1 과 같은 이유 — 짐작한 값을
 * 그대로 저장하는 자리는 매번 사고가 났습니다).
 *
 * 순수 함수입니다 — 화면 없이 시험할 수 있습니다.
 */

import { guessNote, type NoteKind } from "./studentDayNotes";

export type NoteDraft = {
  kind: NoteKind;
  /** 「14:30」 또는 없음. 못 읽으면 null 입니다 — 아무 시각이나 채우지 않습니다. */
  atTime: string | null;
  content: string;
};

/**
 * 인사말 한 낱말. 할 일이 없으므로 특이사항이 될 수 없습니다.
 *
 * **여러 개가 이어질 수 있습니다** — 「선생님 안녕하세요」는 인사 두 개이지 내용이 아닙니다.
 * 하나만 보고 판단하면 이 조각이 내용으로 남아, 특이사항 첫 줄이 「선생님 안녕하세요…」로
 * 시작합니다. 멀리서 보는 사람은 앞 글자만 읽습니다.
 */
const GREET_WORD =
  "(?:안녕하세요|안녕하십니까|안녕하세요~|안녕하세용|선생님들|선생님께|선생님|쌤|감사합니다|감사해요|감사드립니다|고맙습니다|고생하세요|수고하세요|수고하셨습니다|hi|hello|thank you|thanks)";
const TAIL = "[\\s~!?.,ㅎㅋㅠ^_)(:;♡❤️😊🙏]*";
/** 인사만 있는 조각. */
const GREETING = new RegExp(`^(?:${GREET_WORD}${TAIL})+$`, "i");
/** 내용 앞에 붙은 인사. 뒤에 내용이 있으면 조각을 버리지 않고 **인사만** 떼어냅니다. */
const GREETING_HEAD = new RegExp(`^(?:${GREET_WORD}${TAIL})+`, "i");

/** 새 부탁이 시작된다는 표시. 이것이 없는 조각은 **앞 건에 붙입니다.** */
const ASK =
  /(부탁|해\s*주|해주|주세요|주시|주실|챙겨|먹여|먹이|확인|알려|전달|보내|없나요|있나요|되나요|될까요|가능한지|문의|please|could you|can you)/i;

/** 앞과 **다른 이야기**로 넘어간다는 표시. 부탁 표시가 없어도 새 건을 엽니다. */
const TOPIC_SHIFT = /^(그리고|그리구|또한|또|추가로|그리고나서|참|아\s|and\b|also\b)/i;

export function splitNotes(text: string): NoteDraft[] {
  const pieces = cut(text);
  const groups: string[][] = [];

  for (const piece of pieces) {
    const t = piece.trim();
    if (!t || GREETING.test(t)) continue;

    const last = groups[groups.length - 1];
    // 첫 조각은 무조건 새 건입니다. 그 뒤로는 **새 이야기로 넘어갔거나 새 부탁이 있을 때만**
    // 새 건을 엽니다 - 문장마다 한 건씩 만들면 꼬리말이 전부 한 건이 되어 더 번거롭습니다.
    if (!last || TOPIC_SHIFT.test(t) || (ASK.test(t) && !ASK.test(last.join(" ")))) {
      groups.push([t]);
    } else {
      last.push(t);
    }
  }

  const drafts = groups
    .map((g) => g.join(" ").replace(/\s+/g, " ").trim())
    .filter((c) => c.length >= 2)
    .map((content) => {
      const body = content.replace(GREETING_HEAD, "").trim() || content;
      const g = guessNote(body);
      return { kind: g.kind, atTime: g.atTime, content: body.slice(0, 300) };
    });

  // **하나도 안 남으면 원문 전체를 한 건으로 돌려줍니다.** 빈 목록을 돌려주면 화면에 적을
  // 칸이 없고, 그러면 그 부탁은 어디에도 안 남습니다 - 나누려다 없애는 셈입니다.
  if (drafts.length === 0) {
    const whole = (text ?? "").replace(/\s+/g, " ").trim();
    if (!whole) return [];
    const g = guessNote(whole);
    return [{ kind: g.kind, atTime: g.atTime, content: whole.slice(0, 300) }];
  }
  return drafts;
}

/**
 * 조각으로 자르기.
 *
 * 줄바꿈이 먼저입니다 — 토들에서 오는 글은 줄을 나눠 적는 경우가 많고, 줄이 바뀌면 대개
 * 다른 이야기입니다. 그 다음 마침표·물음표, 그리고 「그리고」 앞에서 자릅니다.
 */
function cut(text: string): string[] {
  return (text ?? "")
    .split(/\n+/)
    // **숫자 뒤 마침표에서는 자르지 않습니다** — 「1. 오늘 …」의 「1.」이 제 조각이 되면
    // 그 번호가 앞 건 끝에 붙어 「… 2.」로 끝나는 내용이 남습니다.
    .flatMap((line) => line.split(/(?<=[^\d][.!?~])\s+/))
    .flatMap((s) => s.split(/\s+(?=(?:그리고|그리구|또한|추가로)\s)/))
    .flatMap((s) => s.split(/\s{3,}/));
}
