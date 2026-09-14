/**
 * **올톡페이 결제내역을 앱 자료로 옮기는 판정.**
 *
 * 여기서는 **정하기만** 합니다 - 표를 고치는 일은 `/api/finance/import/apply` 가 하고,
 * 그것도 사람이 승인한 줄만 합니다.
 *
 * ── 무엇이 어려운가 ────────────────────────────────────────────────────────
 *
 * 올톡페이 파일은 **회계 자료가 아니라 발송 기록**입니다. 8~9월 실측 285건에서:
 *
 *   · 고객명 칸이 자유 글자입니다 — 「강하라/치과진료비12,900원포함」·「홍선우(클라리넷)」·
 *     「심규민2세트(A,B)」처럼 사유가 이름 칸에 섞여 있고, 「류연진쌤」·「애니원감님」처럼
 *     학생이 아닌 줄도 섞여 있습니다.
 *   · 청구사유도 자유 글자라 「악기비」·「악기(바이올린)」·「악기비 (바이올린)」이 따로
 *     세어졌습니다. 그대로 담으면 항목별 집계가 다시 안 됩니다.
 *   · **형제 14쌍이 번호를 함께 씁니다** — 황라윤·황준호·황라원이 한 번호입니다. 번호만으로는
 *     누구 건지 못 가릅니다(CLAUDE.md 2-4).
 *
 * 그래서 **번호와 이름을 함께** 봅니다. 실측에서 이 방식으로 249건(87.4%)이 한 명으로
 * 좁혀지고, 나머지 36건은 사람이 봅니다.
 *
 * ── 왜 이름만으로는 확정하지 않나 ──────────────────────────────────────────
 *
 * 명부에 한 명뿐인 이름이라도 **번호가 안 맞으면 확정하지 않습니다.** 번호가 안 맞는다는
 * 것은 명부가 낡았거나 다른 집이라는 뜻인데, 돈에서 그 둘은 결과가 완전히 다릅니다.
 * 대신 그 학생을 **미리 골라둡니다** - 사람은 보고 승인만 누르면 됩니다. 확인은 남기되
 * 손은 덜게 하는 것이 요점입니다.
 */

import { findByName, type NamedStudent } from "./studentName";

export type RawImportRow = {
  /** 파일에서 몇 번째 줄인가. 1부터. */
  seq: number;
  name: string;
  /** 숫자만 남긴 청구핸드폰. */
  phone: string;
  why: string;
  amount: number;
  issuedAt: string | null;
  /** 발송완료 · 결제완료 · 결제중단 · 발송실패 */
  status: string;
  paidAt: string | null;
  method: string | null;
  card: string | null;
  approvalNo: string | null;
};

export type StudentLite = {
  id: string;
  name: string;
  grade: string | null;
  className: string | null;
  /** 숫자만 남긴 어머니·아버지·보호자·결제번호. */
  phones: string[];
};

export type MatchKind = "자동" | "확인필요" | "못찾음";

export type PlanKind = "청구서 만들고 수납" | "청구서만 만들기(미납)" | "수납만 붙이기" | "건너뜀";

export type Candidate = { id: string; name: string; where: string };

export type PlannedRow = {
  raw: RawImportRow;
  /** 정규화한 항목 이름. 원문은 `raw.why` 에 그대로 남아 있습니다. */
  itemName: string;
  stream: "학비" | "학비외";
  match: MatchKind;
  /** 앱이 고른 학생. 「확인필요」여도 짐작이 있으면 채워 둡니다 - 사람이 승인만 누르면 됩니다. */
  suggestedStudentId: string | null;
  candidates: Candidate[];
  /** 왜 이렇게 판정했나. 사람이 읽고 판단할 한 줄입니다. */
  why: string;
  plan: PlanKind;
  sourceKey: string;
  /** 이미 앱에 들어온 줄인가(같은 열쇠). 두 번 넣으면 같은 돈이 두 번 잡힙니다. */
  already: boolean;
};

const digits = (v: string | null | undefined) => String(v ?? "").replace(/\D/g, "");

