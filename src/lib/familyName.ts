import type { RosterEntry } from "@/lib/pickupParse";

/**
 * **성(姓)으로 가릅니다** — 토들 방 이름의 마지막 낱말은 그 집의 성입니다.
 *
 * ── 왜 이게 필요한가 ─────────────────────────────────────────────────
 *
 *   G3 & G7_ E.L, Egeon & Elizabeth Jeong_Office
 *
 * 이 방의 성은 **Jeong(정)**입니다. 그런데 「Egeon」만 보면 명부의 **고이건**도 걸립니다 -
 * 이름은 같고 성이 다릅니다. 성을 안 보면 남의 집 아이를 그 집 방에 이어버리고, 그러면
 * 그 집 학부모 연락이 전부 엉뚱한 아이에게 붙습니다. 화면에는 오류가 아니라 그냥
 * 「고이건 픽업」으로 보입니다.
 *
 * **성이 어긋나면 후보에서 뺍니다.** 그리고 왜 뺐는지 적습니다 - 아무 말 없이 사라지면
 * 「왜 이 아이가 안 걸리지」로 남습니다.
 *
 * ── 성이 잘려 오는 경우 ──────────────────────────────────────────────
 *
 *   G3_Sophia M_Office   →  Sophia Min
 *
 * 토들에 적을 때 성을 한 글자만 쓰거나 잘려 보이는 경우가 있습니다. 그래서 **두 글자
 * 이하는 앞부분만 맞아도** 인정합니다("M" ⊂ "Min"). 세 글자 이상이면 통째로 같아야
 * 합니다 - 「Jeong」과 「Jung」은 다른 집일 수 있고, 그건 기계가 정할 일이 아닙니다.
 */

/**
 * 한국 성의 로마자 표기.
 *
 * 명부의 `name_en` 이 비어 있거나 이름만 적힌 아이가 있습니다. 그 경우 영문 성으로는
 * 가를 수 없어서, 한글 이름의 첫 글자로 견줍니다. 표기가 집집마다 달라서(정=jeong/jung/chung)
 * 여러 개를 함께 둡니다.
 *
 * **이 표에 없는 성은 그냥 안 걸립니다** — 못 가르는 것이지 틀리는 것이 아닙니다.
 * 그런 방은 사람이 고릅니다.
 */
const ROMAN: Record<string, string[]> = {
  김: ["kim", "gim"], 이: ["lee", "yi", "rhee", "i"], 박: ["park", "bak", "pak"],
  최: ["choi", "choe"], 정: ["jeong", "jung", "chung", "jeoung"], 강: ["kang", "gang"],
  조: ["cho", "jo"], 윤: ["yoon", "yun"], 장: ["jang", "chang"], 임: ["lim", "im", "rim"],
  한: ["han"], 오: ["oh", "o"], 서: ["seo", "suh", "sur"], 신: ["shin", "sin"],
  권: ["kwon", "gwon"], 황: ["hwang"], 안: ["ahn", "an"], 송: ["song"],
  류: ["ryu", "yu", "lyu"], 전: ["jeon", "jun", "chun"], 홍: ["hong"], 고: ["ko", "go", "koh"],
  문: ["moon", "mun"], 양: ["yang"], 손: ["son", "sohn"], 배: ["bae", "pae"],
  백: ["baek", "paek", "back"], 허: ["heo", "hur", "huh"], 유: ["yoo", "yu", "you"],
  남: ["nam"], 심: ["shim", "sim"], 노: ["noh", "no", "roh"], 하: ["ha"],
  곽: ["kwak", "gwak"], 성: ["sung", "seong"], 차: ["cha"], 주: ["joo", "ju"],
  우: ["woo", "wu"], 구: ["koo", "gu", "ku"], 민: ["min"], 원: ["won"],
  천: ["cheon", "chun"], 방: ["bang", "pang"], 공: ["kong", "gong"], 현: ["hyun", "hyeon"],
  함: ["ham"], 변: ["byun", "byeon"], 염: ["yeom", "youm"], 여: ["yeo", "yuh"],
  추: ["chu", "choo"], 도: ["do", "doh"], 소: ["so", "soh"], 석: ["seok", "suk"],
  선: ["sun", "seon"], 설: ["seol", "sul"], 마: ["ma"], 길: ["gil", "kil"],
  연: ["yeon", "youn"], 위: ["wi", "wee"], 표: ["pyo"], 명: ["myung", "myeong"],
  기: ["ki", "gi"], 반: ["ban", "pan"], 라: ["ra", "na"], 나: ["na", "ra"],
  탁: ["tak"], 진: ["jin", "chin"], 지: ["ji", "jee"], 채: ["chae"], 제: ["je", "jae"],
};

