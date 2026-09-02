// 인보이스 → 올톡페이 대량발송 파일
//
// 올톡페이에는 공개 API가 없습니다. 가맹점이 할 수 있는 것은 화면에서 한 건씩 등록하거나,
// **엑셀을 올려 한 번에 보내는 것**입니다. 그래서 우리 쪽 일은 "올려도 되는 파일을 정확히
// 만들어 주는 것"으로 끝납니다 - 자동 발송은 우리가 할 수 없습니다.
//
// 그 파일에서 틀리기 쉬운 것이 두 가지입니다.
//   1) 연락처. 명부에 없거나 형식이 어긋난 번호는 **행을 만들지 않고 따로 모아** 보여줍니다.
//      빈 칸으로 섞어 두면 그대로 올라가고, 그 아이만 청구서가 안 갑니다.
//   2) 형제. 두 아이의 보호자 번호가 같으면 청구서가 두 번 갑니다. 합칠지 말지는 학교가
//      정할 일이라 옵션으로 두되, 같은 번호가 몇 쌍인지는 항상 세어 보여줍니다.

export type BillInvoice = {
  id: string;
  invoice_no: string;
  student_id: string | null;
  student_name_ko: string | null;
  student_name: string;
  grade_label: string | null;
  total_amount: number;
  due_date: string;
  guardian_phone: string | null;
  exported_at: string | null;
  /** 인보이스 내역의 항목 이름들. 청구 내용 문구를 만드는 데 씁니다. */
  itemNames: string[];
};

export type BillRow = {
  /** 청구서를 받는 사람 이름. 아이 이름을 씁니다(보호자 성함을 명부에 두지 않습니다). */
  name: string;
  /** 숫자만 남긴 휴대폰 번호. 엑셀에서 앞의 0이 날아가지 않도록 글자로 다룹니다. */
  phone: string;
  amount: number;
  memo: string;
  dueDate: string;
  invoiceNos: string[];
  invoiceIds: string[];
  /** 이미 한 번 내보낸 청구서가 섞여 있는지. 두 번 보내는 것을 막는 표시입니다. */
  resent: boolean;
};

export type BillPlan = {
  rows: BillRow[];
  /** 연락처가 없어서 파일에 못 넣은 것. 빈 칸으로 섞어 올리면 조용히 빠집니다. */
  missing: { invoiceNo: string; name: string; reason: string }[];
  /** 보호자 번호가 같은 묶음(형제). 합치지 않으면 그 집에 청구서가 두 번 갑니다. */
  sharedPhones: { phone: string; names: string[] }[];
  total: number;
};

/**
 * 휴대폰 번호를 숫자만 남깁니다.
 *
 * 명부에는 `010-1234-5678`, `010 1234 5678`, `+82 10-1234-5678` 이 섞여 있습니다.
 * 국가번호(82)는 앞의 0으로 되돌립니다 - 올톡페이 양식은 국내 번호를 받습니다.
 */
export function normalizePhone(v: string | null | undefined): string | null {
  if (!v) return null;
  let d = String(v).replace(/[^\d]/g, "");
  if (d.startsWith("8210")) d = "0" + d.slice(2);
  else if (d.startsWith("82") && d.length >= 11) d = "0" + d.slice(2);
  if (!/^01[016789]\d{7,8}$/.test(d)) return null;
  return d;
}

