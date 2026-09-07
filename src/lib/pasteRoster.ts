/**
 * 구글시트에서 복사한 줄을 학생 명부로 읽습니다.
 *
 * 명부는 구글시트에서만 갱신되고 있습니다. 그걸 앱에 옮기려면 지금은 한 명씩 손으로 넣어야
 * 하는데, 그러면 옮기는 일 자체가 미뤄지고 두 명부가 어긋납니다.
 *
 * ── 왜 구글 API 연동이 아니라 붙여넣기인가 ────────────────────────────
 *
 * 자동 동기화는 구글 클라우드 서비스 계정과 시트 공유 설정이 필요합니다. 외부 계정 하나가
 * 더 늘고, 그 계정이 막히면 명부가 통째로 멈춥니다(카카오맵에서 이미 겪었습니다).
 * 붙여넣기는 **아무 설정도 필요 없고 오늘 바로** 됩니다.
 *
 * ── 칸 순서를 정해두지 않습니다 ──────────────────────────────────────
 *
 * 시트의 칸 순서는 사람이 언제든 바꿉니다. 순서를 코드에 박아두면 어느 날 조용히 학년 칸에
 * 반 이름이 들어갑니다. 그래서 **머리줄의 글자를 보고** 어느 칸인지 정합니다. 머리줄이
 * 없으면 못 읽었다고 말하고 사람이 짝지어 주게 합니다 - 짐작해서 넣지 않습니다.
 */

/** 우리 표의 칸. 여기 없는 칸은 읽지 않습니다. */
export type RosterField =
  | "name"
  | "name_en"
  | "grade"
  | "class_name"
  | "birth_date"
  | "student_no"
  | "mother_phone"
  | "father_phone"
  | "parent_phone";

export const FIELD_LABEL: Record<RosterField, string> = {
  name: "이름",
  name_en: "영문 이름",
  grade: "학년",
  class_name: "반",
  birth_date: "생년월일",
  student_no: "학번",
  mother_phone: "어머니 연락처",
  father_phone: "아버지 연락처",
  parent_phone: "보호자 연락처",
};

/**
 * 머리줄에 적힐 법한 말들.
 *
 * 실제 시트에서 쓰는 말을 넉넉히 넣습니다 - 한 글자만 달라도 못 읽으면 사람이 시트를
 * 고쳐야 하고, 그건 이 기능을 만든 이유와 반대입니다.
 */
const ALIASES: Record<RosterField, string[]> = {
  name: ["이름", "성명", "학생명", "학생이름", "한글이름", "name", "studentname", "koreanname"],
  name_en: ["영문", "영문이름", "영문명", "영어이름", "englishname", "nameen", "english"],
  grade: ["학년", "grade", "gr"],
  class_name: ["반", "학급", "class", "classname", "homeroom"],
  birth_date: ["생년월일", "생일", "출생", "birth", "birthday", "birthdate", "dob"],
  student_no: ["학번", "학생번호", "번호", "studentno", "studentid", "id"],
  mother_phone: ["모", "어머니", "모연락처", "어머니연락처", "모전화", "mother", "mom", "motherphone"],
  father_phone: ["부", "아버지", "부연락처", "아버지연락처", "부전화", "father", "dad", "fatherphone"],
  parent_phone: ["보호자", "보호자연락처", "학부모", "학부모연락처", "연락처", "전화", "phone", "parent", "guardian"],
};

const norm = (s: string) => s.normalize("NFC").toLowerCase().replace(/[\s()\-_./]/g, "");

/** 이 글자가 어느 칸을 가리키는가. 못 고르면 null. */
export function fieldOf(header: string): RosterField | null {
  const h = norm(header);
  if (!h) return null;
  // 정확히 같은 것을 먼저 봅니다. 「연락처」가 「어머니 연락처」보다 먼저 걸리면 안 됩니다.
  for (const [f, list] of Object.entries(ALIASES) as [RosterField, string[]][]) {
    if (list.some((a) => norm(a) === h)) return f;
  }
  for (const [f, list] of Object.entries(ALIASES) as [RosterField, string[]][]) {
    if (list.some((a) => h.includes(norm(a)))) return f;
  }
  return null;
}