export function flat(v: string | null | undefined): string {
  return String(v ?? "").normalize("NFC").toLowerCase().replace(/[^a-z0-9가-힣]/g, "");
}

/** 이 아이를 가리킬 수 있는 **성** 표기들. 영문 성 + 한글 성 + 그 로마자. */
export function surnamesOf(s: RosterEntry): Set<string> {
  const out = new Set<string>();
  const en = String(s.name_en ?? "").trim();
  if (en) {
    const tokens = en.split(/\s+/).filter(Boolean);
    // 영문 이름은 「이름 성」 차례로 적습니다. 낱말이 둘 이상일 때만 마지막이 성입니다 -
    // 「Sophia」 한 낱말뿐이면 그건 이름이지 성이 아닙니다.
    if (tokens.length > 1) out.add(flat(tokens[tokens.length - 1]));
  }
  const ko = String(s.name ?? "").trim();
  if (ko.length >= 2) {
    // 한국 성은 대개 한 글자입니다. 두 글자 성(남궁·황보)은 이 학교에 없어 다루지 않습니다.
    const first = ko[0];
    out.add(flat(first));
    for (const r of ROMAN[first] ?? []) out.add(r);
  }
  return out;
}

/** 이 아이를 가리킬 수 있는 **이름**(성을 뺀 부분) 표기들. */
export function givensOf(s: RosterEntry): Set<string> {
  const out = new Set<string>();
  const en = String(s.name_en ?? "").trim();
  if (en) {
    const tokens = en.split(/\s+/).filter(Boolean);
    const given = tokens.length > 1 ? tokens.slice(0, -1) : tokens;
    if (given.length > 0) {
      out.add(flat(given.join(" ")));
      out.add(flat(given[0]));
    }
  }
  const ko = String(s.name ?? "").trim();
  if (ko) {
    out.add(flat(ko));
    if (ko.length >= 3) out.add(flat(ko.slice(1)));
    // 두 글자 이름(하라)은 성 한 글자 + 이름 한 글자가 아니라 대개 성+이름 두 글자입니다.
    // 그래도 「이하」 같은 잘못된 조각을 만들지 않도록, 두 글자는 통째로만 둡니다.
  }
  return out;
}

/**
 * 방 이름에 적힌 한 사람을 성과 이름으로 가릅니다.
 *
 * 「Sophia M」 → { given: "Sophia", surname: "M" }
 * 「E.L」      → { given: "E.L",    surname: null }  (형제방이면 위에서 성을 붙여줍니다)
 */
export function splitPerson(raw: string): { given: string; surname: string | null } {
  const tokens = String(raw ?? "").trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return { given: "", surname: null };
  if (tokens.length === 1) return { given: tokens[0], surname: null };
  return { given: tokens.slice(0, -1).join(" "), surname: tokens[tokens.length - 1] };
}

/**
 * 이 아이가 그 집 성과 맞는가.
 *
 * - 성이 안 적혔으면 **가리지 않습니다**(true). 없는 조건으로 아이를 빼면 안 됩니다.
 * - 두 글자 이하는 앞부분만 맞아도 됩니다("M" ⊂ "Min", "정" ⊂ "정").
 * - 세 글자 이상은 통째로 같아야 합니다. 「Jeong」과 「Jung」은 다른 집일 수 있습니다.
 */
export function surnameFits(rawSurname: string | null | undefined, s: RosterEntry): boolean {
  const key = flat(rawSurname);
  if (!key) return true;
  const mine = surnamesOf(s);
  if (mine.size === 0) return true; // 명부에 성을 알 재료가 없으면 못 가릅니다
  if (mine.has(key)) return true;
  if (key.length <= 2) {
    for (const m of mine) if (m.startsWith(key)) return true;
  }
  return false;
}

/** 이름(성 뺀 부분)이 맞는가. 통째로 같거나, 세 글자 이상이면서 앞에서부터 이어지면 인정합니다. */
export function givenFits(rawGiven: string, s: RosterEntry): boolean {
  const key = flat(rawGiven);
  if (!key) return false;
  const mine = givensOf(s);
  if (mine.has(key)) return true;
  // 「Elizabet」처럼 뒤가 잘려 오는 경우. 두 글자로 앞을 맞추면 엉뚱한 아이가 걸립니다.
  if (key.length >= 3) {
    for (const m of mine) if (m.startsWith(key)) return true;
  }
  return false;
}
