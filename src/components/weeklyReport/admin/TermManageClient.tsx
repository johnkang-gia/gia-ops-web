"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { WrTerm } from "@/lib/types";

export default function TermManageClient({ initialTerms }: { initialTerms: WrTerm[] }) {
  const [terms, setTerms] = useState<WrTerm[]>(initialTerms);
  const [name, setName] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [saving, setSaving] = useState(false);

  async function addTerm(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    const supabase = createClient();
    const { data } = await supabase
      .from("wr_terms")
      .insert({ name: name.trim(), start_date: startDate || null, end_date: endDate || null, is_active: terms.length === 0 })
      .select()
      .single();
    setSaving(false);
    if (data) {
      setTerms((prev) => [...prev, data as WrTerm]);
      setName("");
      setStartDate("");
      setEndDate("");
    }
  }

  async function activate(id: string) {
    setTerms((prev) => prev.map((t) => ({ ...t, is_active: t.id === id })));
    const supabase = createClient();
    await supabase.from("wr_terms").update({ is_active: false }).neq("id", id);
    await supabase.from("wr_terms").update({ is_active: true }).eq("id", id);
  }

  async function archive(id: string) {
    if (!confirm("이 학기를 보관 처리할까요? 이 학기의 리포트도 함께 보관됩니다.")) return;
    setTerms((prev) => prev.map((t) => (t.id === id ? { ...t, is_archived: true, is_active: false } : t)));
    const supabase = createClient();
    await supabase.from("wr_terms").update({ is_archived: true, is_active: false }).eq("id", id);
    await supabase.from("wr_reports").update({ is_archived: true }).eq("term_id", id);
  }

  const activeTerms = terms.filter((t) => !t.is_archived);
  const archivedTerms = terms.filter((t) => t.is_archived);

  return (
    <div>
      <form onSubmit={addTerm} className="mb-4 flex flex-wrap items-end gap-2 rounded-xl border border-slate-200 bg-white p-3">
        <div>
          <label className="mb-1 block text-[11px] text-slate-400">학기명</label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="예: 2026학년도 1학기" className="w-48 rounded-lg border border-slate-300 px-2 py-1.5 text-sm" />
        </div>
        <div>
          <label className="mb-1 block text-[11px] text-slate-400">시작일</label>
          <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm" />
        </div>
        <div>
          <label className="mb-1 block text-[11px] text-slate-400">종료일</label>
          <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm" />
        </div>
        <button disabled={saving} className="rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-semibold text-white hover:bg-slate-700 disabled:opacity-50">
          학기 추가
        </button>
      </form>

      <div className="flex flex-col gap-2">
        {activeTerms.map((t) => (
          <div key={t.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white p-3">
            <div>
              <div className="font-medium">
                {t.name}
                {t.is_active && <span className="ml-2 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-600">진행중</span>}
              </div>
              <div className="text-xs text-slate-400">
                {t.start_date ?? "?"} ~ {t.end_date ?? "?"}
              </div>
            </div>
            <div className="flex gap-2">
              {!t.is_active && (
                <button onClick={() => activate(t.id)} className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50">
                  이 학기 활성화
                </button>
              )}
              <button onClick={() => archive(t.id)} className="rounded-lg border border-red-200 px-3 py-1.5 text-xs text-red-500 hover:bg-red-50">
                보관 처리
              </button>
            </div>
          </div>
        ))}
        {activeTerms.length === 0 && (
          <p className="rounded-xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-400">등록된 학기가 없습니다.</p>
        )}
      </div>

      {archivedTerms.length > 0 && (
        <div className="mt-6">
          <h2 className="mb-2 text-sm font-bold text-slate-500">보관된 학기</h2>
          <div className="flex flex-col gap-1.5">
            {archivedTerms.map((t) => (
              <div key={t.id} className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 text-sm text-slate-400">
                {t.name}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
