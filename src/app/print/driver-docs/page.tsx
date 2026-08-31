"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";

// 기사님께 드리는 인쇄물(요청 ②: "링크 기기 탭에서 기사님들께 안내서와 동의서 바로 인쇄할 수
// 있도록 버튼 만들어주고").
//
// 예전에는 docs/셔틀 폴더의 .docx를 열어 워드에서 인쇄해야 했습니다. 그러면 담당자가 파일을
// 찾아야 하고, 호차·기사님 성함을 매번 손으로 채워야 하고, 문서가 수정되면 누가 어느 버전을
// 인쇄했는지 알 수 없습니다. 이 화면은 같은 내용을 웹에서 바로 A4로 뽑고, 링크·기기 화면에서
// 넘겨준 호차·성함·차량번호를 미리 채워 나옵니다.
//
// ?doc=notice(안내문) | consent(동의서) | both(둘 다, 기본)
// ?route=27호  &driver=홍길동  &vehicle=12가 3456  &phone=010-0000-0000

const PRINT_CSS = `
  @page { size: A4 portrait; margin: 16mm 15mm; }
  @media print {
    .no-print { display: none !important; }
    .sheet { box-shadow: none !important; border: 0 !important; margin: 0 !important; padding: 0 !important; width: auto !important; }
    .page-break { break-after: page; page-break-after: always; }
  }
  .sheet { line-height: 1.55; color: #111; }
  .sheet h1 { font-size: 20pt; font-weight: 800; margin: 0 0 2mm; }
  .sheet h2 { font-size: 12pt; font-weight: 800; margin: 5mm 0 2mm; padding-bottom: 1mm; border-bottom: 1px solid #cbd5e1; }
  .sheet p, .sheet li { font-size: 10pt; margin: 0 0 2mm; }
  .sheet ul { margin: 0 0 3mm; padding-left: 5mm; }
  .sheet li { list-style: disc; }
  .sheet table { width: 100%; border-collapse: collapse; margin: 2mm 0 4mm; }
  .sheet th, .sheet td { border: 1px solid #94a3b8; padding: 1.6mm 2.5mm; font-size: 9.5pt; text-align: left; vertical-align: top; }
  .sheet th { background: #f1f5f9; font-weight: 700; }
  .brand { font-size: 9.5pt; letter-spacing: .08em; color: #64748b; font-weight: 700; }
  .meta { font-size: 9.5pt; color: #475569; margin-bottom: 4mm; }
`;

function Field({ label, value }: { label: string; value: string }) {
  return (
    <span className="mr-4 inline-block whitespace-nowrap">
      {label}{" "}
      <b className="inline-block min-w-[24mm] border-b border-slate-400 px-1 text-center">{value || " "}</b>
    </span>
  );
}

