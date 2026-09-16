"use client";

import { useEffect, useMemo, useState } from "react";
import { BILL_LABEL, billedItems } from "@/lib/billedItems";
import { useFinanceLive } from "@/lib/useFinanceLive";
import DragScroll from "@/components/common/DragScroll";
import FeeItemsButton from "./FeeItemsModal";
import AlreadyPaidModal, { type AlreadyPaidResult } from "@/components/finance/AlreadyPaidModal";
// 돈을 정하는 판단은 화면에서 떼어 `@/lib/invoiceGrid` 에 두고 시험합니다. 섞여 있으면
// 화면을 손보다 판단을 건드려도 티가 안 나고, 조금 다른 청구서는 그대로 나갑니다.
import { matchesInstrument, planInvoices, typicalByGroup, unusualAmount } from "@/lib/invoiceGrid";
import { addDays, DUE_DAYS } from "@/lib/financePeriod";
import PayModal from "./PayModal";
import { ReceiptChip, ReceiptModal } from "./ReceiptBits";
import { settle, type SettleInvoice } from "@/lib/settlement";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/common/ToastProvider";
import { appliesToAny, inDepartment, inTerm, resolveStudentItems, sumLines, targetLabel, won, type StudentLike } from "@/lib/feeItems";
import { departmentOf, gradeSortKey, type Department } from "@/lib/department";
import { prettyPhone } from "@/lib/alltalkpay";
import { todayKst } from "@/lib/kst";
import {
  IDENTIFIER_LABEL,
  digitsOnly,
  formatIdentifier,
  identifierProblem,
  type ReceiptPurpose,
} from "@/lib/cashReceipt";
import AlltalkpayExport from "./AlltalkpayExport";
import ReconcileModal from "./ReconcileModal";
import InvoicePreviewModal from "./InvoicePreviewModal";
import CancelInvoiceModal from "./CancelInvoiceModal";
import TermPicker, { initialTermId } from "./TermPicker";
import { gradeLabel } from "@/lib/feeItems";
import type { FeeItem, Term, Invoice, StudentFeeItem } from "@/lib/types";
import ScopeTabs from "./ScopeTabs";
import { ALL_SCOPE, gradeOfClass } from "@/lib/gradeScope";

// 인보이스 명단 표 — 학생이 행, 항목이 열인 스프레드시트.
//
// 왜 이 모양인가: 재무 일은 "한 아이"가 아니라 **명단 단위**로 돕니다. 반 스무 명이 같은 책을
// 사는지 확인하고, 악기만 아이마다 다른 것을 훑고, 누가 아직 발행 안 됐는지 봅니다. 한 명씩
// 여는 화면으로는 그 일이 안 됩니다 - 스무 번 열고 스무 번 닫아야 하고, 그러면 빠뜨립니다.
//
// 그래서 결제·회계 프로그램들이 쓰는 모양을 그대로 가져왔습니다.
//   · 첫 열(학생)과 머리줄을 고정해서 오른쪽으로 스크롤해도 누구 줄인지 안 잃습니다.
//   · 맨 아래 합계 줄에 **항목마다 몇 명·얼마**가 뜹니다. 열을 보면 그 책이 몇 권인지 압니다.
//   · 맨 오른쪽에 아이별 합계와 발행 상태. 발행 안 된 줄이 한눈에 보입니다.
//   · 고른 줄만 한 번에 발행합니다.

/**
 * 왼쪽에 고정되는 세 칸(체크·학생·인보이스)의 너비.
 *
 * 고정 위치(left)를 숫자로 적어두고 너비는 내용에 맡기면, 둘이 어긋난 만큼 다음 칸이
 * 덮입니다. 실제로 학생 칸이 이 값보다 좁게 그려져서 인보이스 칸이 오른쪽으로 끌려나갔고,
 * 그만큼 첫 항목(교복) 앞부분이 가려졌습니다. 그래서 **너비와 left 를 같은 수에서** 냅니다.
 */
const W_CHECK = 32;
const W_NAME = 166;
const LEFT_INVOICE = W_CHECK + W_NAME;

/**
 * 표의 한 줄.
 *
 * 이름·학년만 있으면 표는 그려지지만, 청구는 못 합니다. 청구서는 **보호자 연락처**로
 * 나가고, 악기는 명부의 악기 칸과 어긋나면 안 됩니다. 그래서 명부에서 그 칸들을 같이
 * 들고 옵니다 - 재무 화면에서 명부를 다시 열어 확인하게 두면 결국 확인 안 합니다.
 */
export type Student = {
  /** 속한 수강 그룹(방과후·악기반). 그룹 대상 항목이 붙는 근거입니다. */
  groupIds?: string[];
  id: string;
  name: string;
  nameEn: string | null;
  grade: string | null;
  className: string | null;
  department: string | null;
  studentNo: string | null;
  /** 명부의 세 칸. 결제번호를 안 정했으면 어머니 → 아버지 → 보호자 순으로 씁니다. */
  motherPhone: string | null;
  fatherPhone: string | null;
  parentPhone: string | null;
  /**
   * **결제번호** — 이 아이의 청구서가 실제로 나갈 번호.
   *
   * `billingRole` 이 어머니·아버지·보호자면 번호는 그때그때 명부에서 읽습니다. `direct` 면
   * 명부 셋 중 아무도 아닌 번호를 따로 등록한 것이고, 그 번호가 `billingPhone` 입니다.
   * 비어 있으면 아직 안 정한 것입니다.
   */
  billingRole: string | null;
  billingPhone: string | null;
  parentEmail: string | null;
  /** 명부에 적힌 악기. 인보이스의 악기 항목과 어긋나면 화면에서 알려줍니다. */
  instrument: string | null;
};

/**
 * 청구서에 붙은 현금영수증 한 건.
 *
 * 현금영수증은 청구서와 **같은 흐름에서** 생깁니다 — 청구서를 발행해 토들로 보내드리고,
 * 그 답장에 「현금영수증 해주세요, 번호는 …」이 함께 옵니다. 그런데 받는 자리가 다른 화면에
 * 있으면 답장을 읽은 그 순간에 못 적고, 나중에 적으려면 학생을 다시 찾아야 합니다. 그
 * 왕복이 곧 「나중에 하자」입니다.
 *
 * 그래서 청구서 칸 안에 붙입니다. 표를 훑다가 누가 아직 안 물어봤는지, 번호를 아직 못
 * 받았는지, 이미 끊었는지가 한 줄에서 보입니다.
 */
/** 입금 한 줄(요약). 잔액을 내는 데 필요한 것만 들고 옵니다. */
export type PayLite = { invoice_id: string | null; amount: number | string; paid_at?: string; method_kind?: string | null };

export type ReceiptLite = {
  id: string;
  invoice_id: string | null;
  student_id: string | null;
  purpose: ReceiptPurpose;
  identifier: string | null;
  amount: number;
  status: "신청" | "발행" | "취소";
};

type Props = {
  students: Student[];
  items: FeeItem[];
  initialOverrides: StudentFeeItem[];
  recentInvoices: Invoice[];
  initialReceipts: ReceiptLite[];
  payments: PayLite[];
  /**
   * 청구서에 실제로 찍힌 줄. **무엇이 이미 나갔는지**의 유일한 근거입니다.
   *
   * 이게 없어서 같은 항목이 두 번 나갔습니다 - 교복을 한 번 청구한 뒤 다시 발행하면 교복이
   * 또 담겼고, 「이미 받음」으로 만든 청구서에는 안 고른 항목까지 함께 담겼습니다.
   */
  invoiceLines: { invoice_id: string; name: string }[];
  terms: Term[];
  currentUserEmail: string;
  loadError: string | null;
  today: string;
};

type View = { kind: "반"; value: string } | { kind: "학년"; value: string } | { kind: "전체" };

/** 위쪽 큰 갈래. 초등과 중고등은 반 이름도 학년 표기도 달라서, 한 표에 섞으면 열이 뒤엉킵니다. */
type DeptTab = Department | "기타";

/** 청구서를 한 장으로 묶을지, 분류마다 나눌지. */
type IssueMode = "통합" | "분류별";

