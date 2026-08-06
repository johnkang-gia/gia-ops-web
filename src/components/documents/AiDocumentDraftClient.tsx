"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { genCaseId } from "@/lib/caseId";
import GuideButton from "@/components/common/GuideButton";
import { useToast } from "@/components/common/ToastProvider";
import type { SchoolDocument } from "@/lib/types";

const GUIDE_SECTIONS = [
  {
    title: "🪄 AI 서류 작성이란?",
    lines: [
      "근로계약서, 내부 규정, 동의서처럼 서류함에 아직 없는 서류가 필요할 때, 상황을 문장으로 설명하면 AI가 초안을 만들어줍니다.",
      "예: \"다음 달 초등부 2박3일 제주도 현장학습을 가는데, 참가비는 1인 30만원이고 인솔교사는 3명입니다. 응급상황 연락처와 사진·영상 활용 동의 항목을 포함한 학부모 동의서를 만들어주세요.\"",
      "AI가 문서명과 GIA시스템 분류(대분류/중분류)도 함께 제안하니, 확인 후 저장하면 서류함에 그 분류로 자동 등록됩니다.",
      "GIA는 국제학교라 학부모/외국인 교사에게 나가는 서류는 영어나 한/영 병기가 필요할 수 있습니다 - 작성 언어를 한국어/영어/한국어+영어 중에서 고를 수 있습니다.",
      "실제 수치·인명 등은 [ ] 표시된 자리에 직접 채워주세요. 법적 검토가 꼭 필요한 서류는 초안을 참고용으로만 쓰고 최종 확인을 거쳐주세요.",
    ],
  },
];

const STATUS_OPTIONS: SchoolDocument["status"][] = ["필요", "준비중", "보유", "만료임박", "해당없음"];

// 요청: "서류작성의 경우 영문,한글 둘다 작성할 수 있게 해줘 국제학교라 영어문서가 필요할 경우도
// 있어". GIA시스템 분류(대분류/중분류)는 언어와 무관하게 항상 한국어로 유지되고(서버가 강제),
// 여기서 고르는 언어는 초안 본문(draftText)/서류명에만 적용됩니다.
type DraftLanguage = "ko" | "en" | "bilingual";
const LANGUAGE_OPTIONS: { value: DraftLanguage; label: string }[] = [
  { value: "ko", label: "한국어" },
  { value: "en", label: "영어" },
  { value: "bilingual", label: "한국어 + 영어" },
];

type DraftResult = {
  suggestedName: string;
  categoryMajor: string;
  category: string;
  giaSystemId: string | null;
  draftText: string;
};

