"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { genCaseId } from "@/lib/caseId";
import { friendlyError } from "@/lib/errorMessage";
import type { GiaSystem } from "@/lib/types";
import GuideButton from "@/components/common/GuideButton";

const GUIDE_SECTIONS = [
  {
    title: "🧩 GIA시스템이란?",
    lines: [
      "다른 공립·사립·국제학교가 일반적으로 갖추는 운영 시스템을 대분류(예: 재정, 인사·교직원, 학사, 운영)→중분류→세부 항목으로 세분화해서, GIA가 이미 갖췄는지(보유/부분보유/미보유) 체크하는 화면입니다.",
      "\"운영관리 제안함으로 보내기\"를 누르면 제안함→채택예정→발행 절차를 그대로 거치고, 발행되는 순간 이 표의 상태가 자동으로 \"보유\"로 바뀝니다.",
      "필요한 서류가 있는 항목은 \"📁 서류함에 만들기\"로 서류함(문서함)에 같은 분류가 적용된 서류를 바로 만들 수 있습니다.",
    ],
  },
];

const STATUS_STYLE: Record<GiaSystem["status"], string> = {
  보유: "bg-teal-50 text-teal-700",
  부분보유: "bg-amber-50 text-amber-700",
  미보유: "bg-slate-100 text-slate-500",
};

const STATUSES: GiaSystem["status"][] = ["보유", "부분보유", "미보유"];