/** 화면에 보여줄 때만 하이픈을 붙입니다. 파일에는 숫자만 넣습니다. */
export function prettyPhone(d: string): string {
  if (d.length === 11) return `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
  return d;
}

/** 청구 내용 문구. 항목 이름을 그대로 이어 붙이되 너무 길면 "외 N건"으로 줄입니다. */
export function memoFor(names: string[], max = 40): string {
  if (names.length === 0) return "학비외 납부";
  let out = names[0];
  let used = 1;
  for (const n of names.slice(1)) {
    if ((out + ", " + n).length > max) break;
    out += ", " + n;
    used += 1;
  }
  const rest = names.length - used;
  return rest > 0 ? `${out} 외 ${rest}건` : out;
}

export function buildBillPlan(invoices: BillInvoice[], opts: { mergeSiblings: boolean }): BillPlan {
  const missing: BillPlan["missing"] = [];
  const ok: { inv: BillInvoice; phone: string }[] = [];

  for (const inv of invoices) {
    const phone = normalizePhone(inv.guardian_phone);
    if (!phone) {
      missing.push({
        invoiceNo: inv.invoice_no,
        name: inv.student_name_ko || inv.student_name,
        reason: inv.guardian_phone ? `번호 형식이 맞지 않습니다 (${inv.guardian_phone})` : "명부에 보호자 연락처가 없습니다",
      });
      continue;
    }
    ok.push({ inv, phone });
  }

  // 같은 번호가 몇 쌍인지는 합치든 안 합치든 항상 셉니다.
  const byPhone = new Map<string, { inv: BillInvoice; phone: string }[]>();
  for (const e of ok) byPhone.set(e.phone, [...(byPhone.get(e.phone) ?? []), e]);
  const sharedPhones = [...byPhone.entries()]
    .filter(([, list]) => list.length > 1)
    .map(([phone, list]) => ({ phone, names: list.map((e) => e.inv.student_name_ko || e.inv.student_name) }));

  const rows: BillRow[] = [];
  if (opts.mergeSiblings) {
    for (const [phone, list] of byPhone) {
      const names = list.map((e) => e.inv.student_name_ko || e.inv.student_name);
      rows.push({
        name: names.join(" · "),
        phone,
        amount: list.reduce((n, e) => n + Number(e.inv.total_amount), 0),
        memo: list.length > 1 ? `${names.join(", ")} 학비외 납부` : memoFor(list[0].inv.itemNames),
        // 형제의 납부기한이 다르면 **빠른 쪽**에 맞춥니다. 늦은 쪽에 맞추면 하나가 연체됩니다.
        dueDate: list.map((e) => e.inv.due_date).sort()[0],
        invoiceNos: list.map((e) => e.inv.invoice_no),
        invoiceIds: list.map((e) => e.inv.id),
        resent: list.some((e) => !!e.inv.exported_at),
      });
    }
  } else {
    for (const { inv, phone } of ok) {
      rows.push({
        name: inv.student_name_ko || inv.student_name,
        phone,
        amount: Number(inv.total_amount),
        memo: memoFor(inv.itemNames),
        dueDate: inv.due_date,
        invoiceNos: [inv.invoice_no],
        invoiceIds: [inv.id],
        resent: !!inv.exported_at,
      });
    }
  }

  rows.sort((a, b) => a.name.localeCompare(b.name, "ko"));
  return { rows, missing, sharedPhones, total: rows.reduce((n, r) => n + r.amount, 0) };
}

/**
 * 엑셀 머리글.
 *
 * 올톡페이의 업로드 양식이 바뀌거나 가맹점마다 다를 수 있어서 **화면에서 고칠 수 있게**
 * 두었습니다. 여기 적힌 것은 처음 값일 뿐입니다 - 양식이 다르면 그 이름으로 바꿔 쓰면 됩니다.
 */
export const DEFAULT_HEADERS = {
  name: "고객명",
  phone: "청구핸드폰",
  amount: "청구금액",
  memo: "청구사유",
  due: "만료일자",
  ref: "관리번호",
} as const;

export type HeaderMap = Record<keyof typeof DEFAULT_HEADERS, string>;

/** 엑셀에 그대로 들어가는 2차원 배열. 숫자는 숫자로, 번호는 글자로 넣습니다. */
export function toAoa(rows: BillRow[], headers: HeaderMap): (string | number)[][] {
  const head = [headers.name, headers.phone, headers.amount, headers.memo, headers.due, headers.ref];
  return [head, ...rows.map((r) => [r.name, r.phone, r.amount, r.memo, r.dueDate, r.invoiceNos.join(",")])];
}
