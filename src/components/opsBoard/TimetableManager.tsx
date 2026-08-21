"use client";

import { useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/common/ToastProvider";
import type { WrClass, WrPeriod, WrTimetableEntry, OpsBoardLink } from "@/lib/types";
import { departmentOf, gradeSortKey, VISIBLE_DEPARTMENTS } from "@/lib/department";

// 요청: "지금 시간에 각반이 무슨 수업시간인지" - 대시보드가 이 정보를 보여주려면 교시(몇 시부터
// 몇 시까지가 몇 교시인지)와 시간표(어느 반이 무슨 요일 몇 교시에 무슨 수업인지)가 있어야 하는데
// 시스템에 없던 데이터라 여기서 입력합니다. 데이터는 나중에 한 번에 받기로 해서 지금은 틀만
// 만들어두고, 화면에서 한 칸씩 채워 넣을 수 있게 했습니다.
// 유치부는 별도 프로그램으로 분리하기로 해서 이 화면에서는 감춥니다(요청: "유치부는 우선
// 분리해서 표면적으로는 안보이게"). 데이터는 그대로 남아 있고, 나중에 다시 보이게 하려면
// src/lib/department.ts의 VISIBLE_DEPARTMENTS에 넣기만 하면 됩니다.
// 짧은 주소 코드에서 헷갈리는 글자(0/O, 1/I/l)를 뺐습니다 - 눈으로 보고 손으로 옮겨 치는
// 값이라 가장 흔한 실수가 0과 O를 헷갈리는 것입니다.
const SHORT_CODE_CHARS = "23456789abcdefghjkmnpqrstuvwxyz";
function randomShortCode(len = 4) {
  let out = "";
  for (let i = 0; i < len; i++) out += SHORT_CODE_CHARS[Math.floor(Math.random() * SHORT_CODE_CHARS.length)];
  return out;
}

const DEPARTMENTS = VISIBLE_DEPARTMENTS;
const WEEKDAYS = [
  { value: 1, label: "월" },
  { value: 2, label: "화" },
  { value: 3, label: "수" },
  { value: 4, label: "목" },
  { value: 5, label: "금" },
] as const;

type Department = (typeof DEPARTMENTS)[number];

export default function TimetableManager({
  classes,
  initialPeriods,
  initialEntries,
  initialBoardLinks,
}: {
  classes: WrClass[];
  initialPeriods: WrPeriod[];
  initialEntries: WrTimetableEntry[];
  initialBoardLinks: OpsBoardLink[];
}) {
  const notify = useToast();
  const [department, setDepartment] = useState<Department>(DEPARTMENTS[0]);
  const [weekday, setWeekday] = useState<number>(() => {
    const d = new Date().getDay();
    return d >= 1 && d <= 5 ? d : 1;
  });
  const [periods, setPeriods] = useState(initialPeriods);
  const [entries, setEntries] = useState(initialEntries);
  const [links, setLinks] = useState(initialBoardLinks);
  const [busy, setBusy] = useState(false);
  const [newPeriod, setNewPeriod] = useState({ periodNo: "", label: "", start: "", end: "" });

  const deptClasses = useMemo(
    () =>
      classes
        .filter((c) => departmentOf(c) === department)
        .sort((a, b) => gradeSortKey(a.grade) - gradeSortKey(b.grade) || (a.class_name ?? "").localeCompare(b.class_name ?? "", "ko")),
    [classes, department]
  );
  const deptPeriods = useMemo(
    () => periods.filter((p) => p.department === department).sort((a, b) => a.start_time.localeCompare(b.start_time)),
    [periods, department]
  );
  const entryMap = useMemo(() => {
    const m = new Map<string, WrTimetableEntry>();
    for (const e of entries) if (e.weekday === weekday) m.set(`${e.class_id}|${e.period_id}`, e);
    return m;
  }, [entries, weekday]);

  async function addPeriod() {
    const periodNo = parseInt(newPeriod.periodNo, 10);
    if (!Number.isFinite(periodNo) || !newPeriod.start || !newPeriod.end) {
      notify("교시 번호와 시작·종료 시각을 모두 입력해주세요.", "error");
      return;
    }
    setBusy(true);
    const supabase = createClient();
    const { data, error } = await supabase
      .from("wr_periods")
      .insert({
        department,
        period_no: periodNo,
        label: newPeriod.label.trim() || null,
        start_time: newPeriod.start,
        end_time: newPeriod.end,
      })
      .select()
      .single();
    setBusy(false);
    if (error || !data) {
      notify("교시를 추가하지 못했습니다: " + (error?.message ?? ""), "error");
      return;
    }
    setPeriods((prev) => [...prev, data as WrPeriod]);
    setNewPeriod({ periodNo: "", label: "", start: "", end: "" });
  }

  async function removePeriod(id: string) {
    if (!window.confirm("이 교시를 지울까요? 이 교시에 채워둔 시간표도 함께 지워집니다.")) return;
    const supabase = createClient();
    const { error } = await supabase.from("wr_periods").delete().eq("id", id);
    if (error) {
      notify("교시를 지우지 못했습니다: " + error.message, "error");
      return;
    }
    setPeriods((prev) => prev.filter((p) => p.id !== id));
    setEntries((prev) => prev.filter((e) => e.period_id !== id));
  }

  // 시간표 한 칸 저장 - 비우면 그 칸을 지웁니다.
  async function saveCell(classId: string, periodId: string, subjectName: string) {
    const value = subjectName.trim();
    const existing = entryMap.get(`${classId}|${periodId}`);
    if (value === (existing?.subject_name ?? "")) return;
    const supabase = createClient();

    if (!value) {
      if (!existing) return;
      setEntries((prev) => prev.filter((e) => e.id !== existing.id));
      const { error } = await supabase.from("wr_timetable").delete().eq("id", existing.id);
      if (error) notify("지우지 못했습니다: " + error.message, "error");
      return;
    }

    const { data, error } = await supabase
      .from("wr_timetable")
      .upsert(
        { class_id: classId, weekday, period_id: periodId, subject_name: value },
        { onConflict: "class_id,weekday,period_id" }
      )
      .select()
      .single();
    if (error || !data) {
      notify("저장하지 못했습니다: " + (error?.message ?? ""), "error");
      return;
    }
    setEntries((prev) => {
      const row = data as WrTimetableEntry;
      return prev.some((e) => e.id === row.id) ? prev.map((e) => (e.id === row.id ? row : e)) : [...prev, row];
    });
  }

  async function createLink() {
    setBusy(true);
    const supabase = createClient();
    // 짧은 코드가 다른 링크와 우연히 겹치면(유니크 제약 위반, 23505) 다시 뽑습니다.
    // 4자리라 실제로 겹칠 확률은 매우 낮습니다.
    let data: OpsBoardLink | null = null;
    let error: { code?: string; message: string } | null = null;
    for (let attempt = 0; attempt < 5 && !data; attempt++) {
      const res = await supabase
        .from("ops_board_links")
        .insert({ default_department: department, short_code: randomShortCode() })
        .select()
        .single();
      data = res.data as OpsBoardLink | null;
      error = res.error;
      if (!error) break;
      if (error.code !== "23505") break;
    }
    setBusy(false);
    if (error || !data) {
      notify("링크를 만들지 못했습니다: " + (error?.message ?? ""), "error");
      return;
    }
    setLinks((prev) => [data as OpsBoardLink, ...prev]);
  }

  // 짧은 주소는 사람이 주소창에 직접 치는 값이라, 바꿀 때 영문 소문자·숫자만 남깁니다.
  async function saveShortCode(id: string, raw: string) {
    const code = raw.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
    if (!code) {
      notify("짧은 주소는 비워둘 수 없습니다.", "error");
      setLinks((prev) => [...prev]); // 입력칸을 이전 값으로 되돌리기 위한 강제 리렌더링
      return;
    }
    const previous = links;
    setLinks((prev) => prev.map((l) => (l.id === id ? { ...l, short_code: code } : l)));
    const supabase = createClient();
    const { error } = await supabase.from("ops_board_links").update({ short_code: code }).eq("id", id);
    if (error) {
      setLinks(previous);
      notify(
        error.code === "23505"
          ? `"${code}"는 이미 다른 링크가 쓰고 있습니다. 다른 값으로 정해주세요.`
          : "짧은 주소를 바꾸지 못했습니다: " + error.message,
        "error"
      );
    }
  }

  function copyShortUrl(code: string) {
    const url = `${window.location.origin}/d/${code}`;
    navigator.clipboard.writeText(url).then(
      () => notify("짧은 주소를 복사했습니다.", "success"),
      () => notify("복사하지 못했습니다.", "error")
    );
  }

  async function patchLink(id: string, patch: Partial<OpsBoardLink>) {
    setLinks((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)));
    const supabase = createClient();
    const { error } = await supabase.from("ops_board_links").update(patch).eq("id", id);
    if (error) notify("변경하지 못했습니다: " + error.message, "error");
  }

  function copyUrl(token: string) {
    const url = `${window.location.origin}/ops-board/${token}`;
    navigator.clipboard.writeText(url).then(
      () => notify("주소를 복사했습니다.", "success"),
      () => notify("복사하지 못했습니다.", "error")
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* ── 대시보드 링크 ─────────────────────────────────────────────── */}
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="mb-1 flex items-center justify-between gap-2">
          <h2 className="text-sm font-bold text-slate-800">🖥️ 운영 대시보드 링크</h2>
          <button onClick={createLink} disabled={busy} className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50">
            링크 만들기
          </button>
        </div>
        <p className="mb-3 text-[11px] leading-relaxed text-slate-500">
          사무실 큰 모니터에 띄우는 화면입니다. 로그인 없이 주소만으로 열리므로 하루 종일 켜두어도 세션이 풀리지 않습니다. 설정한 시각이 되면 화면 전체가
          하원 운행 화면(위 실시간 지도 + 아래 차량별 도착·출발·탑승 현황)으로 자동 전환됩니다.
          <br />
          <strong className="text-slate-600">짧은 주소</strong>는 다른 컴퓨터에서 주소창에 직접 쳐서 들어갈 때 쓰는 지름길입니다 —
          <span className="font-mono"> 우리주소/d/코드 </span>
          네 글자만 치면 바로 열립니다. 원하는 이름(예: <span className="font-mono">office</span>)으로 바꿔도 됩니다.
        </p>
        {links.length === 0 ? (
          <p className="py-3 text-center text-xs text-slate-400">아직 만든 링크가 없습니다.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {links.map((l) => (
              <div key={l.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 p-2 text-[11px]">
                <input
                  value={l.label}
                  onChange={(e) => patchLink(l.id, { label: e.target.value })}
                  className="w-32 rounded border border-slate-300 px-2 py-1 text-xs font-semibold"
                />
                <select
                  value={l.default_department}
                  onChange={(e) => patchLink(l.id, { default_department: e.target.value as Department })}
                  className="rounded border border-slate-300 px-1.5 py-1"
                  title="처음 열었을 때 보여줄 부서"
                >
                  {DEPARTMENTS.map((d) => (
                    <option key={d} value={d}>{d}</option>
                  ))}
                </select>
                <span className="text-slate-400">전환</span>
                <input
                  type="number"
                  min={0}
                  max={23}
                  value={l.shuttle_switch_hour}
                  onChange={(e) => patchLink(l.id, { shuttle_switch_hour: Number(e.target.value) })}
                  className="w-12 rounded border border-slate-300 px-1.5 py-1 text-center"
                />
                <span className="text-slate-400">시</span>
                <input
                  type="number"
                  min={0}
                  max={59}
                  step={5}
                  value={l.shuttle_switch_minute}
                  onChange={(e) => patchLink(l.id, { shuttle_switch_minute: Number(e.target.value) })}
                  className="w-12 rounded border border-slate-300 px-1.5 py-1 text-center"
                />
                <span className="text-slate-400">분부터 하원 운행 화면</span>
                <div className="ml-auto flex flex-wrap items-center gap-1.5">
                  <span className="text-[10px] font-bold text-slate-400">/d/</span>
                  <input
                    key={l.id + ":" + (l.short_code ?? "")}
                    defaultValue={l.short_code ?? ""}
                    placeholder="office"
                    title="주소창에 직접 칠 수 있는 짧은 주소"
                    onBlur={(e) =>
                      e.target.value.trim() &&
                      e.target.value.trim().toLowerCase() !== l.short_code &&
                      saveShortCode(l.id, e.target.value)
                    }
                    className="w-20 rounded border border-slate-300 px-2 py-1 font-mono text-[11px] font-semibold"
                  />
                  {l.short_code && (
                    <button
                      onClick={() => copyShortUrl(l.short_code!)}
                      className="rounded border border-slate-300 px-2 py-1 font-semibold text-slate-600"
                    >
                      짧은 주소 복사
                    </button>
                  )}
                  <button onClick={() => copyUrl(l.token)} className="rounded border border-slate-300 px-2 py-1 font-semibold text-slate-600">
                    원본 복사
                  </button>
                  <a href={`/ops-board/${l.token}`} target="_blank" rel="noreferrer" className="rounded bg-slate-700 px-2 py-1 font-semibold text-white">
                    열기
                  </a>
                  <button
                    onClick={() => patchLink(l.id, { enabled: !l.enabled })}
                    className={"rounded px-2 py-1 font-semibold " + (l.enabled ? "bg-emerald-50 text-emerald-600" : "bg-slate-100 text-slate-400")}
                  >
                    {l.enabled ? "사용중" : "중지"}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── 부서·요일 선택 ─────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2">
        {DEPARTMENTS.map((d) => (
          <button
            key={d}
            onClick={() => setDepartment(d)}
            className={"rounded-full px-3 py-1.5 text-xs font-bold transition " + (department === d ? "bg-blue-600 text-white" : "bg-black/5 text-slate-500")}
          >
            {d}
          </button>
        ))}
        <span className="mx-2 h-4 w-px bg-slate-200" />
        {WEEKDAYS.map((w) => (
          <button
            key={w.value}
            onClick={() => setWeekday(w.value)}
            className={"rounded-full px-3 py-1.5 text-xs font-bold transition " + (weekday === w.value ? "bg-slate-700 text-white" : "bg-black/5 text-slate-500")}
          >
            {w.label}
          </button>
        ))}
      </div>

      {/* ── 교시 설정 ──────────────────────────────────────────────────── */}
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="mb-1 text-sm font-bold text-slate-800">⏰ {department} 교시</h2>
        <p className="mb-3 text-[11px] text-slate-500">
          지금이 몇 교시인지 판단하는 기준입니다. 부서마다 따로 설정하고, 점심·방과후처럼 수업이 아닌 시간대도 넣어두면 그대로 표시됩니다.
        </p>
        <div className="mb-3 flex flex-wrap items-center gap-1.5">
          <input value={newPeriod.periodNo} onChange={(e) => setNewPeriod({ ...newPeriod, periodNo: e.target.value })} placeholder="번호" className="w-16 rounded-lg border border-slate-300 px-2 py-1.5 text-xs" />
          <input value={newPeriod.label} onChange={(e) => setNewPeriod({ ...newPeriod, label: e.target.value })} placeholder="이름 (예: 1교시)" className="w-32 rounded-lg border border-slate-300 px-2 py-1.5 text-xs" />
          <input type="time" value={newPeriod.start} onChange={(e) => setNewPeriod({ ...newPeriod, start: e.target.value })} className="rounded-lg border border-slate-300 px-2 py-1.5 text-xs" />
          <span className="text-xs text-slate-400">~</span>
          <input type="time" value={newPeriod.end} onChange={(e) => setNewPeriod({ ...newPeriod, end: e.target.value })} className="rounded-lg border border-slate-300 px-2 py-1.5 text-xs" />
          <button onClick={addPeriod} disabled={busy} className="rounded-lg bg-slate-700 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50">
            추가
          </button>
        </div>
        {deptPeriods.length === 0 ? (
          <p className="py-2 text-center text-xs text-slate-400">등록된 교시가 없습니다. 먼저 교시를 추가해주세요.</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {deptPeriods.map((p) => (
              <span key={p.id} className="flex items-center gap-1.5 rounded-lg bg-slate-100 px-2 py-1 text-[11px] text-slate-600">
                <b>{p.label ?? `${p.period_no}교시`}</b>
                {p.start_time.slice(0, 5)}~{p.end_time.slice(0, 5)}
                <button onClick={() => removePeriod(p.id)} className="text-slate-400 hover:text-red-500">✕</button>
              </span>
            ))}
          </div>
        )}
      </div>

      {/* ── 시간표 표 ──────────────────────────────────────────────────── */}
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="mb-1 text-sm font-bold text-slate-800">
          📅 {department} 시간표 · {WEEKDAYS.find((w) => w.value === weekday)?.label}요일
        </h2>
        <p className="mb-3 text-[11px] text-slate-500">칸을 클릭해 과목명을 적고 다른 곳을 누르면 저장됩니다. 비우면 그 칸이 지워집니다.</p>
        {deptClasses.length === 0 || deptPeriods.length === 0 ? (
          <p className="py-4 text-center text-xs text-slate-400">
            {deptClasses.length === 0 ? "이 부서에 등록된 반이 없습니다(반 관리에서 먼저 추가해주세요)." : "먼저 교시를 추가해주세요."}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr>
                  <th className="sticky left-0 z-10 border border-slate-200 bg-slate-50 px-2 py-1.5 text-left font-bold text-slate-500">반</th>
                  {deptPeriods.map((p) => (
                    <th key={p.id} className="border border-slate-200 bg-slate-50 px-2 py-1.5 font-bold text-slate-500">
                      <div>{p.label ?? `${p.period_no}교시`}</div>
                      <div className="font-normal text-[10px] text-slate-400">{p.start_time.slice(0, 5)}</div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {deptClasses.map((c) => (
                  <tr key={c.id}>
                    <td className="sticky left-0 z-10 whitespace-nowrap border border-slate-200 bg-white px-2 py-1.5 font-semibold text-slate-700">
                      {c.grade} {c.class_name}
                    </td>
                    {deptPeriods.map((p) => (
                      <td key={p.id} className="border border-slate-200 p-0">
                        <input
                          defaultValue={entryMap.get(`${c.id}|${p.id}`)?.subject_name ?? ""}
                          onBlur={(e) => saveCell(c.id, p.id, e.target.value)}
                          placeholder="—"
                          className="w-full min-w-[86px] px-2 py-1.5 text-center outline-none focus:bg-blue-50"
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
