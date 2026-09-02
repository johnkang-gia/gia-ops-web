"use client";

import type { Invoice, InvoiceLine } from "@/lib/types";

// 인보이스 한 장. 담당자가 쓰던 구글독스 양식과 같은 모양입니다.
//
// **PDF는 브라우저의 "PDF로 저장"으로 뽑습니다.** 서버에서 PDF를 만들려면 한글 글꼴을
// 심어야 하고, 글꼴이 빠지면 이름이 네모로 나갑니다. 학부모에게 가는 종이라 그 위험을
// 지지 않습니다. 인쇄 창의 "대상"에서 PDF로 저장을 고르면 같은 결과가 나옵니다.
//
// 이 화면에는 **사람이 숫자를 쓰는 자리가 하나도 없습니다.** 항목도 금액도 합계도 발행할 때
// 굳어진 값을 그대로 보여줍니다.

const PRINT_CSS = `
  @page { size: A4 portrait; margin: 18mm 16mm; }
  @media print {
    .no-print { display: none !important; }
    html, body { background: #fff !important; }

    /*
      색을 그대로 인쇄합니다.

      브라우저는 잉크를 아끼려고 **배경색을 기본으로 지웁니다.** 그래서 남색 머리띠가
      하얗게 나오고, 그 위의 흰 글자는 아예 사라집니다. 학부모에게 가는 종이라 화면에서
      본 그대로 나와야 합니다.
    */
    .inv, .inv * {
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
    }

    /*
      여러 장으로 넘어갈 때.

      항목이 많으면 두 장이 됩니다. 그때 줄이 반으로 잘리거나, 표 머리줄이 첫 장에만 있고
      둘째 장은 무슨 칸인지 모르게 나오면 안 됩니다.
    */
    .inv table { break-inside: auto; page-break-inside: auto; }
    .inv tr { break-inside: avoid; page-break-inside: avoid; }
    .inv thead { display: table-header-group; }
    .inv tfoot { display: table-footer-group; }
    /* 결제 안내·꼬리말은 통째로 한 장에 오게 합니다. 반으로 갈리면 읽기 나쁩니다. */
    .inv-keep { break-inside: avoid; page-break-inside: avoid; }

    /*
      바깥 틀을 풀어줍니다.

      이 화면은 사이드바가 있는 큰 틀 안에 들어 있어서, 그대로 두면 한 화면 높이에서 잘려
      **둘째 장이 통째로 사라집니다.** 높이 제한과 스크롤을 전부 풀어야 넘어갑니다.
    */
    .inv-wrap {
      box-shadow: none !important;
      border: 0 !important;
      margin: 0 !important;
      padding: 0 !important;
      width: auto !important;
      max-width: none !important;
      min-height: 0 !important;
      height: auto !important;
      overflow: visible !important;
    }
    .inv-page { min-height: 0 !important; height: auto !important; overflow: visible !important; }
  }
  .inv { color: #111827; font-family: Arial, "Apple SD Gothic Neo", "Malgun Gothic", sans-serif; }
  .inv table { border-collapse: collapse; width: 100%; }
`;

function won(n: number): string {
  return `₩${Math.round(Number(n)).toLocaleString("ko-KR")}`;
}

function dot(d: string): string {
  return (d ?? "").replaceAll("-", ".");
}

