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
  return matchField(header)?.field ?? null;
}

/**
 * 어느 칸인지와 **얼마나 정확히 맞았는지**를 함께 냅니다.
 *
 * 「정확히 같은 말」과 「안에 들어 있는 말」은 확신이 다릅니다. 실제 명부에는 `Class #`(반 안의
 * 번호)와 `Class`(진짜 반)가 나란히 있었는데, 앞엣것도 「class」를 포함한다는 이유로 둘 다
 * 반으로 읽혔습니다. 그리고 진짜 반 칸은 병합되어 대부분 비어 있어서, 결국 **번호가 반 이름**이
 * 되었습니다. 정확히 맞은 칸이 있으면 부분만 맞은 칸은 물러나야 합니다.
 */
export function matchField(header: string): { field: RosterField; exact: boolean } | null {
  const h = norm(header);
  if (!h) return null;
  // ① 똑같은 말이 있으면 그것. 「연락처」가 「어머니 연락처」보다 먼저 걸리면 안 됩니다.
  const exact = ALIAS_INDEX.find((x) => x.a === h);
  if (exact) return { field: exact.field, exact: true };
  // ② 안에 들어 있는 말 중 가장 긴 것. 짧은 말은 여기서 보지 않습니다 - 「모」「부」 같은
  //    한 글자는 남의 머리줄 안에 우연히 들어 있고, 「id」는 사람 이름 David 안에 들어 있습니다.
  //    한글은 두 글자면 뜻이 서고, 알파벳은 세 글자는 되어야 합니다.
  const part = ALIAS_INDEX.find((x) => (/[가-힣]/.test(x.a) ? x.a.length >= 2 : x.a.length >= 3) && h.includes(x.a));
  return part ? { field: part.field, exact: false } : null;
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
 * `2015-03-04`, `2015.3.4`, `2015/03/04`, `20150304`, 그리고 **두 자리 연도** `19.8.20` 을
 * 받습니다.
 *
 * 두 자리 연도는 원래 읽지 않았습니다 - 1915년인지 2015년인지 기계가 정하면 언젠가
 * 틀리기 때문입니다. 그런데 실제 명부가 통째로 그 표기였고, 안 읽은 결과는 **학생 전원의
 * 생년월일이 비는 것**이었습니다. 아예 없는 것보다는 올해 기준으로 가르는 편이 낫습니다.
 */
export function normBirth(raw: string): string | null {
  const s = (raw ?? "").trim();
  if (!s) return null;
  const m = s.match(/^(\d{2}|\d{4})[.\-/]\s*(\d{1,2})[.\-/]\s*(\d{1,2})\.?$/) ?? s.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (!m) return null;
  let y = Number(m[1]);
  // 두 자리 연도(`19.8.20`)는 **올해를 기준으로** 가릅니다. 올해의 두 자리보다 크지 않으면
  // 2000년대, 크면 1900년대입니다. 명부에는 이 표기가 그대로 쓰이고 있어서, 안 읽으면
  // 학생 전원의 생년월일이 통째로 비어버립니다.
  if (m[1].length === 2) y = y <= Number(String(new Date().getFullYear()).slice(2)) ? 2000 + y : 1900 + y;
  const [mo, d] = [Number(m[2]), Number(m[3])];
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

/**
 * 반 이름 뒤에 붙은 **인원수**를 뗍니다.
 *
 * 실제 명부의 반 이름은 `G2J (13)` 처럼 적혀 있습니다. 괄호 안 숫자는 그 반 인원인데, 그대로
 * 반 이름으로 삼으면 **한 명이 전학 올 때마다 반 이름이 바뀝니다.** 그러면 지난 학기 기록이
 * 전부 다른 반에 매달린 채로 남습니다.
 *
 * **숫자만 있을 때만** 뗍니다. `G2 (A)` 처럼 글자가 든 괄호는 반을 가르는 진짜 이름입니다.
 */
const CLASS_SIZE = /[（(]\s*(\d+)\s*[명]?\s*[）)]\s*$/;

export function cleanClassName(raw: string): string {
  return (raw ?? "").replace(CLASS_SIZE, "").replace(/\s+/g, " ").trim();
}

/**
 * 반 이름에 적힌 인원수. 없으면 null.
 *
 * 이 숫자가 **어디까지가 그 반인지**를 알려줍니다. 시트에서 반 이름은 묶음의 첫 줄에만 적히고
 * 아래는 비어 있으므로, 인원수가 없으면 그 아래 몇 줄까지가 같은 반인지 알 길이 없습니다.
 *
 * 실제 명부에서 이게 없으면 큰일이 납니다 - 마지막 반(11명) 아래에 「전출 예정 학생」 26명이
 * 붙어 있었고, 끝까지 물려받으면 그 26명이 **재학생으로 등록**됩니다.
 */
export function classSizeOf(raw: string): number | null {
  const m = (raw ?? "").match(CLASS_SIZE);
  const n = m ? Number(m[1]) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * 반 이름에서 학년을 읽습니다.
 *
 * 이 학교의 반 이름은 `G2J`·`G5E` 처럼 **G + 학년 + 담임 첫 글자**입니다. 그런데 명부 시트에는
 * 학년 칸이 아예 없습니다. 학년이 비면 초등부·중고등부 판정이 안 되고(6학년부터 중고등부),
 * 학생 조회의 학년 탭에도 안 잡힙니다.
 *
 * 짐작이 아니라 **학교가 쓰는 표기를 그대로 읽는 것**입니다. `G` 로 시작하고 바로 숫자가
 * 오는 경우만 읽습니다 - 그 밖의 이름은 건드리지 않습니다.
 */
export function gradeFromClassName(className: string): string | null {
  const m = (className ?? "").trim().match(/^[Gg]\s*(\d{1,2})/) ?? (className ?? "").trim().match(/^(\d{1,2})\s*학년/);
  return m ? m[1] : null;
}

/**
 * 위 줄에서 물려받는 칸.
 *
 * 시트에서 반·학년은 묶음의 첫 줄에만 적고 아래는 병합해 비워 둡니다. 사람 눈에는 그 아래도
 * 같은 반이므로, 우리도 그렇게 읽어야 합니다. 이름·연락처는 절대 물려받지 않습니다 -
 * 물려받으면 없는 학생이 생깁니다.
 */
const INHERITED: RosterField[] = ["class_name", "grade"];

/**
 * 한 칸에 든 연락처를 **누구 것인지까지** 갈라 읽습니다.
 *
 * 실제 명부의 연락처 칸은 `(M) 010-9282-2232 (F) 010-7746-7060` 처럼 적혀 있습니다.
 * 통째로 숫자만 남기면 22자리가 되어 **번호가 아닌 것**이 되고, 그 학생은 연락처 없는
 * 학생으로 들어옵니다. 실제로 129명 중 44명이 그렇게 비어 있었습니다.
 *
 * `(M)`·`(모)`는 어머니, `(F)`·`(부)`는 아버지입니다. 표시가 없으면 보호자 연락처로 둡니다 -
 * 짐작으로 어머니 칸에 넣으면 나중에 「어머니께 연락했는데 아버지가 받으셨다」가 됩니다.
 */
export function splitPhones(raw: string): { mother?: string; father?: string; plain?: string } {
  const s = (raw ?? "").replace(/\s+/g, " ");
  const out: { mother?: string; father?: string; plain?: string } = {};
  // 표시와 그 뒤 번호를 짝지어 읽습니다.
  const tagged = [...s.matchAll(/[（(]\s*(M|F|모|부)\s*[）)]\s*([0-9+][0-9\s\-.]{7,})/gi)];
  for (const t of tagged) {
    const who = t[1].toUpperCase();
    const num = normPhone(t[2]);
    if (!num) continue;
    if (who === "M" || who === "모") out.mother ??= num;
    else out.father ??= num;
  }
  if (out.mother || out.father) return out;
  // 표시가 없으면 눈에 띄는 번호 하나. 여러 개면 첫 번째입니다.
  const bare = s.match(/[0-9+][0-9\s\-.]{7,}/g) ?? [];
  for (const b of bare) {
    const num = normPhone(b);
    if (num) {
      out.plain = num;
      break;
    }
  }
  return out;
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
  /** 머리줄이 원래 자료의 몇 번째 줄이었는가(1부터). 못 찾았으면 null. */
  headerRowNo: number | null;
  /** 머리줄 위에서 버린 줄 수. 「왜 3줄이 없어졌지」에 답하려면 필요합니다. */
  skippedRows: number;
  /** 여기서부터는 다른 명단으로 보고 읽지 않았습니다(시트 기준 줄 번호). 없으면 null. */
  cutFromRowNo: number | null;
  /** 표를 끊은 소제목 글자. 왜 멈췄는지 사람이 알아볼 수 있어야 합니다. */
  cutLabel: string | null;
};

/**
 * 머리줄이 **몇 번째 줄인지** 찾습니다.
 *
 * 첫 줄이 머리줄이라고 가정하면 안 됩니다. 학교 시트의 맨 위에는 제목이나 메모, 빈 줄이
 * 흔히 들어 있습니다 - 실제로 받은 시트의 첫 줄은 칸이 스무 개인데 그중 하나에만 `ASD` 가
 * 적혀 있었고, 진짜 머리줄은 그 아래에 있었습니다. 그걸 머리줄로 읽으면 이름 칸을 못 찾고
 * 한 줄도 들어오지 못합니다.
 *
 * 그래서 위에서부터 몇 줄을 훑어 **아는 칸이 가장 많은 줄**을 머리줄로 봅니다. 같은 점수면
 * 위에 있는 줄이 이깁니다 - 아래로 갈수록 학생 줄에 우연히 걸릴 위험이 커집니다.
 *
 * 전화번호나 생년월일이 든 줄은 아무리 점수가 높아도 머리줄이 아닙니다. 머리줄에는 그런
 * 값이 없습니다.
 */
export function findHeaderRow(table: string[][], lookahead = 15): number | null {
  let best: { at: number; score: number } | null = null;
  for (let i = 0; i < Math.min(table.length, lookahead); i++) {
    const row = table[i];
    if (row.some((c) => normPhone(c) !== null || normBirth(c) !== null)) continue;
    const score = row.filter((c) => c && fieldOf(c)).length;
    if (score >= 2 && (best === null || score > best.score)) best = { at: i, score };
  }
  return best?.at ?? null;
}

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
  // 칸을 나누는 글자는 **줄마다 따로** 봅니다.
  //
  // 예전에는 첫 줄만 보고 정했습니다. 머리줄은 손으로 적어서 탭이 없고 학생 줄은 시트에서
  // 복사해 탭이 있는 경우 - 실제로 가장 흔한 경우 - 온 줄을 쉼표로 나누려다 머리줄이 한 칸이
  // 되었고, 「어머니 연락처」처럼 사이에 띄어쓰기가 든 항목이 통째로 안 읽혔습니다.
  //
  // **빈 줄도 세면서 지웁니다.** 빈 줄을 그냥 버리면 그 뒤 줄 번호가 시트와 어긋나고,
  // 「4번째 줄이 이상합니다」라고 알려줘도 사람은 시트에서 그 줄을 못 찾습니다.
  // 붙여넣은 글은 **격자로 바꾼 뒤** 읽습니다. 읽는 규칙은 시트에서 바로 온 자료와 한 곳에
  // 모여 있어야 합니다 - 두 길이 다르게 읽으면 화면과 시트가 다른 답을 냅니다.
  //
  // 칸을 나누는 글자는 **줄마다 따로** 봅니다. 머리줄은 손으로 적어 탭이 없고 학생 줄은
  // 시트에서 복사해 탭이 있는 경우 - 가장 흔한 경우 - 온 줄을 쉼표로 나누려다 머리줄이 한 칸이
  // 되었고, 「어머니 연락처」처럼 사이에 띄어쓰기가 든 항목이 통째로 안 읽혔습니다.
  const grid = (text ?? "")
    .replace(/\r/g, "")
    .split("\n")
    .map((l) => (l.includes("\t") ? l.split("\t") : l.includes(",") ? l.split(",") : [l]).map((c) => c.replace(/^"(.*)"$/, "$1")));

  const parsed = parseRosterGrid(grid, forced, forcedHeader);

  // 머리줄만 한 칸으로 남았다면 띄어쓰기로 나눠봅니다. 탭 없이 손으로 적은 머리줄입니다.
  // **학생 줄과 칸 수가 맞을 때만** 씁니다 - 「어머니 연락처」를 두 칸으로 쪼개면 더 나빠집니다.
  if (forcedHeader !== false && parsed.header?.length === 1 && parsed.table[1]?.length >= 2) {
    const want = parsed.table[1].length;
    for (const re of [/\s{2,}/, /\s+/]) {
      const tried = parsed.header[0].split(re).filter((c) => c !== "");
      if (tried.length === want) {
        const fixed = parsed.table.map((r, i) => (i === 0 ? tried : r));
        return parseRosterGrid(fixed, forced, forcedHeader);
      }
    }
  }
  return parsed;
}

/**
 * **격자 그대로** 읽습니다. 시트에서 온 자료는 이미 칸이 나뉘어 있습니다.
 *
 * 예전에는 그 격자를 탭·줄바꿈으로 이어붙인 글자로 만들었다가 다시 쪼갰습니다. 그 왕복에서
 * 자료가 망가집니다 - 실제 명부의 머리줄에는 `After↵School`, 자료 칸에는 `G2J↵(13)` 처럼
 * **칸 안에 줄바꿈**이 들어 있었고, 이어붙이는 순간 한 줄이 두 줄로 쪼개져 그 뒤가 통째로
 * 밀렸습니다. 영문 이름 자리에 악기 이름이 들어간 것이 그 결과입니다.
 *
 * 칸 안의 줄바꿈은 **공백으로** 바꿉니다. 지우면 「Name(English)」처럼 붙어버리고, 남기면
 * 또 쪼개집니다.
 */
export function parseRosterGrid(
  grid: string[][],
  forced?: (RosterField | null)[],
  forcedHeader?: boolean,
): ParseResult {
  const numbered = grid
    .map((cells, i) => ({
      no: i + 1,
      cells: cells.map((c) => String(c ?? "").replace(/[\r\n]+/g, " ").trim()),
    }))
    .filter((r) => r.cells.some((c) => c !== ""));

  if (numbered.length === 0)
    return {
      mapping: [], guess: [], header: null, headerUsed: false, headerDetected: false,
      table: [], rows: [], unknownHeaders: [], headerRowNo: null, skippedRows: 0,
      cutFromRowNo: null, cutLabel: null,
    };

  // 머리줄이 첫 줄이 아닐 수 있습니다. 시트 맨 위의 제목·메모를 버리고 시작합니다.
  // 사람이 「머리줄 없음」이라고 정했으면 찾지 않습니다 - 사람이 정한 것이 이깁니다.
  const at = forcedHeader === false ? 0 : (findHeaderRow(numbered.map((r) => r.cells)) ?? 0);
  const kept = numbered.slice(at);
  const table = kept.map((r) => r.cells);
  // 시트 기준 줄 번호. 빈 줄까지 세어야 사람이 시트에서 그 줄을 찾아갈 수 있습니다.
  const rowNos = kept.map((r) => r.no);
  const skippedRows = at === 0 ? 0 : rowNos[0] - 1;

  // 첫 줄이 머리줄인가. 알아본 칸이 **두 개 이상**이면 머리줄로 봅니다.
  // 예전에는 여기에 「이름 칸을 알아봤을 것」이 더 붙어 있었습니다. 그래서 시트의 이름
  // 머리글이 우리가 모르는 말이면 머리줄 전체를 자료로 읽어버렸고, 첫 학생이 사라진 채
  // 나머지 줄도 엉뚱한 칸으로 들어갔습니다. 사람 이름·전화번호·날짜는 어느 것도 머리글
  // 이름과 겹치지 않으므로, 두 칸이 걸리면 머리줄로 보아도 안전합니다.
  // 같은 칸을 가리키는 머리글이 둘 이상이면 **정확히 맞은 쪽만** 남깁니다.
  // `Class #`(반 안의 번호)와 `Class`(진짜 반)가 나란히 있던 실제 명부에서, 둘 다 반으로
  // 읽히고 진짜 반 칸은 병합되어 비어 있어서 번호가 반 이름이 되었습니다.
  const matches = table[0].map((c) => matchField(c));
  const hasExact = new Set(matches.filter((m) => m?.exact).map((m) => m!.field));
  const firstMapping: (RosterField | null)[] = matches.map((m) =>
    !m ? null : m.exact || !hasExact.has(m.field) ? m.field : null,
  );
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

  // 위 줄에서 물려받을 값. 반·학년만입니다 - 이름이나 연락처를 물려받으면 없는 학생이 생깁니다.
  const carry: Partial<Record<RosterField, string>> = {};
  /**
   * 표가 끊기는 자리.
   *
   * 실제 명부는 마지막 반 아래에 `Students will leave / left` 라는 줄을 두고 **전출 예정
   * 학생 26명**을 이어 붙여 두었습니다. 그냥 읽으면 그 26명이 재학생으로 등록됩니다.
   *
   * 이름은 비었는데 다른 칸에 글자가 있고 전화·생일도 없는 줄 - 그건 학생이 아니라
   * **소제목**입니다. 거기서 표가 끝난 것으로 봅니다. 몇 번째 줄에서 왜 멈췄는지는 화면에
   * 적습니다 - 조용히 빼면 「왜 스물여섯 명이 없지」가 됩니다.
   */
  let cutAt = -1;
  let cutLabel = "";
  for (let i = 0; i < body.length; i++) {
    const cells = body[i];
    const nameCol = mapping.indexOf("name");
    const hasName = nameCol >= 0 && !!cells[nameCol]?.trim();
    if (hasName) continue;
    const rest = cells.filter((c, j) => j !== nameCol && c.trim());
    const looksStudent = cells.some((c) => normPhone(c) !== null || normBirth(c) !== null);
    if (rest.length > 0 && !looksStudent) {
      cutAt = i;
      cutLabel = rest[0].slice(0, 40);
      break;
    }
  }
  const cutFrom = cutAt >= 0 ? rowNos[cutAt + (looksHeader ? 1 : 0)] ?? null : null;

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
        // 한 칸에 「(M) …  (F) …」가 함께 들어 있으면 각각의 칸으로 갈라 넣습니다.
        const split = splitPhones(cell);
        if (split.mother) values.mother_phone ??= split.mother;
        if (split.father) values.father_phone ??= split.father;
        if (!split.mother && !split.father && split.plain) values[f] ??= split.plain;
        return;
      }
      if (f === "name" || f === "name_en") {
        // 「(NEW)」 같은 표시를 뗀 뒤에 넣습니다. 표시가 붙은 채로 들어가면 표시를 지운 주에
        // 같은 아이가 한 명 더 생깁니다.
        const cleaned = cleanStudentName(cell);
        if (cleaned) values[f] = cleaned;
        return;
      }
      if (f === "class_name") {
        values.class_name = cleanClassName(cell);
        return;
      }
      values[f] = cell;
    });

    // ── 병합된 칸 물려받기 ───────────────────────────────────────────────
    //
    // 시트에서 반·학년은 묶음의 **첫 줄에만** 적고 아래는 병합해 비워 둡니다. 사람 눈에는
    // 그 아래도 같은 반이지만, 시트가 내보내는 값은 빈 칸입니다. 그대로 두면 한 반에서 첫
    // 아이만 반이 있고 나머지는 반 없는 학생이 됩니다.
    //
    // **비어 있을 때만** 물려받습니다. 적혀 있으면 적힌 것이 이깁니다.
    for (const f of INHERITED) {
      if (!values[f] && carry[f]) values[f] = carry[f];
      else if (values[f]) carry[f] = values[f];
    }

    // 학년 칸이 없는 시트가 있습니다. 반 이름이 `G2J` 면 2학년입니다 - 학교가 쓰는 표기를
    // 그대로 읽는 것이라 짐작이 아닙니다. 학년이 비면 부서 판정도 학년 탭도 작동하지 않습니다.
    if (!values.grade && values.class_name) {
      const g = gradeFromClassName(values.class_name);
      if (g) values.grade = g;
    }

    // 이름이 없으면 넣을 수 없습니다. 이름 없는 학생 줄은 어디에도 못 씁니다.
    // 「이름 칸 자체를 안 정한 것」과 「그 줄만 비어 있는 것」은 사람이 할 일이 달라서 나눕니다.
    const problem = !mapping.includes("name")
      ? "이름 칸을 정하지 않았습니다"
      : !values.name
        ? "이름 칸이 비어 있습니다"
        : cutAt >= 0 && i >= cutAt
          ? `「${cutLabel}」 아래라 재학생 명단이 아닙니다`
          : null;
    // 시트에 실제로 적힌 줄 번호. 「4번째 줄이 이상합니다」가 시트의 4번째 줄이어야
    // 사람이 찾아갈 수 있습니다.
    return { rowNo: rowNos[i + (looksHeader ? 1 : 0)] ?? i + 1, values, problem };
  });

  return {
    mapping, guess, header, headerUsed: looksHeader, headerDetected, table, rows, unknownHeaders,
    headerRowNo: looksHeader ? rowNos[0] : null,
    skippedRows,
    cutFromRowNo: cutFrom,
    cutLabel: cutAt >= 0 ? cutLabel : null,
  };
}
