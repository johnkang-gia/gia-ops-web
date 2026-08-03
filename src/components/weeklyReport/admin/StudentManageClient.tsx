"use client";

import { useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { WrStudent } from "@/lib/types";
import Pagination from "@/components/Pagination";

const PAGE_SIZE = 15;

export default function StudentManageClient({ initialStudents }: { initialStudents: WrStudent[] }) {
  const [students, setStudents] = useState<WrStudent[]>(initialStudents);
  const [name, setName] = useState("");
  const [nameEn, setNameEn] = useState("");
  const [grade, setGrade] = useState("");
  const [className, setClassName] = useState("");
  const [parentPhone, setParentPhone] = useState("");
  const [bulkText, setBulkText] = useState("");
  const [saving, setSaving] = useState(false);
  const [showBulk, setShowBulk] = useState(false);

  async function addStudent(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    const supabase = createClient();
    const { data } = await supabase
      .from("wr_students")
      .insert({
        name: name.trim(),
        name_en: nameEn.trim() || null,
        grade: grade.trim() || null,
        class_name: className.trim() || null,
        parent_phone: parentPhone.trim() || null,
      })
      .select()
      .single();
    setSaving(false);
    if (data) {
      setStudents((prev) => [...prev, data as WrStudent]);
      setName("");
      setNameEn("");
      setGrade("");
      setClassName("");
      setParentPhone("");
    }
  }

  async function bulkAdd() {
    // 한 줄에 "이름,영어이름,학년,반,보호자연락처" 형식
    const rows = bulkText
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [n, ne, g, c, p] = line.split(",").map((v) => v?.trim() ?? "");
        return { name: n, name_en: ne || null, grade: g || null, class_name: c || null, parent_phone: p || null };
      })
      .filter((r) => r.name);
    if (rows.length === 0) return;
    setSaving(true);
    const supabase = createClient();
    const { data } = await supabase.from("wr_students").insert(rows).select();
    setSaving(false);
    if (data) {
      setStudents((prev) => [...prev, ...(data as WrStudent[])]);
      setBulkText("");
      setShowBulk(false);
    }
  }

  async function updateNameEn(id: string, value: string) {
    const next = value.trim() || null;
    setStudents((prev) => prev.map((s) => (s.id === id ? { ...s, name_en: next } : s)));
    const supabase = createClient();
    await supabase.from("wr_students").update({ name_en: next }).eq("id", id);
  }

  async function archiveStudent(id: string) {
    setStudents((prev) => prev.map((s) => (s.id === id ? { ...s, status: "inactive" } : s)));
    const supabase = createClient();
    await supabase.from("wr_students").update({ status: "inactive" }).eq("id", id);
  }

  async function removeStudent(id: string) {
    if (!confirm("이 학생을 완전히 삭제할까요? 관련 리포트도 함께 삭제됩니다.")) return;
    setStudents((prev) => prev.filter((s) => s.id !== id));
    const supabase = createClient();
    await supabase.from("wr_students").delete().eq("id", id);
  }

  const active = students.filter((s) => s.status === "active");
  const [page, setPage] = useState(1);
  const pageItems = useMemo(
    () => active.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [active, page]
  );
  const totalPages = Math.max(1, Math.ceil(active.length / PAGE_SIZE));

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <form onSubmit={addStudent} className="mb-3 flex shrink-0 flex-wrap items-end gap-2 rounded-xl border border-slate-200 bg-white p-3">
        <div>
          <label className="mb-1 block text-[11px] text-slate-400">이름 Name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} className="w-28 rounded-lg border border-slate-300 px-2 py-1.5 text-sm" />
        </div>
        <div>
          <label className="mb-1 block text-[11px] text-slate-400">영어 이름 Name (EN)</label>
          <input value={nameEn} onChange={(e) => setNameEn(e.target.value)} className="w-28 rounded-lg border border-slate-300 px-2 py-1.5 text-sm" />
        </div>
        <div>
          <label className="mb-1 block text-[11px] text-slate-400">학년</label>
          <input value={grade} onChange={(e) => setGrade(e.target.value)} className="w-16 rounded-lg border border-slate-300 px-2 py-1.5 text-sm" />
        </div>
        <div>
          <label className="mb-1 block text-[11px] text-slate-400">반</label>
          <input value={className} onChange={(e) => setClassName(e.target.value)} className="w-20 rounded-lg border border-slate-300 px-2 py-1.5 text-sm" />
        </div>
        <div>
          <label className="mb-1 block text-[11px] text-slate-400">보호자 연락처</label>
          <input value={parentPhone} onChange={(e) => setParentPhone(e.target.value)} className="w-32 rounded-lg border border-slate-300 px-2 py-1.5 text-sm" />
        </div>
        <button disabled={saving} className="rounded-lg bg-wr-primary px-3 py-1.5 text-sm font-semibold text-white hover:bg-wr-primary-2 disabled:opacity-50">
          학생 추가
        </button>
        <button type="button" onClick={() => setShowBulk((v) => !v)} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50">
          대량 등록
        </button>
      </form>

      {showBulk && (
        <div className="mb-4 shrink-0 rounded-xl border border-slate-200 bg-white p-3">
          <p className="mb-1.5 text-[11px] text-slate-400">
            한 줄에 하나씩, &quot;이름,영어이름,학년,반,보호자연락처&quot; 형식으로 붙여넣으세요. 영어이름은 비워둬도 됩니다.
          </p>
          <textarea
            value={bulkText}
            onChange={(e) => setBulkText(e.target.value)}
            rows={6}
            placeholder={"홍길동,Hong Gildong,3,1반,010-1234-5678\n김철수,,3,2반,"}
            className="mb-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
          <button onClick={bulkAdd} disabled={saving} className="rounded-lg bg-wr-primary px-3 py-1.5 text-sm font-semibold text-white hover:bg-wr-primary-2 disabled:opacity-50">
            일괄 등록
          </button>
        </div>
      )}

      <div className="flex-1 overflow-y-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs text-slate-400">
            <tr>
              <th className="px-3 py-2">이름 Name</th>
              <th className="px-3 py-2">영어 이름 Name (EN)</th>
              <th className="px-3 py-2">학년</th>
              <th className="px-3 py-2">반</th>
              <th className="px-3 py-2">보호자 연락처</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {pageItems.map((s) => (
              <tr key={s.id} className="border-t border-slate-100">
                <td className="px-3 py-2 font-medium">{s.name}</td>
                <td className="px-3 py-2">
                  <input
                    defaultValue={s.name_en ?? ""}
                    onBlur={(e) => e.target.value.trim() !== (s.name_en ?? "") && updateNameEn(s.id, e.target.value)}
                    placeholder="-"
                    className="w-28 rounded-lg border border-transparent px-1.5 py-1 text-sm hover:border-slate-200 focus:border-slate-300"
                  />
                </td>
                <td className="px-3 py-2 text-slate-500">{s.grade ?? "-"}</td>
                <td className="px-3 py-2 text-slate-500">{s.class_name ?? "-"}</td>
                <td className="px-3 py-2 text-slate-400">{s.parent_phone ?? "-"}</td>
                <td className="px-3 py-2 text-right">
                  <button onClick={() => archiveStudent(s.id)} className="mr-2 text-xs text-amber-500 hover:text-amber-600">
                    보관
                  </button>
                  <button onClick={() => removeStudent(s.id)} className="text-xs text-red-400 hover:text-red-600">
                    삭제
                  </button>
                </td>
              </tr>
            ))}
            {active.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-slate-400">
                  등록된 학생이 없습니다.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="shrink-0">
        <Pagination page={page} totalPages={totalPages} onChange={setPage} />
      </div>
    </div>
  );
}
