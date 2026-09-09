"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { friendlyError } from "@/lib/errorMessage";
import type { BackupSummary } from "@/lib/types";
import { useConfirm } from "@/components/common/ConfirmProvider";
import { useToast } from "@/components/common/ToastProvider";
import GuideButton from "@/components/common/GuideButton";

const TABLE_LABELS: Record<string, string> = {
  incidents: "사건기록",
  meetings: "회의기록",
  events: "행사기록",
  proposals: "제안함",
  adopted: "채택예정",
  manual_sections: "매뉴얼",
  documents: "서류함",
  tasks: "업무",
  task_comments: "업무 코멘트",
  task_attachments: "업무 첨부파일",
};

function tableLabel(t: string) {
  return TABLE_LABELS[t] ?? t;
}

// 관리자/개발자 전용 데이터 백업/복원 화면입니다. "지금 백업 만들기"는 사건/회의/행사/제안함/
// 채택예정/매뉴얼/업무/서류함의 현재 상태를 통째로 스냅샷(JSON)으로 저장하고, "이 시점으로
// 복원"은 그 스냅샷 시점으로 되돌립니다(요청: "데이터가 꼬여서 날아가버리지않게 백업할수있게
// 만들어주고 백업복원도 관리자,개발자권한을 가진사람이 복원 할 수 있게"). 두 동작 모두 실제
// 로직은 DB 함수(create_backup/restore_backup)에서 처리하고, 이 화면은 그 함수를 호출/결과
// 표시만 합니다 - 함수 안에서 다시 한 번 관리자/개발자 여부를 확인하므로, 화면 접근 제한이
// 뚫려도 DB가 최종 방어선이 됩니다.
const GUIDE_SECTIONS = [
  {
    title: "💾 데이터 백업이란?",
    lines: [
      "사건·회의·행사·제안함·채택예정·매뉴얼·업무·서류함의 지금 상태를 통째로 저장해두는 기능입니다.",
      "잘못된 일괄 수정이나 실수로 인한 대량 삭제처럼 되돌리기 어려운 사고가 났을 때, 저장해둔 시점으로 되돌릴 수 있습니다.",
      "매일 자동으로도 저장되지만, 큰 작업(명부 일괄 반영, 학기 전환 등) 직전에는 직접 한 번 눌러 저장해두시면 안전합니다.",
    ],
  },
  {
    title: "⚠️ 복원할 때 주의할 점",
    lines: [
      "복원은 그 시점 이후에 쌓인 내용을 덮어씁니다. 되돌리기 전에 \"무엇을 잃게 되는지\"를 먼저 확인해주세요.",
      "학생 명부·셔틀 배정은 이 백업에 들어 있지 않습니다. 그쪽은 [학교 > 명부 점검]과 마이그레이션으로 관리됩니다.",
      "확실하지 않으면 복원 전에 지금 상태를 한 번 더 저장해두세요. 되돌린 것을 다시 되돌릴 수 있습니다.",
    ],
  },
];

/** 최근 자동저장·내려받기 기록. 백업이 정말 돌고 있는지 사람이 눈으로 확인하는 자리입니다. */
export type ExportLogRow = {
  id: string;
  actor_email: string;
  kind: string;
  table_count: number | null;
  row_count: number | null;
  failed_tables: string[] | null;
  storage_path: string | null;
  bytes: number | null;
  created_at: string;
};