function DriverDocsInner() {
  const params = useSearchParams();
  const doc = params.get("doc") ?? "both";
  const route = params.get("route") ?? "";
  const driver = params.get("driver") ?? "";
  const vehicle = params.get("vehicle") ?? "";
  const phone = params.get("phone") ?? "";
  const [ready, setReady] = useState(false);

  // 화면이 다 그려진 뒤 인쇄 대화상자를 띄웁니다. 바로 부르면 글꼴이 적용되기 전에 캡처돼
  // 줄바꿈이 어긋난 채로 미리보기가 뜹니다.
  useEffect(() => {
    const t = setTimeout(() => {
      setReady(true);
      window.print();
    }, 400);
    return () => clearTimeout(t);
  }, []);

  const showNotice = doc === "notice" || doc === "both";
  const showConsent = doc === "consent" || doc === "both";

  return (
    <div className="mx-auto max-w-[190mm] bg-white p-6 text-slate-900">
      <style dangerouslySetInnerHTML={{ __html: PRINT_CSS }} />

      <div className="no-print mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3">
        <span className="text-sm font-bold text-slate-700">
          🖨️ {showNotice && showConsent ? "기사님 안내문 + 동의서" : showNotice ? "기사님 안내문" : "위치정보 수집·이용 동의서"}
        </span>
        {route && <span className="rounded-full bg-white px-2 py-0.5 text-xs font-semibold text-slate-500">{route}</span>}
        {driver && <span className="rounded-full bg-white px-2 py-0.5 text-xs font-semibold text-slate-500">{driver} 기사님</span>}
        <button
          type="button"
          onClick={() => window.print()}
          className="ml-auto rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-bold text-white"
        >
          인쇄
        </button>
        <span className="w-full text-[11px] text-slate-400">
          동의서는 <b>2부</b> 인쇄해 한 부는 학교 보관, 한 부는 기사님께 드립니다.
          {!ready && " 인쇄 대화상자를 준비하는 중입니다…"}
        </span>
      </div>

      {/* ── 안내문 (A4 1장) ───────────────────────────────────────────────
          담당자: "안내문 동의서 2장정도로 줄여줘봐 너무 길어."

          예전 판은 안내문만 2장 반이었습니다. 기사님이 이걸 앉아서 다 읽으실 리가 없고,
          안 읽으시면 길게 쓴 것이 오히려 아무것도 전달하지 못합니다.

          줄이면서 **뺀 것과 남긴 것**을 갈랐습니다.
            · 뺀 것 - 왜 필요한지에 대한 긴 설명, 설치 절차 서술(어차피 학교에서 해드립니다),
              같은 말의 반복(수집 시간 제한이 세 군데 적혀 있었습니다).
            · 남긴 것 - 무엇이 수집되고 안 되는지, 시간 제한, 어디에 안 쓰는지, 설정값 표.
              설정값은 기사님이 직접 볼 일은 없지만 **신호가 끊겼을 때 되짚는 유일한 근거**라
              한 장 안에 남겼습니다.
      ─────────────────────────────────────────────────────────────────── */}
      {showNotice && (
        <div className={"sheet" + (showConsent ? " page-break" : "")}>
          <div className="brand">GIA INTERNATIONAL SCHOOL</div>
          <h1>하원 차량 위치 안내 시스템</h1>
          <p className="meta">기사님께 드리는 안내문</p>

          <p>
            기사님, 늘 아이들을 안전하게 태워주셔서 감사합니다. 하원 시간에 &quot;우리 아이 차가 어디쯤 왔나요&quot; 문의가 오면
            지금은 행정실이 기사님께 전화를 드립니다. 운전 중 전화는 위험합니다. 차량 위치가 학교 화면에 뜨면 전화 없이
            바로 안내할 수 있습니다. <b>기사님께 걸려오는 전화를 줄이는 것이 이 시스템의 목적입니다.</b>
          </p>

          <h2>기사님이 하실 일</h2>
          <p>
            휴대폰에 앱 하나를 켜두시는 것뿐입니다. <b>운행 중에는 휴대폰을 만지실 필요가 없습니다</b> — 도착·출발 버튼도
            없습니다. 화면을 가리지 않으니 내비게이션은 평소대로 쓰시면 되고, 설치·설정은 학교에서 3분이면 해드립니다.
          </p>

          <h2>무엇이 수집되고, 무엇은 안 되나요</h2>
          <table>
            <tbody>
              <tr>
                <th style={{ width: "24%" }}>수집합니다</th>
                <td>차량 위치(위도·경도)·시각·속도, 학교가 발급한 기기번호 8자리</td>
              </tr>
              <tr>
                <th>수집하지 않습니다</th>
                <td>통화·문자·사진·연락처 등 휴대폰 안의 어떤 개인 자료도 보지 않습니다</td>
              </tr>
              <tr>
                <th>시간</th>
                <td>
                  <b>평일 15:30~18:30</b>만 저장합니다. 그 밖의 시간(오전·퇴근 후·주말·휴일)은 서버에 닿는 즉시 버려집니다 —
                  <b> 말이 아니라 시스템에 그렇게 만들어져 있어</b> 앱을 끄지 않으셔도 남지 않습니다. 저장된 것도 90일 뒤 자동 삭제됩니다.
                </td>
              </tr>
              <tr>
                <th>보는 사람</th>
                <td>학교 행정실 직원과 동승 선생님뿐입니다. 학부모를 포함해 학교 밖 누구에게도 주지 않습니다.</td>
              </tr>
              <tr>
                <th>쓰지 않는 곳</th>
                <td>
                  <b>근무 평가·운전 습관 감시에 쓰지 않습니다.</b> 오직 &quot;지금 어디쯤인지&quot; 안내하는 데에만 씁니다.
                </td>
              </tr>
            </tbody>
          </table>
          <p style={{ fontSize: "9.5pt", color: "#475569" }}>
            등원 시간대는 아직 수집하지 않습니다. 나중에 넓히게 되면 그때 다시 말씀드리고 동의를 받겠습니다.
          </p>

          <h2>앱 설정값 (학교에서 해드립니다 · 신호가 끊길 때 확인용)</h2>
          <p style={{ fontSize: "9.5pt", color: "#475569" }}>
            문자로 보내드린 설정 링크를 누르시면 순서대로 나옵니다. 마지막에 <b>&quot;연결되었습니다&quot;</b> 초록 표시가 뜨면 끝입니다.
          </p>
          <table>
            <tbody>
              <tr>
                <th style={{ width: "30%" }}>앱 · 기기번호 · 주소</th>
                <td>Traccar Client(무료) · 학교가 알려드린 8자리 · 학교 주소(처음의 demo.traccar.org는 지웁니다)</td>
              </tr>
              <tr>
                <th>Accuracy · Interval · Angle</th>
                <td>Highest · 30초 · 0</td>
              </tr>
              <tr>
                <th>
                  <b>★ Distance</b>
                </th>
                <td>
                  <b>30 m</b> — 30m 넘게 움직였을 때만 보냅니다. 차가 서 있는 밤·주말엔 전송이 멈춰 데이터와 배터리를 아낍니다.
                </td>
              </tr>
              <tr>
                <th>
                  <b>★ Stop detection</b>
                </th>
                <td>
                  <b>끄기</b> — 켜두면 차가 서 있는 동안 위치가 오지 않아 정류장 도착을 못 잡습니다.
                </td>
              </tr>
              <tr>
                <th>위치 권한 · 배터리</th>
                <td>
                  위치는 <b>항상 허용</b>(&quot;앱 사용 중에만&quot;이면 내비 보시는 동안 끊깁니다) · 배터리 최적화는 예외로 등록
                </td>
              </tr>
            </tbody>
          </table>
          <p style={{ fontSize: "9.5pt", color: "#475569" }}>
            <b>아이폰</b>은 며칠 뒤 &quot;백그라운드에서 위치를 사용했습니다. 계속 허용할까요?&quot; 창이 뜹니다. 반드시{" "}
            <b>&quot;항상 허용&quot;</b>을 눌러주세요.
          </p>

          <p style={{ marginTop: "5mm", fontSize: "9.5pt", color: "#64748b" }}>
            GIA International School 행정실 · 궁금한 점은 언제든 행정실로 말씀해 주세요.
          </p>
        </div>
      )}

      {/* ── 동의서 (A4 1장) ───────────────────────────────────────────────
          법적 문서라 **항목은 하나도 빼지 않았습니다** - 목적·수집항목·시간제한·보유기간·
          열람범위·제3자 제공·거부권·철회권. 줄인 것은 문장뿐입니다. 같은 말을 두 번 쓰거나
          안내문에 이미 있는 설명을 옮겨 적은 부분을 걷어냈습니다.
      ─────────────────────────────────────────────────────────────────── */}
      {showConsent && (
        <div className="sheet">
          <div className="brand">GIA INTERNATIONAL SCHOOL</div>
          <h1>위치정보 수집·이용 동의서</h1>
          <p className="meta">하원 차량 위치 안내 시스템</p>

          <p>
            GIA International School(이하 &quot;학교&quot;)은 하원 차량의 위치를 아래 범위에서 수집·이용하고자 합니다. 읽으시고 동의
            여부를 표시해 주십시오.
          </p>

          <table>
            <tbody>
              <tr>
                <th style={{ width: "22%" }}>1. 목적</th>
                <td>
                  하원 차량 위치 확인 및 학부모 문의 안내, 학교 도착·출발 자동 감지에 따른 대기 학생 안내, 정류장 위치 정확도
                  개선. <b>사적 이동경로 파악·근무시간 감시·운전습관 평가에는 사용하지 않습니다.</b>
                </td>
              </tr>
              <tr>
                <th>2. 수집 항목</th>
                <td>
                  단말기 위치(위도·경도)·측정 시각·이동 속도·위치 정확도, 학교 발급 기기 식별번호(8자리), 성명·연락처·담당
                  노선·차량번호. 통화 내용, 문자메시지, 사진, 연락처 등 단말기의 다른 정보는 일절 수집하지 않습니다.
                </td>
              </tr>
              <tr>
                <th>3. 수집 시간</th>
                <td>
                  평일(월~금) <b>15:30~18:30</b>에 측정된 위치만 저장합니다. 그 외 시간(오전·야간·주말·공휴일)에 전송된 위치는 서버
                  도착 즉시 폐기하며 저장하지 않습니다. 이는 문서상의 약속이 아니라 시스템에 구현되어 있습니다. 등원 시간대는
                  본 동의에 포함되지 않으며, 확대 시 별도로 다시 동의를 받습니다.
                </td>
              </tr>
              <tr>
                <th>4. 보유 기간</th>
                <td>
                  수집일로부터 <b>90일</b> 경과 시 매일 정해진 시각에 자동으로 완전 삭제합니다. 동의 철회 또는 계약 종료 시에는
                  그때까지 저장된 위치정보를 지체 없이 파기합니다.
                </td>
              </tr>
              <tr>
                <th>5. 열람 · 제3자</th>
                <td>
                  학교 행정실 담당 직원과 하원 동승 교직원만 열람합니다. 학부모를 포함한 학교 밖의 어떠한 개인·기관에도
                  제공·위탁·판매하지 않으며, 광고나 통계 목적으로도 외부에 넘기지 않습니다. 법령에 따라 수사기관 등이 적법한
                  절차로 요구하는 경우 외에는 예외가 없습니다.
                </td>
              </tr>
              <tr>
                <th>6. 거부 · 철회</th>
                <td>
                  동의하지 않을 권리가 있으며, <b>동의하지 않으셔도 배차·계약·처우에 어떠한 불이익도 없습니다.</b> 다만 해당 차량은
                  위치 안내 대상에서 빠져 학교가 종전처럼 유선으로 문의하게 됩니다. 동의는 언제든 철회하실 수 있고, 행정실에
                  알려주시면 즉시 수집을 중단하고 기존 기록을 파기합니다. 앱을 삭제하시는 것만으로도 전송은 즉시 멈춥니다.
                </td>
              </tr>
            </tbody>
          </table>

          <div style={{ marginTop: "5mm", border: "1px solid #94a3b8", padding: "4mm" }}>
            <p style={{ fontWeight: 700 }}>위 내용을 모두 확인하였으며, 개인위치정보의 수집·이용에</p>
            <p style={{ fontSize: "12pt", fontWeight: 700, margin: "3mm 0" }}>
              ☐ 동의합니다 &nbsp;&nbsp;&nbsp;&nbsp;&nbsp; ☐ 동의하지 않습니다
            </p>
            <table>
              <tbody>
                <tr>
                  <th style={{ width: "22%" }}>성명</th>
                  <td style={{ height: "8mm" }}>{driver}</td>
                  <th style={{ width: "22%" }}>연락처</th>
                  <td>{phone}</td>
                </tr>
                <tr>
                  <th>담당 노선</th>
                  <td style={{ height: "8mm" }}>{route}</td>
                  <th>차량번호</th>
                  <td>{vehicle}</td>
                </tr>
              </tbody>
            </table>
            <p style={{ marginTop: "5mm", textAlign: "right", fontSize: "11pt" }}>
              20&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;년&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;월&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;일
              &nbsp;&nbsp;&nbsp; 성명{" "}
              <span style={{ display: "inline-block", minWidth: "40mm", borderBottom: "1px solid #475569" }} /> (서명 또는 인)
            </p>
          </div>

          <p style={{ marginTop: "4mm", fontSize: "9.5pt", color: "#64748b" }}>
            2부 작성 · 학교 보관 1부, 기사님 1부 &nbsp;·&nbsp; GIA International School 행정실{" "}
            <Field label="담당자" value="" /> <Field label="연락처" value="" />
          </p>
        </div>
      )}
    </div>
  );
}

export default function DriverDocsPrintPage() {

  return (
    <Suspense fallback={<div className="p-8 text-sm text-slate-400">인쇄본을 준비하는 중…</div>}>
      <DriverDocsInner />
    </Suspense>
  );
}