/**
 * 전화번호를 숫자만 남겨 통일합니다.
 *
 * 시트에는 `010-1234-5678`, `01012345678`, `+82 10-1234-5678` 이 섞여 있습니다. 그대로 두면
 * 같은 번호가 세 가지로 저장되고, 학부모를 번호로 찾는 화면이 전부 어긋납니다.
 */
export function normPhone(raw: string): string | null {
  let v = (raw ?? "").replace(/[^0-9+]/g, "");
  if (v.startsWith("+82")) v = "0" + v.slice(3);
  v = v.replace(/[^0-9]/g, "");
  if (v.length < 9 || v.length > 11) return null;
  return v;
}

/**
 * 생년월일을 YYYY-MM-DD 로.
 *
 * `2015-03-04`, `2015.3.4`, `2015/03/04`, `20150304` 을 받습니다. 두 자리 연도(`15.3.4`)는
 * **읽지 않습니다** - 1915년인지 2015년인지 기계가 정하면 언젠가 틀립니다.
 */
export function normBirth(raw: string): string | null {
  const s = (raw ?? "").trim();
  if (!s) return null;
  const m = s.match(/^(\d{4})[.\-/]?\s*(\d{1,2})[.\-/]?\s*(\d{1,2})\.?$/);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (y < 1900 || y > 2100 || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export type ParsedRow = {
  /** 몇 번째 줄이었는가. 화면에서 「3번째 줄」이라고 짚어주려면 필요합니다. */
  rowNo: number;
  values: Partial<Record<RosterField, string>>;
  /** 이 줄을 넣을 수 없는 이유. 있으면 넣지 않습니다. */
  problem: string | null;
};

export type ParseResult = {
  /** 머리줄에서 알아본 칸(열 번호 → 칸). */
  mapping: (RosterField | null)[];
  /** 머리줄로 쓴 줄. 없으면 null(=첫 줄부터 자료). */
  header: string[] | null;
  rows: ParsedRow[];
  /** 알아보지 못한 머리줄 글자. 감추지 않고 화면에 적습니다. */
  unknownHeaders: string[];
};

/**
 * 붙여넣은 글을 읽습니다.
 *
 * 구글시트에서 복사하면 **칸은 탭, 줄은 줄바꿈**으로 옵니다. 그래서 탭을 먼저 봅니다.
 * 탭이 하나도 없으면 쉼표로 나눠봅니다(CSV 를 붙여넣는 사람이 있습니다).
 */
export function parseRosterPaste(text: string, forced?: (RosterField | null)[]): ParseResult {
  const lines = (text ?? "").replace(/\r/g, "").split("\n").filter((l) => l.trim() !== "");
  if (lines.length === 0) return { mapping: [], header: null, rows: [], unknownHeaders: [] };

  const sep = lines[0].includes("\t") ? "\t" : ",";
  const table = lines.map((l) => l.split(sep).map((c) => c.trim()));

  // 첫 줄이 머리줄인가. **이름 칸을 알아볼 수 있으면** 머리줄로 봅니다 - 사람 이름이
  // 우연히 「이름」인 경우는 없습니다.
  const firstMapping = table[0].map((c) => fieldOf(c));
  const looksHeader = firstMapping.filter(Boolean).length >= 2 && firstMapping.includes("name");

  const mapping = forced ?? (looksHeader ? firstMapping : []);
  const header = looksHeader ? table[0] : null;
  const body = looksHeader ? table.slice(1) : table;
  const unknownHeaders = looksHeader ? table[0].filter((c, i) => c && !firstMapping[i]) : [];

  const rows: ParsedRow[] = body.map((cells, i) => {
    const values: Partial<Record<RosterField, string>> = {};
    cells.forEach((cell, col) => {
      const f = mapping[col];
      if (!f || !cell) return;
      if (f === "birth_date") {
        const b = normBirth(cell);
        if (b) values.birth_date = b;
        return;
      }
      if (f === "mother_phone" || f === "father_phone" || f === "parent_phone") {
        const p = normPhone(cell);
        if (p) values[f] = p;
        return;
      }
      values[f] = cell;
    });

    // 이름이 없으면 넣을 수 없습니다. 이름 없는 학생 줄은 어디에도 못 씁니다.
    const problem = !values.name ? "이름 칸이 비어 있습니다" : null;
    return { rowNo: i + 1 + (looksHeader ? 1 : 0), values, problem };
  });

  return { mapping, header, rows, unknownHeaders };
}
