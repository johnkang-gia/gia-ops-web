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
  .sheet { line-height: 1.65; color: #111; }
  .sheet h1 { font-size: 20pt; font-weight: 800; margin: 0 0 2mm; }
  .sheet h2 { font-size: 12.5pt; font-weight: 800; margin: 7mm 0 2mm; padding-bottom: 1mm; border-bottom: 1px solid #cbd5e1; }
  .sheet p, .sheet li { font-size: 10.5pt; margin: 0 0 2mm; }
  .sheet ul { margin: 0 0 3mm; padding-left: 5mm; }
  .sheet li { list-style: disc; }
  .sheet table { width: 100%; border-collapse: collapse; margin: 2mm 0 4mm; }
  .sheet th, .sheet td { border: 1px solid #94a3b8; padding: 2mm 3mm; font-size: 10pt; text-align: left; vertical-align: top; }
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

      {/* ── 안내문 ─────────────────────────────────────────────────────── */}
      {showNotice && (
        <div className={"sheet" + (showConsent ? " page-break" : "")}>
          <div className="brand">GIA INTERNATIONAL SCHOOL</div>
          <h1>하원 차량 위치 안내 시스템</h1>
          <p className="meta">기사님께 드리는 안내문</p>

          <p>기사님, 늘 아이들을 안전하게 태워주셔서 감사합니다.</p>
          <p>
            이번 학기부터 하원 차량의 위치를 학교에서 확인할 수 있는 시스템을 시작합니다. 기사님께 부탁드릴 일과, 무엇이 어떻게
            쓰이는지 솔직하게 말씀드리려고 이 안내문을 준비했습니다.
          </p>

          <h2>왜 필요한가요</h2>
          <p>
            하원 시간에 학부모님들께서 &quot;우리 아이 차가 어디쯤 왔나요&quot;라고 자주 문의를 주십니다. 지금은 행정실에서 기사님께
            전화를 드려 여쭤보는 수밖에 없는데, 운전 중에 전화를 받으시는 것이 위험합니다.
          </p>
          <p>
            차량 위치가 학교 화면에 뜨면 행정실이 전화 없이 바로 안내할 수 있습니다.{" "}
            <b>기사님께 걸려오는 전화가 줄어드는 것이 이 시스템의 가장 큰 목적입니다.</b>
          </p>

          <h2>기사님이 하실 일은 딱 하나입니다</h2>
          <p>휴대폰에 앱을 하나 설치하고, 아침에 켜두시는 것뿐입니다. 운행 중에는 휴대폰을 만지실 필요가 전혀 없습니다.</p>
          <ul>
            <li>앱은 화면을 가리지 않습니다. 켜두신 채로 내비게이션을 평소처럼 쓰시면 됩니다.</li>
            <li>도착·출발 버튼을 누르실 필요가 없습니다. 학교 근처에 오시면 자동으로 처리됩니다.</li>
            <li>설치와 설정은 학교에서 직접 해드립니다. 3분이면 끝납니다.</li>
          </ul>

          <h2>무엇이 수집되나요</h2>
          <table>
            <thead>
              <tr>
                <th style={{ width: "50%" }}>수집되는 것</th>
                <th>수집되지 않는 것</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>차량의 위치(위도·경도)와 시각, 속도</td>
                <td>통화 내용, 문자, 사진, 연락처</td>
              </tr>
              <tr>
                <td>학교에서 발급한 기기 번호(8자리)</td>
                <td>휴대폰에 저장된 어떤 개인 자료도 보지 않습니다</td>
              </tr>
            </tbody>
          </table>
          <p>수집 시간도 제한되어 있습니다.</p>
          <ul>
            <li>
              <b>평일 오후 3시 30분부터 오후 6시 30분까지</b>, 하원 운행 3시간의 위치만 저장됩니다.
            </li>
            <li>그 외 시간(오전·퇴근 후·주말·휴일)의 위치는 학교 서버에 도착하는 즉시 버려집니다. 저장되지 않습니다.</li>
            <li>
              이것은 말로만 드리는 약속이 아니라 <b>시스템에 그렇게 만들어져 있습니다.</b> 앱을 끄지 않으셔도 그 시간 밖의 이동은
              기록에 남지 않습니다.
            </li>
            <li>저장된 위치도 90일이 지나면 시스템이 자동으로 완전히 삭제합니다.</li>
            <li>등원 시간대는 아직 수집하지 않습니다. 나중에 등원까지 넓히게 되면 그때 다시 말씀드리고 동의를 받겠습니다.</li>
          </ul>

          <h2>누가 볼 수 있나요 · 어디에 쓰나요</h2>
          <p>이 위치는 하원 차량이 제대로 운영되고 있는지 확인하는 용도로만 씁니다. 그 외의 목적은 없습니다.</p>
          <ul>
            <li>학교 행정실 직원과 동승 선생님만 봅니다.</li>
            <li>학부모님을 포함하여 학교 밖의 누구에게도 제공하지 않습니다.</li>
            <li>외부 업체·기관에 넘기지 않고, 판매하거나 위탁하지도 않습니다.</li>
            <li>
              <b>근무 평가나 운전 습관 감시에 쓰지 않습니다.</b> 오직 &quot;지금 어디쯤인지&quot; 안내하는 데에만 씁니다.
            </li>
          </ul>

          <h2>앱 설치와 설정</h2>
          <p>
            학교에서 기사님 휴대폰으로 설정 링크를 문자(또는 카카오톡)로 보내드립니다. 그 링크를 누르시면 순서대로 하나씩
            나오고, 화면에 나온 대로 누르기만 하시면 됩니다. 마지막에 <b>&quot;연결되었습니다&quot;</b>라는 초록색 표시가 나오면 끝난
            것입니다. 학교에 오셨을 때는 사무실 모니터의 QR 코드를 휴대폰 카메라로 찍으시면 같은 화면이 열립니다.
          </p>
          <table>
            <thead>
              <tr>
                <th style={{ width: "34%" }}>설정 항목</th>
                <th style={{ width: "26%" }}>설정값</th>
                <th>왜 이렇게 하나요</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>설치할 앱</td>
                <td>Traccar Client</td>
                <td>무료이고 광고·결제가 없습니다</td>
              </tr>
              <tr>
                <td>Device identifier</td>
                <td>학교에서 알려드린 8자리</td>
                <td>어느 차량인지 구분합니다</td>
              </tr>
              <tr>
                <td>Server URL</td>
                <td>학교에서 알려드린 주소</td>
                <td>처음의 demo.traccar.org는 지웁니다</td>
              </tr>
              <tr>
                <td>Location accuracy</td>
                <td>Highest</td>
                <td>학교 도착을 100m 안에서 정확히 잡습니다</td>
              </tr>
              <tr>
                <td>Interval (간격)</td>
                <td>30 (초)</td>
                <td>운행 중 30초마다 위치를 확인합니다</td>
              </tr>
              <tr>
                <td>
                  <b>★ Distance (거리)</b>
                </td>
                <td>
                  <b>80 (m)</b>
                </td>
                <td>
                  80m 이상 움직였을 때만 보냅니다. 차가 서 있는 밤·주말에는 아무것도 보내지 않아 데이터·배터리를 아낍니다
                </td>
              </tr>
              <tr>
                <td>Angle (각도)</td>
                <td>0</td>
                <td>방향이 바뀔 때마다 추가로 보내지 않습니다</td>
              </tr>
              <tr>
                <td>
                  <b>★ Stop detection</b>
                </td>
                <td>
                  <b>끄기</b>
                </td>
                <td>켜두면 차가 서 있는 동안 위치가 오지 않아 정류장 도착을 못 잡습니다</td>
              </tr>
              <tr>
                <td>위치 권한</td>
                <td>항상 허용</td>
                <td>&quot;앱 사용 중에만&quot;이면 내비 보시는 동안 끊깁니다</td>
              </tr>
              <tr>
                <td>배터리 최적화</td>
                <td>예외로 등록</td>
                <td>절전 모드에서 조용히 멈추는 것을 막습니다</td>
              </tr>
            </tbody>
          </table>
          <p style={{ marginTop: "4mm", fontSize: "10pt", color: "#475569" }}>
            <b>아이폰을 쓰시는 경우</b> 며칠 뒤 &quot;Traccar Client가 백그라운드에서 위치를 사용했습니다. 계속 허용할까요?&quot; 창이
            뜹니다. 여기서 반드시 <b>&quot;항상 허용&quot;</b>을 눌러 주세요.
          </p>

          <p style={{ marginTop: "8mm", fontSize: "9.5pt", color: "#64748b" }}>
            GIA International School 행정실 · 문의 사항은 언제든 행정실로 말씀해 주세요.
          </p>
        </div>
      )}

      {/* ── 동의서 ─────────────────────────────────────────────────────── */}
      {showConsent && (
        <div className="sheet">
          <div className="brand">GIA INTERNATIONAL SCHOOL</div>
          <h1>위치정보 수집·이용 동의서</h1>
          <p className="meta">하원 차량 위치 안내 시스템</p>

          <p>
            GIA International School(이하 &quot;학교&quot;)은 하원 차량의 실시간 위치를 학교 운영 목적으로 수집·이용하고자 합니다.
            아래 내용을 읽으시고 동의 여부를 표시해 주십시오.
          </p>

          <h2>1. 수집·이용 목적</h2>
          <ul>
            <li>하원 차량의 현재 위치를 학교 행정실이 확인하여 학부모 문의에 안내</li>
            <li>차량의 학교 도착·출발을 자동으로 감지하여 대기 학생 안내 및 하원 진행 관리</li>
            <li>정류장 위치 정보의 정확도 개선</li>
            <li>개인의 사적인 이동 경로 파악, 근무 시간 감시, 운전 습관 평가 등에는 사용하지 않습니다.</li>
          </ul>

          <h2>2. 수집 항목</h2>
          <table>
            <tbody>
              <tr>
                <th style={{ width: "26%" }}>개인위치정보</th>
                <td>차량 운행 중 단말기의 위치(위도·경도), 측정 시각, 이동 속도, 위치 정확도</td>
              </tr>
              <tr>
                <th>식별 정보</th>
                <td>학교가 발급한 기기 식별번호(8자리)</td>
              </tr>
              <tr>
                <th>운행 정보</th>
                <td>성명, 연락처, 담당 노선, 차량번호</td>
              </tr>
            </tbody>
          </table>
          <p>통화 내용, 문자메시지, 사진, 연락처 등 단말기의 다른 정보는 일절 수집하지 않습니다.</p>

          <h2>3. 수집 시간의 제한</h2>
          <ul>
            <li>평일(월~금) 오후 3시 30분 ~ 오후 6시 30분, 하원 운행 시간 3시간에 측정된 위치만 저장합니다.</li>
            <li>
              그 외 시간(오전, 야간, 주말, 공휴일)에 전송된 위치는 학교 서버에 도착하는 즉시 폐기하며 저장하지 않습니다. 이는
              문서상의 약속이 아니라 시스템에 직접 구현되어 있습니다.
            </li>
            <li>등원 시간대의 수집은 이 동의서에 포함되지 않습니다. 향후 확대할 경우 별도로 다시 동의를 받겠습니다.</li>
          </ul>

          <h2>4. 보유 및 이용 기간</h2>
          <ul>
            <li>수집일로부터 90일이 지나면 시스템이 매일 정해진 시각에 자동으로 완전히 삭제합니다.</li>
            <li>동의를 철회하시거나 계약이 종료되는 경우, 그때까지 저장된 위치정보를 지체 없이 파기합니다.</li>
          </ul>

          <h2>5. 열람 범위 및 제3자 제공</h2>
          <ul>
            <li>학교 행정실 담당 직원과 하원 동승 교직원만 열람합니다.</li>
            <li>학부모를 포함하여 학교 밖의 어떠한 개인·기관에도 제공하지 않습니다.</li>
            <li>제3자에게 제공·위탁·판매하지 않으며, 광고나 통계 목적으로도 외부에 넘기지 않습니다.</li>
            <li>법령에 따라 수사기관 등이 적법한 절차로 요구하는 경우를 제외하고는 예외가 없습니다.</li>
            <li>근무 평가, 징계, 운전 습관 감시 등 본 목적 외의 용도로 사용하지 않습니다.</li>
          </ul>

          <h2>6. 동의를 거부할 권리 · 7. 동의의 철회</h2>
          <p>
            귀하는 위 사항에 동의하지 않을 권리가 있으며, 동의하지 않더라도 배차·계약·처우에 어떠한 불이익도 받지 않습니다. 다만
            해당 차량은 위치 안내 대상에서 제외되어, 학교가 운행 상황을 확인할 때 종전과 같이 유선으로 문의하게 됩니다. 동의는
            언제든지 철회하실 수 있으며, 행정실에 알려주시면 즉시 수집을 중단하고 기존 기록을 파기합니다. 단말기에서 앱을
            삭제하시는 것만으로도 위치 전송은 즉시 중단됩니다.
          </p>

          <div style={{ marginTop: "6mm", border: "1px solid #94a3b8", padding: "4mm" }}>
            <p style={{ fontWeight: 700 }}>위 내용을 모두 확인하였으며, 개인위치정보의 수집·이용에</p>
            <p style={{ fontSize: "12pt", fontWeight: 700, margin: "3mm 0" }}>
              ☐ 동의합니다 &nbsp;&nbsp;&nbsp;&nbsp;&nbsp; ☐ 동의하지 않습니다
            </p>
            <table>
              <tbody>
                <tr>
                  <th style={{ width: "22%" }}>성명</th>
                  <td style={{ height: "9mm" }}>{driver}</td>
                  <th style={{ width: "22%" }}>연락처</th>
                  <td>{phone}</td>
                </tr>
                <tr>
                  <th>담당 노선</th>
                  <td style={{ height: "9mm" }}>{route}</td>
                  <th>차량번호</th>
                  <td>{vehicle}</td>
                </tr>
              </tbody>
            </table>
            <p style={{ marginTop: "6mm", textAlign: "right", fontSize: "11pt" }}>
              20&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;년&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;월&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;일
            </p>
            <p style={{ marginTop: "3mm", textAlign: "right", fontSize: "11pt" }}>
              성명 <span style={{ display: "inline-block", minWidth: "45mm", borderBottom: "1px solid #475569" }} /> (서명 또는 인)
            </p>
          </div>

          <p style={{ marginTop: "6mm", fontSize: "9.5pt", color: "#64748b" }}>
            학교 보관용 · 사본 1부를 기사님께 드립니다.
            <br />
            GIA International School 행정실 &nbsp; <Field label="담당자" value="" /> <Field label="연락처" value="" />
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
