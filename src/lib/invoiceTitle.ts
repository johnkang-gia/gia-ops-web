/**
 * **PDF 파일 이름** — 청구서 한 장을 뭐라고 부를 것인가.
 *
 * ── 무엇이 문제였나 ─────────────────────────────────────────────────────────
 *
 * 브라우저의 「PDF로 저장」은 파일 이름을 **탭 제목**에서 가져옵니다. 그대로 두면 앱 제목이
 * 들어가서 139명 것이 전부 같은 이름으로 저장됩니다. 받는 쪽에서는 어느 아이 것인지
 * 열어봐야 알고, 폴더에 쌓이면 구별할 길이 없습니다.
 *
 * 그래서 「김사랑(G2C) 학비 청구서」처럼 **열어보지 않고도 아는 이름**으로 둡니다.
 *
 * ── 왜 반을 넣나 ────────────────────────────────────────────────────────────
 *
 * 김재이가 셋입니다(§2-4). 이름만 적으면 같은 파일 이름이 셋 나오고, 폴더에 함께 담기면
 * 뒤엣것이 앞엣것을 덮습니다. 반은 그 셋을 가르는 가장 짧은 표시입니다.
 *
 * 순수 함수입니다 - 화면 없이 시험할 수 있습니다.
 */

import { streamOf } from "@/lib/settlement";

export type TitleInvoice = {
  student_name: string;
  student_name_ko?: string | null;
  /** 「Grade 3 · G3JA」처럼 학년과 반을 함께 담은 글자. 반이 없으면 학년만 있습니다. */
  grade_label?: string | null;
  stream?: string | null;
  category?: string | null;
};

/**
 * `grade_label` 에서 반 이름만 꺼냅니다.
 *
 * 「Grade 3 · G3JA」 → 「G3JA」. 가운뎃점 뒤가 반입니다. 반이 없으면 빈 글자를 돌려주고,
 * 그때는 학년을 대신 쓰지 않습니다 - 「김재이(Grade 3)」는 같은 학년 김재이 둘을 못 가르면서
 * 이름만 길어집니다.
 */
export function classOfLabel(label: string | null | undefined): string {
  const s = (label ?? "").trim();
  if (!s) return "";
  const i = s.indexOf("·");
  return i < 0 ? "" : s.slice(i + 1).trim();
}

/**
 * 파일 이름에 쓸 수 없는 글자를 뺍니다.
 *
 * 윈도우는 `\ / : * ? " < > |` 를 파일 이름에 못 씁니다. 그대로 두면 저장이 실패하거나
 * 브라우저가 제 맘대로 잘라내는데, 어느 쪽이든 사람이 고른 이름이 아니게 됩니다.
 */
export function safeFileName(s: string): string {
  return s.replace(/[\\/:*?"<>|]/g, " ").replace(/\s+/g, " ").trim();
}

/** 「김사랑(G2C) 학비 청구서」. 확장자는 브라우저가 붙입니다. */
export function invoiceFileTitle(inv: TitleInvoice): string {
  const name = (inv.student_name_ko?.trim() || inv.student_name || "").trim();
  const klass = classOfLabel(inv.grade_label);
  const who = klass ? `${name}(${klass})` : name;
  return safeFileName(`${who} ${streamOf(inv)} 청구서`);
}
