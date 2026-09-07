"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { formatIdentifier, identifierProblem, type ReceiptPurpose } from "@/lib/cashReceipt";

/**
 * 단말기 앞에 들고 갈 종이.
 *
 * 이 종이를 보는 사람은 **화면이 아니라 단말기 키패드를 보고 있습니다.** 한 손으로 종이를
 * 들고 다른 손으로 번호를 칩니다. 그래서 종이에서 가장 커야 하는 것은 이름도 금액도 아니고
 * **번호**입니다. 번호를 잘못 치면 남의 앞으로 나가고, 그건 취소 발행으로만 되돌립니다.
 *
 * 그래서 이렇게 짰습니다.
 *   · 번호를 14pt 굵게, 하이픈을 넣어 세 덩어리로. 자리를 세지 않아도 되게 합니다.
 *   · 구분(소득공제/지출증빙)을 번호 바로 앞에. 단말기에서 먼저 고르는 것이 이것입니다.
 *   · 맨 왼쪽에 손으로 그을 네모칸. 한 건 끝낼 때마다 그어야 어디까지 했는지 잃지 않습니다.
 *   · 맨 아래에 「앱에서 [발행함]을 눌러주세요」. 이 한 줄이 이중발행을 막습니다.
 */

export type PrintRow = {
  id: string;
  name: string;
  purpose: ReceiptPurpose;
  identifier: string | null;
  amount: number;
  note: string | null;
};

export default function CashReceiptPrintSheet({ rows, dateLabel }: { rows: PrintRow[]; dateLabel: string }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const sheet = (
    <>
      <style>{`
        @page { size: A4 portrait; margin: 10mm; }
        /* 화면에서는 자리를 차지하지 않게 밖으로 밀어둡니다. */
        .gia-print-wrap { position: absolute; left: -99999px; top: 0; }
        @media print {
          html, body {
            margin: 0 !important; padding: 0 !important;
            height: auto !important; overflow: visible !important; background: #fff !important;
          }
          main, .shell-content, .shell-page-bg {
            margin: 0 !important; padding: 0 !important;
            height: auto !important; max-height: none !important; overflow: visible !important;
          }
          /* 종이 말고는 **자리까지** 없앱니다. 감추기만 하면 그 빈 자리가 그대로 장수가 됩니다. */
          body > *:not(.gia-print-wrap) { display: none !important; }
          .gia-print-wrap { position: static !important; left: auto !important; top: auto !important; display: block !important; }
          .gia-receipt-sheet tr { break-inside: avoid; page-break-inside: avoid; }
          .gia-receipt-sheet thead { display: table-header-group; }
        }
        .gia-receipt-sheet { color: #000; font-family: inherit; }
        .gia-receipt-sheet table { width: 100%; border-collapse: collapse; table-layout: fixed; }
        .gia-receipt-sheet th, .gia-receipt-sheet td {
          border: 1px solid #000; padding: 5px 6px; color: #000; vertical-align: middle;
          word-break: keep-all; overflow-wrap: anywhere;
        }
        .gia-receipt-sheet thead th {
          background: #ececec !important; -webkit-print-color-adjust: exact; print-color-adjust: exact;
          text-align: center; font-weight: 700; font-size: 9pt;
        }
        .gia-receipt-sheet .c-chk  { width: 8%;  text-align: center; }
        .gia-receipt-sheet .c-name { width: 20%; font-size: 11pt; font-weight: 700; }
        .gia-receipt-sheet .c-kind { width: 15%; text-align: center; font-size: 9.5pt; font-weight: 700; }
        .gia-receipt-sheet .c-id   { width: 31%; text-align: center; }
        .gia-receipt-sheet .c-amt  { width: 16%; text-align: right; font-size: 10.5pt; font-variant-numeric: tabular-nums; }
        .gia-receipt-sheet .c-note { width: 10%; font-size: 8pt; }
        /* 종이에서 가장 큰 글자. 사람이 이걸 보고 칩니다. */
        .gia-receipt-sheet .idno { font-size: 14pt; font-weight: 800; letter-spacing: 0.6px; font-variant-numeric: tabular-nums; }
        .gia-receipt-sheet .idbad { font-size: 9pt; font-weight: 700; }
        .gia-receipt-sheet .box { display: inline-block; width: 14px; height: 14px; border: 1.5px solid #000; }
        .gia-receipt-sheet .head { margin: 0 0 6px; font-size: 12pt; font-weight: 800; }
        .gia-receipt-sheet .sub  { margin: 0 0 8px; font-size: 9pt; }
        .gia-receipt-sheet .foot { margin: 8px 0 0; font-size: 9.5pt; font-weight: 700; border-top: 1px solid #000; padding-top: 6px; }
      `}</style>

      <div className="gia-print-wrap" aria-hidden>
        <div className="gia-receipt-sheet">
          <p className="head">현금영수증 발행 목록 · {dateLabel} · {rows.length}건</p>
          <p className="sub">단말기에서 구분을 고르고 번호를 그대로 칩니다. 한 건 끝날 때마다 왼쪽 네모에 표시하세요.</p>

          <table>
            <thead>
              <tr>
                <th className="c-chk">완료</th>
                <th className="c-name">이름</th>
                <th className="c-kind">구분</th>
                <th className="c-id">번호</th>
                <th className="c-amt">금액</th>
                <th className="c-note">메모</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const problem = identifierProblem(r.purpose, r.identifier);
                return (
                  <tr key={r.id}>
                    <td className="c-chk">
                      <span className="box" />
                    </td>
                    <td className="c-name">{r.name}</td>
                    <td className="c-kind">{r.purpose}</td>
                    <td className="c-id">
                      {/* 번호가 없거나 자릿수가 안 맞으면 **그렇다고 적습니다.**
                          빈칸으로 두면 단말기 앞에서야 알게 되고, 그때는 되돌아올 수밖에 없습니다. */}
                      {problem ? (
                        <span className="idbad">⚠ {problem}</span>
                      ) : (
                        <span className="idno">{formatIdentifier(r.purpose, r.identifier)}</span>
                      )}
                    </td>
                    <td className="c-amt">{Number(r.amount).toLocaleString()}</td>
                    <td className="c-note">{r.note ?? ""}</td>
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={6} style={{ textAlign: "center", padding: "24px" }}>
                    발행할 건이 없습니다.
                  </td>
                </tr>
              )}
            </tbody>
          </table>

          <p className="foot">
            끝나면 앱 [🧾 현금영수증] 화면에서 [발행함]을 눌러주세요. 누르지 않으면 다음에 뽑을 때 같은 사람이
            또 나오고, 두 번 발행되면 취소 발행으로만 되돌릴 수 있습니다.
          </p>
        </div>
      </div>
    </>
  );

  // 붙기 전(서버에서 그릴 때)에는 아무것도 내지 않습니다. document 가 없습니다.
  return mounted ? createPortal(sheet, document.body) : null;
}
