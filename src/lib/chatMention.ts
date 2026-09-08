/**
 * 구글챗 답장에서 **@로 사람을 부르는** 한 곳입니다.
 *
 * ── 무엇이 문제인가 ──────────────────────────────────────────────────
 *
 * 구글챗에서 멘션은 글자가 아니라 **사람 번호**입니다. 본문에 이렇게 적어야 알림이 갑니다.
 *
 *     <users/109876543210987654321> 오늘 하원 확인 부탁드립니다
 *
 * 「@김선생님」이라고 글자만 적어 보내면 상대 화면에는 그냥 글자로 뜹니다. **보낸 쪽은
 * 불렀다고 생각하고, 받는 쪽은 알림을 못 받습니다.** 이게 가장 나쁜 종류의 조용한 실패라,
 * 여기서는 «못 바꾼 이름»을 따로 돌려줘서 화면이 보내기 전에 알려줄 수 있게 합니다.
 */

export type ChatMember = { google_user_id: string; display_name: string | null };

/** 이름 비교용. 사람은 「김 선생님」과 「김선생님」을 같은 것으로 씁니다. */
function norm(s: string): string {
  return s.toLowerCase().replace(/\s+/g, "");
}

/**
 * 긴 이름부터 봅니다.
 *
 * 「김민」과 「김민수」가 둘 다 방에 있으면, 짧은 쪽을 먼저 맞추면 「@김민수」가 «김민» +
 * 「수」로 갈립니다. 엉뚱한 사람에게 알림이 갑니다.
 */
function sorted(members: ChatMember[]): { id: string; name: string }[] {
  return members
    .filter((m) => m.google_user_id && m.display_name)
    .map((m) => ({ id: m.google_user_id, name: m.display_name as string }))
    .sort((a, b) => b.name.length - a.name.length);
}

/** 본문에서 `@…` 로 시작하는 토막을 찾습니다. 이름에 띄어쓰기가 있을 수 있어 넉넉히 봅니다. */
const MENTION_RE = /@([^\s@]{1,20}(?:\s[^\s@]{1,20})?)/g;

/**
 * 사람이 친 글을 구글챗이 알아듣는 글로 바꿉니다.
 *
 * 이름이 방 멤버와 맞으면 `<users/…>` 로 바뀌고, 안 맞으면 **그대로 둡니다** - 지우면
 * 사람이 무엇을 적었는지가 사라집니다.
 */
export function toChatText(raw: string, members: ChatMember[]): string {
  const list = sorted(members);
  if (list.length === 0) return raw;
  let out = raw;
  for (const m of list) {
    // 「@김민수」 뒤에 글자가 이어지면 다른 사람일 수 있으니, 이름 바로 뒤가 끝이거나 글자가
    // 아닌 경우만 바꿉니다.
    const re = new RegExp(`@${escapeRe(m.name)}(?=$|[^\\p{L}\\p{N}])`, "gu");
    out = out.replace(re, `<users/${idOf(m.id)}>`);
    // 띄어쓰기를 빼고 적는 분들이 있습니다(「@김 민수」 대신 「@김민수」).
    const packed = m.name.replace(/\s+/g, "");
    if (packed !== m.name) {
      const re2 = new RegExp(`@${escapeRe(packed)}(?=$|[^\\p{L}\\p{N}])`, "gu");
      out = out.replace(re2, `<users/${idOf(m.id)}>`);
    }
  }
  return out;
}

/**
 * 바꾸지 못한 `@이름` 목록.
 *
 * 화면이 보내기 전에 「이 이름은 알림이 가지 않습니다」라고 말해줍니다. 그냥 보내버리면
 * 부른 줄 알고 기다리게 됩니다.
 */
export function unmatchedMentions(raw: string, members: ChatMember[]): string[] {
  const known = new Set<string>();
  for (const m of sorted(members)) {
    known.add(norm(m.name));
    known.add(norm(m.name.replace(/\s+/g, "")));
  }
  const out: string[] = [];
  for (const hit of raw.matchAll(MENTION_RE)) {
    const whole = hit[1];
    // 「@김민수 선생님」처럼 뒤에 한 낱말이 더 붙는 경우가 있어, 통째로도 앞부분만도 봅니다.
    const first = whole.split(/\s/)[0];
    if (known.has(norm(whole)) || known.has(norm(first))) continue;
    if (!out.includes(first)) out.push(first);
  }
  return out;
}

/** `users/123` 로 저장돼 있어도, `123` 으로 저장돼 있어도 같은 결과가 나오게 합니다. */
function idOf(userId: string): string {
  return userId.startsWith("users/") ? userId.slice("users/".length) : userId;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
