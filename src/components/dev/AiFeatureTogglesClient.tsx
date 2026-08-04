"use client";

import { useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type FeatureItem = { key: string; label: string; group: string; enabled: boolean };

// 개발자 대시보드에서 AI 기능을 항목별로 켜고 끄는 스위치 목록입니다. 끄면 ai_feature_flags에
// upsert(enabled=false)하고, claude.ts가 다음 호출부터 해당 route를 막습니다(과금 즉시 0원).
// RLS가 is_developer()만 write를 허용하므로 개발자 계정이 아니면 update 자체가 거부됩니다.
export default function AiFeatureTogglesClient({
  initialFeatures,
  myEmail,
}: {
  initialFeatures: FeatureItem[];
  myEmail: string;
}) {
  const [features, setFeatures] = useState<FeatureItem[]>(initialFeatures);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const grouped = useMemo(() => {
    const map = new Map<string, FeatureItem[]>();
    for (const f of features) {
      const list = map.get(f.group);
      if (list) list.push(f);
      else map.set(f.group, [f]);
    }
    return [...map.entries()];
  }, [features]);

  async function toggle(key: string, nextEnabled: boolean) {
    setBusyKey(key);
    setError(null);
    const supabase = createClient();
    const feature = features.find((f) => f.key === key);
    const { error: upsertError } = await supabase.from("ai_feature_flags").upsert(
      {
        key,
        label: feature?.label ?? key,
        group_name: feature?.group ?? "기타",
        enabled: nextEnabled,
        updated_by: myEmail,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "key" }
    );
    setBusyKey(null);
    if (upsertError) {
      setError(upsertError.message || "변경하지 못했습니다.");
      return;
    }
    setFeatures((prev) => prev.map((f) => (f.key === key ? { ...f, enabled: nextEnabled } : f)));
  }

  return (
    <div className="flex flex-col gap-4">
      {error && <p className="text-xs text-red-600">{error}</p>}
      {grouped.map(([group, items]) => (
        <div key={group}>
          <div className="mb-1.5 text-[11px] font-semibold text-slate-400">{group}</div>
          <div className="flex flex-col gap-1">
            {items.map((f) => (
              <div
                key={f.key}
                className="flex items-center justify-between gap-3 rounded-lg border border-slate-100 px-3 py-1.5"
              >
                <div className="min-w-0">
                  <div className="truncate text-xs font-semibold text-slate-700">{f.label}</div>
                  <div className="truncate font-mono text-[10px] text-slate-400">{f.key}</div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className={`text-[11px] font-bold ${f.enabled ? "text-emerald-600" : "text-slate-400"}`}>
                    {f.enabled ? "켜짐" : "꺼짐"}
                  </span>
                  {/* 텍스트 배지 대신 실제 켜고/끄는 스위치 모양으로 바꿨습니다(요청: "온오프
                      켜짐꺼짐으로 말고 온오프 버튼으로 만들어주고"). */}
                  <button
                    type="button"
                    role="switch"
                    aria-checked={f.enabled}
                    onClick={() => toggle(f.key, !f.enabled)}
                    disabled={busyKey === f.key}
                    title={f.enabled ? "클릭하면 끕니다" : "클릭하면 켭니다"}
                    className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${
                      f.enabled ? "bg-emerald-500" : "bg-slate-300"
                    }`}
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                        f.enabled ? "translate-x-6" : "translate-x-1"
                      }`}
                    />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
