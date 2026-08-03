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
                <button
                  type="button"
                  onClick={() => toggle(f.key, !f.enabled)}
                  disabled={busyKey === f.key}
                  className={`shrink-0 rounded-full px-3 py-1 text-[11px] font-bold transition disabled:opacity-50 ${
                    f.enabled
                      ? "bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                      : "bg-red-50 text-red-700 hover:bg-red-100"
                  }`}
                >
                  {f.enabled ? "켜짐" : "일시정지중"}
                </button>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
