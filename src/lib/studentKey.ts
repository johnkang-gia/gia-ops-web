/**
 * **두 자료를 «같은 아이»로 짝짓는 규칙 — 이것 하나만 씁니다.**
 *
 * ── 무엇이 반복됐나 ──────────────────────────────────────────────────────
 *
 * 김재이가 셋입니다(G2A · G2C · G3JA). 동명이인 사고가 여섯 번 났는데, 가르는 규칙
 * (`pickupParse` · `studentLabel`)은 매번 멀쩡했습니다. 사고는 언제나 **규칙을 거치지 않고
 * 화면이 스스로 짝을 지은 자리**에서 났습니다.
 *
 *   · 하원 체크표가 하원수단을 «번호로 찾고, 못 찾으면 이름으로» 찾았습니다. 다른 김재이는
 *     번호로는 안 걸리니 이름 길로 넘어가 G3JA 의 「14:20 픽업」을 가져갔습니다.
 *   · 같은 화면이 오늘 픽업 연락을 **이름만으로**(일부만 겹쳐도) 줄에 얹었습니다.
 *   · 담임 픽업 체크 화면이 학생 → 셔틀 배정을 이름으로 찾았습니다.
 *
 * 공통점은 `Map<이름, 무엇>` 을 만들고 `.get(이름)` 으로 찾는 모양입니다. 이 모양은 김재이
 * 셋이 한 칸을 나눠 쓰게 만들고, 결과는 오류가 아니라 **«적혀 있는 값»**으로 보여서 사람이
 * 그대로 믿습니다.
 *
 * ── 규칙 ─────────────────────────────────────────────────────────────────
 *
 *   ① 찾는 쪽에 학생 번호가 있으면 **번호로 찾습니다.**
 *   ② 번호로 못 찾았을 때 이름 길은 **명부에 한 명뿐인 이름**일 때만 열립니다. 그리고 이름으로
 *      걸리는 상대도 **번호가 없는 줄**이어야 합니다 - 번호가 있는 줄이 번호로 안 걸렸다는 것은
 *      «다른 아이»라는 뜻입니다.
 *   ③ 겹치는 이름인데 번호가 없으면 **찾지 않습니다**(undefined). 엉뚱한 아이에게 붙이는 것보다
 *      비워 두고 사람이 고르게 하는 편이 낫습니다(CLAUDE.md 2-4-1).
 *
 * 이 파일 밖에서 `xxxByName.get(...)` 으로 학생을 찾으면 빌드가 막습니다
 * (`scripts/check-name-lookup.mjs`).
 */

/** 이름 비교용 열쇠. 공백과 괄호 뒤(영문 이름 등)를 뗍니다. */
export function nameKey(name: string | null | undefined): string {
  return String(name ?? "")
    .split("(")[0]
    .replace(/\s+/g, "")
    .trim();
}

/** 명부(재학생)에서 두 명 이상이 쓰는 이름. 이 이름으로는 아무것도 찾지 않습니다. */
export function homonymKeys(roster: Iterable<{ name: string | null | undefined }>): Set<string> {
  const count = new Map<string, number>();
  for (const s of roster) {
    const k = nameKey(s.name);
    if (k) count.set(k, (count.get(k) ?? 0) + 1);
  }
  return new Set([...count].filter(([, n]) => n > 1).map(([k]) => k));
}

/**
 * 학생에게 붙는 자료를 모아 두는 색인. 넣을 때 번호와 이름을 함께 주고, 찾을 때 규칙을
 * 따라 찾습니다.
 *
 * `prefer(old, next)` 가 있으면 같은 아이에게 두 번 들어올 때 어느 쪽을 남길지 정합니다
 * (예: 가장 최근 연락). 없으면 먼저 들어온 것이 남습니다.
 */
export class StudentIndex<T> {
  private byId = new Map<string, T>();
  /** 번호가 없는 줄만. 번호가 있는 줄은 번호로만 찾습니다. */
  private byFreeName = new Map<string, T>();
  /** 번호가 있든 없든. 찾는 쪽에 번호가 없을 때만 씁니다. */
  private byAnyName = new Map<string, T>();

  constructor(
    private readonly homonyms: ReadonlySet<string>,
    private readonly prefer?: (old: T, next: T) => boolean,
  ) {}

  private put(map: Map<string, T>, key: string, value: T) {
    const old = map.get(key);
    if (old === undefined || (this.prefer && this.prefer(old, value))) map.set(key, value);
  }

  add(id: string | null | undefined, name: string | null | undefined, value: T): this {
    const k = nameKey(name);
    if (id) this.put(this.byId, id, value);
    // 겹치는 이름은 이름 칸에 아예 넣지 않습니다 - 넣어 두면 언젠가 누가 꺼냅니다.
    if (k && !this.homonyms.has(k)) {
      if (!id) this.put(this.byFreeName, k, value);
      this.put(this.byAnyName, k, value);
    }
    return this;
  }

  /** 이 아이(번호·이름)에게 붙은 자료. 못 가리면 undefined. */
  find(id: string | null | undefined, name: string | null | undefined): T | undefined {
    const k = nameKey(name);
    const nameOk = !!k && !this.homonyms.has(k);
    if (id) {
      const hit = this.byId.get(id);
      if (hit !== undefined) return hit;
      return nameOk ? this.byFreeName.get(k) : undefined;
    }
    return nameOk ? this.byAnyName.get(k) : undefined;
  }

  values(): T[] {
    return [...new Set([...this.byId.values(), ...this.byAnyName.values(), ...this.byFreeName.values()])];
  }
}
