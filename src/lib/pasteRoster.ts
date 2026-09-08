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
  name: ["이름", "성명", "성함", "학생", "학생명", "학생이름", "학생성명", "한글이름", "국문이름", "name", "studentname", "koreanname"],
  name_en: ["영문", "영문이름", "영문명", "영문성명", "영어이름", "englishname", "nameen", "english"],
  grade: ["학년", "grade", "gr"],
  class_name: ["반", "학급", "반이름", "학급명", "class", "classname", "homeroom"],
  birth_date: ["생년월일", "생일", "출생", "출생일", "birth", "birthday", "birthdate", "dob"],
  student_no: ["학번", "학생번호", "번호", "studentno", "studentid", "id"],
  mother_phone: ["모", "어머니", "모연락처", "어머니연락처", "모전화", "모휴대폰", "mother", "mom", "motherphone"],
  father_phone: ["부", "아버지", "부연락처", "아버지연락처", "부전화", "부휴대폰", "father", "dad", "fatherphone"],
  parent_phone: ["보호자", "보호자연락처", "학부모", "학부모연락처", "부모", "부모님", "연락처", "전화", "전화번호", "휴대폰", "핸드폰", "phone", "parent", "guardian"],
};

const norm = (s: string) =>
  s
    .normalize("NFC")
    .replace(/^["']+|["']+$/g, "")
    .toLowerCase()
    .replace(/[\s()[\]{}<>*·,\-_./\\]/g, "");

/**
 * 머리줄 글자 하나하나를 「긴 것부터」 봅니다.
 *
 * 예전에는 칸(field) 차례대로 돌면서 먼저 걸리는 것을 골랐습니다. 그래서 `name` 이
 * `name_en` 보다 앞에 있다는 이유만으로 「Student English Name」이 **이름** 칸이 되었고,
 * 「부모님 연락처」는 mother_phone 의 「모」 한 글자에 걸려 **어머니 연락처**가 되었습니다.
 * 어느 쪽도 화면에는 오류로 보이지 않고, 엉뚱한 칸에 값이 들어갑니다.
 *
 * 이제는 짧은 말이 긴 말을 이기지 못하도록 **글자 수 내림차순**으로 봅니다.
 */
const ALIAS_INDEX: { field: RosterField; a: string }[] = (Object.entries(ALIASES) as [RosterField, string[]][])
  .flatMap(([field, list]) => list.map((a) => ({ field, a: norm(a) })))
  .filter((x) => x.a !== "")
  .sort((x, y) => y.a.length - x.a.length);

/** 이 글자가 어느 칸을 가리키는가. 못 고르면 null. */
export function fieldOf(header: string): RosterField | null {
  const h = norm(header);
  if (!h) return null;
  // ① 똑같은 말이 있으면 그것. 「연락처」가 「어머니 연락처」보다 먼저 걸리면 안 됩니다.
  const exact = ALIAS_INDEX.find((x) => x.a === h);
  if (exact) return exact.field;
  // ② 안에 들어 있는 말 중 가장 긴 것. 짧은 말은 여기서 보지 않습니다 - 「모」「부」 같은
  //    한 글자는 남의 머리줄 안에 우연히 들어 있고, 「id」는 사람 이름 David 안에 들어 있습니다.
  //    한글은 두 글자면 뜻이 서고, 알파벳은 세 글자는 되어야 합니다.
  const part = ALIAS_INDEX.find((x) => (/[가-힣]/.test(x.a) ? x.a.length >= 2 : x.a.length >= 3) && h.includes(x.a));
  return part ? part.field : null;
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

/**
 * 이름 옆에 붙은 **표시**를 떼어냅니다.
 *
 * 시트에서는 새로 온 아이를 「김민준(NEW)」처럼 적어 표시합니다. 사람에게는 눈에 띄는
 * 표시지만, 그대로 등록하면 **이름이 「김민준(NEW)」인 학생**이 생깁니다. 그러면 다음 주에
 * 표시를 지웠을 때 같은 아이가 두 명이 되고, 출결·관찰기록이 두 줄로 갈립니다.
 *
 * **아는 표시만** 뗍니다. 괄호를 통째로 지우면 시트에 적어둔 다른 정보까지 사라집니다.
 */
const NAME_TAGS = /[（(\[]\s*(new|신규|신입|전학|추가|재원|신입생)\s*[）)\]]/gi;

export function cleanStudentName(raw: string): string {
  return (raw ?? "")
    .replace(NAME_TAGS, " ")
    // 표시가 괄호 없이 붙는 경우도 있습니다: 「김민준 NEW」.
    .replace(/\s+(new|신규|신입생)\s*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
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
  /** 앱이 스스로 알아본 칸. 사람이 고친 것과 구별하려고 따로 둡니다. */
  guess: (RosterField | null)[];
  /** 머리줄로 쓴 줄. 없으면 null(=첫 줄부터 자료). */
  header: string[] | null;
  /** 첫 줄을 머리줄로 보고 있는가. */
  headerUsed: boolean;
  /** 앱이 스스로 「이건 머리줄이다」라고 본 것인가(사람이 정한 것과 구별). */
  headerDetected: boolean;
  /** 나눠 놓은 칸 전체. 화면에서 「이 칸의 예시 값」을 보여주는 데 씁니다. */
  table: string[][];
  rows: ParsedRow[];
  /** 알아보지 못한 머리줄 글자. 감추지 않고 화면에 적습니다. */
  unknownHeaders: string[];
};

/**
 * 붙여넣은 글을 읽습니다.
 *
 * 구글시트에서 복사하면 **칸은 탭, 줄은 줄바꿈**으로 옵니다. 그래서 탭을 먼저 봅니다.
 * 탭이 하나도 없으면 쉼표로 나눠봅니다(CSV 를 붙여넣는 사람이 있습니다).
 *
 * `forced` 는 사람이 화면에서 직접 고른 칸, `forcedHeader` 는 사람이 직접 정한
 * 「첫 줄이 머리줄인지」입니다. **사람이 정한 것이 언제나 이깁니다** - 앱이 머리줄을
 * 반만 알아봤을 때 사람이 나머지를 고칠 수 없으면, 그 뒤 자료도 전부 어긋난 채 들어갑니다.
 */
export function parseRosterPaste(
  text: string,
  forced?: (RosterField | null)[],
  forcedHeader?: boolean,
): ParseResult {
  const lines = (text ?? "").replace(/\r/g, "").split("\n").filter((l) => l.trim() !== "");
  if (lines.length === 0)
    return { mapping: [], guess: [], header: null, headerUsed: false, headerDetected: false, table: [], rows: [], unknownHeaders: [] };

  // 칸을 나누는 글자는 **줄마다 따로** 봅니다.
  //
  // 예전에는 첫 줄만 보고 정했습니다. 머리줄은 손으로 적어서 탭이 없고 학생 줄은 시트에서
  // 복사해 탭이 있는 경우 - 실제로 가장 흔한 경우 - 온 줄을 쉼표로 나누려다 머리줄이 한 칸이
  // 되었고, 「어머니 연락처」처럼 사이에 띄어쓰기가 든 항목이 통째로 안 읽혔습니다.
  const table = lines.map((l) =>
    (l.includes("\t") ? l.split("\t") : l.includes(",") ? l.split(",") : [l]).map((c) =>
      c.trim().replace(/^"(.*)"$/, "$1"),
    ),
  );

  // 머리줄만 한 칸으로 남았다면 띄어쓰기로 나눠봅니다. 탭 없이 손으로 적은 머리줄입니다.
  // **학생 줄과 칸 수가 맞을 때만** 씁니다 - 「어머니 연락처」를 두 칸으로 쪼개면 더 나빠집니다.
  if (forcedHeader !== false && table.length >= 2 && table[0].length === 1 && table[1].length >= 2) {
    const want = table[1].length;
    for (const re of [/\s{2,}/, /\s+/]) {
      const tried = table[0][0].split(re).filter((c) => c !== "");
      if (tried.length === want) {
        table[0] = tried;
        break;
      }
    }
  }

  // 첫 줄이 머리줄인가. 알아본 칸이 **두 개 이상**이면 머리줄로 봅니다.
  // 예전에는 여기에 「이름 칸을 알아봤을 것」이 더 붙어 있었습니다. 그래서 시트의 이름
  // 머리글이 우리가 모르는 말이면 머리줄 전체를 자료로 읽어버렸고, 첫 학생이 사라진 채
  // 나머지 줄도 엉뚱한 칸으로 들어갔습니다. 사람 이름·전화번호·날짜는 어느 것도 머리글
  // 이름과 겹치지 않으므로, 두 칸이 걸리면 머리줄로 보아도 안전합니다.
  const firstMapping = table[0].map((c) => fieldOf(c));
  const known = firstMapping.filter(Boolean).length;
  // 한 칸만 걸렸을 때는 「자료다운 값」이 섞여 있는지로 가릅니다. 머리줄에는 전화번호도
  // 생년월일도 없습니다. 시트 머리글 대부분이 우리가 모르는 말이어도 머리줄은 머리줄입니다.
  const looksLikeData = table[0].some((c) => normPhone(c) !== null || normBirth(c) !== null);
  const headerDetected = known >= 2 || (known >= 1 && table[0].length >= 2 && !looksLikeData);
  const looksHeader = forcedHeader ?? headerDetected;

  const guess = looksHeader ? firstMapping : table[0].map(() => null);
  const mapping = forced ?? guess;
  const header = looksHeader ? table[0] : null;
  const body = looksHeader ? table.slice(1) : table;
  const unknownHeaders = looksHeader ? table[0].filter((c, i) => c && !mapping[i]) : [];

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
      if (f === "name" || f === "name_en") {
        // 「(NEW)」 같은 표시를 뗀 뒤에 넣습니다. 표시가 붙은 채로 들어가면 표시를 지운 주에
        // 같은 아이가 한 명 더 생깁니다.
        const cleaned = cleanStudentName(cell);
        if (cleaned) values[f] = cleaned;
        return;
      }
      values[f] = cell;
    });

    // 이름이 없으면 넣을 수 없습니다. 이름 없는 학생 줄은 어디에도 못 씁니다.
    // 「이름 칸 자체를 안 정한 것」과 「그 줄만 비어 있는 것」은 사람이 할 일이 달라서 나눕니다.
    const problem = !mapping.includes("name")
      ? "이름 칸을 정하지 않았습니다"
      : !values.name
        ? "이름 칸이 비어 있습니다"
        : null;
    return { rowNo: i + 1 + (looksHeader ? 1 : 0), values, problem };
  });

  return { mapping, guess, header, headerUsed: looksHeader, headerDetected, table, rows, unknownHeaders };
}
