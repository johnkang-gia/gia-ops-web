/**
 * "누구 셔틀에 누구도 같이 태워주세요" 를 읽어냅니다.
 *
 * 실제로 온 연락입니다.
 *   "선생님 오늘 하교시 서이셔틀에 하임이두 같이 보내주세요!"
 *
 * 이 한 문장에 세 가지가 겹쳐 있습니다.
 *   ① 서이(김서이)가 타는 **차**에
 *   ② 하임이(정하임)를 **같이** 태워달라
 *   ③ 오늘 **하루만** — 정하임은 평소 셔틀을 타지 않습니다
 *
 * 지금까지는 이런 글이 그냥 '문의' 로만 쌓였습니다. 사람이 읽고 기억해야 했고, 잊으면
 * 아이가 차를 못 탑니다.
 *
 * **AI 없이 규칙으로 먼저 읽습니다.** AI 호출은 실패할 수 있고 느립니다. 이 문형은 뜻이
 * 좁고 표현이 몇 가지로 정해져 있어서 규칙으로 충분히 잡힙니다. AI 는 규칙이 놓친 것을
 * 보태는 쪽으로만 씁니다.
 */

/** 명부에서 이 판단에 필요한 만큼만. */
export type RideAlongStudent = {
  id: string;
  name: string;
  grade?: string | null;
  className?: string | null;
};

export type RideAlongRead = {
  /** 원문에 적힌 대로의 표기. '서이' · '하임이'. */
  hostSurface: string;
  riderSurface: string;
  /** 명부에서 찾은 후보. 딱 하나면 확정할 수 있습니다. */
  hostCandidates: RideAlongStudent[];
  riderCandidates: RideAlongStudent[];
  /** 왜 이렇게 읽었는지. 틀렸을 때 사람이 근거를 봐야 고칠 수 있습니다. */
  why: string;
};

const flat = (s: string) => (s ?? "").replace(/\s+/g, "").trim();

// 차를 가리키는 말. "서이차", "서이 버스", "서이 셔틀" 모두 같은 뜻입니다.
const VEHICLE = "(?:셔틀|샤틀|차량|차|버스)";
// 태워달라는 말. 이 말이 없으면 그냥 차량 이야기를 한 것일 수 있습니다.
const ASK = /(태워|태우|보내|같이\s*가|함께\s*가|타고\s*가|탑승)/;
// 이름 뒤에 붙는 조사. 이름만 뽑아내려면 떼어내야 합니다.
const PARTICLE = /(이랑|랑|이와|와|과|이도|도|두|이|가|은|는|을|를|의)$/;

/**
 * 이름 표기에서 조사를 뗀 여러 모양을 만듭니다.
 *
 * 조사를 **무조건 떼면 안 됩니다.** '서이' 에서 '이' 를 떼면 '서' 가 되어 김서이를 못 찾습니다.
 * 반대로 '하임이두' 는 두 번 떼야 '하임' 이 됩니다. 어느 쪽이 맞는지는 명부를 봐야 알 수
 * 있으므로, 뗀 것과 안 뗀 것을 **모두** 만들어 두고 명부에서 맞는 것을 고릅니다.
 */
function surfaceForms(s: string): string[] {
  const base = flat(s);
  const out = [base];
  let cur = base;
  for (let i = 0; i < 2; i++) {
    const next = cur.replace(PARTICLE, "");
    if (next === cur) break;
    cur = next;
    if (cur.length >= 2) out.push(cur);
  }
  return [...new Set(out)];
}

/**
 * 명부에서 이 표기에 해당하는 아이를 찾습니다.
 *
 * 부모는 이름 전체를 잘 쓰지 않습니다 - '서이', '하임이' 처럼 뒤 두 글자로 부릅니다.
 * 그래서 **끝자리 일치**를 봅니다. 다만 그러면 여럿이 걸립니다(하임 → 임하임·정하임).
 * 여럿이면 여럿 그대로 돌려줍니다 - 여기서 하나를 고르면 그것이 곧 틀린 답입니다.
 */
export function findBySurface(surface: string, roster: RideAlongStudent[]): RideAlongStudent[] {
  for (const s of surfaceForms(surface)) {
    const exact = roster.filter((r) => flat(r.name) === s);
    if (exact.length > 0) return exact;
  }
  for (const s of surfaceForms(surface)) {
    const tail = roster.filter((r) => flat(r.name).endsWith(s));
    if (tail.length > 0) return tail;
  }
  for (const s of surfaceForms(surface)) {
    const part = roster.filter((r) => flat(r.name).includes(s));
    if (part.length > 0) return part;
  }
  return [];
}

/**
 * 한 글에서 동승 요청을 읽어냅니다. 없으면 null.
 */
export function readRideAlong(text: string, roster: RideAlongStudent[]): RideAlongRead | null {
  const raw = (text ?? "").trim();
  if (!raw || !ASK.test(raw)) return null;

  // ① "<이름> 셔틀에" 를 찾습니다. 붙여 쓴 '서이셔틀에' 도, 띄어 쓴 '서이 셔틀에' 도 잡습니다.
  const host = new RegExp(`([가-힣]{2,4})\\s*${VEHICLE}\\s*(?:에|로|편에|편으로)`).exec(raw);
  if (!host) return null;
  const hostSurface = flat(host[1]);

  // ② 태울 아이. 차 이야기 **뒤쪽**에서, '도/두/같이/함께' 가 붙은 이름을 찾습니다.
  //    "하임이두 같이", "하임이도", "하임이랑 같이" 가 모두 여기 걸립니다.
  const after = raw.slice(host.index + host[0].length);
  const rider =
    /([가-힣]{2,4})\s*(?:이?두|이?도|이?랑|이?와|이?과)\s*(?:같이|함께)?/.exec(after) ??
    /([가-힣]{2,4})\s*(?:같이|함께)/.exec(after);
  if (!rider) return null;
  const riderSurface = flat(rider[1]);
  if (!riderSurface || riderSurface === hostSurface) return null;

  const hostCandidates = findBySurface(hostSurface, roster);
  const riderCandidates = findBySurface(riderSurface, roster);

  return {
    hostSurface,
    riderSurface,
    hostCandidates,
    riderCandidates,
    why: `"${hostSurface} 차에 ${riderSurface} 같이 태워달라" 로 읽었습니다.`,
  };
}

/**
 * 자동으로 등록해도 되는가.
 *
 * **양쪽 모두 한 명으로 좁혀질 때만** 자동입니다. 하나라도 여럿이면 확인대기로 둡니다 -
 * 엉뚱한 아이를 차에 태우는 것은 되돌릴 수 없는 종류의 실수입니다.
 */
export function canAutoRegister(read: RideAlongRead): boolean {
  return read.hostCandidates.length === 1 && read.riderCandidates.length === 1;
}
