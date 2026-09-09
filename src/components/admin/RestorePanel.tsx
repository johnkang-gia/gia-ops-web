"use client";

import { useState } from "react";
import { useToast } from "@/components/common/ToastProvider";
import { useConfirm } from "@/components/common/ConfirmProvider";
import { BACKUP_GROUPS } from "@/lib/backupTables";
import type { TablePlan } from "@/lib/dataRestore";

/**
 * **내려받은 파일로 되돌리기.**
 *
 * ── 이 화면이 지키는 것 ──────────────────────────────────────────────
 *
 * 되돌리기는 살아 있는 자료를 덮어씁니다. 「복원」 버튼 하나만 있는 화면은 아무도 못
 * 누릅니다 - 눌러도 되는지 판단할 재료가 없으니까요. 그래서 순서를 셋으로 나눕니다.
 *
 *   ① 파일을 고르면 **무엇이 몇 줄 바뀌는지 먼저 셉니다.** 아직 아무것도 안 바뀝니다.
 *   ② 묶음별로 되돌릴 것을 고릅니다. 명부만 꼬였는데 회계까지 되돌릴 이유가 없습니다.
 *   ③ 누르면 되돌립니다. **직전에 지금 상태가 한 벌 저장됩니다** - 되돌린 것을 다시
 *      되돌릴 수 있어야 사람이 누를 수 있습니다.
 *
 * 「파일과 똑같이 맞추기」(파일에 없는 줄 지우기)는 기본이 꺼져 있습니다. 되돌리기를 하는
 * 사람은 이미 사고를 수습하는 중이라, 그 자리에서 또 지우는 선택을 기본값으로 둘 수 없습니다.
 */

type PlanResponse = {
  exportedAt?: string;
  appVersion?: string;
  plan?: TablePlan[];
  error?: string;
};