export default function InvoiceGridClient({
  students,
  items,
  initialOverrides,
  recentInvoices,
  initialReceipts,
  payments: initialPayments,
  invoiceLines,
  terms,
  currentUserEmail,
  loadError,
  today,
}: Props) {
  // 돈에 닿는 자료가 바뀌면 이 화면이 함께 다시 그려집니다. 한 사람이 고치고
  // 여러 사람이 보는 화면이라, 고친 사람만 새 금액을 보면 안 됩니다.
  useFinanceLive(["wr_students"]);
  const notify = useToast();
  const [overrides, setOverrides] = useState(initialOverrides);
  /** 청구서에 붙은 현금영수증. 청구서 칸 안에서 바로 접수·발행 표시를 합니다. */
  const [receipts, setReceipts] = useState(initialReceipts);
  /** 이 청구서들에 들어온 돈. 「보냈다」 옆에 「받았다」가 같이 보여야 합니다. */
  const [payments, setPayments] = useState(initialPayments);
  /** 결제완료를 체크할 청구서. 값이 있으면 창이 열립니다. */
  const [payFor, setPayFor] = useState<{ id: string; label: string; balance: number } | null>(null);
  /** 현금영수증을 넣거나 고칠 청구서. 값이 있으면 창이 열립니다. */
  const [receiptFor, setReceiptFor] = useState<{ invoice: Invoice; studentName: string } | null>(null);
  // 항목도 상태로 들고 있습니다. 여기서 바로 만들면 **그 자리에서 열이 생겨야** 합니다 -
  // 화면을 새로 고쳐야 보이면 결국 항목 화면으로 건너가서 만들게 됩니다.
  const [itemList, setItemList] = useState(items);

  /**
   * **열 순서를 표에서 바로 바꿉니다.**
   *
   * 열 순서는 항목의 `sort_order` 인데, 바꾸려면 항목 관리 화면까지 가야 했습니다. 정작
   * 「이 열을 맨 뒤로」라고 생각하는 순간은 표를 보고 있을 때입니다.
   *
   * **같은 분류 안에서만** 옮깁니다 - 표는 분류(교재·교복…)로 먼저 세우므로, 분류를
   * 건너뛰어 옮기면 저장은 되지만 화면에서는 제자리로 돌아온 것처럼 보입니다.
   */
  const [dragItem, setDragItem] = useState<string | null>(null);
  const [overItem, setOverItem] = useState<string | null>(null);

  async function moveItemColumn(targetId: string) {
    const fromId = dragItem;
    setDragItem(null);
    setOverItem(null);
    if (!fromId || fromId === targetId) return;

    const from = itemList.find((x) => x.id === fromId);
    const to = itemList.find((x) => x.id === targetId);
    if (!from || !to) return;
    if (from.category !== to.category) {
      notify("같은 분류 안에서만 옮길 수 있습니다. 표가 분류로 먼저 세워집니다.", "error");
      return;
    }

    const group = itemList
      .filter((x) => x.category === from.category)
      .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));
    const f = group.findIndex((x) => x.id === fromId);
    const t = group.findIndex((x) => x.id === targetId);
    const [moved] = group.splice(f, 1);
    group.splice(t, 0, moved);

    const orderById = new Map(group.map((x, idx) => [x.id, idx]));
    setItemList((prev) => prev.map((x) => (orderById.has(x.id) ? { ...x, sort_order: orderById.get(x.id)! } : x)));

    const supabase = createClient();
    for (const [idx, x] of group.entries()) {
      if (x.sort_order === idx) continue;
      const { error } = await supabase.from("fee_items").update({ sort_order: idx }).eq("id", x.id);
      // 화면에서는 옮겨졌는데 저장이 안 됐으면, 새로고침에 되돌아가고 사람은 자기가 잘못
      // 끈 줄 압니다.
      if (error) return notify(`열 순서를 저장하지 못했습니다: ${error.message}`, "error");
    }
    notify(`「${moved.name_ko || moved.name}」 열을 옮겼습니다.`, "success");
  }
  const [newOpen, setNewOpen] = useState(false);
  const [newItem, setNewItem] = useState({ category: "", name: "", name_ko: "", unit_price: 0, applyToView: true });
  const [invoices, setInvoices] = useState(recentInvoices);
  /**
   * 청구서에 찍힌 줄. **state 로 둡니다.**
   *
   * 발행하거나 「이미 받음」을 넣은 **그 순간** 표가 회색으로 잠겨야 합니다. 다시 불러올
   * 때까지 안 잠기면, 사람은 기록이 안 된 줄 알고 또 누릅니다 - 그러면 같은 항목이 두
   * 장에 담깁니다.
   */
  const [lineRows, setLineRows] = useState(invoiceLines);

  /**
   * **이 학생의 이 항목이 이미 청구서에 담겼는가.** 판정은 `billedItems` 한 곳입니다 -
   * 발행·이미받음·표가 같은 답을 봐야 같은 돈이 두 번 나가지 않습니다.
   */
  const billed = useMemo(
    () => billedItems(invoices as unknown as Parameters<typeof billedItems>[0], lineRows, payments),
    [invoices, lineRows, payments],
  );
  const [dept, setDept] = useState<DeptTab>("초등부");
  /** 보고 있는 분류. "전체" 면 분류를 가리지 않습니다. */
  const [cat, setCat] = useState<string>("전체");
  /** 보고 있는 학기. 항목 화면과 같은 학기를 봅니다(브라우저에 기억해둡니다). */
  const [termId, setTermId] = useState("");
  useEffect(() => {
    setTermId(initialTermId(terms));
  }, [terms]);
  const [view, setView] = useState<View>({ kind: "전체" });
  /** 올톡페이 발송 파일을 만들 청구서. 값이 있으면 창이 열립니다. */
  const [exportIds, setExportIds] = useState<string[] | null>(null);
  /** 올톡페이 청구서와 맞춰보기. 저장은 하지 않고 보기만 합니다. */
  const [reconcileOpen, setReconcileOpen] = useState(false);
  /** 취소하려는 청구서. 이유를 적게 하려고 창을 한 번 거칩니다. */
  const [cancelling, setCancelling] = useState<{ invoice: Invoice; studentName: string; reason?: string } | null>(null);
  /** 미리보기 창. 새 탭으로 열면 확인할 때마다 탭을 열고 닫아야 합니다. */
  const [preview, setPreview] = useState<{ id: string; label: string } | null>(null);
  /** 이 화면에서 고친 연락처. 새로고침 없이 바로 반영합니다. */
  const [studentPhones, setStudentPhones] = useState<
    Record<string, Partial<Pick<Student, "motherPhone" | "fatherPhone" | "parentPhone" | "billingRole" | "billingPhone">>>
  >({});
  /** 방금 발행한 것. 발행 직후 바로 청구로 이어가라고 띄웁니다. */
  const [justIssued, setJustIssued] = useState<Invoice[]>([]);
  const [q, setQ] = useState("");
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [openCats, setOpenCats] = useState<Set<string>>(new Set());
  /**
   * 대상이 안 맞는 항목까지 볼지.
   *
   * 평소에는 끕니다 - 지금 명단과 상관없는 열이 표를 가로로 늘리기만 합니다. 다만 예외로
   * 붙여야 할 때가 있어서(4학년 교재를 3학년 한 명에게) 켤 수 있게 둡니다.
   */
  const [showOffTarget, setShowOffTarget] = useState(false);
  const [onlyUnissued, setOnlyUnissued] = useState(false);
  /** 「이미 받음」 창을 연 학생. 청구서를 소급해 만들고 입금까지 함께 넣습니다. */
  const [alreadyFor, setAlreadyFor] = useState<Student | null>(null);

  /** 발행 전 검토 창. 누르자마자 나가면 잘못 나간 것을 되돌릴 수 없습니다. */
  const [review, setReview] = useState<Student[] | null>(null);
  /**
   * 한 장으로 묶을지, 분류마다 나눌지.
   *
   * 통합은 종이가 한 장이라 학부모가 한 번만 결제합니다. 분류별은 교재비를 먼저 보내고
   * 교복은 치수를 잰 뒤에 보낼 수 있습니다. 어느 쪽이 맞는지는 그때그때 다릅니다.
   */
  const [issueMode, setIssueMode] = useState<IssueMode>("통합");
  /** 발주 목록 창. 합계 줄의 개수가 그대로 발주 수량입니다. */
  const [orderOpen, setOrderOpen] = useState(false);
  /**
   * 한 아이만 여는 창.
   *
   * 표는 여럿을 훑을 때 좋고, 한 아이를 **꼼꼼히** 볼 때는 좁습니다. 악기처럼 아이마다 다른
   * 것을 고를 때는 분류별로 펼쳐놓고 보는 편이 낫습니다. 표에서 이름을 누르면 열립니다.
   */
  const [detail, setDetail] = useState<Student | null>(null);
  // 납입기한은 **발행한 날로부터 이레**입니다(`DUE_DAYS`). 학비와 같은 규칙을 써야 합니다 -
  // 같은 날 보낸 두 청구서의 마감일이 다르면 학부모가 먼저 알아봅니다.
  const [dueDate, setDueDate] = useState(() => addDays(today, DUE_DAYS));

  /**
   * 지금 보는 부서에서 쓰는 항목만.
   *
   * 초등과 중고등은 사는 교재가 아예 다릅니다. 한 표에 다 세우면 열이 두 배로 늘어나고,
   * 중고등 교재가 초등 아이 줄에 붙을 수 있는 자리가 생깁니다. 부서가 비어 있는 항목
   * (교복처럼 학교 전체가 사는 것)은 어느 쪽에서든 보입니다.
   */
  const activeItems = useMemo(
    () =>
      itemList
        .filter(
          (i) =>
            // active 로 거르지 않습니다. 항목은 끄는 것이 아니라 지웁니다(2026-09).
            // 학기 판단은 발행 쪽과 **같은 함수**를 씁니다. 따로 적으면 표에 보이는 항목이
            // 청구서에는 안 실립니다.
            inTerm(i, termId, terms.find((x) => x.id === termId)?.status === "진행중") &&
            (!i.department || i.department === dept),
        )
        .sort(
          (a, b) =>
            a.category.localeCompare(b.category, "ko") || a.sort_order - b.sort_order || a.name.localeCompare(b.name),
        ),
    [itemList, dept, termId, terms],
  );

  /**
   * 분류 탭으로 한 번 더 좁힙니다.
   *
   * 교재를 붙이는 일과 교복을 붙이는 일은 **다른 날 하는 다른 일**입니다. 교재를 훑는 중에
   * 교복 열이 함께 서 있으면 어디까지 봤는지 놓치고, 실수로 옆 칸을 누릅니다. 청구도 따로
   * 나갑니다 - 교재는 학기 전에, 교복은 치수를 잰 뒤에.
   *
   * '전체' 는 지금까지처럼 다 보여줍니다. 여기서만 통합 한 장으로 발행할 수 있습니다.
   */
  const catTabs = useMemo(
    () => [...new Set(activeItems.map((i) => i.category))].sort((a, b) => a.localeCompare(b, "ko")),
    [activeItems],
  );
  useEffect(() => {
    if (cat !== "전체" && !catTabs.includes(cat)) setCat("전체");
  }, [catTabs, cat]);

  /** 지금 화면이 다루는 항목. 표의 열, 학생 창의 목록, 합계, 발행이 모두 이것을 씁니다. */
  const scopedItems = useMemo(
    () => (cat === "전체" ? activeItems : activeItems.filter((i) => i.category === cat)),
    [activeItems, cat],
  );

  /**
   * 부서로 먼저 가릅니다.
   *
   * 초등과 중고등은 반 이름 체계도, 사는 교재도 다릅니다. 한 표에 섞으면 열이 서로의 몫까지
   * 늘어나 가로로 한없이 길어지고, "2학년"이 초등 2학년인지 중2인지도 헷갈립니다.
   */
  const deptOf = (s: Student): DeptTab => departmentOf({ department: s.department, grade: s.grade }) ?? "기타";
  const deptCounts = useMemo(() => {
    const m = new Map<DeptTab, number>();
    for (const s of students) m.set(deptOf(s), (m.get(deptOf(s)) ?? 0) + 1);
    return m;
  }, [students]);
  /** 아무도 없는 갈래는 탭으로 만들지 않습니다. 다만 '기타'는 사람이 있으면 반드시 보여줍니다 -
      부서가 안 적힌 아이가 조용히 사라지면 그 아이만 청구가 안 됩니다. */
  const deptTabs = useMemo(
    () => (["초등부", "중고등부", "유치부", "기타"] as DeptTab[]).filter((d) => (deptCounts.get(d) ?? 0) > 0),
    [deptCounts],
  );
  useEffect(() => {
    if (deptTabs.length > 0 && !deptTabs.includes(dept)) setDept(deptTabs[0]);
  }, [deptTabs, dept]);

  const inDept = useMemo(() => students.filter((s) => deptOf(s) === dept), [students, dept]);

  /**
   * 학생 한 명의 이번 학기 청구서들.
   *
   * 분류별로 따로 발행할 수 있게 되면서 **한 학생에 여러 장**이 생깁니다. 한 장만 들고 있으면
   * 교복은 나갔는데 교재는 안 나간 아이가 '발행됨' 으로 보입니다.
   */
  const invoicesByStudent = useMemo(() => {
    const m = new Map<string, Invoice[]>();
    for (const v of invoices) {
      if (!v.student_id || v.status !== "발행") continue;
      // 지난 학기 청구서가 이번 학기 표에서 '발행됨'으로 보이면 안 됩니다.
      const sameTerm = (v.term_id ?? "") === termId || (!v.term_id && terms.find((x) => x.id === termId)?.status === "진행중");
      if (sameTerm) m.set(v.student_id, [...(m.get(v.student_id) ?? []), v]);
    }
    return m;
  }, [invoices, termId, terms]);

  /**
   * 청구서 → 현금영수증. 취소된 건은 「없던 일」로 봅니다 - 취소한 뒤 다시 요청이 오면
   * 새로 접수해야 하는데, 취소한 줄이 자리를 잡고 있으면 새 요청을 못 넣습니다.
   */
  const receiptByInvoice = useMemo(() => {
    const m = new Map<string, ReceiptLite>();
    for (const r of receipts) {
      if (!r.invoice_id || r.status === "취소") continue;
      m.set(r.invoice_id, r);
    }
    return m;
  }, [receipts]);

  /**
   * 같은 학생·같은 분류로 두 장 이상 나간 청구서.
   *
   * 학생을 합치거나 발행을 두 번 눌렀을 때 생깁니다. 그대로 두면 청구액이 두 배로 잡혀
   * 미수금이 부풀고, 학부모에게 두 장이 나갑니다. 표에서는 «외 1장»이라는 작은 글씨로만
   * 보여서 눈에 띄지 않았습니다.
   */
  const dupInvoices = useMemo(() => {
    const out: { studentName: string; category: string; list: Invoice[] }[] = [];
    for (const [, list] of invoicesByStudent) {
      const byCat = new Map<string, Invoice[]>();
      for (const v of list) {
        const k = v.category ?? "통합";
        (byCat.get(k) ?? byCat.set(k, []).get(k)!).push(v);
      }
      for (const [k, g] of byCat) {
        if (g.length < 2) continue;
        // 금액이 큰 것이 앞에 옵니다 - 대개 잘못 나간 쪽이 큽니다(항목이 겹쳐 담겨서).
        const sorted = [...g].sort((a, b) => Number(b.total_amount) - Number(a.total_amount));
        out.push({ studentName: sorted[0].student_name_ko || sorted[0].student_name, category: k, list: sorted });
      }
    }
    return out.sort((a, b) => a.studentName.localeCompare(b.studentName, "ko"));
  }, [invoicesByStudent]);

  /**
   * 지금 보고 있는 분류의 청구서. 이것이 '발행됨/미발행' 의 기준입니다.
   *
   * 통합('전체') 에서는 분류 없이 나간 통합 청구서를, 분류 탭에서는 그 분류 청구서를 찾습니다.
   * 통합 청구서에는 그 분류도 이미 들어 있으므로 그것도 나간 것으로 봅니다.
   */
  const invoiceByStudent = useMemo(() => {
    const m = new Map<string, Invoice>();
    for (const [sid, list] of invoicesByStudent) {
      const hit = cat === "전체" ? list.find((v) => !v.category) : list.find((v) => v.category === cat || !v.category);
      if (hit) m.set(sid, hit);
    }
    return m;
  }, [invoicesByStudent, cat]);

  /** 지금 보고 있는 명단. */
  const rows = useMemo(() => {
    const k = q.trim().toLowerCase().replace(/\s+/g, "");
    let list = inDept;
    if (view.kind === "반") list = list.filter((s) => (s.className ?? "") === view.value);
    if (view.kind === "학년") list = list.filter((s) => (s.grade ?? "") === view.value);
    if (k) {
      list = list.filter(
        (s) => s.name.toLowerCase().replace(/\s+/g, "").includes(k) || (s.nameEn ?? "").toLowerCase().replace(/\s+/g, "").includes(k),
      );
    }
    if (onlyUnissued) list = list.filter((s) => !invoiceByStudent.has(s.id));
    return list;
  }, [inDept, view, q, onlyUnissued, invoiceByStudent]);

  /** 이 명단의 아이마다 사는 것. 표 전체가 이 하나에서 나옵니다. */
  const linesByStudent = useMemo(() => {
    const m = new Map<string, ReturnType<typeof resolveStudentItems>>();
    for (const s of rows) m.set(s.id, resolveStudentItems(scopedItems, s as StudentLike, overrides));
    return m;
  }, [rows, scopedItems, overrides]);

  /**
   * 지금 보이는 명단에서 실제로 쓰이는 항목만 열로 세웁니다.
   *
   * 여기에 한 겹을 더 뒀습니다 — **이 명단과 상관없는 항목은 펼쳐도 세우지 않습니다.**
   *
   * 항목은 학기마다 늡니다. 분류를 펼쳐 아이에게 붙이려 할 때 그 분류의 항목이 전부 열로
   * 서는데, G2A 를 보는 중에 `4학년 중국어` 열이 서 있을 이유가 없습니다. 그렇게 늘어난
   * 열은 가로 스크롤이 되고, 가로로 긴 표에서는 옆 칸을 잘못 누릅니다.
   *
   * 대상이 비어 있는 항목(개별 지정)은 그대로 둡니다 - 어느 아이에게나 손으로 붙이는
   * 것이라 걸러내면 붙일 방법이 없어집니다.
   */
  const usedItems = useMemo(() => {
    const used = new Set<string>();
    for (const ls of linesByStudent.values()) for (const l of ls) used.add(l.item.id);
    const list = rows as StudentLike[];
    return scopedItems.filter((i) => {
      // 이미 누군가 사고 있으면 무조건 세웁니다. 안 그러면 붙여둔 것이 화면에서 사라집니다.
      if (used.has(i.id)) return true;
      if (!openCats.has(i.category)) return false;
      return showOffTarget || appliesToAny(i, list);
    });
  }, [scopedItems, linesByStudent, openCats, rows, showOffTarget]);

  /** 대상이 안 맞아 숨긴 항목 수. 숨겼다는 사실을 말해주지 않으면 "왜 없지" 가 됩니다. */
  const hiddenByTarget = useMemo(() => {
    if (showOffTarget) return 0;
    const list = rows as StudentLike[];
    return scopedItems.filter((i) => openCats.has(i.category) && !appliesToAny(i, list)).length;
  }, [scopedItems, openCats, rows, showOffTarget]);

  const cats = useMemo(() => [...new Set(usedItems.map((i) => i.category))], [usedItems]);
  const allCats = useMemo(() => [...new Set(scopedItems.map((i) => i.category))], [scopedItems]);

  /**
   * 대조에 넘길 명단. **부서 탭이나 검색과 무관하게 명부 전체**입니다 - 올톡페이 파일에는
   * 전교생이 들어 있어서, 지금 보이는 것만 넘기면 나머지가 전부 "명부에 없음"으로 나옵니다.
   */
  const reconcileStudents = useMemo(
    () =>
      students.map((s) => ({
        id: s.id,
        name: s.name,
        parentPhone: s.motherPhone ?? s.fatherPhone ?? s.parentPhone,
        gradeLabel: gradeLabel({ grade: s.grade, className: s.className }),
        ours: sumLines(resolveStudentItems(activeItems, s as StudentLike, overrides)),
      })),
    [students, activeItems, overrides],
  );

  /** 청구할 것이 있는데 연락처가 없는 아이. 없는 아이 전부를 세면 대부분이라 아무도 안 봅니다. */
  const noPhone = useMemo(
    () =>
      rows.filter(
        (s) =>
          !(s.motherPhone?.trim() || s.fatherPhone?.trim() || s.parentPhone?.trim()) &&
          sumLines(linesByStudent.get(s.id) ?? []) > 0,
      ),
    [rows, linesByStudent],
  );

  const totalOf = (sid: string) => sumLines(linesByStudent.get(sid) ?? []);
  const grandTotal = rows.reduce((n, s) => n + totalOf(s.id), 0);
  const unissued = rows.filter((s) => !invoiceByStudent.has(s.id)).length;

  /** 열 합계 — 이 항목을 몇 명이 사고 얼마인가. */
  const colSummary = useMemo(() => {
    const m = new Map<string, { people: number; qty: number; amount: number }>();
    for (const ls of linesByStudent.values()) {
      for (const l of ls) {
        const cur = m.get(l.item.id) ?? { people: 0, qty: 0, amount: 0 };
        m.set(l.item.id, { people: cur.people + 1, qty: cur.qty + l.qty, amount: cur.amount + l.amount });
      }
    }
    return m;
  }, [linesByStudent]);

  const lineFor = (sid: string, itemId: string) => (linesByStudent.get(sid) ?? []).find((l) => l.item.id === itemId) ?? null;

  async function upsert(sid: string, item: FeeItem, mode: "include" | "exclude", qty: number) {
    const prev = overrides;
    const local: StudentFeeItem = {
      id: `local-${sid}-${item.id}`,
      student_id: sid,
      item_id: item.id,
      term_id: null,
      mode,
      qty,
      note: null,
      updated_by: currentUserEmail,
      created_at: "",
      updated_at: "",
    };
    setOverrides((p) => [...p.filter((o) => !(o.student_id === sid && o.item_id === item.id)), local]);
    const { data, error } = await createClient()
      .from("student_fee_items")
      .upsert({ student_id: sid, item_id: item.id, mode, qty, updated_by: currentUserEmail }, { onConflict: "student_id,item_id" })
      .select()
      .single();
    if (error || !data) {
      notify("저장하지 못했습니다: " + (error?.message ?? ""), "error");
      setOverrides(prev);
      return;
    }
    setOverrides((p) => p.map((o) => (o.id === local.id ? (data as StudentFeeItem) : o)));
  }

  /** 수량만 바꿉니다. 금액은 단가 × 수량으로만 나옵니다 - 손으로 쓰는 자리가 없습니다. */
  function setQty(s: Student, item: FeeItem, qty: number) {
    if (qty < 1) return;
    void upsert(s.id, item, "include", qty);
  }

  function toggleCell(s: Student, item: FeeItem) {
    const on = !!lineFor(s.id, item.id);
    void upsert(s.id, item, on ? "exclude" : "include", lineFor(s.id, item.id)?.qty ?? 1);
  }

  /**
   * 명부의 악기 칸과 항목 이름이 같은 악기를 가리키는지.
   *
   * 명부에는 `첼로`, 항목에는 `Cello Rental` 처럼 적혀 있어서 글자가 똑같지는 않습니다.
   * 한쪽이 다른 쪽에 들어 있으면 같은 것으로 봅니다 - 틀려도 표시 하나가 빠질 뿐이고,
   * 맞으면 첼로 아이에게 바이올린이 붙은 것을 사람이 알아챌 수 있습니다.
   */


  /**
   * 보호자 연락처를 그 자리에서 고칩니다.
   *
   * 명부 화면으로 건너갔다 오면 하던 일을 놓칩니다. 실패하면 조용히 넘기지 않습니다 -
   * 저장된 줄 알고 발행하면 그 아이만 청구가 안 나갑니다.
   */
  async function savePhone(s: Student, key: "motherPhone" | "fatherPhone" | "parentPhone", raw: string) {
    const col = key === "motherPhone" ? "mother_phone" : key === "fatherPhone" ? "father_phone" : "parent_phone";
    const value = raw.trim() || null;
    if ((s[key] ?? null) === value) return;
    const { error } = await createClient().from("wr_students").update({ [col]: value }).eq("id", s.id);
    if (error) {
      notify(`연락처를 저장하지 못했습니다: ${error.message}`, "error");
      return;
    }
    setStudentPhones((p) => ({ ...p, [s.id]: { ...(p[s.id] ?? {}), [key]: value } }));
    notify("연락처를 저장했습니다.", "success");
  }

  /**
   * **결제번호를 정합니다.** 셋 중 하나를 고르거나, 셋 중 아무도 아닌 번호를 새로 등록합니다.
   *
   * 고른 것이 어머니면 **번호는 베끼지 않습니다** - 명부의 어머니 칸을 그때그때 읽습니다.
   * 베껴 두면 어머니가 번호를 바꿨을 때 명부는 새 번호·결제번호는 옛 번호가 되는데, 둘 다
   * 그럴듯해 보여서 어느 쪽이 맞는지 알 수 없습니다.
   */
  async function saveBilling(s: Student, role: string | null, direct?: string) {
    const phone = role === "direct" ? (direct ?? "").trim() : null;
    if (role === "direct" && !phone) {
      notify("새로 등록할 번호를 적어주세요.", "error");
      return;
    }
    // **서버를 거칩니다.** 브라우저에서 바로 `wr_students` 를 고치면 그 표의 자물쇠가
    // 명부 관리 권한을 요구해서, 재무 담당자에게는 **한 줄도 안 맞고 오류도 안 납니다.**
    // 그래서 화면만 바뀌었다가 창을 다시 열면 사라졌습니다(/api/finance/billing-phone).
    const res = await fetch("/api/finance/billing-phone", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ studentId: s.id, role, phone }),
    });
    const json = (await res.json().catch(() => null)) as
      | { error?: string; student?: { billing_phone_role: string | null; billing_phone: string | null } }
      | null;
    // 조용히 넘기면 정해진 줄 알고 청구를 돌립니다. 그러면 그 집만 엉뚱한 분께 갑니다.
    if (!res.ok) {
      notify(`결제번호를 저장하지 못했습니다: ${json?.error ?? "알 수 없는 이유"}`, "error");
      return;
    }
    // 화면은 **저장된 값**을 그대로 받아 그립니다. 보낸 값을 그리면 서버가 다듬은 것과
    // 어긋나고, 그 차이는 다음에 열어볼 때야 드러납니다.
    const saved = json?.student ?? { billing_phone_role: role, billing_phone: phone };
    setStudentPhones((p) => ({
      ...p,
      [s.id]: { ...(p[s.id] ?? {}), billingRole: saved.billing_phone_role, billingPhone: saved.billing_phone },
    }));
    notify(role ? "결제번호를 정했습니다." : "결제번호를 지웠습니다. 어머니 → 아버지 → 보호자 순으로 나갑니다.", "success");
  }

  /** 내보낸 표시를 화면에도 바로 반영합니다. 새로고침해야 보이면 두 번 보내게 됩니다. */
  function markExported(ids: string[]) {
    const at = new Date().toISOString();
    setInvoices((p) => p.map((v) => (ids.includes(v.id) ? { ...v, exported_at: at } : v)));
    setJustIssued((p) => p.map((v) => (ids.includes(v.id) ? { ...v, exported_at: at } : v)));
  }

  /** 열 하나를 이 명단 전원에게 넣거나 뺍니다. 반 단위로 교재를 붙일 때 이게 없으면 스무 번 눌러야 합니다. */
  async function fillColumn(item: FeeItem, on: boolean) {
    if (rows.length === 0) return;
    // 되묻지 않습니다. 항목을 넣고 빼는 것은 표를 고치는 일이고 다시 누르면 되돌아갑니다.
    setBusy(true);
    try {
      const payload = rows.map((s) => ({
        student_id: s.id,
        item_id: item.id,
        mode: on ? "include" : "exclude",
        qty: lineFor(s.id, item.id)?.qty ?? 1,
        updated_by: currentUserEmail,
      }));
      const { data, error } = await createClient()
        .from("student_fee_items")
        .upsert(payload, { onConflict: "student_id,item_id" })
        .select();
      if (error) {
        notify("일괄 반영에 실패했습니다: " + error.message, "error");
        return;
      }
      const fresh = (data as StudentFeeItem[] | null) ?? [];
      setOverrides((p) => [
        ...p.filter((o) => !(o.item_id === item.id && rows.some((s) => s.id === o.student_id))),
        ...fresh,
      ]);
      notify(`${rows.length}명에게 반영했습니다.`, "success");
    } finally {
      setBusy(false);
    }
  }

  /**
   * 표에서 바로 항목을 만듭니다.
   *
   * 만들면서 **지금 보고 있는 명단에 곧바로 붙일 수 있게** 했습니다(기본 켜짐). 반을 보다가
   * "이 반 교재 하나 더 있었지" 하는 순간에, 항목 화면으로 건너갔다 돌아오면 보던 자리를
   * 다시 찾아야 하고 그 사이에 무엇을 하려 했는지 잊습니다.
   */
  async function createItem() {
    const name = newItem.name.trim();
    const category = newItem.category.trim();
    if (!name || !category) {
      notify("분류와 이름을 적어주세요.", "error");
      return;
    }
    setBusy(true);
    try {
      const supabase = createClient();
      // 지금 보기가 반/학년이면 그 값을 기본 대상으로 넣어둡니다 - 다음에 전학 온 아이에게도
      // 자동으로 붙습니다. '표에만 붙이기'와 달리 이건 규칙으로 남습니다.
      const defaults =
        newItem.applyToView && view.kind === "반"
          ? { default_classes: [view.value], default_grades: [] as string[] }
          : newItem.applyToView && view.kind === "학년"
            ? { default_grades: [view.value], default_classes: [] as string[] }
            : { default_grades: [] as string[], default_classes: [] as string[] };

      const { data, error } = await supabase
        .from("fee_items")
        .insert({
          category,
          name,
          name_ko: newItem.name_ko.trim() || null,
          unit_price: Number(newItem.unit_price) || 0,
          // 지금 보고 있는 부서의 항목으로 만듭니다. 초등 표에서 만든 교재가 중고등 표에
          // 나타나면, 만든 사람도 나중에 왜 거기 있는지 모릅니다.
          department: dept === "초등부" || dept === "중고등부" ? dept : null,
          term_id: termId || null,
          ...defaults,
          created_by: currentUserEmail,
        })
        .select()
        .single();
      if (error || !data) {
        notify("항목을 만들지 못했습니다: " + (error?.message ?? ""), "error");
        return;
      }
      const made = data as FeeItem;
      setItemList((p) => [made, ...p]);
      // 새 분류라면 그 열이 바로 보이도록 펼쳐둡니다.
      setOpenCats((p) => new Set([...p, made.category]));
      notify(
        newItem.applyToView && view.kind !== "전체"
          ? `"${made.name}"을 만들고 ${view.value}${view.kind === "학년" ? "학년" : ""}에 붙였습니다.`
          : `"${made.name}"을 만들었습니다. 표에서 눌러 넣어주세요.`,
        "success",
      );
      setNewItem({ category, name: "", name_ko: "", unit_price: 0, applyToView: newItem.applyToView });
    } finally {
      setBusy(false);
    }
  }

  /**
   * 발행 전 검토.
   *
   * 회계 프로그램들은 예외 없이 여기에 한 단계를 둡니다. 보내는 순간 되돌릴 수 없고, 학부모가
   * 받은 뒤에 고치면 신뢰가 깎이기 때문입니다. **평소와 다른 금액을 짚어주는 것**이 핵심입니다.
   */
  function openReview() {
    const targets = rows.filter((s) => checked.has(s.id) && totalOf(s.id) > 0);
    if (targets.length === 0) {
      notify("발행할 학생을 골라주세요(금액이 0원인 학생은 제외됩니다).", "error");
      return;
    }
    setReview(targets);
  }

  /**
   * 같은 반에서 가장 흔한 금액. 이것과 다른 아이를 "평소와 다르다"고 짚습니다.
   *
   * 평균이 아니라 **최빈값**을 씁니다. 한 명이 악기를 사면 평균이 통째로 끌려가서, 정작
   * 멀쩡한 아이들이 전부 '다름'으로 표시됩니다.
   */
  const typicalByClass = useMemo(
    () =>
      typicalByGroup(
        students.map((s) => ({
          key: s.className || (s.grade ? `${s.grade}학년` : ""),
          amount: sumLines(resolveStudentItems(activeItems, s as StudentLike, overrides)),
        })),
      ),
    [students, activeItems, overrides],
  );

  function unusual(s: Student): number | null {
    return unusualAmount(typicalByClass, s.className || (s.grade ? `${s.grade}학년` : ""), totalOf(s.id));
  }

  /**
   * 발행할 청구서 목록을 미리 세웁니다. 한 학생이 여러 장이 될 수 있습니다.
   *
   * · 분류 탭을 고른 상태 → 그 분류만, 학생당 한 장.
   * · '전체' + 통합       → 분류를 가리지 않고 학생당 한 장(지금까지의 방식).
   * · '전체' + 분류별     → 그 학생에게 붙은 분류마다 한 장씩.
   */
  function planFor(targets: Student[], mode: IssueMode) {
    return planInvoices(targets, {
      cat,
      mode,
      categoriesOf: (s) =>
        (linesByStudent.get(s.id) ?? resolveStudentItems(scopedItems, s as StudentLike, overrides)).map((l) => l.item.category),
    });
  }

  /** 고른 줄을 한 번에 발행합니다. */
  async function issueChecked(mode: IssueMode = issueMode) {
    const targets = review ?? rows.filter((s) => checked.has(s.id) && totalOf(s.id) > 0);
    if (targets.length === 0) return;
    const jobs = planFor(targets, mode);
    setBusy(true);
    const made: Invoice[] = [];
    const failed: string[] = [];
    try {
      for (const { student: s, category } of jobs) {
        /**
         * **이미 나간 항목은 빼고 보냅니다.**
         *
         * 예전에는 분류만 보냈습니다. 그래서 교복을 한 번 청구한 뒤 교재비를 청구하려고
         * 다시 발행하면 **교복이 또 담겼습니다** - 학부모 화면에는 낼 돈이 두 배로 뜨는데,
         * 오류가 아니라 「청구된 금액」으로 보입니다.
         *
         * 판정은 `billedItems` 한 곳입니다. 발행·이미받음·표가 같은 답을 봐야 합니다.
         */
        const marks = billed.get(s.id);
        const mine = (linesByStudent.get(s.id) ?? []).filter((l) => !category || l.item.category === category);
        const rest = mine.filter((l) => !marks?.has(l.item.name));
        if (rest.length === 0) {
          // 조용히 건너뛰면 발행된 줄 알고 넘어갑니다. 왜 빠졌는지 말해줍니다(§5).
          failed.push(`${s.name}(${category ?? "학비외"} — 이미 모두 청구서에 나갔습니다)`);
          continue;
        }
        const res = await fetch("/api/finance/invoices", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            studentId: s.id,
            dueDate,
            feeTermId: termId || null,
            category,
            itemIds: rest.map((l) => l.item.id),
          }),
        });
        // ── 돌아온 것이 우리 답이 맞는가 ─────────────────────────────────────
        //
        // 발행이 «HTML 조각»과 함께 실패한 일이 있었습니다. 그건 우리 서버가 낸 오류가
        // 아니라 **다른 사이트의 웹페이지가 돌아온 것**입니다 - 주소가 엉뚱한 곳으로
        // 가거나(사내망 차단·프록시·잘못된 도메인), 로그인이 풀려 로그인 화면 HTML이
        // 대신 온 경우입니다.
        //
        // 예전에는 그 HTML을 파싱하려다 실패하고 상태 문구만 남겨서, 무엇이 잘못됐는지
        // 알 방법이 없었습니다. 무엇이 돌아왔는지를 보고 사람이 판단할 수 있게 합니다.
        const ctype = res.headers.get("content-type") ?? "";
        if (!ctype.includes("application/json")) {
          const head = (await res.text().catch(() => "")).slice(0, 120).replace(/\s+/g, " ").trim();
          failed.push(
            `${s.name}${category ? `·${category}` : ""}(서버가 JSON 대신 ${ctype || "알 수 없는 형식"}을 돌려줬습니다 · ${res.status} · ${head})`,
          );
          continue;
        }

        const body = await res.json().catch(() => ({}));
        if (res.ok) {
          made.push(body.invoice as Invoice);
          // **방금 나간 줄을 바로 얹습니다.** 안 얹으면 표가 다시 불러올 때까지 안 잠기고,
          // 그 사이에 또 누르면 같은 항목이 두 장에 담깁니다.
          const invId = (body.invoice as Invoice | undefined)?.id;
          if (invId) setLineRows((p) => [...p, ...rest.map((l) => ({ invoice_id: invId, name: l.item.name }))]);
        }
        // 한 명이 실패해도 나머지는 계속합니다. 다만 **누가 실패했는지 반드시 말합니다** -
        // 조용히 넘기면 그 아이만 인보이스 없이 남습니다.
        else failed.push(`${s.name}${category ? `·${category}` : ""}(${body.error ?? res.statusText})`);
      }
      if (made.length > 0) {
        setInvoices((p) => [...made, ...p]);
        // 발행은 종이를 만든 것일 뿐, 아직 청구가 나간 것이 아닙니다. 여기서 끊기면
        // 발행만 해놓고 올톡페이에 안 올리는 일이 생깁니다.
        setJustIssued(made);
      }
      if (failed.length > 0) notify(`${made.length}건 발행 · ${failed.length}건 실패: ${failed.join(", ")}`, "error");
      else notify(`${made.length}건 발행했습니다.`, "success");
      setChecked(new Set());
      setReview(null);
    } finally {
      setBusy(false);
    }
  }

  /** 지금 보이는 표를 그대로 CSV로. 구글시트에 붙여넣어 따로 보관하거나 공유할 수 있습니다. */
  function exportCsv() {
    const head = ["학생", "영문이름", "학년", "반", ...usedItems.map((i) => i.name), "합계", "인보이스"];
    const body = rows.map((s) => [
      s.name,
      s.nameEn ?? "",
      s.grade ?? "",
      s.className ?? "",
      ...usedItems.map((i) => {
        const l = lineFor(s.id, i.id);
        return l ? String(l.qty) : "";
      }),
      String(totalOf(s.id)),
      invoiceByStudent.get(s.id)?.invoice_no ?? "",
    ]);
    const foot = [
      "합계",
      "",
      "",
      "",
      ...usedItems.map((i) => String(colSummary.get(i.id)?.amount ?? 0)),
      String(grandTotal),
      "",
    ];
    const csv = [head, ...body, foot]
      .map((r) => r.map((c) => (/[",\n]/.test(c) ? `"${c.replaceAll('"', '""')}"` : c)).join(","))
      .join("\n");
    // 엑셀·구글시트가 한글을 깨뜨리지 않도록 BOM을 붙입니다.
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `인보이스_${view.kind === "전체" ? "전체" : view.value}_${today}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  /**
   * **이미 받은 학비외 청구.**
   *
   * 청구서는 만들되 학부모에게는 안 나갑니다(`issued_offline`). 이미 낸 분께 또 내라고
   * 하는 셈이 되니까요. 대신 무엇을 받았는지는 입금 메모에 이름으로 남습니다 - 나중에
   * 「교재는 아직 안 냈다」를 셀 수 있어야 합니다.
   */
  async function recordAlreadyPaid(s: Student, r: AlreadyPaidResult) {
    setBusy(true);
    try {
      /**
       * **받은 날로 나눠 만듭니다.**
       *
       * 교복은 8월 24일, 교재비는 8월 28일에 받았으면 청구서도 두 장입니다. 청구서 날짜가
       * 곧 그 돈이 잡히는 달이라, 한 장에 묶으면 월 마감 숫자가 어긋납니다 - 8월 31일과
       * 9월 1일이 섞이는 날이 반드시 옵니다.
       *
       * 항목을 안 고르고 금액만 적었으면 묶음이 없습니다. 그때는 예전처럼 한 장입니다.
       */
      const jobs =
        r.batches.length > 0
          ? r.batches.map((b) => ({
              paidAt: b.paidAt,
              amount: b.amount,
              itemIds: b.itemIds,
              memo: `받은 항목: ${b.labels.join(" · ")}`,
            }))
          : [{ paidAt: r.paidAt, amount: r.amount, itemIds: [] as string[], memo: r.memo }];

      const made: Invoice[] = [];
      const failed: string[] = [];
      for (const j of jobs) {
        const res = await fetch("/api/finance/invoices", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            studentId: s.id,
            // 청구서 날짜를 **받은 날**로 맞춥니다. 오늘로 두면 지난달에 받은 돈이 이번 달
            // 장부에 잡혀서, 월별로 세는 숫자가 어긋납니다.
            dueDate: j.paidAt,
            billingMonth: j.paidAt.slice(0, 7),
            feeTermId: termId || null,
            category: cat === "전체" ? null : cat,
            // **고른 항목만 담습니다.** 이게 없어서 교복만 체크해도 교재비까지 담겼고,
            // 입금은 교복 값만 붙어 그 청구서가 일부납으로 남았습니다 - 이미 받은 항목이
            // 미납·연체에 다시 뜨는 것처럼 보였습니다.
            ...(j.itemIds.length > 0 ? { itemIds: j.itemIds } : {}),
            alreadyPaid: { paidAt: j.paidAt, amount: j.amount, method: r.method, memo: j.memo },
          }),
        });
        const b = (await res.json().catch(() => ({}))) as { error?: string; paid?: number; invoice?: Invoice };
        if (!res.ok) {
          // 한 장이 실패해도 나머지는 계속합니다. 다만 **어느 날짜가 실패했는지** 말합니다 -
          // 조용히 넘기면 그 날 받은 돈이 통째로 안 적힌 채 남습니다(§5).
          failed.push(`${j.paidAt}(${b.error ?? "이유 모름"})`);
          continue;
        }
        if (b.invoice) {
          made.push(b.invoice);
          // 고른 항목만 담았으므로 그 이름들을 그대로 얹습니다. 이름은 명부가 아니라 **표가
          // 들고 있는 항목 이름**입니다 - 서버가 청구서에 찍은 것과 같은 글자입니다.
          const names = (linesByStudent.get(s.id) ?? [])
            .filter((l) => j.itemIds.length === 0 || j.itemIds.includes(l.item.id))
            .map((l) => l.item.name);
          const invId = b.invoice.id;
          setLineRows((p) => [...p, ...names.map((name) => ({ invoice_id: invId, name }))]);
        }
      }

      // 새로고침 없이 화면에 바로 얹습니다. 다시 불러오게 하면 이 표는 통째로 다시
      // 그려져서, 여러 명을 연달아 넣을 때 스크롤과 체크가 매번 튑니다.
      if (made.length > 0) setInvoices((p) => [...made, ...p]);
      /**
       * **입금도 바로 얹습니다.** 이걸 안 하면 방금 넣은 청구서가 화면에서 미납으로 보이고,
       * 그 항목은 회색으로 안 잠깁니다 - 사람은 「기록이 안 됐나」 하고 또 누릅니다.
       */
      if (made.length > 0) {
        setPayments((p) => [
          ...p,
          ...made.map((inv, i) => ({
            invoice_id: inv.id,
            amount: jobs[i]?.amount ?? 0,
            paid_at: jobs[i]?.paidAt ?? r.paidAt,
            method_kind: r.method,
          })),
        ]);
      }
      if (failed.length > 0) notify(`${made.length}장 기록 · ${failed.length}장 실패: ${failed.join(", ")}`, "error");
      else {
        setAlreadyFor(null);
        notify(
          made.length > 1
            ? `${s.name} — 받은 날로 나눠 ${made.length}장 기록했습니다.`
            : `${s.name} — 이미 받은 것으로 넣었습니다 (${won(jobs[0]?.amount ?? r.amount)}).`,
          "success",
        );
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    // w-full + min-w-0: 이게 없으면 표가 넓어질 때 **페이지 자체가 옆으로 늘어납니다.**
    // 그러면 상단 탭줄과 제목까지 함께 밀려나가고, 가로 스크롤바가 화면 맨 아래에 생겨
    // 표를 보려면 페이지를 통째로 밀어야 합니다. 늘어나야 하는 것은 표 안쪽뿐입니다.
    // **세로는 가두지 않습니다.** 한때 화면 높이에 통째로 가뒀는데, 그러면 표 안쪽에서
    // 세로로도 스크롤해야 합니다. 학생이 백 명 넘는 명단은 위에서 아래로 쭉 훑어 내리는
    // 것이라 페이지째 내려가는 편이 자연스럽습니다. 가둘 것은 **가로뿐**입니다.
    <div className="mx-auto w-full min-w-0 max-w-full p-3 sm:p-4">
      <div className="mb-1 flex flex-wrap items-baseline gap-2">
        <h1 className="text-lg font-bold">🧾 청구 · 학비외</h1>
        <span className="text-xs text-slate-400">교재 · 교복 등 · 학생 × 항목</span>
        {/* 예전에는 「항목 관리 →」 링크였습니다. 누르면 다른 대분류 탭으로 넘어가면서
            보고 있던 학기·부서·체크가 전부 풀렸고, 돌아와서 처음부터 다시 찾아야 했습니다. */}
        <FeeItemsButton />
      </div>
      <p className="mb-3 text-xs leading-relaxed text-slate-500">
        표는 <b>보는 곳</b>입니다. 넣고 빼는 것은 <b>이름을 눌러 나오는 창</b>에서만 합니다 — 칸이 촘촘해서
        훑다가 옆 칸을 눌러도 알아채지 못했습니다. 항목에 정해둔 <b>기본 학년·반</b>은 이미 체크된 채로 나오고,
        합계는 표가 계산합니다 — 사람이 더할 자리가 없습니다.
      </p>

      {loadError && (
        <p className="mb-3 rounded-lg border border-orange-200 bg-orange-50 px-3 py-2 text-[12px] text-orange-800">
          자료를 읽지 못했습니다: {loadError}
        </p>
      )}
      {activeItems.length === 0 && (
        <p className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-800">
          아직 등록된 항목이 없습니다.{" "}
          위의 <b>[📚 학비외 항목]</b> 에서 먼저 교재·교복 등을 만들어주세요.
        </p>
      )}

      <div className="mb-2 flex flex-wrap items-center gap-2">
        <TermPicker terms={terms} value={termId} onChange={setTermId} />
        <span className="text-[11px] text-slate-400">학기를 바꾸면 그 학기의 항목과 청구서만 보입니다</span>
      </div>

      {/* ── 발행 직후 ─────────────────────────────────────────────
          발행은 종이를 만든 것일 뿐입니다. 여기서 끊기면 발행만 해놓고 청구를 안 보냅니다. */}
      {justIssued.length > 0 && (
        <div className="mb-2 flex flex-wrap items-center gap-2 rounded-xl border border-emerald-300 bg-emerald-50 px-3 py-2">
          <span className="text-[12px] font-bold text-emerald-900">
            방금 {justIssued.length}건 발행했습니다.
          </span>
          <span className="text-[11px] text-emerald-800">
            {justIssued.every((v) => v.exported_at) ? "발송 파일까지 받으셨습니다." : "아직 청구는 나가지 않았습니다 — 올톡페이로 보내야 합니다."}
          </span>
          <button
            onClick={() => setExportIds(justIssued.map((v) => v.id))}
            className="ml-auto rounded-lg bg-emerald-600 px-3 py-1.5 text-[12px] font-bold text-white"
          >
            📤 올톡페이로 청구하기
          </button>
          <button onClick={() => setJustIssued([])} className="text-[11px] font-bold text-emerald-700 underline">
            닫기
          </button>
        </div>
      )}

      {/* ── 부서 ──────────────────────────────────────────────────
          초등과 중고등을 한 표에 섞으면 열이 서로의 몫까지 늘어나 가로로 한없이 길어지고,
          "2학년"이 초등 2학년인지 중2인지도 헷갈립니다. 그래서 먼저 갈라놓습니다. */}
      <div className="mb-2 flex flex-wrap items-center gap-1 border-b border-slate-200">
        {deptTabs.map((d) => (
          <button
            key={d}
            onClick={() => {
              setDept(d);
              // 부서를 바꾸면 반·학년은 다시 골라야 합니다. 초등 G2A는 중고등에 없습니다.
              setView({ kind: "전체" });
              setChecked(new Set());
            }}
            className={
              "-mb-px rounded-t-lg px-3 py-1.5 text-[13px] font-bold transition-colors " +
              (dept === d
                ? "border-b-2 border-teal-600 text-teal-700"
                : "border-b-2 border-transparent text-slate-400 hover:bg-slate-50 hover:text-slate-700")
            }
          >
            {d === "기타" ? "부서 미상" : d}
            <span className="ml-1 text-[11px] font-semibold opacity-60">{deptCounts.get(d) ?? 0}</span>
          </button>
        ))}
      </div>

      {/* ── 분류 ─────────────────────────────────────────────────
          교재를 붙이는 일과 교복을 붙이는 일은 다른 날 하는 다른 일입니다. 한 화면에 함께
          세워두면 어디까지 봤는지 놓치고 옆 칸을 누릅니다. 청구도 따로 나갑니다. */}
      {catTabs.length > 0 && (
        <div className="mb-2 flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] font-bold text-slate-400">분류</span>
          {["전체", ...catTabs].map((c) => {
            const on = cat === c;
            const n = c === "전체" ? activeItems.length : activeItems.filter((i) => i.category === c).length;
            return (
              <button
                key={c}
                onClick={() => {
                  setCat(c);
                  // 분류를 바꾸면 고른 학생도 비웁니다. 교재를 고른 채 교복 탭에서 발행하면
                  // 엉뚱한 청구가 나갑니다.
                  setChecked(new Set());
                }}
                className={
                  "rounded-full px-2.5 py-1 text-[12px] font-bold transition-colors " +
                  (on ? "bg-teal-600 text-white" : "bg-slate-100 text-slate-500 hover:bg-slate-200 hover:text-slate-700")
                }
              >
                {c}
                <span className="ml-1 text-[10px] font-semibold opacity-70">{n}</span>
              </button>
            );
          })}
          <span className="text-[11px] text-slate-400">
            {cat === "전체" ? "분류를 가리지 않고 봅니다" : `${cat} 항목만 보고, ${cat}만 청구합니다`}
          </span>
        </div>
      )}

      {/* ── 보기 ─────────────────────────────────────────────────
          예전에는 반 열댓 개와 학년이 **한 줄에 평평하게** 서 있었습니다. 그러면 「2학년을
          통째로」 보는 길이 반들 사이에 묻히고, 초등부 반이 늘수록 줄이 접혀 학년은 아예
          화면 밖으로 나갑니다.

          이제 부서 → 학년 → 반으로 한 단씩 내려갑니다. 학비 청구와 **같은 덩어리**를
          씁니다 - 같은 일을 하다 화면만 옮겼는데 좁히는 방법이 다르면 그걸 고장으로
          여깁니다. */}
      <ScopeTabs
        dept={dept === "기타" ? "부서 미상" : dept}
        students={inDept}
        scope={view.kind === "반" ? { grade: gradeOfClass(inDept, view.value), klass: view.value } : view.kind === "학년" ? { grade: view.value, klass: "" } : ALL_SCOPE}
        onChange={(next) => {
          setView(next.klass ? { kind: "반", value: next.klass } : next.grade ? { kind: "학년", value: next.grade } : { kind: "전체" });
          // 고른 것도 함께 풉니다 - 화면에 없는 학생이 골라진 채 남으면 청구서가 안 보이는
          // 아이에게 나갑니다.
          setChecked(new Set());
        }}
      />

      <div className="mb-2 flex flex-wrap items-center gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="이름으로 찾기"
          className="w-44 rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
        />
        <label className="flex items-center gap-1 text-[11px] text-slate-500">
          <input type="checkbox" checked={onlyUnissued} onChange={(e) => setOnlyUnissued(e.target.checked)} />
          아직 발행 안 된 학생만
        </label>
        {/* 안 쓰이는 분류는 열을 접어둡니다. 악기처럼 몇 명만 고르는 것은 펼쳐야 넣을 수 있습니다. */}
        <span className="flex flex-wrap items-center gap-1">
          {allCats.map((c) => {
            const on = openCats.has(c);
            return (
              <button
                key={c}
                onClick={() =>
                  setOpenCats((p) => {
                    const n = new Set(p);
                    if (n.has(c)) n.delete(c);
                    else n.add(c);
                    return n;
                  })
                }
                className={
                  "rounded px-1.5 py-0.5 text-[11px] font-semibold " +
                  (on ? "bg-teal-600 text-white" : "border border-slate-200 text-slate-500 hover:bg-slate-50")
                }
                title={on ? "안 쓰는 항목 열까지 보이는 중" : "이 분류의 모든 항목을 열로 펼칩니다"}
              >
                {on ? "▾" : "▸"} {c}
              </button>
            );
          })}
        </span>
        <button
          onClick={() => {
            // 고른 줄이 있으면 그것만, 없으면 지금 보이는 명단에서 **아직 안 보낸** 발행 건만.
            // 전부를 기본으로 잡으면 이미 보낸 청구서까지 다시 올리게 됩니다.
            const picked = rows.filter((s) => checked.has(s.id));
            const src = picked.length > 0 ? picked : rows;
            const ids = src
              .map((s) => invoiceByStudent.get(s.id))
              .filter((v): v is Invoice => !!v && (picked.length > 0 || !v.exported_at))
              .map((v) => v.id);
            if (ids.length === 0) {
              notify(picked.length > 0 ? "고른 학생 중 발행된 청구서가 없습니다." : "보낼 청구서가 없습니다. 먼저 발행해주세요.", "error");
              return;
            }
            setExportIds(ids);
          }}
          className="ml-auto rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-xs font-bold text-emerald-800 hover:bg-emerald-100"
          title="발행된 청구서를 올톡페이 대량발송 엑셀로 만듭니다"
        >
          📤 올톡페이 청구
        </button>
        <button
          onClick={() => setReconcileOpen(true)}
          className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50"
          title="올톡페이에서 받은 청구서관리목록과 지금 등록한 항목 금액을 맞춰봅니다 (저장하지 않습니다)"
        >
          🔍 청구서와 대조
        </button>
        <button onClick={exportCsv} className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50">
          ⬇ CSV (구글시트용)
        </button>
      </div>

      {/* 청구서는 명부의 보호자 연락처로 나갑니다. 발행은 되는데 발송에서 조용히 빠지는 것이라
          표 위에서 미리 알려줍니다. */}
      {noPhone.length > 0 && (
        <p className="mb-2 rounded-lg border border-orange-200 bg-orange-50 px-3 py-2 text-[11px] text-orange-800">
          이 명단에서 <b>보호자 연락처가 없는 학생 {noPhone.length}명</b>입니다 — 발행은 되지만 올톡페이 발송에서 빠집니다.{" "}
          {noPhone.slice(0, 8).map((s) => s.name).join(", ")}
          {noPhone.length > 8 ? ` 외 ${noPhone.length - 8}명` : ""}
        </p>
      )}

      {/* ── 표에서 바로 항목 만들기 ────────────────────────────── */}
      <div className="mb-2 rounded-xl border border-slate-200 bg-white">
        <button
          type="button"
          onClick={() => setNewOpen((v) => !v)}
          className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] font-bold text-slate-700"
        >
          <span className="text-teal-600">{newOpen ? "▾" : "＋"}</span>
          여기서 바로 항목 만들기
          <span className="font-medium text-slate-400">— 항목 화면으로 건너가지 않아도 됩니다</span>
        </button>
        {newOpen && (
          <div className="flex flex-wrap items-end gap-2 border-t border-slate-100 p-3">
            <label className="text-[11px] text-slate-500">
              분류
              <input
                list="grid-category-list"
                value={newItem.category}
                onChange={(e) => setNewItem((f) => ({ ...f, category: e.target.value }))}
                placeholder="교재 · 악기 · 자유롭게"
                className="ml-1 w-32 rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
              />
              <datalist id="grid-category-list">
                {allCats.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </label>
            <label className="text-[11px] text-slate-500">
              인보이스 이름 (영문)
              <input
                value={newItem.name}
                onChange={(e) => setNewItem((f) => ({ ...f, name: e.target.value }))}
                placeholder="Reveal Math 5"
                className="ml-1 w-52 rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
              />
            </label>
            <label className="text-[11px] text-slate-500">
              한글 이름
              <input
                value={newItem.name_ko}
                onChange={(e) => setNewItem((f) => ({ ...f, name_ko: e.target.value }))}
                placeholder="5학년 수학"
                className="ml-1 w-32 rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
              />
            </label>
            <label className="text-[11px] text-slate-500">
              단가
              {/* 0 을 글자로 두지 않습니다.
                  숫자 칸에 `0` 이 적혀 있으면 지우고 쓰거나 뒤에 붙여 `045000` 이 됩니다.
                  값이 0이면 빈 칸으로 보이고, 자리표시만 `0` 으로 둡니다. */}
              <input
                type="number"
                value={newItem.unit_price === 0 ? "" : newItem.unit_price}
                onChange={(e) => setNewItem((f) => ({ ...f, unit_price: Number(e.target.value) || 0 }))}
                onFocus={(e) => e.target.select()}
                placeholder="0"
                className="ml-1 w-28 rounded-lg border border-slate-300 px-2 py-1.5 text-right text-sm"
              />
            </label>
            {view.kind !== "전체" && (
              <label className="flex items-center gap-1 text-[11px] text-slate-600">
                <input
                  type="checkbox"
                  checked={newItem.applyToView}
                  onChange={(e) => setNewItem((f) => ({ ...f, applyToView: e.target.checked }))}
                />
                <b>{view.value}{view.kind === "학년" ? "학년" : ""}</b> 기본으로 붙이기
              </label>
            )}
            <button
              onClick={() => void createItem()}
              disabled={busy}
              className="rounded-lg bg-teal-600 px-4 py-1.5 text-sm font-semibold text-white disabled:opacity-40"
            >
              + 만들기
            </button>
            <span className="w-full text-[11px] text-slate-400">
              단가·기본 대상을 더 손보려면 화면 위의 <b>[📚 학비외 항목]</b> 에서 고칠 수 있습니다.
            </span>
          </div>
        )}
      </div>

      {/* ── 요약 ─────────────────────────────────────────────────── */}
      <div className="mb-2 flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2">
        <span className="text-[12px] text-slate-500">
          {view.kind === "전체" ? "전체" : `${view.value}${view.kind === "학년" ? "학년" : ""}`} <b className="text-slate-800">{rows.length}명</b>
        </span>
        <span className="text-[12px] text-slate-500">
          합계 <b className="text-base font-black tabular-nums text-slate-800">{won(grandTotal)}</b>
        </span>
        <span className={"text-[12px] " + (unissued > 0 ? "font-bold text-amber-700" : "text-slate-400")}>
          미발행 {unissued}명
        </span>
        <label className="ml-auto text-[11px] text-slate-500">
          납부 기한
          <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="ml-1 rounded-lg border border-slate-300 px-2 py-1 text-sm" />
        </label>
        <button
          onClick={() => setOrderOpen(true)}
          className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
          title="합계 줄의 개수를 발주용 목록으로 뽑습니다"
        >
          📦 발주 목록
        </button>
        <button
          onClick={openReview}
          disabled={busy || checked.size === 0}
          className="rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-40"
        >
          {busy ? "…" : `🧾 고른 ${checked.size}명 ${cat === "전체" ? "발행" : `${cat} 발행`}`}
        </button>
      </div>

      {/* 대상이 안 맞아 감춘 열이 있으면 말해줍니다.
          말없이 감추면 "만든 항목이 표에 없다" 가 되고, 사람은 항목을 또 만듭니다. */}
      {hiddenByTarget > 0 && (
        <p className="mb-2 text-[11px] text-slate-500">
          이 명단과 대상이 다른 항목 <b>{hiddenByTarget}개</b>는 열로 세우지 않았습니다.{" "}
          <button onClick={() => setShowOffTarget(true)} className="font-semibold text-teal-700 underline">
            그래도 보기
          </button>
        </p>
      )}
      {showOffTarget && (
        <p className="mb-2 text-[11px] text-amber-700">
          대상이 다른 항목까지 보고 있습니다 — 표가 가로로 길어집니다.{" "}
          <button onClick={() => setShowOffTarget(false)} className="font-semibold underline">
            다시 감추기
          </button>
        </p>
      )}

      {/* ── 중복 청구서 ─────────────────────────────────────────────
          한 아이에게 같은 분류로 두 장이 나가면 청구액이 두 배로 잡힙니다. 미수금이 부풀고
          학부모에게는 두 장이 갑니다. 표 안의 «외 1장»은 너무 작아서 아무도 못 봤습니다. */}
      {dupInvoices.length > 0 && (
        <div className="mb-3 rounded-xl border-2 border-rose-300 bg-rose-50 p-3">
          <p className="mb-1.5 text-[13px] font-bold text-rose-900">
            ⚠️ 같은 학생에게 두 장 이상 나간 청구서 {dupInvoices.length}건
          </p>
          <p className="mb-2 text-[11px] leading-relaxed text-rose-800">
            그대로 두면 <b>청구액이 두 배로 잡힙니다.</b> 남길 한 장을 빼고 나머지를 취소해 주세요 — 지우지 않고 취소로
            남으므로 나중에 무엇을 왜 내렸는지 볼 수 있습니다.
          </p>
          <ul className="flex flex-col gap-1.5">
            {dupInvoices.map((d) => (
              <li key={`${d.studentName}-${d.category}`} className="rounded-lg bg-white p-2">
                <p className="mb-1 text-[12px] font-bold text-slate-800">
                  {d.studentName} <span className="font-normal text-slate-500">· {d.category}</span>
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {d.list.map((v, idx) => (
                    <span key={v.id} className="flex items-center gap-1 rounded-lg border border-slate-200 px-1.5 py-0.5 text-[11px]">
                      <b className="tabular-nums text-slate-700">{won(Number(v.total_amount))}</b>
                      <span className="text-slate-400">{v.invoice_no}</span>
                      {idx === 0 && (
                        <span className="rounded bg-rose-100 px-1 text-[10px] font-bold text-rose-700" title="금액이 가장 큰 청구서">
                          최고액
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={() => {
                          setCancelling({ invoice: v, studentName: d.studentName, reason: "중복 발행" });
                        }}
                        className="rounded bg-rose-600 px-1.5 py-0.5 text-[10px] font-bold text-white hover:bg-rose-700"
                        title="이 청구서를 취소합니다"
                      >
                        취소
                      </button>
                    </span>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ── 표 ───────────────────────────────────────────────────── */}
      {/* **가로만** 스크롤합니다. 세로는 페이지째 내려갑니다.

          가로 스크롤 상자를 만들면 안쪽의 sticky 는 창이 아니라 이 상자를 기준으로 붙습니다.
          그래서 머리줄은 아래로 내려갈 때 따라오지 못하고, 대신 **왼쪽 학생 이름 칸**(sticky
          left-0)이 옆으로 밀 때 그대로 남습니다. 옆으로 스무 칸을 밀어도 누구 줄인지 보이는
          것이, 세로로 내릴 때 항목 이름이 보이는 것보다 중요합니다 - 금액을 잘못 넣는 사고는
          «어느 학생인지» 놓칠 때 납니다. */}
      {/* 잡아서 밀 수 있습니다(`DragScroll`). 스크롤 막대는 가만히 있으면 숨는데, 열이
          스무 개 넘는 이 표에서는 그 막대가 «오른쪽에 더 있다»는 유일한 표시입니다.
          `g-scroll-x` 로 늘 보이게 하고, 마우스만 쓰는 자리를 위해 밀기도 붙입니다. */}
      <DragScroll className="g-scroll-x w-full min-w-0 max-w-full overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="min-w-full border-collapse text-left text-[12px]">
          <thead className="sticky top-0 z-20">
            {/* 분류 줄 — 열이 많아지면 무엇끼리 묶인 것인지 보여야 합니다. */}
            <tr>
              {/* 왼쪽 고정 칸이 셋(체크·학생·인보이스)입니다. 둘로 세면 분류 이름이 한 칸씩
                  왼쪽으로 밀려, 「교복」 위에 앞 분류 이름이 앉습니다. */}
              <th className="sticky left-0 z-30 border-b border-r border-slate-200 bg-slate-100 px-2 py-1" colSpan={3} />
              {cats.map((c) => (
                <th
                  key={c}
                  colSpan={usedItems.filter((i) => i.category === c).length}
                  className="border-b border-r border-slate-200 bg-slate-100 px-2 py-1 text-center text-[10px] font-bold text-slate-500"
                >
                  {c}
                </th>
              ))}
              <th className="border-b border-slate-200 bg-slate-100 px-2 py-1" />
            </tr>
            <tr>
              <th
                className="sticky left-0 z-30 border-b border-slate-200 bg-white px-2 py-1.5"
                style={{ width: W_CHECK, minWidth: W_CHECK, maxWidth: W_CHECK }}
              >
                <input
                  type="checkbox"
                  checked={rows.length > 0 && rows.every((s) => checked.has(s.id))}
                  onChange={(e) => setChecked(e.target.checked ? new Set(rows.map((s) => s.id)) : new Set())}
                  title="전부 고르기"
                />
              </th>
              <th
                className="sticky z-30 overflow-hidden border-b border-r border-slate-200 bg-white px-2 py-1.5 font-semibold text-slate-600"
                style={{ left: W_CHECK, width: W_NAME, minWidth: W_NAME, maxWidth: W_NAME }}
              >
                학생
              </th>
              {/* 인보이스를 **이름 바로 옆**에 둡니다.
                  맨 뒤에 있으면 항목이 늘수록 오른쪽으로 밀려, 누가 발행됐는지 보려고
                  매번 표를 끝까지 밀어야 했습니다. 발행 여부는 항목보다 먼저 보는 것입니다. */}
              <th
                className="sticky z-30 min-w-[150px] whitespace-nowrap border-b border-r-2 border-slate-300 bg-white px-2 py-1.5 font-semibold text-slate-600"
                style={{ left: LEFT_INVOICE }}
              >
                인보이스
              </th>
              {usedItems.map((i) => (
                <th
                  key={i.id}
                  draggable
                  onDragStart={(e) => {
                    setDragItem(i.id);
                    e.dataTransfer.effectAllowed = "move";
                    e.dataTransfer.setData("text/plain", i.id);
                  }}
                  onDragEnd={() => {
                    setDragItem(null);
                    setOverItem(null);
                  }}
                  onDragOver={(e) => {
                    if (!dragItem || dragItem === i.id) return;
                    e.preventDefault();
                    e.dataTransfer.dropEffect = "move";
                    setOverItem(i.id);
                  }}
                  onDragLeave={() => setOverItem((o) => (o === i.id ? null : o))}
                  onDrop={(e) => {
                    e.preventDefault();
                    void moveItemColumn(i.id);
                  }}
                  title="제목을 끌어서 열 순서를 옮깁니다"
                  className={
                    "min-w-[86px] cursor-grab border-b border-r border-slate-100 bg-white px-1 py-1.5 align-bottom " +
                    (overItem === i.id ? "!bg-teal-50 outline outline-2 outline-teal-400 " : "") +
                    (dragItem === i.id ? "opacity-40 " : "")
                  }
                >
                  <span className="block truncate text-[11px] font-semibold text-slate-700" title={`${i.name}${i.name_ko ? ` · ${i.name_ko}` : ""}`}>
                    <span className="mr-0.5 select-none text-slate-300">⠿</span>
                    {i.name_ko || i.name}
                  </span>
                  {/* 대상을 이름 아래 뱃지로. 이것이 있으면 이름에 `4학년` 을 적을 이유가
                      없어집니다 - 인보이스에 찍히는 이름이 깨끗해집니다. */}
                  <span
                    className={
                      "block truncate text-[9px] font-bold " +
                      (targetLabel(i) === "개별 지정" ? "text-slate-300" : i.auto_apply === false ? "text-amber-600" : "text-teal-600")
                    }
                    title={
                      i.auto_apply === false
                        ? `대상: ${targetLabel(i)} — 자동으로 안 붙습니다. 살 아이만 체크하세요`
                        : `대상: ${targetLabel(i)} — 전원에게 자동으로 붙습니다`
                    }
                  >
                    {/* 자동으로 안 붙는 항목은 별표를 답니다.
                        열은 서 있는데 아무 칸도 안 차 있으면 "왜 비어 있지" 가 되는데,
                        비어 있는 것이 맞다는 표시가 필요합니다. */}
                    {targetLabel(i)}
                    {i.auto_apply === false && " ✱"}
                  </span>
                  <span className="block text-[10px] tabular-nums text-slate-400">{won(Number(i.unit_price))}</span>
                  {/* 열 하나를 명단 전원에게. 반 단위로 교재를 붙이는 일이 가장 잦습니다. */}
                  <span className="mt-0.5 flex gap-0.5">
                    <button
                      onClick={() => void fillColumn(i, true)}
                      disabled={busy}
                      className="flex-1 rounded bg-teal-50 text-[9px] font-bold text-teal-700 hover:bg-teal-100 disabled:opacity-40"
                      title={`보이는 ${rows.length}명 전원에게 넣기`}
                    >
                      전체 +
                    </button>
                    <button
                      onClick={() => void fillColumn(i, false)}
                      disabled={busy}
                      className="flex-1 rounded bg-slate-50 text-[9px] font-bold text-slate-500 hover:bg-slate-100 disabled:opacity-40"
                      title={`보이는 ${rows.length}명에게서 빼기`}
                    >
                      −
                    </button>
                  </span>
                </th>
              ))}
              <th className="min-w-[92px] border-b border-l border-slate-200 bg-white px-2 py-1.5 text-right font-semibold text-slate-600">
                합계
              </th>
            </tr>
          </thead>

          <tbody>
            {rows.map((s) => {
              const total = totalOf(s.id);
              const inv = invoiceByStudent.get(s.id);
              const on = checked.has(s.id);
              return (
                <tr key={s.id} className={on ? "bg-teal-50/40" : "hover:bg-slate-50/60"}>
                  <td
                    className={"sticky left-0 z-10 border-b border-slate-100 px-2 py-1 " + (on ? "bg-teal-50" : "bg-white")}
                    style={{ width: W_CHECK, minWidth: W_CHECK, maxWidth: W_CHECK }}
                  >
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={(e) =>
                        setChecked((p) => {
                          const n = new Set(p);
                          if (e.target.checked) n.add(s.id);
                          else n.delete(s.id);
                          return n;
                        })
                      }
                    />
                  </td>
                  <td
                    className={
                      "sticky z-10 overflow-hidden whitespace-nowrap border-b border-r border-slate-200 px-2 py-1 " +
                      (on ? "bg-teal-50" : "bg-white")
                    }
                    style={{ left: W_CHECK, width: W_NAME, minWidth: W_NAME, maxWidth: W_NAME }}
                  >
                    {/* 이름을 누르면 그 아이만 크게 봅니다. 표는 훑기에 좋고, 한 아이를
                        꼼꼼히 고를 때는 좁습니다. */}
                    <button
                      type="button"
                      onClick={() => setDetail(s)}
                      className="text-left font-semibold text-slate-800 underline decoration-slate-300 decoration-dotted underline-offset-2 hover:decoration-slate-600"
                      title="눌러서 이 학생의 항목을 자세히 고릅니다"
                    >
                      {s.name}
                    </button>
                    <span className="ml-1 text-[10px] text-slate-400">
                      {[s.grade ? `${s.grade}` : null, s.className].filter(Boolean).join(" ")}
                    </span>
                  </td>

                  <td
                    className={
                      "sticky z-10 whitespace-nowrap border-b border-r-2 border-slate-300 px-2 py-1 " +
                      (on ? "bg-teal-50" : "bg-white")
                    }
                    style={{ left: LEFT_INVOICE }}
                  >
                    {inv ? (
                      <span className="flex items-center gap-1">
                      <button
                        onClick={() => setPreview({ id: inv.id, label: `${s.name} · ${inv.invoice_no}${inv.category ? ` · ${inv.category}` : ""}` })}
                        className="text-[11px] font-bold text-emerald-700 underline"
                        title="여기서 바로 보기"
                      >
                        {inv.invoice_no}
                      </button>
                      {/* 통합인지 어느 분류인지 보여야 합니다. 번호만 보고는 이 청구서에
                          교복이 들어 있는지 알 수 없습니다. */}
                      <span className="rounded bg-slate-100 px-1 text-[10px] font-bold text-slate-600">
                        {inv.category ?? "통합"}
                      </span>
                      {(invoicesByStudent.get(s.id)?.length ?? 0) > 1 && (
                        <span className="text-[10px] font-semibold text-slate-400" title="이 학생의 이번 학기 청구서 수">
                          외 {(invoicesByStudent.get(s.id)?.length ?? 1) - 1}장
                        </span>
                      )}
                      {/* 발행과 발송은 다릅니다. 종이를 만든 것과 학부모에게 청구가 간 것을
                          같은 표시로 두면, 발행만 해놓고 안 보낸 것을 아무도 모릅니다. */}
                      {inv.exported_at ? (
                        <span className="rounded bg-emerald-100 px-1 text-[10px] font-bold text-emerald-800" title="올톡페이 발송 파일로 내보냈습니다">
                          보냄
                        </span>
                      ) : (
                        <span className="rounded bg-amber-100 px-1 text-[10px] font-bold text-amber-800" title="아직 올톡페이로 청구하지 않았습니다">
                          미발송
                        </span>
                      )}
                      {/* 받았는가. 보낸 것만 보이고 받은 것이 안 보이면, 목록만 보고는
                          누가 냈는지 알 수 없어 결국 수납 화면을 따로 열게 됩니다. */}
                      {(() => {
                        const st = settle(inv as unknown as SettleInvoice, payments, today);
                        if (st.state === "완납") {
                          return (
                            <span className="rounded bg-emerald-600 px-1 text-[10px] font-bold text-white" title={`${won(st.paid)} 받음`}>
                              완납
                            </span>
                          );
                        }
                        if (st.state === "이월됨") {
                          return (
                            <span className="rounded bg-slate-200 px-1 text-[10px] font-bold text-slate-600" title="미납이 다음 청구서로 넘어갔습니다">
                              이월됨
                            </span>
                          );
                        }
                        if (st.state === "취소") return null;
                        return (
                          <button
                            onClick={() =>
                              setPayFor({ id: inv.id, label: `${s.name} · ${inv.invoice_no}`, balance: st.balance })
                            }
                            className={
                              "rounded px-1 text-[10px] font-bold text-white " +
                              (st.state === "연체" ? "bg-rose-600" : st.state === "부분납부" ? "bg-amber-600" : "bg-slate-500")
                            }
                            title={`남은 ${won(st.balance)} — 눌러서 결제완료`}
                          >
                            {st.state === "부분납부" ? `일부 · 남은 ${won(st.balance)}` : st.state === "연체" ? "연체" : "미납"}
                          </button>
                        );
                      })()}
                      {/* 현금영수증. 청구서를 보내드리면 그 답장에 「해주세요, 번호는 …」이
                          함께 옵니다. 받는 자리가 다른 화면에 있으면 그 순간에 못 적습니다. */}
                      <ReceiptChip
                        receipt={receiptByInvoice.get(inv.id)}
                        onClick={() => setReceiptFor({ invoice: inv, studentName: s.name })}
                      />
                      {/* 발행하고 나서 고칠 일이 생깁니다. 지우지 않고 취소로 남깁니다. */}
                      <button
                        onClick={() => {
                          setCancelling({ invoice: inv, studentName: s.name });
                        }}
                        className="text-[11px] font-bold text-slate-300 hover:text-rose-600"
                        title="발행 취소 (지우지 않고 취소로 남깁니다)"
                      >
                        ↩
                      </button>
                      </span>
                    ) : total > 0 ? (
                      // 한 명만 발행하는 일이 잦습니다(뒤늦게 등록한 아이, 항목을 고친 아이).
                      // 그때마다 체크 → 위로 올라가 [발행]을 누르는 것은 두 걸음이 더 듭니다.
                      // **검토 창은 그대로 거칩니다** - 발행은 되돌릴 수 없고, 그 창이
                      // 「이 아이만 금액이 다르다」를 짚어주는 자리입니다.
                      <span className="flex items-center gap-1">
                        <span className="text-[11px] font-semibold text-amber-600">미발행</span>
                        <button
                          onClick={() => setReview([s])}
                          disabled={busy}
                          className="rounded bg-amber-100 px-1 text-[11px] font-bold text-amber-800 hover:bg-amber-200 disabled:opacity-40"
                          title={`${s.name} 한 명만 지금 발행합니다 (${won(total)})`}
                        >
                          발행 →
                        </button>
                        {/* 이미 받은 건. 교복·교재는 올톡페이로 항목마다 따로 결제되어서,
                            「교복은 냈고 교재는 안 냈다」가 흔합니다. 학비에만 있던 자리를
                            여기에도 둡니다 - 오히려 여기가 더 자주 쓰입니다. */}
                        <button
                          onClick={() => setAlreadyFor(s)}
                          disabled={busy}
                          className="rounded bg-emerald-100 px-1 text-[11px] font-bold text-emerald-800 hover:bg-emerald-200 disabled:opacity-40"
                          title={`${s.name} — 이미 받은 돈으로 넣습니다 (청구서는 만들되 안 보냄)`}
                        >
                          💰
                        </button>
                      </span>
                    ) : (
                      <span className="text-[11px] text-slate-300">—</span>
                    )}
                  </td>

                  {usedItems.map((i) => {
                    const l = lineFor(s.id, i.id);
                    const ov = overrides.find((o) => o.student_id === s.id && o.item_id === i.id) ?? null;
                    return (
                      <td
                        key={i.id}
                        className={
                          "border-b border-r border-slate-100 p-0 text-center " + (l ? "bg-teal-50/70" : "")
                        }
                      >
                        {/* 표에서는 **바꾸지 않습니다.**
                            칸이 작고 촘촘해서 훑다가 옆 칸을 눌러도 알아채지 못했습니다. 항목이
                            빠지거나 붙은 것을 나중에 청구서에서 발견하게 되는 자리였습니다.
                            누르면 그 학생 창이 열리고, 고치는 것은 거기서만 합니다 - 창에는
                            이름·금액·수량이 함께 있어 무엇을 바꾸는지 보입니다. */}
                        <button
                          onClick={() => setDetail(s)}
                          className="flex h-8 w-full items-center justify-center gap-1"
                          title={
                            (l
                              ? `${i.name} · ${won(l.amount)}${ov ? (ov.mode === "include" ? " · 직접 넣음" : "") : " · 기본"}`
                              : `${i.name} · 없음`) + " — 눌러서 이 학생 창에서 고칩니다"
                          }
                        >
                          {l ? (
                            <>
                              <span className="text-[13px] font-black text-teal-700">✓</span>
                              {l.qty > 1 && <span className="text-[10px] font-bold text-teal-700">×{l.qty}</span>}
                              {/* 사람이 따로 넣은 것은 점 하나로 구분합니다. 기본 세트와 섞이면
                                  "왜 이게 여기 있지"를 매번 묻게 됩니다. */}
                              {ov?.mode === "include" && <span className="text-[8px] text-amber-600">●</span>}
                            </>
                          ) : (
                            <span className="text-[11px] text-slate-200">·</span>
                          )}
                        </button>
                      </td>
                    );
                  })}

                  <td className="border-b border-l border-slate-200 px-2 py-1 text-right">
                    <span className={"font-bold tabular-nums " + (total > 0 ? "text-slate-800" : "text-slate-300")}>
                      {total > 0 ? won(total) : "—"}
                    </span>
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={usedItems.length + 4} className="px-3 py-12 text-center text-sm text-slate-400">
                  학생이 없습니다.
                </td>
              </tr>
            )}
          </tbody>

          {/* 합계 줄 — 열을 보면 그 항목이 몇 명·얼마인지 압니다. 발주할 때 이 숫자를 씁니다. */}
          <tfoot className="sticky bottom-0 z-20">
            <tr>
              {/* 왼쪽 고정 칸 셋을 함께 덮습니다. 둘로 세면 아래 숫자들이 한 칸씩 밀려,
                  마지막 항목 열 밑에 총합이 앉습니다. */}
              <td className="sticky left-0 z-30 border-t-2 border-slate-300 bg-slate-100 px-2 py-1.5" colSpan={3}>
                <span className="text-[11px] font-bold text-slate-600">합계 · {rows.length}명</span>
                <span className="ml-2 text-[11px] text-slate-500">미발행 {unissued}</span>
              </td>
              {usedItems.map((i) => {
                const c = colSummary.get(i.id);
                return (
                  <td key={i.id} className="border-t-2 border-r border-slate-300 bg-slate-100 px-1 py-1.5 text-center">
                    {c ? (
                      <>
                        <span className="block text-[11px] font-bold text-slate-700">{c.qty}개</span>
                        <span className="block text-[10px] tabular-nums text-slate-500">{won(c.amount)}</span>
                      </>
                    ) : (
                      <span className="text-[11px] text-slate-300">—</span>
                    )}
                  </td>
                );
              })}
              <td className="border-t-2 border-l border-slate-300 bg-slate-100 px-2 py-1.5 text-right">
                <span className="text-[13px] font-black tabular-nums text-slate-800">{won(grandTotal)}</span>
              </td>
            </tr>
          </tfoot>
        </table>
      </DragScroll>

      {/* ── 발행 전 검토 ────────────────────────────────────────── */}
      {alreadyFor && (
        <AlreadyPaidModal
          title="이미 받은 학비외 청구 등록"
          studentName={alreadyFor.name}
          // 항목마다 금액을 함께 넘깁니다. 올톡페이는 항목별로 결제 문자가 나가서,
          // 「교복만 결제됨」을 그 자리에서 체크할 수 있어야 합니다.
          lines={(linesByStudent.get(alreadyFor.id) ?? []).map((l) => {
            // 이미 청구서에 담긴 항목은 **다시 고를 수 없게** 잠급니다. 고를 수 있게 두면
            // 같은 항목이 두 장에 담기고, 학부모 화면에는 낼 돈이 두 배로 뜹니다.
            const mark = billed.get(alreadyFor.id)?.get(l.item.name);
            return {
              id: l.item.id,
              label: l.item.name_ko?.trim() || l.item.name,
              amount: Number(l.amount ?? 0),
              lockedNote: mark ? BILL_LABEL[mark.state] : null,
            };
          })}
          busy={busy}
          onClose={() => setAlreadyFor(null)}
          onSubmit={(r) => void recordAlreadyPaid(alreadyFor, r)}
        />
      )}

      {review && (
        <div className="fixed inset-0 z-[999] flex items-center justify-center bg-black/40 p-4" onClick={() => !busy && setReview(null)}>
          <div className="flex max-h-[80vh] w-full max-w-2xl flex-col rounded-xl bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="border-b border-slate-100 p-3">
              <p className="text-sm font-bold text-slate-800">발행 전 확인</p>
              <p className="mt-0.5 text-[12px] text-slate-500">
                {review.length}명 · 합계{" "}
                <b className="text-slate-800">{won(review.reduce((n, s) => n + totalOf(s.id), 0))}</b> · 납부 기한 {dueDate}
              </p>
              {(() => {
                const odd = review.filter((s) => unusual(s) != null);
                return odd.length > 0 ? (
                  <p className="mt-2 rounded-lg bg-amber-50 px-2 py-1.5 text-[12px] leading-relaxed text-amber-800">
                    ⚠️ <b>{odd.length}명</b>의 금액이 같은 반 아이들과 다릅니다. 아래에서 확인해주세요 — 맞는 경우도
                    많지만(악기·수리), 빠뜨린 것도 이 자리에서 드러납니다.
                  </p>
                ) : null;
              })()}

              {/* 한 장으로 묶을지, 분류마다 나눌지.
                  통합은 학부모가 한 번만 결제합니다. 분류별은 교재비를 먼저 보내고 교복은
                  치수를 잰 뒤에 보낼 수 있습니다 - 한 장으로 묶으면 늦은 쪽 때문에 이른 쪽까지
                  못 나갑니다. 분류 탭을 고른 상태라면 고를 것이 없습니다(그 분류만 나갑니다). */}
              {cat === "전체" && catTabs.length > 1 && (
                <div className="mt-2 flex flex-wrap items-center gap-1.5 rounded-lg bg-slate-50 px-2 py-1.5">
                  <span className="text-[11px] font-bold text-slate-500">어떻게 발행할까요</span>
                  {(["통합", "분류별"] as IssueMode[]).map((m) => (
                    <button
                      key={m}
                      onClick={() => setIssueMode(m)}
                      className={
                        "rounded-full px-2.5 py-1 text-[12px] font-bold transition-colors " +
                        (issueMode === m ? "bg-slate-800 text-white" : "bg-white text-slate-500 ring-1 ring-slate-200 hover:text-slate-800")
                      }
                    >
                      {m === "통합" ? "한 장에 전부" : "분류마다 따로"}
                    </button>
                  ))}
                  <span className="text-[11px] text-slate-500">
                    {issueMode === "통합"
                      ? `학생당 한 장 · 모두 ${planFor(review, "통합").length}장`
                      : `분류마다 한 장씩 · 모두 ${planFor(review, "분류별").length}장`}
                  </span>
                </div>
              )}
              {cat !== "전체" && (
                <p className="mt-2 rounded-lg bg-teal-50 px-2 py-1.5 text-[12px] font-semibold text-teal-800">
                  <b>{cat}</b> 항목만 담은 청구서가 나갑니다. 다른 분류는 이 청구서에 들어가지 않습니다.
                </p>
              )}
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-2">
              <table className="w-full text-left text-[12px]">
                <thead className="text-[11px] text-slate-400">
                  <tr>
                    <th className="px-2 py-1">학생</th>
                    <th className="px-2 py-1">항목</th>
                    <th className="px-2 py-1 text-right">금액</th>
                  </tr>
                </thead>
                <tbody>
                  {review.map((s) => {
                    const typical = unusual(s);
                    const ls = linesByStudent.get(s.id) ?? [];
                    return (
                      <tr key={s.id} className={"border-t border-slate-100 " + (typical != null ? "bg-amber-50/60" : "")}>
                        <td className="px-2 py-1.5 align-top">
                          <span className="font-semibold text-slate-800">{s.name}</span>
                          <span className="ml-1 text-[10px] text-slate-400">{s.className}</span>
                          {invoiceByStudent.has(s.id) && (
                            <span className="ml-1 text-[10px] font-bold text-amber-700">이미 발행됨 — 한 장 더 나갑니다</span>
                          )}
                        </td>
                        <td className="px-2 py-1.5 text-[11px] leading-relaxed text-slate-500">
                          {ls.map((l) => `${l.item.name}${l.qty > 1 ? `×${l.qty}` : ""}`).join(" · ")}
                        </td>
                        <td className="px-2 py-1.5 text-right align-top">
                          <span className="block font-bold tabular-nums text-slate-800">{won(totalOf(s.id))}</span>
                          {typical != null && (
                            <span className="block text-[10px] font-semibold text-amber-700">평소 {won(typical)}</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="flex items-center gap-2 border-t border-slate-100 p-3">
              <button onClick={() => setReview(null)} disabled={busy} className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-600">
                돌아가기
              </button>
              <button
                onClick={() => void issueChecked()}
                disabled={busy}
                className="ml-auto rounded-lg bg-slate-800 px-4 py-2 text-sm font-bold text-white disabled:opacity-40"
              >
                {busy
                  ? "발행 중…"
                  : `${review.length}명 · ${planFor(review, issueMode).length}장 발행${cat === "전체" ? "" : ` (${cat})`}`}
              </button>
            </div>
          </div>
        </div>
      )}

      {preview && <InvoicePreviewModal invoiceId={preview.id} label={preview.label} onClose={() => setPreview(null)} />}

      {/* 발행 취소 창은 학비 화면과 **같은 것**을 씁니다. 화면마다 따로 만들면 한쪽에만
          경고가 붙고, 빠진 쪽에서 사고가 납니다. */}
      {cancelling && (
        <CancelInvoiceModal
          invoice={cancelling.invoice}
          studentName={cancelling.studentName}
          defaultReason={cancelling.reason ?? ""}
          onDone={(done) => {
            setInvoices((p) => p.map((v) => (v.id === done.id ? done : v)));
            setJustIssued((p) => p.filter((v) => v.id !== done.id));
          }}
          onClose={() => setCancelling(null)}
        />
      )}

      {reconcileOpen && (
        <ReconcileModal
          students={reconcileStudents}
          onClose={() => setReconcileOpen(false)}
          onOpenStudent={(id) => {
            const s = students.find((x) => x.id === id);
            if (!s) return;
            // 그 아이가 다른 부서·다른 반에 있어도 창은 열려야 합니다. 대조 결과에서 이름을
            // 눌렀는데 아무 일도 안 일어나면 고치러 갈 방법이 없습니다.
            setDept(deptOf(s));
            setView({ kind: "전체" });
            setReconcileOpen(false);
            setDetail(s);
          }}
        />
      )}

      {exportIds && (
        <AlltalkpayExport invoiceIds={exportIds} onClose={() => setExportIds(null)} onMarked={markExported} />
      )}

      {receiptFor && (
        <ReceiptModal
          invoice={receiptFor.invoice}
          studentName={receiptFor.studentName}
          receipt={receiptByInvoice.get(receiptFor.invoice.id)}
          currentUserName={currentUserEmail}
          onClose={() => setReceiptFor(null)}
          onSaved={(row) =>
            setReceipts((p) => {
              const i = p.findIndex((x) => x.id === row.id);
              if (i < 0) return [row, ...p];
              const n = p.slice();
              n[i] = row;
              return n;
            })
          }
        />
      )}
      {payFor && (
        <PayModal
          target={payFor}
          today={today}
          onClose={() => setPayFor(null)}
          onDone={async (msg) => {
            notify(msg, "success");
            const supabase = createClient();
            const { data } = await supabase.from("payments").select("invoice_id, amount, paid_at, method_kind");
            if (data) setPayments(data as PayLite[]);
          }}
        />
      )}

      {/* ── 한 학생 자세히 ─────────────────────────────────────── */}
      {detail && (() => {
        // 표와 같은 분류만 보여줍니다. 교재를 붙이려고 연 창에 교복이 함께 있으면
        // 실수로 눌러도 알아채기 어렵습니다.
        const dLines = resolveStudentItems(scopedItems, detail as StudentLike, overrides);
        const dTotal = sumLines(dLines);
        const dInv = invoiceByStudent.get(detail.id);
        const byCat = new Map<string, FeeItem[]>();
        for (const i of scopedItems) byCat.set(i.category, [...(byCat.get(i.category) ?? []), i]);
        return (
          <div className="fixed inset-0 z-[999] flex items-center justify-center bg-black/40 p-4" onClick={() => setDetail(null)}>
            <div className="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-xl bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
              <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 p-3">
                <span className="text-base font-black text-slate-800">{detail.name}</span>
                {detail.nameEn && <span className="text-[12px] text-slate-400">{detail.nameEn}</span>}
                <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-semibold text-slate-600">
                  {[detail.grade ? `${detail.grade}학년` : null, detail.className].filter(Boolean).join(" ")}
                </span>
                {dInv && (
                  <button
                    onClick={() => setPreview({ id: dInv.id, label: `${detail.name} · ${dInv.invoice_no}${dInv.category ? ` · ${dInv.category}` : ""}` })}
                    className="text-[11px] font-bold text-emerald-700 underline"
                  >
                    {dInv.invoice_no}{dInv.category ? ` · ${dInv.category}` : " · 통합"} 보기
                  </button>
                )}
                {dInv && (
                  <button
                    onClick={() => {
                      setCancelling({ invoice: dInv, studentName: detail.name });
                      setDetail(null);
                    }}
                    className="text-[11px] font-semibold text-rose-600 underline"
                    title="발행 취소 (지우지 않고 취소로 남깁니다)"
                  >
                    발행 취소
                  </button>
                )}
                <a
                  href={`/students/${detail.id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[11px] font-semibold text-slate-500 underline"
                >
                  명부 열기 ↗
                </a>
                <button onClick={() => setDetail(null)} className="ml-auto text-sm font-bold text-slate-400 hover:text-slate-700">
                  ✕
                </button>
              </div>

              {/* 명부에서 그대로 가져온 값입니다. 청구서는 이 연락처로 나갑니다 - 비어 있으면
                  발행은 되는데 발송에서 조용히 빠지므로, 고르기 전에 먼저 보입니다. */}
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-slate-100 bg-slate-50 px-3 py-1.5 text-[11px]">
                {detail.studentNo && <span className="text-slate-500">학번 {detail.studentNo}</span>}
                {/* 청구서는 **어머니 → 아버지 → 보호자** 순으로 있는 번호로 나갑니다.
                    여기서 바로 고칠 수 있어야 합니다 - 발행하려다 번호가 없는 것을 알게 되는데,
                    그때 명부 화면으로 건너갔다 오면 하던 일을 놓칩니다. */}
                {(
                  [
                    ["motherPhone", "어머니"],
                    ["fatherPhone", "아버지"],
                    ["parentPhone", "보호자"],
                  ] as ["motherPhone" | "fatherPhone" | "parentPhone", string][]
                ).map(([key, label]) => {
                  const raw = (detail[key] as string | null) ?? "";
                  const first = key === "motherPhone" ? true : key === "fatherPhone" ? !detail.motherPhone : !detail.motherPhone && !detail.fatherPhone;
                  return (
                    <span key={key} className="flex items-center gap-1">
                      <span className={"text-[10px] font-bold " + (raw && first ? "text-teal-700" : "text-slate-400")}>
                        {label}
                        {raw && first && " ●"}
                      </span>
                      <input
                        defaultValue={raw}
                        onBlur={(e) => void savePhone(detail, key, e.target.value)}
                        placeholder="010-"
                        className="w-28 rounded border border-slate-200 px-1 py-0.5 text-[11px] tabular-nums"
                      />
                    </span>
                  );
                })}
                {!detail.motherPhone && !detail.fatherPhone && !detail.parentPhone && !detail.billingPhone && (
                  <span className="font-bold text-orange-700">연락처가 없어 청구서가 못 나갑니다</span>
                )}
                {detail.instrument && (
                  <span className="rounded bg-violet-100 px-1.5 py-0.5 font-semibold text-violet-800">명부 악기 · {detail.instrument}</span>
                )}
              </div>

              {/* ── 결제번호 ─────────────────────────────────────────────────────
                  예전에는 청구서를 **발행할 때마다** 셋 중 하나를 골랐습니다. 그래서 같은
                  아이의 청구서가 이번 달은 어머니에게, 다음 달은 아버지에게 갔습니다. 어느
                  쪽도 틀린 번호가 아니라서 화면에는 오류로 안 보이고, 학부모가 「저는 못
                  받았는데요」라고 말해야 드러납니다.

                  그래서 **아이마다 한 번 정해 둡니다.** 결제만 담당하는 분이 따로 계신 집도
                  있어서, 셋 중에 없으면 새로 등록할 수 있게 둡니다. */}
              <div className="flex flex-wrap items-center gap-1.5 border-b border-teal-100 bg-teal-50/60 px-3 py-1.5 text-[11px]">
                <span className="font-bold text-teal-800">💳 결제번호</span>
                {(
                  [
                    ["mother", "어머니", detail.motherPhone],
                    ["father", "아버지", detail.fatherPhone],
                    ["guardian", "보호자", detail.parentPhone],
                  ] as [string, string, string | null][]
                ).map(([role, label, phone]) => (
                  <button
                    key={role}
                    type="button"
                    // 번호가 없는 대상은 고를 수 없습니다. 고르게 두면 그 아이만 청구서가
                    // 조용히 안 나갑니다.
                    disabled={!phone?.trim()}
                    onClick={() => void saveBilling(detail, role)}
                    title={phone?.trim() ? phone : "이 칸에 번호가 없습니다"}
                    className={
                      "rounded px-1.5 py-0.5 font-semibold transition " +
                      (detail.billingRole === role
                        ? "bg-teal-600 text-white"
                        : phone?.trim()
                        ? "bg-white text-teal-700 ring-1 ring-teal-200 hover:bg-teal-100"
                        : "bg-slate-100 text-slate-300")
                    }
                  >
                    {label}
                  </button>
                ))}
                <span className="text-slate-300">|</span>
                {/* 명부 셋 중 아무도 아닌 번호. 여기가 원본이므로 번호 자체를 저장합니다. */}
                {/* **등록 단추를 따로 둡니다.** 예전에는 칸을 벗어날 때만(onBlur) 저장해서,
                    번호를 치고 엔터를 누르거나 창을 닫으면 그대로 사라졌습니다 - 사람은 적었다고
                    생각하는데 아무 일도 안 일어났습니다. 엔터와 단추 둘 다로 저장합니다. */}
                <input
                  defaultValue={detail.billingRole === "direct" ? detail.billingPhone ?? "" : ""}
                  key={detail.id + (detail.billingRole ?? "") + (detail.billingPhone ?? "")}
                  id={`billing-direct-${detail.id}`}
                  onKeyDown={(e) => {
                    if (e.key !== "Enter") return;
                    e.preventDefault();
                    const v = (e.target as HTMLInputElement).value.trim();
                    if (v) void saveBilling(detail, "direct", v);
                  }}
                  onBlur={(e) => {
                    const v = e.target.value.trim();
                    if (!v) return;
                    if (detail.billingRole === "direct" && v === (detail.billingPhone ?? "")) return;
                    void saveBilling(detail, "direct", v);
                  }}
                  placeholder="새 번호 직접 등록"
                  className={
                    "w-32 rounded border px-1 py-0.5 text-[11px] tabular-nums " +
                    (detail.billingRole === "direct" ? "border-teal-500 bg-white font-bold" : "border-slate-200")
                  }
                />
                <button
                  type="button"
                  onClick={() => {
                    const el = document.getElementById(`billing-direct-${detail.id}`) as HTMLInputElement | null;
                    const v = (el?.value ?? "").trim();
                    if (!v) {
                      notify("새로 등록할 번호를 적어주세요.", "error");
                      return;
                    }
                    void saveBilling(detail, "direct", v);
                  }}
                  className="rounded bg-teal-600 px-1.5 py-0.5 text-[11px] font-bold text-white hover:bg-teal-700"
                >
                  등록
                </button>
                {detail.billingRole ? (
                  <button
                    type="button"
                    onClick={() => void saveBilling(detail, null)}
                    className="rounded px-1 text-[10px] text-slate-400 hover:text-rose-600"
                    title="정한 것을 지우면 어머니 → 아버지 → 보호자 순으로 나갑니다"
                  >
                    ✕ 지정 해제
                  </button>
                ) : (
                  // **안 정했다는 사실이 보여야** 정합니다. 지금까지는 안 정한 것과 어머니로
                  // 정한 것이 화면에서 똑같아 보였습니다.
                  <span className="text-[10px] font-medium text-orange-600">
                    아직 안 정함 — 어머니 → 아버지 → 보호자 순으로 나갑니다
                  </span>
                )}
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto p-3">
                {scopedItems.length === 0 ? (
                  <p className="py-10 text-center text-[12px] text-slate-400">
                    {cat === "전체" ? "등록된 항목이 없습니다." : `${cat} 항목이 없습니다.`}
                  </p>
                ) : (
                  [...byCat.entries()].map(([cat, list]) => (
                    <div key={cat} className="mb-3">
                      <p className="mb-1 text-[11px] font-bold text-slate-500">{cat}</p>
                      <div className="flex flex-col gap-1">
                        {list.map((item) => {
                          const l = dLines.find((x) => x.item.id === item.id);
                          const ov = overrides.find((o) => o.student_id === detail.id && o.item_id === item.id) ?? null;
                          /**
                           * **이미 청구서에 나간 항목.**
                           *
                           * 뺄 수 없게 잠급니다. 여기서 빼도 이미 나간 종이는 안 바뀌는데,
                           * 화면에서는 「없던 일」처럼 보입니다 - 그 상태로 다시 발행하면 같은
                           * 항목이 또 담기거나(중복), 받을 돈이 목록에서 사라집니다(누락).
                           */
                          const mark = billed.get(detail.id)?.get(item.name);
                          return (
                            <div
                              key={item.id}
                              className={
                                "flex items-center gap-2 rounded-lg border px-2 py-2 " +
                                (mark
                                  ? "border-slate-200 bg-slate-100"
                                  : l
                                    ? "border-teal-300 bg-teal-50/60"
                                    : "border-slate-100")
                              }
                            >
                              <button
                                type="button"
                                disabled={!!mark}
                                onClick={() => toggleCell(detail, item)}
                                title={
                                  mark
                                    ? `이미 청구서에 나갔습니다(${BILL_LABEL[mark.state]}). 고치려면 그 청구서를 취소해주세요.`
                                    : undefined
                                }
                                className={
                                  "flex h-5 w-5 shrink-0 items-center justify-center rounded border text-[11px] font-bold disabled:cursor-not-allowed " +
                                  (mark
                                    ? "border-slate-300 bg-slate-300 text-white"
                                    : l
                                      ? "border-teal-600 bg-teal-600 text-white"
                                      : "border-slate-300 text-transparent")
                                }
                                aria-label={l ? "빼기" : "넣기"}
                              >
                                ✓
                              </button>
                              <span className="min-w-0 flex-1">
                                <span className={"text-sm " + (l ? "font-semibold text-slate-800" : "text-slate-500")}>
                                  {item.name}
                                </span>
                                {item.name_ko && <span className="ml-1.5 text-[11px] text-slate-400">{item.name_ko}</span>}
                                {l?.fromDefault && <span className="ml-1.5 text-[10px] text-teal-700">기본</span>}
                                {/* 명부에 적힌 악기와 같은 이름이면 표시해 줍니다. 악기는 아이마다 달라서
                                    이 대조가 없으면 첼로 아이에게 바이올린 대여료가 붙어도 모릅니다. */}
                                {detail.instrument && matchesInstrument(item, detail.instrument) && (
                                  <span className="ml-1.5 rounded bg-violet-100 px-1 text-[10px] font-semibold text-violet-800">명부와 같음</span>
                                )}
                                {ov && (
                                  <span className="ml-1.5 text-[10px] font-semibold text-amber-700">
                                    {ov.mode === "exclude" ? "직접 뺌" : "직접 넣음"}
                                  </span>
                                )}
                                {/* **이미 나간 것은 그 자리에서 말해줍니다.** 안 적으면 왜 못
                                    빼는지 모르고, 모르면 항목 쪽을 뒤지게 됩니다. */}
                                {mark && (
                                  <span
                                    className={
                                      "ml-1.5 rounded px-1 text-[10px] font-bold " +
                                      (mark.state === "완납"
                                        ? "bg-emerald-600 text-white"
                                        : mark.state === "일부"
                                          ? "bg-amber-500 text-white"
                                          : "bg-slate-400 text-white")
                                    }
                                  >
                                    {BILL_LABEL[mark.state]}
                                  </span>
                                )}
                              </span>
                              {l ? (
                                <span className="flex shrink-0 items-center gap-1">
                                  <input
                                    type="number"
                                    min={1}
                                    value={l.qty}
                                    onChange={(e) => void setQty(detail, item, Number(e.target.value) || 1)}
                                    className="w-12 rounded border border-slate-200 px-1 py-0.5 text-center text-[12px]"
                                    title="수량"
                                  />
                                  <span className="w-24 text-right text-[13px] font-bold tabular-nums text-slate-700">{won(l.amount)}</span>
                                </span>
                              ) : (
                                <span className="w-24 shrink-0 text-right text-[12px] tabular-nums text-slate-300">
                                  {won(Number(item.unit_price))}
                                </span>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))
                )}
              </div>

              <div className="flex flex-wrap items-center gap-3 border-t border-slate-100 bg-slate-50 p-3">
                <span className="text-[12px] font-semibold text-slate-500">{dLines.length}개 항목</span>
                <span className="text-lg font-black tabular-nums text-slate-800">{won(dTotal)}</span>
                <button
                  onClick={() => {
                    setChecked(new Set([detail.id]));
                    setDetail(null);
                    setReview([detail]);
                  }}
                  disabled={dLines.length === 0}
                  className="ml-auto rounded-lg bg-slate-800 px-4 py-2 text-sm font-bold text-white disabled:opacity-40"
                >
                  🧾 이 학생만 {cat === "전체" ? "발행" : `${cat} 발행`}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── 발주 목록 ───────────────────────────────────────────── */}
      {orderOpen && (
        <div className="fixed inset-0 z-[999] flex items-center justify-center bg-black/40 p-4" onClick={() => setOrderOpen(false)}>
          <div className="flex max-h-[80vh] w-full max-w-lg flex-col rounded-xl bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="border-b border-slate-100 p-3">
              <p className="text-sm font-bold text-slate-800">📦 발주 목록</p>
              <p className="mt-0.5 text-[12px] text-slate-500">
                {view.kind === "전체" ? "전체" : `${view.value}${view.kind === "학년" ? "학년" : ""}`} {rows.length}명 기준 ·
                이미 세어둔 숫자를 꺼낸 것뿐입니다
              </p>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-2">
              <table className="w-full text-left text-[12px]">
                <thead className="text-[11px] text-slate-400">
                  <tr>
                    <th className="px-2 py-1">분류</th>
                    <th className="px-2 py-1">항목</th>
                    <th className="px-2 py-1 text-right">수량</th>
                    <th className="px-2 py-1 text-right">금액</th>
                  </tr>
                </thead>
                <tbody>
                  {usedItems
                    .filter((i) => (colSummary.get(i.id)?.qty ?? 0) > 0)
                    .map((i) => {
                      const c = colSummary.get(i.id)!;
                      return (
                        <tr key={i.id} className="border-t border-slate-100">
                          <td className="px-2 py-1.5 text-[11px] text-slate-500">{i.category}</td>
                          <td className="px-2 py-1.5 font-semibold text-slate-800">{i.name}</td>
                          <td className="px-2 py-1.5 text-right font-black tabular-nums text-slate-800">{c.qty}</td>
                          <td className="px-2 py-1.5 text-right tabular-nums text-slate-500">{won(c.amount)}</td>
                        </tr>
                      );
                    })}
                  {usedItems.filter((i) => (colSummary.get(i.id)?.qty ?? 0) > 0).length === 0 && (
                    <tr>
                      <td colSpan={4} className="px-2 py-10 text-center text-slate-400">
                        아직 아무도 고른 항목이 없습니다.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="flex items-center gap-2 border-t border-slate-100 p-3">
              <button
                onClick={() => {
                  const lines = usedItems
                    .filter((i) => (colSummary.get(i.id)?.qty ?? 0) > 0)
                    .map((i) => `${i.name} — ${colSummary.get(i.id)!.qty}`)
                    .join("\n");
                  void navigator.clipboard.writeText(lines).then(() => notify("발주 목록을 복사했습니다.", "success"));
                }}
                className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-600"
              >
                목록 복사
              </button>
              <button onClick={() => setOrderOpen(false)} className="ml-auto rounded-lg bg-slate-800 px-4 py-2 text-sm font-bold text-white">
                닫기
              </button>
            </div>
          </div>
        </div>
      )}

      <p className="mt-2 text-[11px] leading-relaxed text-slate-400">
        ✓ 는 그 아이가 그 항목을 산다는 뜻입니다. <span className="text-amber-600">●</span> 는 기본 세트가 아니라 사람이 따로
        넣은 것입니다. 열 머리의 <b>전체 +</b> 는 지금 보이는 명단 전원에게 한 번에 넣습니다. 합계 줄의 개수는 그대로
        발주 수량입니다.
      </p>
    </div>
  );
}
