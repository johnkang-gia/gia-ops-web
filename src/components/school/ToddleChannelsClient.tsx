"use client";

import { useMemo, useState } from "react";
import { useToast } from "@/components/common/ToastProvider";
import { suggestForChannel } from "@/lib/toddleChannel";
import type { RosterEntry } from "@/lib/pickupParse";

/**
 * 토들 방을 학생에게 잇는 화면.
 *
 * ── 무엇을 조심했나 ──────────────────────────────────────────────────
 *
 * **기계가 고른 것을 확인 없이 저장하지 않습니다.** 방 이름 해석은 대개 맞지만, 틀리면
 * 학부모 연락이 통째로 엉뚱한 아이에게 붙습니다. 그건 화면에 오류로 안 보이고
 * 「그 아이가 오늘 픽업이래」로 보입니다.
 *
 * 그래서 제안은 **연한 회색으로 미리 채워만 두고**, 사람이 [연결]을 눌러야 저장됩니다.
 * 한꺼번에 잇는 단추도 뒀지만, **다 이어진 방(complete)만** 대상입니다 - 애매한 방까지
 * 쓸어 담으면 확인하는 뜻이 없어집니다.
 */

export type StudentOption = { id: string; name: string; nameEn: string | null; grade: string | null; className: string | null };
export type ChannelRow = {
  /** 아직 표에 없는 방(글만 들어온 방)은 null. */
  id: string | null;
  label: string;
  confirmedAt: string | null;
  confirmedBy: string | null;
  ignored: boolean;
  lastSeenAt: string | null;
  studentIds: string[];
};

type Filter = "안됨" | "됨" | "제외" | "전체";