export default function RestorePanel() {
  const notify = useToast();
  const confirmAction = useConfirm();

  const [file, setFile] = useState<{ name: string; json: unknown } | null>(null);
  const [plan, setPlan] = useState<TablePlan[] | null>(null);
  const [exportedAt, setExportedAt] = useState<string>("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [wipe, setWipe] = useState(false);
  const [busy, setBusy] = useState(false);

  /** 파일에 들어 있는 표를 묶음으로 나눠 보여줍니다. 89개를 한 줄씩 세우면 아무도 못 읽습니다. */
  const groupsInFile = BACKUP_GROUPS.map((g) => ({
    group: g.group,
    tables: g.tables.filter((t) => plan?.some((p) => p.table === t)),
  })).filter((g) => g.tables.length > 0);

  async function pickFile(f: File) {
    setBusy(true);
    setPlan(null);
    try {
      const text = await f.text();
      let json: unknown;
      try {
        json = JSON.parse(text);
      } catch {
        notify("JSON 파일이 아닙니다. 내려받은 백업 파일을 그대로 올려주세요.", "error");
        return;
      }
      setFile({ name: f.name, json });

      const res = await fetch("/api/admin/restore", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ backup: json, dryRun: true }),
      });
      const body = (await res.json().catch(() => ({}))) as PlanResponse;
      if (!res.ok) {
        notify(body.error || "파일을 읽지 못했습니다.", "error");
        setFile(null);
        return;
      }
      setPlan(body.plan ?? []);
      setExportedAt(body.exportedAt ?? "");
      // 처음에는 아무것도 안 골라둡니다. 다 켜두면 「전체 되돌리기」가 기본이 되는데,
      // 대개는 한 묶음만 꼬여 있습니다.
      setPicked(new Set());
    } finally {
      setBusy(false);
    }
  }

  function toggleGroup(tables: string[], on: boolean) {
    setPicked((prev) => {
      const next = new Set(prev);
      for (const t of tables) {
        if (on) next.add(t);
        else next.delete(t);
      }
      return next;
    });
  }

  const chosen = plan?.filter((p) => picked.has(p.table)) ?? [];
  const willWrite = chosen.reduce((n, p) => n + p.toAdd + p.toOverwrite, 0);
  const willDelete = chosen.reduce((n, p) => n + p.onlyInDb, 0);

  async function run() {
    if (!file || chosen.length === 0) {
      notify("되돌릴 묶음을 골라주세요.", "error");
      return;
    }
    // 무엇이 바뀌는지 **숫자로** 다시 한 번 보여주고 묻습니다. 「정말 복원할까요?」만 뜨는
    // 확인창은 아무것도 확인시켜 주지 못합니다.
    const ok = await confirmAction(
      `${exportedAt ? new Date(exportedAt).toLocaleString("ko-KR") : "알 수 없는 시점"} 의 자료로 되돌립니다.\n\n` +
        `· 표 ${chosen.length}개 · ${willWrite.toLocaleString("ko-KR")}줄을 덮어쓰거나 새로 넣습니다\n` +
        (wipe
          ? `· ⚠ 파일에 없는 ${willDelete.toLocaleString("ko-KR")}줄을 지웁니다 (백업 이후에 만든 자료입니다)\n`
          : `· 파일에 없는 ${willDelete.toLocaleString("ko-KR")}줄은 그대로 둡니다\n`) +
        `\n되돌리기 직전에 지금 상태가 한 벌 저장되므로, 되돌린 것도 다시 되돌릴 수 있습니다.`,
      { confirmLabel: "되돌리기", danger: true },
    );
    if (!ok) return;

    setBusy(true);
    try {
      const res = await fetch("/api/admin/restore", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ backup: file.json, tables: [...picked], dryRun: false, wipeMissing: wipe }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        written?: number;
        deleted?: number;
        safetyBackup?: string;
        error?: string;
      };
      if (!res.ok) {
        notify(body.error || "되돌리지 못했습니다.", "error");
        return;
      }
      // 절반만 들어간 상태를 「완료」로 보여주지 않습니다.
      if (body.error) notify(body.error, "error");
      else
        notify(
          `${(body.written ?? 0).toLocaleString("ko-KR")}줄을 되돌렸습니다` +
            (body.deleted ? ` · ${body.deleted.toLocaleString("ko-KR")}줄 지움` : "") +
            `. 직전 상태는 「${body.safetyBackup}」로 저장했습니다. 화면을 새로고침해주세요.`,
          "success",
        );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mb-4 rounded-xl border border-amber-300 bg-amber-50/60 p-3">
      <div className="mb-1.5 flex flex-wrap items-center gap-2">
        <b className="text-sm text-amber-900">♻️ 백업 파일로 되돌리기</b>
        <label className="ml-auto shrink-0 cursor-pointer rounded-lg border border-amber-400 bg-white px-3 py-1.5 text-[12px] font-bold text-amber-800 hover:bg-amber-100">
          {file ? "다른 파일 고르기" : "백업 파일 고르기"}
          <input
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void pickFile(f);
              e.target.value = "";
            }}
          />
        </label>
      </div>
      <p className="text-[12px] leading-relaxed text-amber-800">
        내려받아 둔 파일을 올리면 <b>무엇이 몇 줄 바뀌는지 먼저 보여줍니다.</b> 그걸 보고 되돌릴 묶음을
        고른 뒤 눌러주세요. 되돌리기 직전에 지금 상태가 한 벌 저장되므로 되돌린 것도 다시 되돌릴 수 있습니다.
      </p>

      {busy && !plan && <p className="mt-2 text-[12px] text-amber-700">파일을 읽는 중…</p>}

      {plan && (
        <div className="mt-2 border-t border-amber-200 pt-2">
          <p className="mb-1.5 text-[12px] font-bold text-amber-900">
            📄 {file?.name} · {exportedAt ? new Date(exportedAt).toLocaleString("ko-KR") : "시점 알 수 없음"}
          </p>

          <div className="flex flex-col gap-1">
            {groupsInFile.map((g) => {
              const rows = plan.filter((p) => g.tables.includes(p.table));
              const on = g.tables.every((t) => picked.has(t));
              const add = rows.reduce((n, p) => n + p.toAdd, 0);
              const over = rows.reduce((n, p) => n + p.toOverwrite, 0);
              const only = rows.reduce((n, p) => n + p.onlyInDb, 0);
              const broken = rows.filter((p) => p.skip);
              return (
                <label
                  key={g.group}
                  className={
                    "flex cursor-pointer items-start gap-2 rounded-lg border px-2 py-1.5 text-[12px] transition " +
                    (on ? "border-amber-400 bg-white" : "border-transparent bg-white/50 hover:bg-white")
                  }
                >
                  <input type="checkbox" checked={on} onChange={(e) => toggleGroup(g.tables, e.target.checked)} className="mt-0.5" />
                  <span className="min-w-0 flex-1">
                    <b className="text-slate-800">{g.group}</b>
                    <span className="ml-1 text-slate-500">표 {rows.length}개</span>
                    <span className="ml-2 text-emerald-700">새로 {add.toLocaleString("ko-KR")}줄</span>
                    <span className="ml-1.5 text-blue-700">덮어씀 {over.toLocaleString("ko-KR")}줄</span>
                    {only > 0 && <span className="ml-1.5 text-slate-500">파일에 없음 {only.toLocaleString("ko-KR")}줄</span>}
                    {/* 되돌릴 수 없는 표를 조용히 빼지 않습니다. 빼두면 사람은 다 되돌린 줄
                        알고, 그 표만 옛 상태로 남습니다. */}
                    {broken.length > 0 && (
                      <span className="mt-0.5 block text-[11px] font-semibold text-rose-700">
                        되돌릴 수 없음: {broken.map((b) => `${b.table}(${b.skip})`).join(" · ")}
                      </span>
                    )}
                  </span>
                </label>
              );
            })}
          </div>

          <label className="mt-2 flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-2 py-1.5 text-[11px] text-rose-800">
            <input type="checkbox" checked={wipe} onChange={(e) => setWipe(e.target.checked)} className="mt-0.5" />
            <span>
              <b>파일과 똑같이 맞추기</b> — 파일에 없는 줄을 <b>지웁니다</b>. 백업받은 뒤에 새로 만든 자료가
              사라집니다. 「잘못된 것이 잔뜩 들어와서 그때 상태로 완전히 되돌려야 할 때」만 켜세요.
            </span>
          </label>

          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button
              onClick={() => void run()}
              disabled={busy || picked.size === 0}
              className="rounded-lg bg-amber-600 px-4 py-2 text-[13px] font-bold text-white hover:bg-amber-700 disabled:opacity-40"
            >
              {busy ? "되돌리는 중…" : "♻️ 고른 묶음 되돌리기"}
            </button>
            {picked.size > 0 && (
              <span className="text-[11px] text-amber-800">
                표 {chosen.length}개 · {willWrite.toLocaleString("ko-KR")}줄
                {wipe && willDelete > 0 && <b className="text-rose-700"> · {willDelete.toLocaleString("ko-KR")}줄 지움</b>}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
