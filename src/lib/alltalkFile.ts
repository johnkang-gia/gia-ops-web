import { toAmount, toIsoDate } from "@/lib/payments";
import type { RawImportRow } from "@/lib/paymentImport";

/**
 * 올톡페이 「청구서관리목록」 엑셀 → 줄 목록. 브라우저에서 읽습니다.
 *
 * 「결제내역 올리기」와 「올톡 대조」가 같은 파일을 받습니다. 칸을 찾는 규칙이 두 벌이면 한쪽만
 * 고쳐지는 날이 오고, 같은 파일이 화면마다 다른 줄로 읽힙니다.
 */
export async function readAlltalkFile(file: File): Promise<RawImportRow[]> {
  const XLSX = await import("xlsx");
  const wb = XLSX.read(await file.arrayBuffer(), { cellDates: true });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });

  // 칸 이름은 **적어준 순서대로** 찾습니다. 순서가 없으면 올톡페이 파일에서 `등록일자`가
  // `수납일자`보다 먼저 걸려, 돈 들어온 날이 아니라 청구서 만든 날이 입금일로 들어갑니다.
  const pick = (r: Record<string, unknown>, names: string[]) => {
    const keys = Object.keys(r);
    for (const n of names) {
      const k = keys.find((k) => k.replace(/\s+/g, "").includes(n));
      if (k !== undefined && String(r[k] ?? "").trim() !== "" && String(r[k]).trim() !== "-") return r[k];
    }
    return "";
  };

  const rows: RawImportRow[] = [];
  raw.forEach((r, i) => {
    const amount = toAmount(pick(r, ["청구금액", "결제금액", "금액", "amount"]));
    const name = String(pick(r, ["고객명", "성명", "이름"]) ?? "").trim();
    // 금액도 이름도 없는 줄은 합계행·머리글입니다.
    if (!amount && !name) return;
    rows.push({
      seq: i + 1,
      name,
      phone: String(pick(r, ["청구핸드폰", "핸드폰", "휴대폰", "연락처", "phone"]) ?? "").replace(/\D/g, ""),
      why: String(pick(r, ["청구사유", "내용", "메모", "적요"]) ?? "").trim(),
      amount,
      issuedAt: toIsoDate(pick(r, ["등록일자", "청구일", "발행일"])) || null,
      status: String(pick(r, ["상태", "결제상태"]) ?? "").trim(),
      paidAt: toIsoDate(pick(r, ["수납일자", "결제일", "승인일"])) || null,
      method: String(pick(r, ["수납구분", "결제수단", "수단"]) ?? "").trim() || null,
      card: String(pick(r, ["카드사"]) ?? "").trim() || null,
      approvalNo: String(pick(r, ["승인번호", "거래번호"]) ?? "").trim() || null,
    });
  });
  return rows;
}