export default function ToddleChannelsClient({
  rows: initial,
  students,
  canEdit,
  loadError,
}: {
  rows: ChannelRow[];
  students: StudentOption[];
  canEdit: boolean;
  loadError: string | null;
}) {
  const notify = useToast();
  const [rows, setRows] = useState(initial);
  const [filter, setFilter] = useState<Filter>("안됨");
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  /** 방마다 지금 고른 학생들. 제안으로 미리 채워두고 사람이 고칩니다. */
  const [picked, setPicked] = useState<Record<string, string[]>>({});

  const roster = useMemo<RosterEntry[]>(
    () => students.map((s) => ({ id: s.id, name: s.name, name_en: s.nameEn, grade: s.grade, class_name: s.className, birth_date: null })),
    [students],
  );
  const byId = useMemo(() => new Map(students.map((s) => [s.id, s])), [students]);

  /** 방 이름에서 뽑은 제안. 저장된 연결이 있으면 그것이 답입니다 - 제안이 덮지 않습니다. */
  const suggestions = useMemo(() => {
    const m = new Map<string, ReturnType<typeof suggestForChannel>>();
    for (const r of rows) m.set(r.label, suggestForChannel(r.label, roster));
    return m;
  }, [rows, roster]);

  const chosen = (r: ChannelRow): string[] => {
    if (picked[r.label]) return picked[r.label];
    if (r.studentIds.length > 0) return r.studentIds;
    return (suggestions.get(r.label)?.picks ?? []).map((p) => p.student?.id).filter((x): x is string => !!x);
  };

  const shown = rows
    .filter((r) => {
      if (q && !r.label.toLowerCase().includes(q.toLowerCase())) return false;
      if (filter === "전체") return true;
      if (filter === "제외") return r.ignored;
      if (r.ignored) return false;
      return filter === "됨" ? !!r.confirmedAt : !r.confirmedAt;
    })
    .sort((a, b) => (b.lastSeenAt ?? "").localeCompare(a.lastSeenAt ?? "") || a.label.localeCompare(b.label, "ko"));

  const counts = {
    안됨: rows.filter((r) => !r.ignored && !r.confirmedAt).length,
    됨: rows.filter((r) => !r.ignored && r.confirmedAt).length,
    제외: rows.filter((r) => r.ignored).length,
  };

  async function save(r: ChannelRow, action: "link" | "ignore" | "unignore" | "unlink") {
    const studentIds = action === "link" ? chosen(r) : [];
    if (action === "link" && studentIds.length === 0) {
      notify("연결할 학생을 골라주세요.", "error");
      return;
    }
    setBusy(r.label);
    const res = await fetch("/api/toddle/channels", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, label: r.label, grades: (suggestions.get(r.label)?.grades ?? []).join("&") || null, studentIds }),
    });
    const b = (await res.json().catch(() => ({}))) as { error?: string; channelId?: string; confirmedBy?: string };
    setBusy(null);
    if (!res.ok) {
      // 저장이 실패했는데 화면만 바뀌면, 다음에 열었을 때 연결이 사라져 있습니다.
      notify(b.error ?? "저장하지 못했습니다.", "error");
      return;
    }
    setRows((prev) =>
      prev.map((x) =>
        x.label !== r.label
          ? x
          : {
              ...x,
              id: b.channelId ?? x.id,
              studentIds,
              ignored: action === "ignore",
              confirmedAt: action === "link" ? new Date().toISOString() : null,
              confirmedBy: action === "link" ? (b.confirmedBy ?? null) : null,
            },
      ),
    );
    setPicked((p) => {
      const next = { ...p };
      delete next[r.label];
      return next;
    });
  }

  /** 다 이어진 방만 한꺼번에. 애매한 방은 남겨 두고 사람이 하나씩 봅니다. */
  async function linkAllComplete() {
    const targets = rows.filter((r) => !r.ignored && !r.confirmedAt && suggestions.get(r.label)?.complete);
    if (targets.length === 0) {
      notify("한꺼번에 이을 수 있는 방이 없습니다. 남은 방은 이름을 다 못 읽어 하나씩 봐야 합니다.", "error");
      return;
    }
    if (!confirm(`${targets.length}개 방을 이름 그대로 연결합니다. 계속할까요?`)) return;
    for (const r of targets) await save(r, "link");
    notify(`${targets.length}개 방을 연결했습니다.`, "success");
  }

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h1 className="text-lg font-bold">💬 토들 채널 연결</h1>
        <span className="text-[11px] text-slate-500">
          방 이름에 누구 이야기인지 이미 적혀 있습니다. 학기에 한 번 이어두면 그 뒤로는 이름을 다시 풀지 않습니다.
        </span>
      </div>

      {loadError && (
        <p className="mb-2 rounded-lg bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">⚠️ {loadError}</p>
      )}
      {!canEdit && (
        <p className="mb-2 rounded-lg bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">
          보기만 됩니다. 잘못 이으면 학부모 연락이 엉뚱한 아이에게 붙어서, 연결은 행정·관리자만 바꿉니다.
        </p>
      )}

      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        {(["안됨", "됨", "제외", "전체"] as Filter[]).map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            className={
              "rounded-full px-2.5 py-1 text-[11px] font-bold " +
              (filter === f ? "bg-slate-800 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200")
            }
          >
            {f === "안됨" ? `연결 안 됨 ${counts.안됨}` : f === "됨" ? `연결됨 ${counts.됨}` : f === "제외" ? `제외 ${counts.제외}` : "전체"}
          </button>
        ))}
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="방 이름 찾기"
          className="ml-auto w-40 rounded-lg border border-slate-300 px-2 py-1 text-[11px]"
        />
        {canEdit && (
          <button
            type="button"
            onClick={linkAllComplete}
            className="rounded-lg bg-emerald-600 px-3 py-1 text-[11px] font-bold text-white hover:bg-emerald-700"
            title="이름을 하나도 안 빠뜨리고 읽은 방만 대상입니다"
          >
            이름 그대로 한꺼번에 연결
          </button>
        )}
      </div>

      {shown.length === 0 ? (
        <p className="rounded-lg bg-slate-50 px-3 py-6 text-center text-xs text-slate-500">
          {filter === "안됨" ? "연결이 안 된 방이 없습니다." : "해당하는 방이 없습니다."}
        </p>
      ) : (
        <div className="space-y-1.5">
          {shown.map((r) => {
            const sug = suggestions.get(r.label);
            const sel = chosen(r);
            const saved = r.studentIds.length > 0;
            return (
              <div
                key={r.label}
                className={
                  "rounded-xl border px-3 py-2 " +
                  (r.ignored ? "border-slate-200 bg-slate-50" : r.confirmedAt ? "border-emerald-200 bg-emerald-50/40" : "border-amber-200 bg-amber-50/40")
                }
              >
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  <b className="text-[13px]">{r.label}</b>
                  {sug?.isSibling && (
                    <span className="rounded bg-violet-100 px-1.5 py-0.5 text-[10px] font-bold text-violet-700">형제방</span>
                  )}
                  {r.confirmedAt ? (
                    <span className="text-[10px] font-semibold text-emerald-700">
                      ✓ 연결됨{r.confirmedBy ? ` · ${r.confirmedBy}` : ""}
                    </span>
                  ) : sug ? (
                    <span className="text-[10px] text-amber-700">{sug.complete ? "이름을 다 읽었습니다" : "이름을 다 못 읽었습니다"}</span>
                  ) : (
                    // 방 이름이 학교 규칙과 다른 경우(공지방 등). 이유를 적습니다 - 아무 말 없이
                    // 비어 있으면 「왜 이건 안 되지」로 남습니다.
                    <span className="text-[10px] text-slate-500">방 이름에서 학년·이름을 못 읽었습니다. 직접 고르거나 제외해주세요.</span>
                  )}
                </div>

                {/* 방 이름에서 못 읽은 이름을 그대로 적습니다. 무엇이 안 읽혔는지 알아야 고칩니다. */}
                {sug && !sug.complete && (
                  <p className="mt-0.5 text-[10px] text-rose-700">
                    못 읽음: {sug.picks.filter((p) => !p.student).map((p) => `「${p.raw}」${p.why === "여럿" ? ` (${p.candidates.length}명 중)` : ""}`).join(" · ")}
                  </p>
                )}

                <div className="mt-1.5 flex flex-wrap items-center gap-1">
                  {sel.map((sid) => {
                    const s = byId.get(sid);
                    return (
                      <span
                        key={sid}
                        className={
                          "inline-flex items-center gap-1 rounded-lg border px-2 py-0.5 text-[11px] " +
                          // 저장 전 제안은 연하게. **눌러서 확정하기 전까지는 아직 아무것도
                          // 아니라는 것**이 눈으로 보여야 합니다.
                          (saved ? "border-emerald-300 bg-white font-bold text-emerald-800" : "border-slate-300 bg-white text-slate-500")
                        }
                      >
                        {s ? `${s.name}${s.className ? `(${s.className})` : ""}` : "알 수 없는 학생"}
                        {canEdit && (
                          <button
                            type="button"
                            onClick={() => setPicked((p) => ({ ...p, [r.label]: sel.filter((x) => x !== sid) }))}
                            className="text-slate-400 hover:text-rose-600"
                            title="빼기"
                          >
                            ✕
                          </button>
                        )}
                      </span>
                    );
                  })}
                  {canEdit && (
                    <select
                      value=""
                      onChange={(e) => {
                        const v = e.target.value;
                        if (!v) return;
                        setPicked((p) => ({ ...p, [r.label]: [...new Set([...sel, v])] }));
                      }}
                      className="rounded-lg border border-slate-300 px-1.5 py-0.5 text-[11px]"
                    >
                      <option value="">+ 학생 추가</option>
                      {students.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                          {s.className ? ` (${s.className})` : ""}
                          {s.nameEn ? ` · ${s.nameEn}` : ""}
                        </option>
                      ))}
                    </select>
                  )}
                </div>

                {canEdit && (
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    <button
                      type="button"
                      disabled={busy === r.label}
                      onClick={() => save(r, "link")}
                      className="rounded-lg bg-slate-800 px-2.5 py-1 text-[11px] font-bold text-white disabled:opacity-40"
                    >
                      {r.confirmedAt ? "다시 연결" : "연결"}
                    </button>
                    {r.confirmedAt && (
                      <button
                        type="button"
                        disabled={busy === r.label}
                        onClick={() => save(r, "unlink")}
                        className="rounded-lg border border-slate-300 px-2.5 py-1 text-[11px] font-bold text-slate-600 disabled:opacity-40"
                      >
                        연결 해제
                      </button>
                    )}
                    <button
                      type="button"
                      disabled={busy === r.label}
                      onClick={() => save(r, r.ignored ? "unignore" : "ignore")}
                      title="학부모 방이 아닌 경우(공지방·시험방). 목록에서 내려 「아직 안 한 것」과 섞이지 않게 합니다."
                      className="rounded-lg border border-slate-300 px-2.5 py-1 text-[11px] font-semibold text-slate-500 disabled:opacity-40"
                    >
                      {r.ignored ? "제외 해제" : "학부모 방 아님"}
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