/** 이름 칸에서 **한글 이름만** 떼어냅니다. 뒤에 붙은 사유·표기는 버립니다. */
export function koreanName(v: string | null | undefined): string | null {
  const m = String(v ?? "").trim().match(/^([가-힣]{2,4})/);
  return m ? m[1] : null;
}

/**
 * 청구사유를 **항목 이름**으로 정리합니다.
 *
 * 올톡페이는 자유 글자라 같은 항목이 여러 이름으로 들어옵니다. 정리하지 않으면 항목별
 * 집계(`finance_item_monthly`)가 「악기비」와 「악기(바이올린)」을 다른 것으로 셉니다.
 *
 * **원문은 안 버립니다** - 청구서 줄 이름에 괄호로 함께 적습니다. 학부모가 받은 문자와
 * 대조할 수 있어야 하고, 정리가 틀렸을 때 무엇 때문인지 알 수 있어야 합니다.
 */
export function normalizeItem(why: string | null | undefined): { itemName: string; stream: "학비" | "학비외" } {
  const s = String(why ?? "").trim();
  if (/교복|고복/.test(s)) return { itemName: "GIA 교복", stream: "학비외" };
  if (/교재/.test(s)) return { itemName: "1학기 교재비", stream: "학비외" };
  if (/악기|바이올린|플[릇룻]|클라리넷|첼로|우[크쿠]렐레/.test(s)) return { itemName: "악기비", stream: "학비외" };
  if (/미납/.test(s)) return { itemName: "미납 정산", stream: "학비외" };
  if (/앨범/.test(s)) return { itemName: "앨범비", stream: "학비외" };
  if (/병원|치과|진료/.test(s)) return { itemName: "병원비", stream: "학비외" };
  if (/학비|수업료|등록금/.test(s)) return { itemName: "학비", stream: "학비" };
  // 모르는 사유는 **그대로 둡니다.** 아무 항목에나 밀어 넣으면 그 달 집계가 슬쩍 달라지고,
  // 그건 오류로 안 보입니다.
  return { itemName: s || "(사유 없음)", stream: "학비외" };
}

/** 같은 파일을 두 번 올려도 같은 돈이 두 번 안 들어가게 하는 열쇠. */
export function sourceKeyOf(r: RawImportRow): string {
  // 승인번호가 있으면 그것이 가장 튼튼합니다 - 올톡페이가 결제마다 유일하게 붙입니다.
  if (r.approvalNo && r.approvalNo !== "-") return `올톡|승인|${r.approvalNo}`;
  // 아직 안 낸 줄에는 승인번호가 없습니다. 이름·사유·금액·등록일자로 만듭니다 - 같은 파일을
  // 다시 받아도 이 넷은 그대로입니다(줄 번호로 만들면 줄이 하나 밀릴 때 전부 새 줄이 됩니다).
  return `올톡|${r.name}|${r.why}|${r.amount}|${r.issuedAt ?? ""}`;
}

/** 학생 이름 뒤에 붙일 자리 표시. 후보를 고를 때 이것이 없으면 동명이인을 못 가립니다. */
function whereOf(s: StudentLite): string {
  return s.className || (s.grade ? `${s.grade}학년` : "");
}

/**
 * 이 줄은 누구 것인가.
 *
 * **이름 대조가 아닙니다** - 번호로 먼저 좁히고, 이름은 `studentName.ts` 의 `findByName`
 * 으로 한 번 더 좁히는 데만 씁니다. 이름 규칙은 그쪽 한 곳에만 있습니다(CLAUDE.md 2-4).
 *
 * 순서가 뜻을 가집니다.
 *   ① 번호로 좁히고, 그 안에서 **이름으로 한 번 더** 좁힙니다 → 한 명이면 확정.
 *   ② 번호는 맞는데 이름이 안 맞거나 여럿이면 → 후보를 보여주고 사람이 고릅니다.
 *   ③ 번호가 명부에 없으면 → 이름으로 짐작만 하고 **확정하지 않습니다.**
 */
