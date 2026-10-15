import type { ReactNode } from "react";
import PrintButton from "@/components/finance/PrintButton";

/**
 * 인증 증거 한 장의 틀 — 학교 이름·자료 제목·기간·만든 날짜·출처 문구가 늘 같은 자리에 있습니다.
 *
 * 심사단은 자료 수십 장을 넘겨 봅니다. 장마다 머리말 모양이 다르면 «언제 기준 숫자인가»를 매번 찾게 되고, 출처가
 * 안 적힌 숫자는 증거로 쓰이지 않습니다. 그래서 틀을 하나로 둡니다. 인쇄할 때는 위 안내줄이 빠집니다.
 */
export default function ExhibitSheet({
  exhibitNo,
  title,
  subtitle,
  period,
  generated,
  source,
  children,
  landscape,
}: {
  exhibitNo?: string;
  title: string;
  subtitle?: string;
  period: string;
  generated: string;
  source: string;
  children: ReactNode;
  landscape?: boolean;
}) {
  return (
    <div className="min-h-screen bg-slate-100 p-4 print:bg-white print:p-0">
      <style>{`
        @page { size: A4 ${landscape ? "landscape" : "portrait"}; margin: 14mm; }
        @media print { .no-print { display: none !important; } }
        .ex table { width: 100%; border-collapse: collapse; font-size: 10.5px; }
        .ex th { background: #1e3a5f; color: #fff; text-align: left; padding: 5px 7px; font-weight: 700; }
        .ex td { border-bottom: 1px solid #e2e8f0; padding: 4px 7px; vertical-align: top; }
        .ex tr { break-inside: avoid; }
        .ex h2 { font-size: 13px; font-weight: 800; color: #1e3a5f; margin: 18px 0 6px; }
        .ex .num { text-align: right; font-variant-numeric: tabular-nums; }
        .ex .kpis { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; margin: 10px 0 4px; }
        .ex .kpi { border: 1px solid #cbd5e1; border-radius: 6px; padding: 8px 10px; }
        .ex .kpi b { display: block; font-size: 18px; color: #0f172a; }
        .ex .kpi span { font-size: 9.5px; color: #475569; }
        .ex p.note { font-size: 10px; color: #475569; line-height: 1.55; margin-top: 6px; }
      `}</style>
      <div className="no-print mx-auto mb-3 flex max-w-[210mm] items-center gap-2 text-[12px] text-slate-600">
        <span>
          인쇄 창에서 <b>「PDF로 저장」</b>을 고르면 드라이브에 올릴 파일이 됩니다. 학생 이름·연락처는 담지 않았습니다.
        </span>
        <span className="ml-auto">
          <PrintButton />
        </span>
      </div>
      <div className={`ex mx-auto bg-white p-8 shadow-sm print:max-w-none print:p-0 print:shadow-none ${landscape ? "max-w-[297mm]" : "max-w-[210mm]"}`}>
        <div style={{ borderBottom: "3px solid #1e3a5f", paddingBottom: 8, display: "flex", alignItems: "flex-end", gap: 12 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1, color: "#64748b" }}>
              GIA MICRO SCHOOL · ACCREDITATION EVIDENCE{exhibitNo ? ` · ${exhibitNo}` : ""}
            </div>
            <div style={{ fontSize: 19, fontWeight: 800, color: "#0f172a", marginTop: 2 }}>{title}</div>
            {subtitle && <div style={{ fontSize: 11, color: "#475569", marginTop: 2 }}>{subtitle}</div>}
          </div>
          <div style={{ textAlign: "right", fontSize: 10, color: "#475569", lineHeight: 1.5 }}>
            Period: <b>{period}</b>
            <br />
            Generated: {generated}
          </div>
        </div>
        {children}
        <div style={{ marginTop: 22, borderTop: "1px solid #cbd5e1", paddingTop: 6, fontSize: 9, color: "#64748b" }}>
          Source: {source}. Figures are generated directly from GIA&apos;s school operations system (GIA Ops) records; no student names or contact
          details are included.
        </div>
      </div>
    </div>
  );
}

export function Kpi({ value, label }: { value: ReactNode; label: string }) {
  return (
    <div className="kpi">
      <b>{value}</b>
      <span>{label}</span>
    </div>
  );
}

export const pct = (n: number | null | undefined) => (n == null ? "—" : `${n.toFixed(1)}%`);
export const ratio = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 1000) / 10 : null);
export const monthEn = (ym: string) => {
  const [y, m] = ym.split("-").map(Number);
  return `${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][m - 1]} ${y}`;
};
