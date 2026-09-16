"use client";

import { Fragment } from "react";
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

/** 청구서 한 장에 들어가는 아이 하나 몫. 형제를 합치면 이것이 여럿입니다. */
export type SheetPart = { invoice: Invoice; lines: InvoiceLine[] };

/**
 * **형제를 합쳐도 아이별 내역이 보여야 합니다.**
 *
 * 보호자 번호가 같으면 청구는 한 장으로 합쳐 보냅니다 - 안 그러면 그 집에 청구서가 두 번
 * 갑니다. 그런데 합친 청구서에 금액만 한 줄로 찍히면, **그 집은 어느 아이 몫이 얼마인지
 * 알 수 없습니다.** 문의가 오면 행정실이 두 장을 다시 찾아 더해 설명해야 합니다.
 *
 * 그래서 한 장 안에서 아이마다 칸을 나누고, 아이별 소계와 전체 합계를 따로 적습니다.
 *
 * 화면을 두 벌로 만들지 않습니다. 한 명짜리는 **아이가 한 명인 합본**일 뿐이라, 같은 코드가
 * 그립니다 - 두 벌이면 한쪽만 고쳐지는 날이 오고, 학부모에게 가는 종이가 서로 달라집니다.
 */
export default function InvoiceSheet({
  parts,
  embed = false,
}: {
  parts: SheetPart[];
  /** 미리보기 창 안에 들어간 경우. 바깥 창에 이미 인쇄 단추가 있어 머리줄을 숨깁니다. */
  embed?: boolean;
}) {
  const invoice = parts[0].invoice;
  const many = parts.length > 1;
  const lines = parts.flatMap((p) => p.lines);

  // 합계는 굳어진 줄에서 다시 더해 보여줍니다. 머리줄의 total_amount와 어긋나면 그 사실이
  // 화면에 보여야 합니다 - 조용히 한쪽만 믿으면 어긋난 채로 나갑니다.
  const sum = lines.reduce((n, l) => n + Number(l.amount), 0);
  const stored = parts.reduce((n, p) => n + Number(p.invoice.total_amount), 0);
  const mismatch = Math.round(sum) !== Math.round(stored);

  /** 아이 이름(반). 누구 몫인지 한 줄로 보여줄 때 씁니다. */
  const whoOf = (inv: Invoice): string => {
    const name = (inv.student_name_ko?.trim() || inv.student_name || "").trim();
    const g = (inv.grade_label ?? "").trim();
    return g ? `${name} · ${g}` : name;
  };

  // 형제의 납부기한이 다르면 **빠른 쪽**을 적습니다. 늦은 쪽을 적으면 한 아이가 연체됩니다.
  const due = parts.map((p) => p.invoice.due_date).sort()[0];


  return (
    <div className={"inv-page p-4 print:min-h-0 print:bg-white print:p-0 " + (embed ? "bg-white p-2" : "min-h-screen bg-slate-100")}>
      <style>{PRINT_CSS}</style>

      <div className={"no-print mx-auto mb-3 flex max-w-[210mm] flex-wrap items-center gap-2 " + (embed ? "hidden" : "")}>
        <span className="text-sm font-bold text-slate-700">{parts.map((p) => p.invoice.invoice_no).join(" · ")}</span>
        <span className="text-xs text-slate-500">{parts.map((p) => whoOf(p.invoice)).join(" · ")}</span>
        {/* 합본이면 **어느 아이 것이 취소됐는지**까지 적습니다. 「취소된 인보이스」만 뜨면
            두 장 중 어느 쪽인지 몰라 둘 다 다시 확인하게 됩니다. */}
        {parts
          .filter((p) => p.invoice.status === "취소")
          .map((p) => (
            <span key={p.invoice.id} className="rounded bg-red-100 px-2 py-0.5 text-[11px] font-bold text-red-700">
              {many ? `${whoOf(p.invoice)} · ` : ""}취소된 인보이스
              {p.invoice.cancel_reason && <span className="ml-1 font-medium">· {p.invoice.cancel_reason}</span>}
              {p.invoice.cancelled_by && <span className="ml-1 font-medium opacity-70">({p.invoice.cancelled_by})</span>}
            </span>
          ))}
        <button
          onClick={() => window.print()}
          className="ml-auto rounded-lg bg-slate-800 px-4 py-2 text-sm font-bold text-white"
        >
          🖨 인쇄 · PDF로 저장
        </button>
      </div>

      {mismatch && (
        <p className="no-print mx-auto mb-3 max-w-[210mm] rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-800">
          내역 합({won(sum)})과 저장된 총액({won(stored)})이 다릅니다. 발행을 다시 해주세요.
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
                  {/* 교재 말고도 나갑니다 - 교복·악기·방과후·학비. 제목에 한 품목을 박아두면
                      다른 품목 청구서가 나갈 때마다 제목이 거짓말이 됩니다. */}
                  <div style={{ fontSize: 10, fontWeight: 700, color: "#d6b370", marginTop: 3 }}>
                    Payment Invoice
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
                  <div style={{ fontSize: 11.5, fontWeight: 800, marginTop: 2 }}>{dot(due)}</div>
                </td>
              </tr>
            </tbody>
          </table>

          {/* 학생 */}
          <table style={{ marginTop: 20 }}>
            <tbody>
              {/* 형제를 합쳤으면 아이를 한 줄씩 적습니다. 한 칸에 이어 붙이면 어느 반이 누구
                  것인지 짝이 안 맞습니다 - 아래 내역도 아이별로 나뉘므로 여기도 나눕니다. */}
              {parts.map((p, i) => (
                <tr key={p.invoice.id}>
                  <td style={{ width: 130, padding: "3px 0", fontSize: 8.5, fontWeight: 700, letterSpacing: 0.6, color: "#6b7280" }}>
                    {i === 0 ? (many ? "STUDENTS" : "STUDENT NAME") : ""}
                  </td>
                  <td style={{ padding: "3px 0", fontSize: 11.5, fontWeight: 800 }}>
                    {p.invoice.student_name}
                    {p.invoice.grade_label && (
                      <span style={{ fontWeight: 400, color: "#6b7280" }}> · {p.invoice.grade_label}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* 내역 */}
          <table style={{ marginTop: 22 }}>
            <thead>
              <tr style={{ background: "#1e2a44", color: "#fff" }}>
                <th style={{ width: 46, padding: "7px 10px", textAlign: "left", fontSize: 9, letterSpacing: 0.5 }}>NO.</th>
                <th style={{ padding: "7px 10px", textAlign: "left", fontSize: 9, letterSpacing: 0.5 }}>DESCRIPTION</th>
                <th style={{ width: 60, padding: "7px 10px", textAlign: "left", fontSize: 9, letterSpacing: 0.5 }}>QTY</th>
                <th style={{ width: 110, padding: "7px 10px", textAlign: "left", fontSize: 9, letterSpacing: 0.5 }}>AMOUNT</th>
              </tr>
            </thead>
            <tbody>
              {/*
                **아이마다 칸을 나눕니다.**

                형제를 합치면 줄이 섞여서, 「악기비 12만원」이 형 것인지 동생 것인지 알 수
                없습니다. 그 집이 물어보면 행정실이 두 장을 다시 찾아 더해 설명해야 합니다.

                한 명짜리는 머리줄도 소계도 없이 예전 그대로 나옵니다 - 아이가 한 명인데
                「김사랑 소계」를 적으면 총액과 같은 숫자가 두 번 찍힙니다.
              */}
              {parts.map((part) => {
                const subtotal = part.lines.reduce((n, l) => n + Number(l.amount), 0);
                return (
                  <Fragment key={part.invoice.id}>
                    {many && (
                      <tr style={{ background: "#e8eaf0" }}>
                        <td colSpan={4} style={{ padding: "6px 10px", fontSize: 10, fontWeight: 800, color: "#1e2a44" }}>
                          {whoOf(part.invoice)}
                          <span style={{ fontWeight: 400, color: "#6b7280" }}> · No. {part.invoice.invoice_no}</span>
                        </td>
                      </tr>
                    )}
                    {part.lines.map((l, i) => (
                      <tr key={l.id} style={{ background: i % 2 === 1 ? "#f4f5f7" : "#fff" }}>
                        <td style={{ padding: "7px 10px", fontSize: 10.5 }}>{l.seq}</td>
                        <td style={{ padding: "7px 10px", fontSize: 10.5 }}>{l.name}</td>
                        <td style={{ padding: "7px 10px", fontSize: 10.5 }}>{l.qty}</td>
                        <td style={{ padding: "7px 10px", fontSize: 10.5 }}>{won(Number(l.amount))}</td>
                      </tr>
                    ))}
                    {part.lines.length === 0 && (
                      <tr>
                        <td colSpan={4} style={{ padding: "18px 10px", fontSize: 10.5, color: "#9ca3af" }}>
                          내역이 없습니다.
                        </td>
                      </tr>
                    )}
                    {many && (
                      <tr>
                        <td colSpan={3} style={{ padding: "6px 10px", fontSize: 10, fontWeight: 700, textAlign: "right", color: "#374151" }}>
                          {(part.invoice.student_name_ko?.trim() || part.invoice.student_name)} 소계
                        </td>
                        <td style={{ padding: "6px 10px", fontSize: 10.5, fontWeight: 800, borderTop: "1px solid #c7ccd8" }}>
                          {won(subtotal)}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
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
                    • Please complete payment by {dot(due)} via the Altok Pay payment request.
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
            <span style={{ marginLeft: 8, fontStyle: "normal" }}>No. {parts.map((p) => p.invoice.invoice_no).join(", ")}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