export default function GiaSystemsClient({ initialSystems }: { initialSystems: GiaSystem[] }) {
  const [systems, setSystems] = useState<GiaSystem[]>(initialSystems);
  const [suggesting, setSuggesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [proposedIds, setProposedIds] = useState<Set<string>>(new Set());
  const [proposingId, setProposingId] = useState<string | null>(null);
  const [creatingDocId, setCreatingDocId] = useState<string | null>(null);
  const [activeMajor, setActiveMajor] = useState<string>("전체");

  // 대분류 > 중분류 순서로 묶습니다(요청: "대분류항목에서부터 더 들어가서 운영-교직원-교직원계약서
  // 이런식으로 항목을 세분화"). 대분류 탭으로 먼저 좁히고, 그 안에서 중분류별 소그룹으로 보여줍니다.
  const majors = useMemo(() => {
    const set = new Set(systems.map((s) => s.major || "(미분류)"));
    return Array.from(set);
  }, [systems]);

  const grouped = useMemo(() => {
    const filtered = activeMajor === "전체" ? systems : systems.filter((s) => (s.major || "(미분류)") === activeMajor);
    const map = new Map<string, GiaSystem[]>();
    for (const s of filtered) {
      const key = `${s.major || "(미분류)"} / ${s.category}`;
      const list = map.get(key) ?? [];
      list.push(s);
      map.set(key, list);
    }
    return [...map.entries()];
  }, [systems, activeMajor]);

  const summary = useMemo(() => {
    const counts = { 보유: 0, 부분보유: 0, 미보유: 0 };
    for (const s of systems) counts[s.status]++;
    return counts;
  }, [systems]);

  const majorSummary = useMemo(() => {
    const map = new Map<string, { 보유: number; 부분보유: number; 미보유: number }>();
    for (const s of systems) {
      const key = s.major || "(미분류)";
      const c = map.get(key) ?? { 보유: 0, 부분보유: 0, 미보유: 0 };
      c[s.status]++;
      map.set(key, c);
    }
    return map;
  }, [systems]);

  async function suggest() {
    setSuggesting(true);
    setError(null);
    try {
      const res = await fetch("/api/ai/gia-systems-suggest", { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "제안을 생성하지 못했습니다.");
      const rows = (json.rows ?? []) as GiaSystem[];
      if (rows.length === 0) {
        setError("새로 제안할 만한 항목을 찾지 못했습니다(이미 대부분 반영됐거나, 검색 결과가 충분하지 않았습니다).");
      } else {
        setSystems((prev) => [...prev, ...rows]);
      }
    } catch (err) {
      setError(friendlyError("벤치마킹 제안을 받아오지 못했습니다.", err));
    } finally {
      setSuggesting(false);
    }
  }

  async function updateStatus(id: string, status: GiaSystem["status"]) {
    setSystems((prev) => prev.map((s) => (s.id === id ? { ...s, status } : s)));
    const supabase = createClient();
    const { error } = await supabase.from("gia_systems").update({ status }).eq("id", id);
    if (error) setError(friendlyError("상태를 변경하지 못했습니다.", error));
  }

  async function sendToProposals(s: GiaSystem) {
    setProposingId(s.id);
    try {
      const supabase = createClient();
      const finalText = [s.name, s.description, s.benchmark_school ? `(참고 사례: ${s.benchmark_school})` : null]
        .filter(Boolean)
        .join("\n\n");
      const { error } = await supabase.from("proposals").insert({
        case_id: genCaseId("PRP"),
        source: "system",
        source_id: s.id,
        date: new Date().toISOString().slice(0, 10),
        target_doc: "실무자용",
        category: s.category,
        final_text: finalText,
      });
      if (error) throw new Error(error.message);
      setProposedIds((prev) => new Set(prev).add(s.id));
    } catch (err) {
      setError(friendlyError("운영관리 제안함으로 보내지 못했습니다.", err));
    } finally {
      setProposingId(null);
    }
  }

  // 요청 3번: "필요한 서류가 있다면 서류함에 만들어주고, 서류함에 만들때에도 이 분류를 그대로
  // 적용해서 서류도 자동으로 분류화 되도록". GIA시스템 항목의 major/category(대분류/중분류)를
  // 그대로 documents.category_major/category에 넣어서 만들고, gia_systems.document_id로
  // 연결해두면 다음부터는 새로 만들지 않고 바로 서류함으로 이동할 수 있습니다.
  async function createDocument(s: GiaSystem) {
    setCreatingDocId(s.id);
    try {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("documents")
        .insert({
          case_id: genCaseId("DOC"),
          name: s.name,
          category: s.category,
          category_major: s.major,
          gia_system_id: s.id,
          status: "필요",
          notes: `GIA시스템 "${s.major} / ${s.category}" 항목에서 자동 생성됨${s.description ? `\n${s.description}` : ""}`,
        })
        .select()
        .single();
      if (error) throw new Error(error.message);
      const { error: updateErr } = await supabase
        .from("gia_systems")
        .update({ document_id: data.id })
        .eq("id", s.id);
      if (updateErr) throw new Error(updateErr.message);
      setSystems((prev) => prev.map((x) => (x.id === s.id ? { ...x, document_id: data.id } : x)));
    } catch (err) {
      setError(friendlyError("서류함에 만들지 못했습니다.", err));
    } finally {
      setCreatingDocId(null);
    }
  }

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h1 className="mb-1 text-lg font-bold">🧩 GIA시스템</h1>
          <p className="text-xs text-slate-500">
            다른 공립·사립·국제학교가 일반적으로 갖추는 운영 시스템을 대분류→중분류→세부 항목으로
            세분화해서, GIA가 이미 갖췄는지 한눈에 봅니다. &quot;운영관리 제안함으로 보내기&quot;를
            누르면 기존 제안함→채택예정→발행 절차를 그대로 거치고, 발행되는 순간 이 표의 상태가
            자동으로 &quot;보유&quot;로 바뀝니다.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <button
            onClick={suggest}
            disabled={suggesting}
            className="shrink-0 rounded-lg bg-gia-navy px-3 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
          >
            {suggesting ? "검색 중..." : "✨ AI로 벤치마킹 제안받기"}
          </button>
          <GuideButton title="GIA시스템 사용 가이드" sections={GUIDE_SECTIONS} />
        </div>
      </div>

      <div className="mb-4 flex gap-2 text-xs">
        <span className="rounded-full bg-teal-50 px-3 py-1 font-semibold text-teal-700">보유 {summary.보유}</span>
        <span className="rounded-full bg-amber-50 px-3 py-1 font-semibold text-amber-700">부분보유 {summary.부분보유}</span>
        <span className="rounded-full bg-slate-100 px-3 py-1 font-semibold text-slate-500">미보유 {summary.미보유}</span>
      </div>

      <div className="mb-4 flex flex-wrap gap-1.5">
        <button
          onClick={() => setActiveMajor("전체")}
          className={
            "rounded-full border px-3 py-1 text-xs font-semibold " +
            (activeMajor === "전체"
              ? "border-gia-navy bg-gia-navy text-white"
              : "border-slate-200 bg-white text-slate-600 hover:border-slate-300")
          }
        >
          전체 ({systems.length})
        </button>
        {majors.map((m) => {
          const c = majorSummary.get(m) ?? { 보유: 0, 부분보유: 0, 미보유: 0 };
          const total = c.보유 + c.부분보유 + c.미보유;
          return (
            <button
              key={m}
              onClick={() => setActiveMajor(m)}
              className={
                "rounded-full border px-3 py-1 text-xs font-semibold " +
                (activeMajor === m
                  ? "border-gia-navy bg-gia-navy text-white"
                  : "border-slate-200 bg-white text-slate-600 hover:border-slate-300")
              }
            >
              {m} ({total})
            </button>
          );
        })}
      </div>

      {error && <div className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{error}</div>}

      <div className="flex flex-col gap-4">
        {grouped.map(([groupKey, items]) => (
          <div key={groupKey} className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            <div className="border-b border-slate-100 bg-slate-50 px-4 py-2 text-sm font-bold text-slate-700">
              {groupKey}
            </div>
            <div className="divide-y divide-slate-100">
              {items.map((s) => (
                <div key={s.id} className="px-4 py-3">
                  <div className="mb-1 flex flex-wrap items-center gap-2">
                    <span className={"rounded-full px-2 py-0.5 text-[10px] font-semibold " + STATUS_STYLE[s.status]}>
                      {s.status}
                    </span>
                    {s.source === "ai_suggested" && (
                      <span className="rounded-full bg-purple-50 px-2 py-0.5 text-[10px] font-semibold text-purple-600">
                        AI 제안
                      </span>
                    )}
                    <span className="text-sm font-semibold text-slate-800">{s.name}</span>
                  </div>
                  {s.description && <p className="mb-1 text-xs text-slate-600">{s.description}</p>}
                  {s.benchmark_school && (
                    <p className="mb-2 text-[11px] text-slate-400">참고 사례: {s.benchmark_school}</p>
                  )}
                  {s.related_manual_category && (
                    <p className="mb-2 text-[11px] text-amber-600">
                      📎 발행된 매뉴얼(&quot;{s.related_manual_target_doc}&quot; · {s.related_manual_category})에
                      이미 이 시스템 이름이 언급되어 있어요 - 실제로 갖춰져 있다면 상태를 확인해 &quot;보유&quot;로
                      바꿔주세요.
                    </p>
                  )}
                  <div className="flex flex-wrap items-center gap-2">
                    <select
                      value={s.status}
                      onChange={(e) => updateStatus(s.id, e.target.value as GiaSystem["status"])}
                      className="rounded-lg border border-slate-200 px-2 py-1 text-xs"
                    >
                      {STATUSES.map((st) => (
                        <option key={st} value={st}>
                          {st}
                        </option>
                      ))}
                    </select>
                    {s.status === "미보유" && (
                      proposedIds.has(s.id) ? (
                        <Link href="/proposals" className="text-xs font-semibold text-blue-500 hover:underline">
                          운영관리 제안함에서 확인 →
                        </Link>
                      ) : (
                        <button
                          onClick={() => sendToProposals(s)}
                          disabled={proposingId === s.id}
                          className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                        >
                          {proposingId === s.id ? "보내는 중..." : "운영관리 제안함으로 보내기"}
                        </button>
                      )
                    )}
                    {s.document_id ? (
                      <Link
                        href="/documents"
                        className="rounded-lg border border-blue-200 px-2.5 py-1 text-xs font-semibold text-blue-600 hover:bg-blue-50"
                      >
                        📁 서류함에서 보기 →
                      </Link>
                    ) : (
                      <button
                        onClick={() => createDocument(s)}
                        disabled={creatingDocId === s.id}
                        className="rounded-lg border border-blue-200 px-2.5 py-1 text-xs font-semibold text-blue-600 hover:bg-blue-50 disabled:opacity-50"
                        title="이 항목에 필요한 서류를 서류함에 같은 분류로 만듭니다."
                      >
                        {creatingDocId === s.id ? "만드는 중..." : "📁 서류함에 만들기"}
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
        {systems.length === 0 && (
          <p className="rounded-xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-400">
            등록된 시스템이 없습니다. &quot;AI로 벤치마킹 제안받기&quot;로 시작해보세요.
          </p>
        )}
      </div>
    </div>
  );
}