export default function AdminBackupsClient({
  initialBackups,
  exportLog = [],
}: {
  initialBackups: BackupSummary[];
  exportLog?: ExportLogRow[];
}) {
  const confirmAction = useConfirm();
  const notify = useToast();
  const [backups, setBackups] = useState<BackupSummary[]>(initialBackups);
  const [label, setLabel] = useState("");
  const [creating, setCreating] = useState(false);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);

  /**
   * **전체 데이터를 파일 하나로 내려받습니다.**
   *
   * 지금까지의 백업은 전부 데이터베이스 안이나 Supabase 대시보드 안에 있었습니다. 그러면
   * 데이터베이스가 통째로 잘못되거나 계정을 잃었을 때 백업도 같이 사라집니다.
   * 한 벌은 반드시 학교 손에 있어야 합니다.
   */
  async function downloadAll() {
    setDownloading(true);
    try {
      const res = await fetch("/api/admin/export", { cache: "no-store" });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        notify((b as { error?: string }).error || "내려받지 못했습니다.", "error");
        return;
      }
      // 표가 빠진 채로 만들어진 백업을 온전한 것으로 믿게 두지 않습니다.
      const failed = res.headers.get("X-Backup-Failed");
      const rows = res.headers.get("X-Backup-Rows");
      const blob = await res.blob();
      const name = /filename="([^"]+)"/.exec(res.headers.get("Content-Disposition") ?? "")?.[1] ?? "gia-data.json";
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      a.click();
      URL.revokeObjectURL(url);
      if (failed && failed !== "none") {
        notify(`받긴 했지만 못 읽은 표가 있습니다: ${failed}. 이 파일은 온전하지 않습니다.`, "error");
      } else {
        notify(`${Number(rows ?? 0).toLocaleString("ko-KR")}줄을 받았습니다. 학교 밖(구글 드라이브 등)에도 한 벌 두세요.`, "success");
      }
    } finally {
      setDownloading(false);
    }
  }

  async function createBackup() {
    setCreating(true);
    const supabase = createClient();
    const { data, error } = await supabase.rpc("create_backup", { p_label: label.trim() || null });
    setCreating(false);
    if (error) {
      notify(friendlyError("백업을 만들지 못했습니다.", error), "error");
      return;
    }
    const row = data as BackupSummary & { snapshot: unknown };
    setBackups((prev) => [
      { id: row.id, label: row.label, created_by: row.created_by, created_at: row.created_at, tables: row.tables },
      ...prev,
    ]);
    setLabel("");
  }

  async function restoreBackup(b: BackupSummary) {
    const when = new Date(b.created_at).toLocaleString("ko-KR");
    // 되돌릴 수 없는 작업이라(복원하는 순간 지금 데이터가 이 백업 시점 내용으로 대체됩니다),
    // 두 번 확인합니다 - 라벨/시각/대상 테이블을 다시 보여줘서 실수로 엉뚱한 백업을 고르지
    // 않도록 합니다.
    const ok = await confirmAction(
      `"${b.label || "(이름 없음)"}" (${when}) 시점으로 복원할까요?\n\n` +
        `대상: ${b.tables.map(tableLabel).join(", ")}\n\n` +
        `지금 이 화면들의 데이터가 그 시점 내용으로 바뀝니다. 되돌릴 수 없으니, 걱정되면 먼저 " 지금 백업 만들기"로 현재 상태부터 남겨두세요.`,
      { danger: true, confirmLabel: "복원" }
    );
    if (!ok) return;

    setRestoringId(b.id);
    const supabase = createClient();
    const { error } = await supabase.rpc("restore_backup", { p_backup_id: b.id });
    setRestoringId(null);
    if (error) {
      notify(friendlyError("복원하지 못했습니다.", error), "error");
      return;
    }
    notify("복원을 완료했습니다. 화면을 새로고침해 주세요.", "success");
  }

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-4">
        <div className="flex items-center justify-between gap-2">
          <h1 className="text-lg font-bold text-slate-800">데이터 백업/복원</h1>
          <GuideButton title="데이터 백업 사용 가이드" sections={GUIDE_SECTIONS} />
        </div>
        <p className="mt-1 text-sm text-slate-500">
          사건·회의·행사·제안함·채택예정·매뉴얼·업무·서류함의 현재 상태를 스냅샷으로 저장하고,
          필요하면 그 시점으로 되돌립니다. 관리자만 볼 수 있습니다.
        </p>
      </div>

      {/* ── 전체 데이터 ────────────────────────────────────────────────
          아래 「지금 백업 만들기」는 사건·회의·업무 등 일부 표만 담고, 그것도 **같은
          데이터베이스 안**에 둡니다. DB가 통째로 잘못되면 함께 사라지므로 그것만으로는
          백업이 아닙니다. 그래서 밖으로 나가는 길을 위에 따로 둡니다. */}
      <div className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50/60 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <b className="text-sm text-emerald-900">📦 전체 데이터 내려받기</b>
          <button
            onClick={() => void downloadAll()}
            disabled={downloading}
            className="ml-auto shrink-0 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-50"
          >
            {downloading ? "모으는 중…" : "⬇ 지금 받기"}
          </button>
        </div>
        <p className="mt-1.5 text-[12px] leading-relaxed text-emerald-800">
          학생 명부·출결·회계·셔틀·업무까지 <b>전부</b> 파일 하나로 받습니다. 매일 밤 자동으로도 한 벌이
          저장소(데이터베이스 밖)에 저장되지만, <b>학교 손에 있는 한 벌</b>은 따로 있어야 합니다 —
          받은 파일은 구글 드라이브처럼 다른 곳에 옮겨두세요.
        </p>
        <p className="mt-1 text-[11px] text-emerald-700">
          개인정보와 연락처가 통째로 담긴 파일입니다. 누가 언제 받았는지 기록에 남습니다.
        </p>

        {exportLog.length > 0 && (
          <div className="mt-2 border-t border-emerald-200 pt-2">
            <p className="mb-1 text-[11px] font-bold text-emerald-800">최근 기록</p>
            <div className="flex flex-col gap-0.5">
              {exportLog.map((r) => (
                <div key={r.id} className="flex flex-wrap items-center gap-1.5 text-[11px] text-emerald-900">
                  <span className="tabular-nums text-emerald-700">{new Date(r.created_at).toLocaleString("ko-KR")}</span>
                  <span className="rounded-full bg-white px-1.5 font-bold">{r.kind}</span>
                  <span className="text-emerald-700">{r.actor_email}</span>
                  {r.row_count != null && <span>{r.row_count.toLocaleString("ko-KR")}줄</span>}
                  {r.bytes != null && <span>· {(r.bytes / 1024 / 1024).toFixed(1)}MB</span>}
                  {/* 빠진 표가 있으면 **빨갛게** 적습니다. 백업의 최악은 안 되는 것이 아니라
                      되는 줄 알았는데 그 표만 없는 것입니다. */}
                  {r.failed_tables && r.failed_tables.length > 0 && (
                    <span className="rounded-full bg-rose-100 px-1.5 font-bold text-rose-700">
                      못 읽음: {r.failed_tables.join(", ")}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="mb-6 flex items-center gap-2 g-panel-solid p-3 shadow-sm">
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="백업 이름(선택, 예: 발행 직전)"
          className="min-w-0 flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-300"
        />
        <button
          onClick={createBackup}
          disabled={creating}
          className="shrink-0 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:opacity-50"
        >
          {creating ? "만드는 중..." : "💾 지금 백업 만들기"}
        </button>
      </div>

      <div className="flex flex-col gap-2">
        {backups.length === 0 && (
          <div className="rounded-lg bg-white p-6 text-center text-sm text-slate-400 shadow-sm">
            아직 만들어진 백업이 없습니다.
          </div>
        )}
        {backups.map((b) => (
          <div key={b.id} className="flex items-center justify-between gap-3 g-panel-solid p-3 shadow-sm">
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold text-slate-800">{b.label || "(이름 없음)"}</div>
              <div className="mt-0.5 text-xs text-slate-400">
                {new Date(b.created_at).toLocaleString("ko-KR")} · {b.created_by}
              </div>
              <div className="mt-1 text-[11px] text-slate-400">{b.tables.map(tableLabel).join(" · ")}</div>
            </div>
            <button
              onClick={() => restoreBackup(b)}
              disabled={restoringId === b.id}
              className="shrink-0 rounded-lg border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-600 transition hover:bg-red-50 disabled:opacity-50"
            >
              {restoringId === b.id ? "복원 중..." : "이 시점으로 복원"}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
