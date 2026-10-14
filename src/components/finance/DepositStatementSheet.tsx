"use client";

import { PRINT_CSS, won, dot } from "@/components/finance/InvoiceSheet";
import type { DepositStatement } from "@/lib/depositStatement";

/**
 * **예치금 사용내역서 한 장** — 청구서와 **같은 틀**(머리띠·학생·표·합계 띠·안내·꼬리말)이고 색만 청록입니다.
 *
 * 학부모가 받는 종이가 셋입니다(청구서 남색 · 영수증 초록 · 예치금 내역 청록). 틀이 같아야 어디를 보면 무엇이
 * 있는지 한 번 익히면 되고, 색이 달라야 세 장을 섞어 놓아도 무엇인지 먼저 갈립니다. 인쇄 규칙(`PRINT_CSS`)도
 * 청구서 것을 그대로 씁니다 - 두 벌이면 한쪽만 잘려 나오는 날이 옵니다.
 */

const INK = "#134e4a";
const SECTION_BG = "#e0f2f1";
const ACCENT = "#0f766e";

export default function DepositStatementSheet({
  statement,
  students,
  shareName,
  asOf,
}: {
  statement: DepositStatement;
  students: { name: string; grade: string | null; class_name: string | null }[];
  shareName: string | null;
  asOf: string;
}) {
  const t = statement.totals;
  const th = { padding: "7px 10px", textAlign: "left" as const, fontSize: 9, letterSpacing: 0.5 };
  const td = { padding: "6px 10px", fontSize: 10.5 };
  const Section = ({ title }: { title: string }) => (
    <tr style={{ background: SECTION_BG }}>
      <td colSpan={5} style={{ padding: "6px 10px", fontSize: 10, fontWeight: 800, color: INK }}>
        {title}
      </td>
    </tr>
  );

  return (
    <div className="inv-page min-h-screen bg-slate-100 p-4 print:min-h-0 print:bg-white print:p-0">
      <style>{PRINT_CSS}</style>
      <div className="no-print mx-auto mb-3 flex max-w-[210mm] items-center gap-2">
        <span className="text-sm font-bold text-slate-700">예치금 사용내역서 · {students.map((s) => s.name).join(" · ")}</span>
        <button onClick={() => window.print()} className="ml-auto rounded-lg bg-teal-800 px-4 py-2 text-sm font-bold text-white">
          🖨 인쇄 · PDF로 저장
        </button>
      </div>
      {t.mismatch && (
        <p className="no-print mx-auto mb-3 max-w-[210mm] rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-800">
          받은 돈 − 쓴 돈 − 돌려준 돈({won(t.received - t.used - t.refunded)})이 남은 돈({won(t.balance)})과 다릅니다. 보내기 전에 예치금 대장을 확인해주세요.
        </p>
      )}

      <div className="inv-wrap mx-auto max-w-[210mm] bg-white p-8 shadow-sm print:max-w-none print:p-0 print:shadow-none">
        <div className="inv">
          <table>
            <tbody>
              <tr>
                <td style={{ background: INK, color: "#fff", padding: "14px 18px", width: "62%" }}>
                  <div style={{ fontSize: 19, fontWeight: 800, letterSpacing: -0.2 }}>GIA Micro Lab</div>
                  <div style={{ fontSize: 10, fontWeight: 700, color: "#99f6e4", marginTop: 3 }}>Deposit Statement · 예치금 사용내역서</div>
                </td>
                <td style={{ background: INK, color: "#fff", padding: "14px 18px", textAlign: "right", fontSize: 9.5, lineHeight: 1.5 }}>
                  Gangnam-gu, Seoul
                  <br />
                  www.giamicro.com
                </td>
              </tr>
            </tbody>
          </table>

          <table style={{ marginTop: 18 }}>
            <tbody>
              <tr>
                <td style={{ background: "#f0fdfa", padding: "9px 14px", width: "50%" }}>
                  <div style={{ fontSize: 8, fontWeight: 700, letterSpacing: 0.6, color: "#6b7280" }}>AS OF · 기준일</div>
                  <div style={{ fontSize: 11.5, marginTop: 2 }}>{dot(asOf)}</div>
                </td>
                <td style={{ background: "#f0fdfa", padding: "9px 14px" }}>
                  <div style={{ fontSize: 8, fontWeight: 700, letterSpacing: 0.6, color: ACCENT }}>REMAINING DEPOSIT · 남은 예치금</div>
                  <div style={{ fontSize: 11.5, fontWeight: 800, marginTop: 2 }}>{won(t.balance)}</div>
                </td>
              </tr>
            </tbody>
          </table>

          <table style={{ marginTop: 20 }}>
            <tbody>
              {students.map((s, i) => (
                <tr key={s.name + i}>
                  <td style={{ width: 130, padding: "3px 0", fontSize: 8.5, fontWeight: 700, letterSpacing: 0.6, color: "#6b7280" }}>
                    {i === 0 ? (students.length > 1 ? "STUDENTS" : "STUDENT NAME") : ""}
                  </td>
                  <td style={{ padding: "3px 0", fontSize: 11.5, fontWeight: 800 }}>
                    {s.name}
                    {(s.grade || s.class_name) && <span style={{ fontWeight: 400, color: "#6b7280" }}> · {[s.grade, s.class_name].filter(Boolean).join(" ")}</span>}
                  </td>
                </tr>
              ))}
              {shareName && students.length > 1 && (
                <tr>
                  <td style={{ padding: "3px 0", fontSize: 8.5, fontWeight: 700, letterSpacing: 0.6, color: "#6b7280" }}>SHARED · 공유</td>
                  <td style={{ padding: "3px 0", fontSize: 10, color: ACCENT }}>
                    {shareName} — 위 학생들이 한 예치금을 함께 사용합니다. Shared by the students above.
                  </td>
                </tr>
              )}
            </tbody>
          </table>

          <table style={{ marginTop: 22 }}>
            <thead>
              <tr style={{ background: INK, color: "#fff" }}>
                <th style={{ ...th, width: 76 }}>DATE</th>
                <th style={th}>DESCRIPTION</th>
                <th style={{ ...th, width: 92 }}>STUDENT</th>
                <th style={{ ...th, width: 92 }}>IN · 입금</th>
                <th style={{ ...th, width: 92 }}>OUT · 사용</th>
              </tr>
            </thead>
            <tbody>
              <Section title="받은 예치금 · Deposits received" />
              {statement.received.map((r, i) => (
                <tr key={`in${i}`} style={{ background: i % 2 ? "#f4f5f7" : "#fff" }}>
                  <td style={td}>{dot(r.date)}</td>
                  <td style={td}>
                    {r.origin}
                    {r.method ? ` · ${r.method}` : ""}
                    {r.memo ? <span style={{ color: "#6b7280" }}> · {r.memo}</span> : null}
                  </td>
                  <td style={td}>{r.depositor}</td>
                  <td style={td}>{won(r.amount)}</td>
                  <td style={td} />
                </tr>
              ))}
              {statement.received.length === 0 && (
                <tr>
                  <td colSpan={5} style={{ ...td, color: "#9ca3af" }}>받은 예치금이 없습니다.</td>
                </tr>
              )}

              <Section title="사용 내역 · Applied to invoices" />
              {statement.used.map((u, i) => (
                <tr key={`out${i}`} style={{ background: i % 2 ? "#f4f5f7" : "#fff" }}>
                  <td style={td}>{dot(u.date)}</td>
                  <td style={td}>
                    {u.item}
                    <span style={{ color: "#6b7280" }}> · No. {u.invoiceNo}</span>
                    {u.from && <span style={{ marginLeft: 6, fontSize: 8.5, fontWeight: 700, color: ACCENT, background: "#ccfbf1", borderRadius: 3, padding: "1px 5px" }}>{u.from} 예치금에서</span>}
                  </td>
                  <td style={td}>{u.student}</td>
                  <td style={td} />
                  <td style={td}>−{won(u.amount)}</td>
                </tr>
              ))}
              {statement.used.length === 0 && (
                <tr>
                  <td colSpan={5} style={{ ...td, color: "#9ca3af" }}>아직 사용한 내역이 없습니다.</td>
                </tr>
              )}

              {statement.refunded.length > 0 && <Section title="돌려드린 금액 · Refunded" />}
              {statement.refunded.map((r, i) => (
                <tr key={`rf${i}`}>
                  <td style={td}>{dot(r.date)}</td>
                  <td style={td}>{r.memo}</td>
                  <td style={td} />
                  <td style={td} />
                  <td style={td}>−{won(r.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <table className="inv-keep" style={{ marginTop: 26 }}>
            <tbody>
              <tr>
                <td style={{ width: "50%" }} />
                <td style={{ background: INK, color: "#fff", padding: "12px 16px" }}>
                  <table>
                    <tbody>
                      <tr>
                        <td style={{ fontSize: 9.5, opacity: 0.85 }}>DEPOSITED · 받은 예치금</td>
                        <td style={{ textAlign: "right", fontSize: 10.5 }}>{won(t.received)}</td>
                      </tr>
                      <tr>
                        <td style={{ fontSize: 9.5, color: "#99f6e4" }}>APPLIED · 사용</td>
                        <td style={{ textAlign: "right", fontSize: 10.5, color: "#99f6e4" }}>−{won(t.used)}</td>
                      </tr>
                      {t.refunded > 0 && (
                        <tr>
                          <td style={{ fontSize: 9.5, opacity: 0.85 }}>REFUNDED · 돌려드림</td>
                          <td style={{ textAlign: "right", fontSize: 10.5 }}>−{won(t.refunded)}</td>
                        </tr>
                      )}
                      <tr>
                        <td style={{ fontSize: 11, fontWeight: 800, letterSpacing: 0.4, paddingTop: 4 }}>REMAINING · 남은 예치금</td>
                        <td style={{ textAlign: "right", fontSize: 13, fontWeight: 800, paddingTop: 4 }}>{won(t.balance)}</td>
                      </tr>
                      {statement.leftBy.length > 1 &&
                        statement.leftBy.map((l) => (
                          <tr key={l.student}>
                            <td style={{ fontSize: 9, opacity: 0.8 }}>└ {l.student} 맡긴 몫</td>
                            <td style={{ textAlign: "right", fontSize: 9.5, opacity: 0.8 }}>{won(l.amount)}</td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </td>
              </tr>
            </tbody>
          </table>

          <table className="inv-keep" style={{ marginTop: 26 }}>
            <tbody>
              <tr>
                <td style={{ background: "#f0fdfa", padding: "12px 14px", verticalAlign: "top" }}>
                  <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: 0.6, color: ACCENT }}>NOTES</div>
                  <div style={{ fontSize: 9.5, marginTop: 6, lineHeight: 1.6 }}>
                    • 남은 예치금은 다음 청구서에서 차감됩니다. The remaining deposit will be applied to upcoming invoices.
                    <br />• 기준일({dot(asOf)}) 현재의 금액입니다. Amounts are as of the date above.
                    <br />• 문의는 행정실로 연락 주세요. Please contact the school office with any questions.
                  </div>
                </td>
              </tr>
            </tbody>
          </table>

          <div className="inv-keep" style={{ marginTop: 26, borderTop: "1px solid #d1d5db", paddingTop: 8, textAlign: "center", fontSize: 9, fontStyle: "italic", color: "#6b7280" }}>
            GIA Micro Lab · Gangnam-gu, Seoul · Thank you.
          </div>
        </div>
      </div>
    </div>
  );
}