export function matchImportRow(
  raw: RawImportRow,
  students: readonly StudentLite[],
): { match: MatchKind; suggestedStudentId: string | null; candidates: Candidate[]; why: string } {
  const phone = digits(raw.phone);
  const byPhone = phone ? students.filter((s) => s.phones.includes(phone)) : [];
  const ko = koreanName(raw.name);
  // **이름 대조는 `studentName.ts` 한 곳만 씁니다**(CLAUDE.md 2-4). 여기서 다시 만들면
  // 별칭·영문 표기 규칙이 한 벌 더 생기고, 한쪽만 고쳐지는 날이 옵니다.
  // 다만 넘길 때는 **한글 이름만 떼어** 넘깁니다 - 올톡페이 고객명 칸에는
  // 「강하라/치과진료비12,900원포함」처럼 사유가 붙어 있어서 원문 그대로는 안 걸립니다.
  const named: (StudentLite & NamedStudent)[] = students.map((s) => ({ ...s, nameEn: null }));
  const byName = ko ? findByName(ko, named).filter((s) => s.name === ko) : [];
  const cand = (list: readonly StudentLite[]): Candidate[] =>
    list.map((s) => ({ id: s.id, name: s.name, where: whereOf(s) }));

  // ① 번호 ∩ 이름
  const both = byPhone.filter((s) => byName.some((t) => t.id === s.id));
  if (both.length === 1) {
    // 이름 칸에 사유가 섞여 있으면(「강하라/치과진료비12,900원포함」) **그 사실을 적습니다.**
    // 학생은 맞지만 금액에 다른 것이 섞여 있다는 신호라, 검수하는 사람이 알아야 합니다.
    const dirty = ko !== String(raw.name).trim();
    const base = byPhone.length > 1 ? "번호를 형제와 함께 씁니다 — 이름으로 갈랐습니다" : "번호와 이름이 모두 맞습니다";
    return {
      match: "자동",
      suggestedStudentId: both[0].id,
      candidates: cand(both),
      why: dirty ? `${base} · 이름 칸에 「${String(raw.name).trim()}」 처럼 사유가 섞여 있습니다` : base,
    };
  }
  if (both.length > 1) {
    return { match: "확인필요", suggestedStudentId: null, candidates: cand(both), why: "같은 번호·같은 이름이 둘 이상입니다" };
  }

  // ② 번호는 명부에 있는데 이름으로 못 좁힘
  if (byPhone.length === 1) {
    return {
      match: "확인필요",
      suggestedStudentId: byPhone[0].id,
      candidates: cand(byPhone),
      why: ko
        ? `번호는 ${byPhone[0].name} 의 것인데 이름이 「${raw.name}」 입니다`
        : `번호는 ${byPhone[0].name} 의 것인데 이름을 읽지 못했습니다`,
    };
  }
  if (byPhone.length > 1) {
    return {
      match: "확인필요",
      suggestedStudentId: null,
      candidates: cand(byPhone),
      why: `형제 ${byPhone.length}명이 이 번호를 함께 씁니다 — 누구 것인지 골라주세요`,
    };
  }

  // ③ 번호가 명부에 없음
  if (byName.length === 1) {
    return {
      match: "확인필요",
      // 짐작은 채워 둡니다 - 맞으면 승인만 누르면 됩니다.
      suggestedStudentId: byName[0].id,
      candidates: cand(byName),
      why: "이름은 맞는데 번호가 명부에 없습니다 — 명부가 낡았거나 다른 집일 수 있습니다",
    };
  }
  if (byName.length > 1) {
    return { match: "확인필요", suggestedStudentId: null, candidates: cand(byName), why: `같은 이름이 ${byName.length}명입니다` };
  }
  return {
    match: "못찾음",
    suggestedStudentId: null,
    candidates: [],
    why: "이름도 번호도 명부에 없습니다 — 학생이 아닌 줄일 수 있습니다",
  };
}

/**
 * 이 줄로 무엇을 할 것인가.
 *
 * 올톡페이 한 줄은 **청구서 한 장**입니다 - 결제까지 됐으면 거기에 수납도 붙습니다.
 * 앱에는 그 청구서가 아예 없으므로 대부분 「청구서를 만들고」에서 시작합니다.
 */
