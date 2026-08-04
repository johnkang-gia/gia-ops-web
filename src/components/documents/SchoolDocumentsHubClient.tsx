"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { ManualSection, SchoolDocument } from "@/lib/types";
import GuideButton from "@/components/common/GuideButton";

const GUIDE_SECTIONS = [
  {
    title: "🗄️ 학교 문서함이란?",
    lines: [
      "GIA에서 만들어지는 서류·보고서를 한곳에 모았습니다. 업무 보고서·회의 보고서는 상단 카드에서 기간별로 열람·인쇄하고, 매뉴얼·운영계획안·서류함은 아래 목록에서 검색해 바로 열어볼 수 있습니다.",
      "카드를 누르면 해당 화면으로 이동하고, 검색창에 이름이나 카테고리를 입력하면 매뉴얼·운영계획안·서류함 전체에서 바로 찾아줍니다.",
    ],
  },
];

type DocRow = {
  key: string;
  kind: "매뉴얼" | "운영계획안" | "서류함";
  title: string;
  subtitle: string;
  href: string;
  updatedAt: string;
};

function formatDate(iso: string) {
  if (!iso) return "-";
  return iso.slice(0, 10);
}

export default function SchoolDocumentsHubClient({
  manuals,
  documents,
}: {
  manuals: ManualSection[];
  documents: SchoolDocument[];
}) {
  const [query, setQuery] = useState("");

  const rows: DocRow[] = useMemo(() => {
    const manualRows: DocRow[] = manuals.map((m) => ({
      key: `manual-${m.id}`,
      kind: m.target_doc === "학부모용" ? "운영계획안" : "매뉴얼",
      title: m.category,
      subtitle: m.target_doc === "학부모용" ? "GIA 운영계획안 (학부모 배포용)" : "GIA 실무자매뉴얼",
      href: `/manuals?doc=${encodeURIComponent(m.target_doc)}`,
      updatedAt: m.updated_at,
    }));
    const documentRows: DocRow[] = documents.map((d) => ({
      key: `doc-${d.id}`,
      kind: "서류함",
      title: d.name,
      subtitle: d.category ? `${d.category} · ${d.status}` : d.status,
      href: "/documents",
      updatedAt: d.updated_at,
    }));
    return [...manualRows, ...documentRows].sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
  }, [manuals, documents]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) => r.title.toLowerCase().includes(q) || r.subtitle.toLowerCase().includes(q) || r.kind.includes(q)
    );
  }, [rows, query]);

  const displayed = query.trim() ? filtered : filtered.slice(0, 15);

  const manualCount = manuals.filter((m) => m.target_doc === "실무자용").length;
  const planCount = manuals.filter((m) => m.target_doc === "학부모용").length;

  const KIND_STYLE: Record<DocRow["kind"], string> = {
    매뉴얼: "bg-blue-50 text-blue-600",
    운영계획안: "bg-teal-50 text-teal-600",
    서류함: "bg-amber-50 text-amber-700",
  };

  return (
    <div className="mx-auto flex h-full max-w-5xl flex-col overflow-hidden">
      <div className="mb-4 flex shrink-0 items-center justify-between gap-2">
        <div>
          <h1 className="text-lg font-bold">🗄️ 학교 문서함</h1>
          <p className="mt-0.5 text-xs text-slate-500">
            GIA의 보고서·매뉴얼·운영계획안·서류를 한곳에서 열람·검색·인쇄합니다.
          </p>
        </div>
        <GuideButton title="학교 문서함 사용 가이드" sections={GUIDE_SECTIONS} />
      </div>

      <div className="mb-4 grid shrink-0 grid-cols-2 gap-2 sm:grid-cols-4">
        <Link
          href="/school/documents/reports"
          className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm transition hover:border-gia-navy hover:shadow-md"
        >
          <div className="text-lg">📊</div>
          <div className="mt-1 text-sm font-bold text-slate-700">보고서</div>
          <div className="text-[11px] text-slate-400">업무 · 회의</div>
        </Link>
        <Link
          href="/manuals?doc=실무자용"
          className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm transition hover:border-gia-navy hover:shadow-md"
        >
          <div className="text-lg">📗</div>
          <div className="mt-1 text-sm font-bold text-slate-700">매뉴얼</div>
          <div className="text-[11px] text-slate-400">{manualCount}개 항목</div>
        </Link>
        <Link
          href="/manuals?doc=학부모용"
          className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm transition hover:border-gia-navy hover:shadow-md"
        >
          <div className="text-lg">📘</div>
          <div className="mt-1 text-sm font-bold text-slate-700">운영계획안</div>
          <div className="text-[11px] text-slate-400">{planCount}개 항목</div>
        </Link>
        <Link
          href="/documents"
          className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm transition hover:border-gia-navy hover:shadow-md"
        >
          <div className="text-lg">📁</div>
          <div className="mt-1 text-sm font-bold text-slate-700">서류함</div>
          <div className="text-[11px] text-slate-400">{documents.length}건</div>
        </Link>
      </div>

      <div className="mb-3 shrink-0">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="🔍 문서 이름, 카테고리로 검색 (매뉴얼·운영계획안·서류함)"
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="mb-2 text-sm font-bold text-slate-700">
            {query.trim() ? `🔎 검색 결과 (${filtered.length}건)` : `🆕 최근 등록·수정된 문서`}
          </h2>
          {displayed.length === 0 ? (
            <p className="text-xs text-slate-400">
              {query.trim() ? "검색 결과가 없습니다." : "아직 등록된 매뉴얼/서류가 없습니다."}
            </p>
          ) : (
            <div className="flex flex-col divide-y divide-slate-100">
              {displayed.map((r) => (
                <Link
                  key={r.key}
                  href={r.href}
                  className="flex items-center gap-2 py-2 text-xs hover:bg-slate-50"
                >
                  <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${KIND_STYLE[r.kind]}`}>
                    {r.kind}
                  </span>
                  <span className="flex-1 truncate font-medium text-slate-700">{r.title}</span>
                  <span className="shrink-0 truncate text-slate-400">{r.subtitle}</span>
                  <span className="shrink-0 font-mono text-[10px] text-slate-400">{formatDate(r.updatedAt)}</span>
                </Link>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
