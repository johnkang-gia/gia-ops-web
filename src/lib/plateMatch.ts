/**
 * **카메라가 읽은 글자를 등록된 호차에 맞춥니다.**
 *
 * ── 왜 일반 번호판 인식이 아닌가 ─────────────────────────────────────
 *
 * 세상의 모든 번호판을 읽어야 한다면 어려운 일입니다. 그런데 우리가 가려낼 대상은
 * **오늘 오는 우리 학교 차 십수 대뿐**입니다. 답이 열몇 개로 정해져 있으면, 글자를
 * 반만 읽어도 어느 차인지 정할 수 있습니다.
 *
 * 「12모3456」에서 「모3456」만 읽혀도 그걸로 끝나는 번호판이 하나뿐이면 그 차입니다.
 * 그래서 **읽기를 잘하는 것보다 좁히기를 잘하는 편**이 실제로 더 잘 맞습니다.
 *
 * ── 무엇을 조심했나 ──────────────────────────────────────────────────
 *
 * **애매하면 안 고릅니다.** 두 호차가 비슷하게 맞으면 아무것도 안 고르고 사람에게
 * 넘깁니다 - 엉뚱한 차를 도착으로 찍으면 아이들이 다른 차 앞에 줄을 섭니다.
 *
 * 숫자 네 자리가 이 판단의 뼈대입니다. 앞자리(지역·분류)와 한글은 카메라에서 자주
 * 뭉개지지만 뒤 네 자리는 크고 굵어서 비교적 잘 읽힙니다. 사람이 차를 부를 때도
 * 뒤 네 자리를 씁니다.
 */

export type PlateCandidate = { routeId: string; routeNo: string; vehicleNo: string | null };
export type PlateMatch =
  | { kind: "찾음"; routeId: string; routeNo: string; vehicleNo: string; digits: string }
  | { kind: "여럿"; candidates: PlateCandidate[]; reason: string }
  | { kind: "못읽음"; reason: string };

/** 번호판에서 견줄 것만 남깁니다. 공백·하이픈·점을 걷어내고 한글은 그대로 둡니다. */
export function plateKey(raw: string | null | undefined): string {
  return String(raw ?? "").normalize("NFC").replace(/[^0-9가-힣]/g, "");
}

/**
 * 번호판의 **뒤 네 자리**. 없으면 null.
 *
 * 「12모3456」 → "3456" · 「서울30가1234」 → "1234"
 * 숫자 덩어리 중 마지막 네 자리를 씁니다 - 앞자리는 두 자리(신형)일 수도 세 자리(구형)일
 * 수도 있어서 자리 수로 세면 어긋납니다.
 */
export function lastFour(raw: string | null | undefined): string | null {
  const groups = plateKey(raw).match(/\d+/g);
  if (!groups) return null;
  const tail = groups[groups.length - 1];
  return tail.length >= 4 ? tail.slice(-4) : null;
}

/** 카메라가 읽어온 글자에서 나올 수 있는 **네 자리 후보**를 모두 뽑습니다. */
export function fourDigitRuns(text: string): string[] {
  const flat = plateKey(text);
  const out = new Set<string>();
  for (const run of flat.match(/\d+/g) ?? []) {
    if (run.length < 4) continue;
    // 「123456」처럼 길게 읽힌 덩어리 안에도 진짜 네 자리가 들어 있습니다.
    for (let i = 0; i + 4 <= run.length; i++) out.add(run.slice(i, i + 4));
  }
  return [...out];
}

/**
 * 카메라 글자를 등록된 호차에 맞춥니다.
 *
 * 순서:
 * 1. 뒤 네 자리가 **딱 하나**의 호차와 맞으면 그 차입니다.
 * 2. 여러 호차와 맞으면(뒤 네 자리가 같은 차가 있으면) 한글·앞자리로 한 번 더 좁힙니다.
 * 3. 그래도 못 좁히면 **안 고릅니다.**
 */
export function matchPlate(ocrText: string, routes: PlateCandidate[]): PlateMatch {
  const usable = routes.filter((r) => lastFour(r.vehicleNo));
  if (usable.length === 0) {
    // 번호판이 등록 안 된 상태. 카메라를 아무리 잘 읽어도 맞출 대상이 없습니다 -
    // 「인식 실패」로 보이면 사람이 카메라만 계속 들이댑니다.
    return { kind: "못읽음", reason: "호차에 차량번호가 등록되어 있지 않습니다. 셔틀 관리에서 먼저 넣어주세요." };
  }

  const runs = fourDigitRuns(ocrText);
  if (runs.length === 0) {
    return { kind: "못읽음", reason: "숫자 네 자리를 읽지 못했습니다. 번호판이 화면에 가득 차도록 가까이 대주세요." };
  }

  const hits: PlateCandidate[] = [];
  let matchedDigits = "";
  for (const run of runs) {
    const found = usable.filter((r) => lastFour(r.vehicleNo) === run);
    if (found.length === 0) continue;
    for (const f of found) if (!hits.some((h) => h.routeId === f.routeId)) hits.push(f);
    if (!matchedDigits) matchedDigits = run;
  }

  if (hits.length === 0) {
    return {
      kind: "못읽음",
      reason: `읽은 숫자(${runs.slice(0, 3).join("·")})와 맞는 호차가 없습니다. 다시 비춰주세요.`,
    };
  }
  if (hits.length === 1) {
    const h = hits[0];
    return { kind: "찾음", routeId: h.routeId, routeNo: h.routeNo, vehicleNo: h.vehicleNo as string, digits: matchedDigits };
  }

  // 뒤 네 자리가 같은 차가 둘 이상. 한글 한 글자라도 읽혔으면 그걸로 갈라 봅니다.
  const flat = plateKey(ocrText);
  const korean = [...flat].filter((c) => /[가-힣]/.test(c));
  if (korean.length > 0) {
    const narrowed = hits.filter((h) => korean.some((k) => plateKey(h.vehicleNo).includes(k)));
    if (narrowed.length === 1) {
      const h = narrowed[0];
      return { kind: "찾음", routeId: h.routeId, routeNo: h.routeNo, vehicleNo: h.vehicleNo as string, digits: matchedDigits };
    }
  }

  // 못 좁혔으면 고르지 않습니다. 엉뚱한 차를 도착으로 찍으면 아이들이 다른 차 앞에 섭니다.
  return {
    kind: "여럿",
    candidates: hits,
    reason: `번호가 비슷한 호차가 ${hits.length}대입니다. 어느 차인지 눌러주세요.`,
  };
}
