/**
 * 학생 이름을 대조하는 **한 곳**입니다.
 *
 * 왜 모았는가. 이 판단이 여섯 파일에 흩어져 있었고, 이번 주에 난 오류가 전부 거기서
 * 나왔습니다.
 *
 * | 언제 | 무엇이 틀렸나 | 어느 파일이었나 |
 * |---|---|---|
 * | 사진 | `고서윤` 이 명부와 안 맞음 | passportPhoto |
 * | 출결 | `이예나 셔틀 안탑니다` 가 통째로 무시됨 | attendanceDigest |
 * | 동승 | `하임이` 가 임하임인지 정하임인지 못 가림 | rideAlong |
 * | 문의 | `김재이` 셋 중 누구인지 표시 안 됨 | pickupParse |
 *
 * **한 곳을 고쳐도 나머지 다섯은 그대로였습니다.** 부서 판정(`departmentOf`)을 한 곳으로
 * 모으고 검사기를 붙였던 것과 같은 문제입니다.
 *
 * 여기서 지키는 것 네 가지.
 *
 * ① **자모를 합쳐서 봅니다(NFC).** 맥에서 만든 파일 이름은 `고서윤` 이 ㄱ+ㅗ+ㅅ... 으로
 *    쪼개져 옵니다. 눈에는 똑같아 보이는데 글자로는 다릅니다. 이것 때문에 사진 137장이
 *    한 명도 안 붙었습니다.
 * ② **조사는 떼되, 뗀 것과 안 뗀 것을 모두 봅니다.** '서이' 에서 '이' 를 떼면 '서' 가 되어
 *    김서이를 못 찾습니다. 반대로 '하임이두' 는 두 번 떼야 '하임' 이 됩니다. 어느 쪽이
 *    맞는지는 명부를 봐야 알 수 있으므로 양쪽을 다 만들어 두고 명부에서 고릅니다.
 * ③ **여럿이면 여럿 그대로 돌려줍니다.** 하나를 골라주는 순간 그것이 곧 틀린 답입니다.
 *    엉뚱한 아이를 차에 태우거나 결석 처리하는 일은 되돌릴 수 없습니다.
 * ④ **겹치는 이름에만 반을 붙입니다.** 한 명뿐인 이름에까지 붙이면 화면이 글자로 가득 차고
 *    정작 구분이 필요한 이름이 묻힙니다.
 */

/** 대조에 필요한 만큼의 학생. 화면마다 들고 있는 모양이 달라 최소한만 받습니다. */
export type NamedStudent = {
  id?: string | null;
  name: string;
  nameEn?: string | null;
  grade?: string | null;
  className?: string | null;
};

/**
 * 글자를 맞대볼 수 있는 모양으로 고칩니다.
 *
 * · 자모를 합칩니다(NFC) — 맥 파일 이름 대응
 * · 공백과 괄호를 뗍니다 — `김재이 (G3J)` 와 `김재이(G3J)` 가 같아야 합니다
 * · 영문은 소문자로 — `Jay Kim` 과 `jay kim`
 */
export function normalizeName(s: string | null | undefined): string {
  return (s ?? "")
    .normalize("NFC")
    .replace(/[\s()（）［\]【】]/g, "")
    .trim()
    .toLowerCase();
}

/** 이름 뒤에 붙는 조사. '하임이두' → '하임이' → '하임' */
const PARTICLE = /(이랑|랑|이와|와|과|이도|도|두|이|가|은|는|을|를|의)$/;

/**
 * 조사를 뗀 여러 모양. 원래 모양이 **맨 앞**입니다 - 그것이 맞는 경우가 가장 많습니다.
 */
