// 인보이스 → 올톡페이 대량발송 파일
//
// 올톡페이에는 공개 API가 없습니다. 가맹점이 할 수 있는 것은 화면에서 한 건씩 등록하거나,
// **엑셀을 올려 한 번에 보내는 것**입니다. 그래서 우리 쪽 일은 "그대로 올릴 수 있는 파일을
// 정확히 만들어 주는 것"으로 끝납니다 - 자동 발송은 우리가 할 수 없습니다.
//
// 열 이름과 순서는 올톡페이가 준 **청구서등록 양식 그대로**입니다(아래 SHEET_NAME·COLUMNS).
// 양식에 없는 열을 하나라도 더 붙이면 업로드가 통째로 거절될 수 있어서, 우리 쪽 관리번호도
// 넣지 않습니다. 대신 어떤 청구서를 내보냈는지는 DB의 exported_at 으로 남깁니다.
//
// 그 파일에서 틀리기 쉬운 것이 세 가지입니다.
//   1) 연락처. 명부에 없거나 형식이 어긋난 번호는 **행을 만들지 않고 따로 모아** 보여줍니다.
//      빈 칸으로 섞어 두면 그대로 올라가고, 그 아이만 청구서가 안 갑니다.
//   2) 누구에게 보낼지. 어머니·아버지·보호자 중 실제로 결제하는 분이 집마다 다릅니다.
//   3) 형제. 두 아이의 보호자 번호가 같으면 청구서가 두 번 갑니다. 합칠지 말지는 학교가
//      정할 일이라 옵션으로 두되, 같은 번호가 몇 쌍인지는 항상 세어 보여줍니다.

/** 청구서를 누구 앞으로 보낼지. */
export type GuardianRole = "mother" | "father" | "guardian";

export const ROLE_LABEL: Record<GuardianRole, string> = {
  mother: "어머니",
  father: "아버지",
  guardian: "보호자",
};

/** 짧은 표시(M / F / 보호자) - 좁은 표에서 씁니다. */
export const ROLE_SHORT: Record<GuardianRole, string> = {
  mother: "M",
  father: "F",
  guardian: "보호자",
};

/**
 * 고를 때의 기본 순서.
 *
 * 어머니를 먼저 보는 이유는 실제로 그 집이 가장 많기 때문입니다. 어머니 칸이 비어 있으면
 * 아버지, 그것도 없으면 보호자(부모가 아닌 분) 순으로 내려갑니다. 명부의 어머니 칸을 아직
 * 안 채운 학교에서도 지금과 똑같이 동작하고, 채우는 대로 자동으로 어머니 번호로 넘어갑니다.
 */
export const ROLE_ORDER: GuardianRole[] = ["mother", "father", "guardian"];

export type GuardianPhones = {
  mother_phone: string | null;
  father_phone: string | null;
  /** 부모가 아닌 분(조부모·친척 등). 예전부터 쓰던 칸이라 이름은 parent_phone 그대로입니다. */
  parent_phone: string | null;
};

export type BillInvoice = {
  id: string;
  invoice_no: string;
  student_id: string | null;
  student_name_ko: string | null;
  student_name: string;
  grade_label: string | null;
  total_amount: number;
  due_date: string;
  /** 발행할 때 굳혀 둔 번호. 명부가 그 뒤에 바뀌어도 이 값이 남습니다. */
  guardian_phone: string | null;
  /** 발행할 때 고른 대상. 번호만으로는 나중에 누구였는지 알 수 없어 함께 남깁니다. */
  guardian_role: GuardianRole | "manual" | null;
  exported_at: string | null;
  /** 지금 명부에 있는 세 칸. 화면에서 대상을 바꿀 때 씁니다. */
  phones: GuardianPhones;
  /** 인보이스 내역의 항목 이름들. 청구 내용 문구를 만드는 데 씁니다. */
  itemNames: string[];
};

