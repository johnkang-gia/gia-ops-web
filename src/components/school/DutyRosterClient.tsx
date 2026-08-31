"use client";

import { useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/common/ToastProvider";
import { useConfirm } from "@/components/common/ConfirmProvider";

export type DutyRow = {
  id: string;
  kind: string;
  weekday: number | null;
  service_date: string | null;
  slot: string | null;
  staff_name: string;
  staff_email: string | null;
  note: string | null;
};

const WEEKDAYS = [
  { value: 1, label: "월" },
  { value: 2, label: "화" },
  { value: 3, label: "수" },
  { value: 4, label: "목" },
  { value: 5, label: "금" },
];

// 처음 쓰는 사람이 무엇을 적어야 할지 감이 오도록 학교에서 실제로 도는 당번 이름을 넣어둡니다.
// 목록에 없으면 직접 입력하면 되고, 한 번 쓴 이름은 다음부터 후보로 나타납니다.
const SUGGESTED_KINDS = ["급식당번", "체육관 사용", "코딩실 사용", "도서관 당번", "복도 지도"];

function whenLabel(row: DutyRow): string {
  if (row.service_date) return row.service_date;
  const wd = WEEKDAYS.find((w) => w.value === row.weekday);
  return wd ? `매주 ${wd.label}` : "기간 무관";
}

export default function DutyRosterClient({
  initialRows,
  team,
  canEdit,
}: {
  initialRows: DutyRow[];
  team: { email: string; name: string | null }[];
  canEdit: boolean;
}) {
  const notify = useToast();
  const confirm = useConfirm();
  const [rows, setRows] = useState(initialRows);
  const [busy, setBusy] = useState(false);

  // 입력칸
  const [kind, setKind] = useState("급식당번");
  const [mode, setMode] = useState<"weekly" | "date">("weekly");
  const [weekday, setWeekday] = useState(1);
  const [serviceDate, setServiceDate] = useState("");
  const [slot, setSlot] = useState("");
  const [staffName, setStaffName] = useState("");
  const [note, setNote] = useState("");

  const kinds = useMemo(() => {
    const set = new Set<string>(SUGGESTED_KINDS);
    rows.forEach((r) => set.add(r.kind));
    return [...set];
  }, [rows]);

  // 종류별로 묶고, 그 안에서는 요일 → 날짜 순으로 정렬합니다.
  const grouped = useMemo(() => {
    const map = new Map<string, DutyRow[]>();
    for (const r of rows) {
      if (!map.has(r.kind)) map.set(r.kind, []);
      map.get(r.kind)!.push(r);
    }
    for (const list of map.values()) {
      list.sort(
        (a, b) =>
          (a.weekday ?? 99) - (b.weekday ?? 99) ||
          (a.service_date ?? "").localeCompare(b.service_date ?? "") ||
          (a.slot ?? "").localeCompare(b.slot ?? "", "ko")
      );
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0], "ko"));
  }, [rows]);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!kind.trim() || !staffName.trim()) {
      notify("당번 종류와 담당자 이름을 입력해주세요.", "error");
      return;
    }
    setBusy(true);
    const supabase = createClient();
    // 이름이 앱 계정과 일치하면 이메일까지 채워둡니다. 나중에 "내 당번" 같은 기능을 붙일 때
    // 이름만으로는 동명이인을 가릴 수 없어서, 지금 연결해두는 편이 낫습니다.
    const matched = team.find((m) => (m.name ?? "").trim() === staffName.trim());
    const { data, error } = await supabase
      .from("duty_roster")
      .insert({
        kind: kind.trim(),
        weekday: mode === "weekly" ? weekday : null,
        service_date: mode === "date" ? serviceDate || null : null,
        slot: slot.trim() || null,
        staff_name: staffName.trim(),
        staff_email: matched?.email ?? null,
        note: note.trim() || null,
      })
      .select()
      .single();
    setBusy(false);
    if (error || !data) {
      notify("추가하지 못했습니다: " + (error?.message ?? ""), "error");
      return;
    }
    setRows((prev) => [...prev, data as DutyRow]);
    setStaffName("");
    setSlot("");
    setNote("");
  }

  async function remove(row: DutyRow) {
    const ok = await confirm(`${row.kind} · ${whenLabel(row)} · ${row.staff_name}`, {
      title: "당번을 지울까요?",
      confirmLabel: "지우기",
      danger: true,
    });
    if (!ok) return;
    const previous = rows;
    setRows((prev) => prev.filter((r) => r.id !== row.id));
    const supabase = createClient();
    const { error } = await supabase.from("duty_roster").delete().eq("id", row.id);
    if (error) {
      setRows(previous);
      notify("지우지 못했습니다: " + error.message, "error");
    }
  }

  return (
    <div className="flex flex-col gap-5">
      {canEdit && (
        <form onSubmit={add} className="g-panel-solid p-4 shadow-sm">
          <h2 className="mb-3 text-sm font-bold text-slate-800">당번 추가</h2>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <label className="mb-1 block text-[11px] font-semibold text-slate-500">종류</label>
              <input
                list="duty-kinds"
                value={kind}
                onChange={(e) => setKind(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-2.5 py-2 text-sm"
              />
              <datalist id="duty-kinds">
                {kinds.map((k) => (
                  <option key={k} value={k} />
                ))}
              </datalist>
            </div>

            <div>
              <label className="mb-1 block text-[11px] font-semibold text-slate-500">언제</label>
              <div className="flex gap-1.5">
                <select
                  value={mode}
                  onChange={(e) => setMode(e.target.value as "weekly" | "date")}
                  className="rounded-lg border border-slate-300 px-2 py-2 text-sm"
                >
                  <option value="weekly">매주</option>
                  <option value="date">특정일</option>
                </select>
                {mode === "weekly" ? (
                  <select
                    value={weekday}
                    onChange={(e) => setWeekday(Number(e.target.value))}
                    className="flex-1 rounded-lg border border-slate-300 px-2 py-2 text-sm"
                  >
                    {WEEKDAYS.map((w) => (
                      <option key={w.value} value={w.value}>
                        {w.label}요일
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="date"
                    value={serviceDate}
                    onChange={(e) => setServiceDate(e.target.value)}
                    className="min-w-0 flex-1 rounded-lg border border-slate-300 px-2 py-2 text-sm"
                  />
                )}
              </div>
            </div>

            <div>
              <label className="mb-1 block text-[11px] font-semibold text-slate-500">구분 (선택)</label>
              <input
                value={slot}
                onChange={(e) => setSlot(e.target.value)}
                placeholder="예: 1층 / 점심 1부"
                className="w-full rounded-lg border border-slate-300 px-2.5 py-2 text-sm"
              />
            </div>

            <div>
              <label className="mb-1 block text-[11px] font-semibold text-slate-500">담당자</label>
              <input
                list="duty-staff"
                value={staffName}
                onChange={(e) => setStaffName(e.target.value)}
                placeholder="이름"
                className="w-full rounded-lg border border-slate-300 px-2.5 py-2 text-sm"
              />
              <datalist id="duty-staff">
                {team.filter((m) => m.name).map((m) => (
                  <option key={m.email} value={m.name!} />
                ))}
              </datalist>
            </div>

            <div className="sm:col-span-2">
              <label className="mb-1 block text-[11px] font-semibold text-slate-500">메모 (선택)</label>
              <input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-2.5 py-2 text-sm"
              />
            </div>
          </div>
          <button
            type="submit"
            disabled={busy}
            className="mt-3 rounded-lg bg-gia-navy px-4 py-2 text-sm font-semibold text-white hover:bg-gia-navy-2 disabled:opacity-50"
          >
            {busy ? "추가 중..." : "추가"}
          </button>
        </form>
      )}

      {grouped.length === 0 ? (
        <p className="rounded-xl border border-dashed border-slate-200 p-8 text-center text-sm text-slate-400">
          아직 등록된 당번이 없습니다.
        </p>
      ) : (
        grouped.map(([k, list]) => (
          <div key={k} className="g-panel-solid p-4 shadow-sm">
            <div className="mb-2 flex items-center gap-2">
              <h2 className="text-sm font-bold text-slate-800">{k}</h2>
              <span className="text-[11px] text-slate-400">{list.length}건</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-[11px] text-slate-400">
                  <tr>
                    <th className="py-1 pr-3 font-semibold">언제</th>
                    <th className="py-1 pr-3 font-semibold">구분</th>
                    <th className="py-1 pr-3 font-semibold">담당자</th>
                    <th className="py-1 pr-3 font-semibold">메모</th>
                    {canEdit && <th className="py-1" />}
                  </tr>
                </thead>
                <tbody>
                  {list.map((r) => (
                    <tr key={r.id} className="border-t border-slate-100">
                      <td className="whitespace-nowrap py-1.5 pr-3 font-medium text-slate-700">{whenLabel(r)}</td>
                      <td className="py-1.5 pr-3 text-slate-500">{r.slot ?? "-"}</td>
                      <td className="py-1.5 pr-3 font-semibold text-slate-800">
                        {r.staff_name}
                        {r.staff_email && <span className="ml-1 text-[10px] font-normal text-emerald-600">계정 연결됨</span>}
                      </td>
                      <td className="py-1.5 pr-3 text-xs text-slate-400">{r.note ?? ""}</td>
                      {canEdit && (
                        <td className="py-1.5 text-right">
                          <button
                            onClick={() => remove(r)}
                            className="rounded-lg border border-slate-200 px-2 py-1 text-[11px] text-slate-500 hover:bg-red-50 hover:text-red-600"
                          >
                            지우기
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))
      )}
    </div>
  );
}
