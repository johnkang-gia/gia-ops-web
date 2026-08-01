// 기존 Apps Script의 genId(prefix) 함수와 동일한 형식(PREFIX-yyMMdd-HHmmss-무작위3자리)을
// 유지합니다. 이전 데이터(구글 시트에서 옮겨온 case_id)와 새로 만든 case_id가 서로 다른
// 규칙을 쓰면 정렬/검색이 어긋날 수 있어, 형식을 그대로 맞췄습니다.
export function genCaseId(prefix: "INC" | "MTG" | "EVT" | "PRP" | "ADT" | "MDR" | "DOC" | "TRM" | "INQ" | "TSK"): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const ts =
    String(now.getFullYear()).slice(2) +
    pad(now.getMonth() + 1) +
    pad(now.getDate()) +
    "-" +
    pad(now.getHours()) +
    pad(now.getMinutes()) +
    pad(now.getSeconds());
  const rand = Math.floor(100 + Math.random() * 900);
  return `${prefix}-${ts}-${rand}`;
}