export type BillRow = {
  /** 청구서를 받는 사람 이름. 아이 이름을 씁니다(보호자 성함을 명부에 두지 않습니다). */
  name: string;
  /** 숫자만 남긴 휴대폰 번호. 엑셀에서 앞의 0이 날아가지 않도록 글자로 다룹니다. */
  phone: string;
  /** 이 번호가 누구 것인지. 화면에만 보여주고 파일에는 넣지 않습니다. */
  role: GuardianRole | "manual";
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
  missing: { invoiceId: string; invoiceNo: string; name: string; reason: string }[];
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

/** 명부의 세 칸 중 그 역할의 번호(정리된 형태). 없으면 null. */
export function phoneOf(phones: GuardianPhones, role: GuardianRole): string | null {
  if (role === "mother") return normalizePhone(phones.mother_phone);
  if (role === "father") return normalizePhone(phones.father_phone);
  return normalizePhone(phones.parent_phone);
}

/** 지금 명부에서 쓸 수 있는 대상들. 화면의 선택지를 만들 때 씁니다. */
export function availableRoles(phones: GuardianPhones): GuardianRole[] {
  return ROLE_ORDER.filter((r) => phoneOf(phones, r) !== null);
}

/**
 * 이 청구서를 누구 앞으로 보낼지 정합니다.
 *
 * 고른 값이 있으면 그것을 먼저 봅니다. 다만 **그 칸이 비어 있으면 그대로 따르지 않습니다** -
 * 아버지로 골라두었는데 아버지 번호를 지운 경우, 그 말을 따르면 그 아이만 청구서가 안 갑니다.
 * 그럴 때는 어머니 → 아버지 → 보호자 순으로 실제로 있는 번호를 씁니다.
 */
export function resolveRecipient(
  phones: GuardianPhones,
  chosen: GuardianRole | null | undefined
): { role: GuardianRole; phone: string } | null {
  const order = chosen ? [chosen, ...ROLE_ORDER.filter((r) => r !== chosen)] : ROLE_ORDER;
  for (const role of order) {
    const phone = phoneOf(phones, role);
    if (phone) return { role, phone };
  }
  return null;
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

export function buildBillPlan(
  invoices: BillInvoice[],
  opts: {
    mergeSiblings: boolean;
    /** 화면에서 청구서마다 대상을 바꾼 것. 없으면 발행할 때 고른 값을 씁니다. */
    roleOverrides?: Record<string, GuardianRole>;
  }
): BillPlan {
  const missing: BillPlan["missing"] = [];
  const ok: { inv: BillInvoice; phone: string; role: GuardianRole | "manual" }[] = [];

  for (const inv of invoices) {
    const override = opts.roleOverrides?.[inv.id];

    // 손으로 적어 넣은 번호는 명부보다 우선합니다 - 그 청구서 한 건에만 쓰라고 적은 값입니다.
    if (!override && inv.guardian_role === "manual") {
      const manual = normalizePhone(inv.guardian_phone);
      if (manual) {
        ok.push({ inv, phone: manual, role: "manual" });
        continue;
      }
    }

    const chosen =
      override ??
      (inv.guardian_role && inv.guardian_role !== "manual" ? inv.guardian_role : null);
    const picked = resolveRecipient(inv.phones, chosen);

    if (!picked) {
      // 명부에 하나도 없으면, 발행할 때 굳혀 둔 번호라도 살려 씁니다.
      const frozen = normalizePhone(inv.guardian_phone);
      if (frozen) {
        ok.push({ inv, phone: frozen, role: "manual" });
        continue;
      }
      const raw = [inv.phones.mother_phone, inv.phones.father_phone, inv.phones.parent_phone]
        .filter(Boolean)
        .join(", ");
      missing.push({
        invoiceId: inv.id,
        invoiceNo: inv.invoice_no,
        name: inv.student_name_ko || inv.student_name,
        reason: raw ? `번호 형식이 맞지 않습니다 (${raw})` : "명부에 보호자 연락처가 없습니다",
      });
      continue;
    }
    ok.push({ inv, phone: picked.phone, role: picked.role });
  }

  // 같은 번호가 몇 쌍인지는 합치든 안 합치든 항상 셉니다.
  const byPhone = new Map<string, typeof ok>();
  for (const e of ok) byPhone.set(e.phone, [...(byPhone.get(e.phone) ?? []), e]);
  const sharedPhones = [...byPhone.entries()]
    .filter(([, list]) => list.length > 1)
    .map(([phone, list]) => ({
      phone,
      names: list.map((e) => e.inv.student_name_ko || e.inv.student_name),
    }));

  const rows: BillRow[] = [];
  if (opts.mergeSiblings) {
    for (const [phone, list] of byPhone) {
      const names = list.map((e) => e.inv.student_name_ko || e.inv.student_name);
      rows.push({
        name: names.join(" · "),
        phone,
        role: list[0].role,
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
    for (const { inv, phone, role } of ok) {
      rows.push({
        name: inv.student_name_ko || inv.student_name,
        phone,
        role,
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

// ── 올톡페이 청구서등록 양식 ───────────────────────────────────────────────
//
// 올톡페이에서 받은 양식 파일(bill_sample.xlsx)을 그대로 옮겨 적은 것입니다. 별표(*)와
// 띄어쓰기까지 원본 그대로 둡니다 - 열 이름을 글자로 맞춰 보는 업로드기라면 한 글자만 달라도
// 못 알아봅니다. 양식이 바뀌면 여기만 고치면 됩니다.

/** 양식의 시트 이름. */
export const SHEET_NAME = "청구서등록";

/** 양식의 열 - 순서까지 그대로입니다. */
export const COLUMNS = [
  "*상품명 (청구사유)",
  "*고객명",
  "*핸드폰번호",
  "*청구금액",
  "*결제만료일자(년월일)",
  "*결제만료시간(00시)",
  " 예약일(년월일)",
  "예약시간(00시)",
] as const;

/**
 * 결제만료시간의 기본값.
 *
 * 양식은 시(時)까지만 받습니다. 저녁 늦게까지 열어두는 편이 안전해서 23시를 기본으로 둡니다 -
 * 이른 시각으로 잡으면 그날 퇴근길에 결제하려던 학부모가 못 냅니다.
 */
export const DEFAULT_DUE_HOUR = 23;

/** 시(時)를 양식이 쓰는 글자로. 한 자리도 두 자리로 채웁니다(9 → 09시). */
export function hourLabel(hour: number): string {
  return `${String(hour).padStart(2, "0")}시`;
}

/** `2026-09-30` → `20260930`. 양식은 이 숫자 형태를 씁니다. */
export function ymd(date: string): number {
  return Number(date.replace(/\D/g, "").slice(0, 8));
}

export type SendOptions = {
  /** 결제만료시간(시). */
  dueHour: number;
  /** 예약 발송을 쓸 때의 날짜(YYYY-MM-DD). 비우면 예약 없이 바로 보냅니다. */
  reserveDate?: string | null;
  /** 예약 발송 시각(시). */
  reserveHour?: number | null;
};

/**
 * 엑셀에 그대로 들어가는 2차원 배열.
 *
 * 첫 줄은 양식의 열 이름, 그 아래가 청구 줄입니다. 예약 칸은 비워 두면 올톡페이가 바로
 * 보냅니다 - 예약을 쓰고 싶을 때만 채웁니다.
 */
export function toAoa(rows: BillRow[], opts: SendOptions): (string | number)[][] {
  const hour = hourLabel(opts.dueHour);
  const reserveDay = opts.reserveDate ? ymd(opts.reserveDate) : "";
  const reserveHour =
    opts.reserveDate && opts.reserveHour != null ? hourLabel(opts.reserveHour) : "";

  return [
    [...COLUMNS],
    ...rows.map((r) => [r.memo, r.name, r.phone, r.amount, ymd(r.dueDate), hour, reserveDay, reserveHour]),
  ];
}

/** 열 너비(글자 수). 열어봤을 때 바로 읽히도록 맞춰 둡니다. */
export const COLUMN_WIDTHS = [34, 16, 14, 12, 20, 18, 16, 14];