export default function InvoiceSheet({
  invoice,
  lines,
  embed = false,
}: {
  invoice: Invoice;
  lines: InvoiceLine[];
  /** 미리보기 창 안에 들어간 경우. 바깥 창에 이미 인쇄 단추가 있어 머리줄을 숨깁니다. */
  embed?: boolean;
}) {
  // 합계는 굳어진 줄에서 다시 더해 보여줍니다. 머리줄의 total_amount와 어긋나면 그 사실이
  // 화면에 보여야 합니다 - 조용히 한쪽만 믿으면 어긋난 채로 나갑니다.
  const sum = lines.reduce((n, l) => n + Number(l.amount), 0);
  const mismatch = Math.round(sum) !== Math.round(Number(invoice.total_amount));

  return (
    <div className={"inv-page p-4 print:min-h-0 print:bg-white print:p-0 " + (embed ? "bg-white p-2" : "min-h-screen bg-slate-100")}>
      <style>{PRINT_CSS}</style>

      <div className={"no-print mx-auto mb-3 flex max-w-[210mm] flex-wrap items-center gap-2 " + (embed ? "hidden" : "")}>
        <span className="text-sm font-bold text-slate-700">{invoice.invoice_no}</span>
        <span className="text-xs text-slate-500">{invoice.student_name}</span>
        {invoice.status === "취소" && (
          <span className="rounded bg-red-100 px-2 py-0.5 text-[11px] font-bold text-red-700">
            취소된 인보이스
            {invoice.cancel_reason && <span className="ml-1 font-medium">· {invoice.cancel_reason}</span>}
            {invoice.cancelled_by && <span className="ml-1 font-medium opacity-70">({invoice.cancelled_by})</span>}
          </span>
        )}
        <button
          onClick={() => window.print()}
          className="ml-auto rounded-lg bg-slate-800 px-4 py-2 text-sm font-bold text-white"
        >
          🖨 인쇄 · PDF로 저장
        </button>
      </div>

      {mismatch && (
        <p className="no-print mx-auto mb-3 max-w-[210mm] rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-800">
          내역 합({won(sum)})과 저장된 총액({won(Number(invoice.total_amount))})이 다릅니다. 발행을 다시 해주세요.
        </p>
      )}

      <div className="inv-wrap mx-auto max-w-[210mm] bg-white p-8 shadow-sm print:max-w-none print:p-0 print:shadow-none">
        <div className="inv">
          {/* 머리띠 */}
          <table>
            <tbody>
              <tr>
                <td style={{ background: "#1e2a44", color: "#fff", padding: "14px 18px", width: "62%" }}>
                  <div style={{ fontSize: 19, fontWeight: 800, letterSpacing: -0.2 }}>GIA Micro Lab</div>
                  <div style={{ fontSize: 10, fontWeight: 700, color: "#d6b370", marginTop: 3 }}>
                    Textbook Payment Invoice
                  </div>
                </td>
                <td style={{ background: "#1e2a44", color: "#fff", padding: "14px 18px", textAlign: "right", fontSize: 9.5, lineHeight: 1.5 }}>
                  Gangnam-gu, Seoul
                  <br />
                  www.giamicro.com
                </td>
              </tr>
            </tbody>
          </table>

          {/* 발행일 · 납부기한 */}
          <table style={{ marginTop: 18 }}>
            <tbody>
              <tr>
                <td style={{ background: "#f7f4ee", padding: "9px 14px", width: "50%" }}>
                  <div style={{ fontSize: 8, fontWeight: 700, letterSpacing: 0.6, color: "#6b7280" }}>ISSUE DATE</div>
                  <div style={{ fontSize: 11.5, marginTop: 2 }}>{dot(invoice.issue_date)}</div>
                </td>
                <td style={{ background: "#f7f4ee", padding: "9px 14px" }}>
                  <div style={{ fontSize: 8, fontWeight: 700, letterSpacing: 0.6, color: "#a07d2e" }}>PAYMENT DUE</div>
                  <div style={{ fontSize: 11.5, fontWeight: 800, marginTop: 2 }}>{dot(invoice.due_date)}</div>
                </td>
              </tr>
            </tbody>
          </table>

          {/* 학생 */}
          <table style={{ marginTop: 20 }}>
            <tbody>
              <tr>
                <td style={{ width: 130, padding: "3px 0", fontSize: 8.5, fontWeight: 700, letterSpacing: 0.6, color: "#6b7280" }}>
                  STUDENT NAME
                </td>
                <td style={{ padding: "3px 0", fontSize: 11.5, fontWeight: 800 }}>{invoice.student_name}</td>
              </tr>
              <tr>
                <td style={{ padding: "3px 0", fontSize: 8.5, fontWeight: 700, letterSpacing: 0.6, color: "#6b7280" }}>
                  GRADE / CLASS
                </td>
                <td style={{ padding: "3px 0", fontSize: 11.5 }}>{invoice.grade_label ?? ""}</td>
              </tr>
            </tbody>
          </table>

          {/* 내역 */}
          <table style={{ marginTop: 22 }}>
            <thead>
              <tr style={{ background: "#1e2a44", color: "#fff" }}>
                <th style={{ width: 46, padding: "7px 10px", textAlign: "left", fontSize: 9, letterSpacing: 0.5 }}>NO.</th>
                <th style={{ padding: "7px 10px", textAlign: "left", fontSize: 9, letterSpacing: 0.5 }}>TEXTBOOK / MATERIAL</th>
                <th style={{ width: 60, padding: "7px 10px", textAlign: "left", fontSize: 9, letterSpacing: 0.5 }}>QTY</th>
                <th style={{ width: 110, padding: "7px 10px", textAlign: "left", fontSize: 9, letterSpacing: 0.5 }}>AMOUNT</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={l.id} style={{ background: i % 2 === 1 ? "#f4f5f7" : "#fff" }}>
                  <td style={{ padding: "7px 10px", fontSize: 10.5 }}>{l.seq}</td>
                  <td style={{ padding: "7px 10px", fontSize: 10.5 }}>{l.name}</td>
                  <td style={{ padding: "7px 10px", fontSize: 10.5 }}>{l.qty}</td>
                  <td style={{ padding: "7px 10px", fontSize: 10.5 }}>{won(Number(l.amount))}</td>
                </tr>
              ))}
              {lines.length === 0 && (
                <tr>
                  <td colSpan={4} style={{ padding: "18px 10px", fontSize: 10.5, color: "#9ca3af" }}>
                    내역이 없습니다.
                  </td>
                </tr>
              )}
            </tbody>
          </table>

          {/* 총액 */}
          <table style={{ marginTop: 26 }}>
            <tbody>
              <tr>
                <td style={{ width: "58%" }} />
                <td style={{ background: "#1e2a44", color: "#fff", padding: "12px 16px" }}>
                  <table>
                    <tbody>
                      <tr>
                        <td style={{ fontSize: 11, fontWeight: 800, letterSpacing: 0.4 }}>TOTAL DUE</td>
                        <td style={{ textAlign: "right", fontSize: 13, fontWeight: 800 }}>{won(sum)}</td>
                      </tr>
                    </tbody>
                  </table>
                </td>
              </tr>
            </tbody>
          </table>

          {/* 입금 정보 · 안내 */}
          <table style={{ marginTop: 26 }}>
            <tbody>
              <tr>
                <td style={{ background: "#f7f4ee", padding: "12px 14px", width: "50%", verticalAlign: "top" }}>
                  <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: 0.6, color: "#a07d2e" }}>PAYMENT INFORMATION</div>
                  <div style={{ fontSize: 10, marginTop: 6, lineHeight: 1.6 }}>
                    Bank: KB Kookmin Bank 445-701-01-280-625
                    <br />
                    Account Holder: 그레이스 문화 선교회 (Grace Culture Mission)
                    <br />
                    <i style={{ fontSize: 9, color: "#6b7280" }}>Please note the student&apos;s name in the transfer memo.</i>
                  </div>
                </td>
                <td style={{ background: "#f4f5f7", padding: "12px 14px", verticalAlign: "top" }}>
                  <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: 0.6, color: "#374151" }}>NOTES</div>
                  <div style={{ fontSize: 9.5, marginTop: 6, lineHeight: 1.6 }}>
                    • Please complete payment by {dot(invoice.due_date)} via the Altok Pay payment request.
                    <br />
                    • Issued on {dot(invoice.issue_date)}.
                    <br />• Please contact the school office with any questions.
                  </div>
                </td>
              </tr>
            </tbody>
          </table>

          <div className="inv-keep" style={{ marginTop: 26, borderTop: "1px solid #d1d5db", paddingTop: 8, textAlign: "center", fontSize: 9, fontStyle: "italic", color: "#6b7280" }}>
            GIA Micro Lab · Gangnam-gu, Seoul · Thank you for your prompt payment.
            <span style={{ marginLeft: 8, fontStyle: "normal" }}>No. {invoice.invoice_no}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
