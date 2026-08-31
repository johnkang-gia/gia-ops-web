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

export default function AdminBackupsClient({ initialBackups }: { initialBackups: BackupSummary[] }) {
  const confirmAction = useConfirm();
  const notify = useToast();
  const [backups, setBackups] = useState<BackupSummary[]>(initialBackups);
  const [label, setLabel] = useState("");
  const [creating, setCreating] = useState(false);
  const [restoringId, setRestoringId] = useState<string | null>(null);

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