export default function AiDocumentDraftClient() {
  const router = useRouter();
  const notify = useToast();
  const [situation, setSituation] = useState("");
  const [language, setLanguage] = useState<DraftLanguage>("ko");
  const [drafting, setDrafting] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<DraftResult | null>(null);

  // AI 응답을 편집 가능한 폼 상태로 옮겨서, 저장 전에 담당자가 이름/분류/본문을 직접 다듬을 수
  // 있게 합니다(AI가 분류를 잘못 짚었을 수도 있으니 그대로 저장되지 않도록).
  const [name, setName] = useState("");
  const [categoryMajor, setCategoryMajor] = useState("");
  const [category, setCategory] = useState("");
  const [draftText, setDraftText] = useState("");
  const [status, setStatus] = useState<SchoolDocument["status"]>("준비중");
  const [saving, setSaving] = useState(false);

  async function requestDraft(e: React.FormEvent) {
    e.preventDefault();
    if (!situation.trim()) {
      setError("어떤 서류가 왜 필요한지 상황을 설명해주세요.");
      return;
    }
    setDrafting(true);
    setError("");
    const res = await fetch("/api/ai/document-quick-draft", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ situation, language }),
    });
    const data = await res.json();
    setDrafting(false);
    if (!res.ok) {
      setError(data.error || "초안을 만들지 못했습니다.");
      return;
    }
    setResult(data);
    setName(data.suggestedName || "");
    setCategoryMajor(data.categoryMajor || "");
    setCategory(data.category || "");
    setDraftText(data.draftText || "");
  }

  async function saveToDocuments() {
    if (!name.trim()) {
      setError("서류명을 입력해주세요.");
      return;
    }
    setSaving(true);
    setError("");
    const supabase = createClient();
    const { error: err } = await supabase.from("documents").insert({
      case_id: genCaseId("DOC"),
      name: name.trim(),
      category: category || null,
      category_major: categoryMajor || null,
      gia_system_id: result?.giaSystemId ?? null,
      status,
      notes: `AI 서류 작성으로 생성됨\n[입력한 상황]\n${situation}`,
      ai_draft: draftText,
    });
    setSaving(false);
    if (err) {
      setError(err.message);
      return;
    }
    notify("서류함에 저장했습니다.", "success");
    router.push("/documents");
  }

  return (
    <div className="mx-auto flex h-full max-w-3xl flex-col overflow-y-auto">
      <div className="mb-1 flex items-center justify-between gap-2">
        <h1 className="text-lg font-bold">🪄 AI 서류 작성</h1>
        <GuideButton title="AI 서류 작성 사용 가이드" sections={GUIDE_SECTIONS} />
      </div>
      <p className="mb-4 text-xs text-slate-500">
        서류함에 아직 없는 서류가 필요할 때, 상황을 설명하면 AI가 초안과 분류를 함께 만들어줍니다.
        저장하면 GIA시스템 분류 체계에 맞춰 서류함에 자동으로 등록됩니다.
      </p>

      <form
        onSubmit={requestDraft}
        className="mb-4 flex flex-col gap-2 rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
      >
        <label className="text-xs font-semibold text-slate-500">상황 설명</label>
        <textarea
          value={situation}
          onChange={(e) => setSituation(e.target.value)}
          rows={6}
          placeholder="예: 다음 달 초등부 2박3일 제주도 현장학습을 가는데, 참가비는 1인 30만원이고 인솔교사는 3명입니다. 응급상황 연락처와 사진·영상 활용 동의 항목을 포함한 학부모 동의서를 만들어주세요."
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
        />

        <label className="mt-1 text-xs font-semibold text-slate-500">작성 언어</label>
        <div className="flex flex-wrap gap-1.5">
          {LANGUAGE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setLanguage(opt.value)}
              className={
                "rounded-full border px-3 py-1.5 text-xs font-semibold transition " +
                (language === opt.value
                  ? "border-gia-navy bg-gia-navy text-white"
                  : "border-slate-200 bg-white text-slate-500 hover:border-slate-300")
              }
            >
              {opt.label}
            </button>
          ))}
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}
        <button
          type="submit"
          disabled={drafting}
          className="self-start rounded-lg bg-gia-navy px-4 py-2 text-sm font-semibold text-white hover:bg-gia-navy-2 disabled:opacity-50"
        >
          {drafting ? "AI가 작성 중..." : "✨ AI 초안 만들기"}
        </button>
      </form>

      {result && (
        <div className="flex flex-col gap-2 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <div className="sm:col-span-3">
              <label className="mb-1 block text-xs font-semibold text-slate-500">서류명</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-500">대분류</label>
              <input
                value={categoryMajor}
                onChange={(e) => setCategoryMajor(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-500">중분류</label>
              <input
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-500">상태</label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as SchoolDocument["status"])}
                className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
              >
                {STATUS_OPTIONS.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
          </div>
          {result.giaSystemId && (
            <p className="text-xs text-blue-600">📎 GIA시스템 기존 항목과 연결되어 저장됩니다.</p>
          )}

          <label className="mt-1 text-xs font-semibold text-slate-500">초안 (저장 전 자유롭게 수정 가능)</label>
          <textarea
            value={draftText}
            onChange={(e) => setDraftText(e.target.value)}
            rows={16}
            className="w-full whitespace-pre-wrap rounded-lg border border-slate-300 px-3 py-2 font-mono text-xs"
          />

          <button
            onClick={saveToDocuments}
            disabled={saving}
            className="self-start rounded-lg bg-gia-navy px-4 py-2 text-sm font-semibold text-white hover:bg-gia-navy-2 disabled:opacity-50"
          >
            {saving ? "저장 중..." : "📁 서류함에 저장"}
          </button>
        </div>
      )}
    </div>
  );
}