export function planOf(raw: RawImportRow, already: boolean): { plan: PlanKind; why: string } {
  if (already) return { plan: "건너뜀", why: "이미 앱에 들어와 있습니다" };
  const st = String(raw.status ?? "");
  if (/중단/.test(st)) {
    // **버리지 않고 건너뜁니다.** 중단은 학교가 다시 발행하려고 멈춘 것이라, 나중에 다시
    // 보낸 줄이 같은 파일 안에 있습니다. 그 줄이 진짜이고 이 줄은 흔적입니다.
    return { plan: "건너뜀", why: "결제중단 — 다시 발행한 줄이 따로 있습니다" };
  }
  if (/실패/.test(st)) return { plan: "건너뜀", why: "발송실패 — 학부모에게 가지 않았습니다" };
  if (/완료/.test(st) && /결제|수납/.test(st)) return { plan: "청구서 만들고 수납", why: "결제완료" };
  if (/발송|전송/.test(st)) return { plan: "청구서만 만들기(미납)", why: "보냈지만 아직 안 냈습니다 — 미납금으로 잡힙니다" };
  return { plan: "건너뜀", why: `모르는 상태입니다: ${st || "(빈칸)"}` };
}

/**
 * 파일 한 벌을 통째로 판정합니다.
 *
 * `existingKeys` 는 **이미 앱에 들어온 열쇠**입니다(청구서·입금 양쪽). 같은 파일을 두 번
 * 올려도 같은 돈이 두 번 들어가지 않게 합니다 - 이 검사가 없으면 그 학생의 미납이 두 배로
 * 보이고, 그건 오류가 아니라 그냥 다른 숫자입니다.
 */
export function buildImportPlan(
  raws: readonly RawImportRow[],
  students: readonly StudentLite[],
  existingKeys: ReadonlySet<string>,
): PlannedRow[] {
  return raws.map((raw) => {
    const key = sourceKeyOf(raw);
    const already = existingKeys.has(key);
    const m = matchImportRow(raw, students);
    const p = planOf(raw, already);
    const item = normalizeItem(raw.why);
    return {
      raw,
      itemName: item.itemName,
      stream: item.stream,
      match: m.match,
      suggestedStudentId: m.suggestedStudentId,
      candidates: m.candidates,
      // 판정 이유를 **둘 다** 적습니다. 「누구인가」와 「무엇을 할 것인가」는 다른 물음이라,
      // 하나만 보여주면 사람이 나머지를 짐작하게 됩니다.
      why: `${m.why} · ${p.why}`,
      plan: p.plan,
      sourceKey: key,
      already,
    };
  });
}

export type PlanSummary = {
  total: number;
  auto: number;
  needPerson: number;
  notFound: number;
  already: number;
  skipped: number;
  /** 실제로 반영될 후보 줄 수(건너뜀 제외). */
  actionable: number;
  billAmount: number;
  payAmount: number;
};

export function summarizePlan(rows: readonly PlannedRow[]): PlanSummary {
  const s: PlanSummary = {
    total: rows.length,
    auto: 0,
    needPerson: 0,
    notFound: 0,
    already: 0,
    skipped: 0,
    actionable: 0,
    billAmount: 0,
    payAmount: 0,
  };
  for (const r of rows) {
    if (r.match === "자동") s.auto += 1;
    else if (r.match === "확인필요") s.needPerson += 1;
    else s.notFound += 1;
    if (r.already) s.already += 1;
    if (r.plan === "건너뜀") {
      s.skipped += 1;
      continue;
    }
    s.actionable += 1;
    s.billAmount += r.raw.amount;
    if (r.plan === "청구서 만들고 수납" || r.plan === "수납만 붙이기") s.payAmount += r.raw.amount;
  }
  return s;
}

// ── 학생별로 「무엇이 어떻게 바뀌나」 ────────────────────────────────────────

export type StudentBefore = { billed: number; received: number; balance: number };