export function nameForms(s: string | null | undefined): string[] {
  const base = normalizeName(s);
  if (!base) return [];
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

/** 한 학생을 부를 수 있는 모든 표기(한글명·영문명·성 뺀 이름). */
export function surfacesOf(s: NamedStudent): string[] {
  const out = [normalizeName(s.name)];
  if (s.nameEn) {
    out.push(normalizeName(s.nameEn));
    // "Jay Kim" 에서 이름만. 부모는 성을 잘 안 씁니다.
    const first = s.nameEn.trim().split(/\s+/)[0];
    if (first && first.length >= 2) out.push(normalizeName(first));
  }
  // 한글 이름에서 성을 뗀 두 글자. '김서이' → '서이'
  const ko = (s.name ?? "").normalize("NFC");
  if (/^[가-힣]{3,4}$/.test(ko)) out.push(normalizeName(ko.slice(1)));
  return [...new Set(out.filter((x) => x.length >= 2))];
}

/**
 * 표기 하나로 명부에서 학생을 찾습니다.
 *
 * **여럿이면 여럿 그대로 돌려줍니다.** 부르는 쪽이 사람에게 물어야 합니다.
 * 찾는 순서: 이름이 정확히 같음 → 끝자리가 같음 → 포함. 앞쪽이 하나라도 걸리면 거기서
 * 멈춥니다 - 뒤로 갈수록 헐거워서, 앞에서 찾은 것이 항상 더 맞습니다.
 */
export function findByName<T extends NamedStudent>(surface: string, roster: T[]): T[] {
  const forms = nameForms(surface);
  if (forms.length === 0) return [];

  const table = roster.map((r) => ({ r, keys: surfacesOf(r) }));

  for (const f of forms) {
    const hit = table.filter((x) => x.keys.includes(f));
    if (hit.length > 0) return hit.map((x) => x.r);
  }
  for (const f of forms) {
    const hit = table.filter((x) => x.keys.some((k) => k.endsWith(f)));
    if (hit.length > 0) return hit.map((x) => x.r);
  }
  for (const f of forms) {
    const hit = table.filter((x) => x.keys.some((k) => k.includes(f)));
    if (hit.length > 0) return hit.map((x) => x.r);
  }
  return [];
}

/**
 * 학년·반 힌트로 후보를 좁힙니다. 좁혀지지 않으면 **원래 후보를 그대로** 돌려줍니다 -
 * 힌트가 틀렸을 때 아무도 안 남는 것보다 여럿이 남는 편이 낫습니다.
 */
export function narrowBy<T extends NamedStudent>(
  candidates: T[],
  hint: { grade?: string | null; className?: string | null },
): T[] {
  if (candidates.length <= 1) return candidates;
  if (hint.className) {
    const byClass = candidates.filter((c) => (c.className ?? "") === hint.className);
    if (byClass.length > 0) return byClass;
  }
  if (hint.grade) {
    const g = String(hint.grade).replace(/[^0-9+]/g, "");
    const byGrade = candidates.filter((c) => String(c.grade ?? "").replace(/[^0-9+]/g, "") === g);
    if (byGrade.length > 0) return byGrade;
  }
  return candidates;
}

/**
 * 화면에 쓸 이름. **겹치는 이름에만** 반을 붙입니다.
 *
 * 김재이가 셋(G2C·G2A·G3JA)입니다. 목록에 그냥 "김재이" 로만 뜨면 어느 아이 이야기인지
 * 알 수 없고, 그 상태로 셔틀·출결에 반영하면 엉뚱한 아이가 처리됩니다.
 */
export function displayName(s: NamedStudent, roster: NamedStudent[]): string {
  const same = roster.filter((o) => normalizeName(o.name) === normalizeName(s.name));
  if (same.length <= 1) return s.name;
  const cls = (s.className ?? "").trim();
  return cls ? `${s.name}(${cls})` : `${s.name}(${s.grade ?? "?"}학년)`;
}

/** 이 이름이 명부에서 겹치는가. 화면에서 "확인 필요" 를 띄울지 정할 때 씁니다. */
export function isHomonym(name: string, roster: NamedStudent[]): boolean {
  const k = normalizeName(name);
  return roster.filter((o) => normalizeName(o.name) === k).length > 1;
}