export type ReviewRow = {
  id: string;
  seq: number;
  rawName: string;
  rawPhone: string | null;
  rawWhy: string | null;
  itemName: string | null;
  amount: number;
  issuedAt: string | null;
  paidAt: string | null;
  atpStatus: string | null;
  method: string | null;
  matchKind: MatchKind;
  matchWhy: string | null;
  plan: PlanKind;
  suggestedStudentId: string | null;
  decidedStudentId: string | null;
  decision: "대기" | "승인" | "보류" | "건너뜀";
  appliedAt: string | null;
  applyError: string | null;
};

export type StudentGroup = {
  studentId: string | null;
  name: string;
  where: string;
  rows: ReviewRow[];
  before: StudentBefore;
  /** 승인한 줄만 반영했을 때의 값. 사람이 「이렇게 바뀝니다」로 읽는 숫자입니다. */
  after: StudentBefore;
  waiting: number;
  approved: number;
};

/** 그 줄이 실제로 가리키는 학생. 사람이 고친 것이 앱의 짐작보다 셉니다. */
export function studentIdOf(r: ReviewRow): string | null {
  return r.decidedStudentId ?? r.suggestedStudentId;
}

/**
 * **학생별로 묶고, 승인한 줄만 더해 「이렇게 바뀝니다」를 냅니다.**
 *
 * 검수하는 사람이 보는 것은 줄이 아니라 **사람**입니다 - 「이 아이한테 지금 얼마가 잡혀
 * 있고, 이걸 반영하면 얼마가 되나」. 줄만 늘어놓으면 285줄을 하나씩 보게 되고, 그러면
 * 아무도 끝까지 못 봅니다.
 *
 * 「대기」는 아직 안 본 줄이라 **after 에 안 넣습니다.** 넣으면 아무도 안 본 것이 이미 된
 * 것처럼 보입니다.
 */
export function groupForReview(
  rows: readonly ReviewRow[],
  opts: {
    nameOf: (id: string) => string | null;
    whereOf: (id: string) => string | null;
    /** 지금 앱에 잡혀 있는 그 학생의 청구·수납. 모르면 0으로 봅니다. */
    beforeOf: (id: string) => StudentBefore | null;
  },
): StudentGroup[] {
  const map = new Map<string, StudentGroup>();
  for (const r of rows) {
    const sid = studentIdOf(r);
    const key = sid ?? "(누구인지 모름)";
    let g = map.get(key);
    if (!g) {
      const before = sid ? opts.beforeOf(sid) ?? { billed: 0, received: 0, balance: 0 } : { billed: 0, received: 0, balance: 0 };
      g = {
        studentId: sid,
        name: sid ? opts.nameOf(sid) ?? r.rawName : "누구인지 모름",
        where: sid ? opts.whereOf(sid) ?? "" : "",
        rows: [],
        before,
        after: { ...before },
        waiting: 0,
        approved: 0,
      };
      map.set(key, g);
    }
    g.rows.push(r);
    if (r.decision === "대기") g.waiting += 1;
    if (r.decision !== "승인" || r.plan === "건너뜀") continue;
    g.approved += 1;
    // 이미 반영된 줄은 **before 에 이미 들어가 있습니다.** 또 더하면 두 배로 보입니다.
    if (r.appliedAt) continue;
    if (r.plan === "청구서 만들고 수납") {
      g.after.billed += r.amount;
      g.after.received += r.amount;
    } else if (r.plan === "청구서만 만들기(미납)") {
      g.after.billed += r.amount;
    } else if (r.plan === "수납만 붙이기") {
      g.after.received += r.amount;
    }
  }
  for (const g of map.values()) {
    g.after.balance = g.after.billed - g.after.received;
    g.rows.sort((a, b) => a.seq - b.seq);
  }
  // **손댈 것이 남은 사람이 위**입니다. 이 화면을 여는 이유가 그것입니다.
  return [...map.values()].sort(
    (a, b) => b.waiting - a.waiting || (a.studentId ? 0 : -1) - (b.studentId ? 0 : -1) || a.name.localeCompare(b.name, "ko"),
  );
}
