"use client";

import { useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/common/ToastProvider";
import { useConfirm } from "@/components/common/ConfirmProvider";
import { mergePreview, type DupGroup, type DupPerson } from "@/lib/studentDuplicates";

/**
 * 이름이 같은 학생 줄.
 *
 * **묶는 근거는 이름 하나뿐입니다.** 생년월일이나 영문 이름이 같다는 이유로 올리던 것은
 * 뺐습니다 — 그렇게 걸린 짝은 대부분 다른 아이였고, 틀린 짝이 섞이면 사람이 목록 자체를
 * 신뢰하지 않게 됩니다. 합치는 일은 되돌릴 수 없으니 목록은 좁은 편이 낫습니다.
 *
 * ── 화면이 답해야 하는 물음 ────────────────────────────────────────────
 *
 * 이름이 같다는 것만으로는 아무것도 정할 수 없습니다. 김재이가 셋, 이준서가 둘인 학교입니다.
 * 사람이 정해야 하는 것은 **다른 아이인가, 같은 아이인데 줄이 두 번 만들어진 것인가**이고,
 * 그 판단에 필요한 것을 화면이 전부 내놓아야 합니다.
 *
 *   · 반·학년   — 다르면 동명이인일 가능성이 큽니다
 *   · 생년월일  — 판정에는 안 쓰지만, 사람이 보기에는 가장 큰 단서입니다
 *   · 보호자 번호 — 같으면 같은 집(같은 아이이거나 형제)
 *   · **붙어 있는 기록** — 한쪽이 텅 비었으면 새로 생긴 빈 줄입니다
 *
 * 마지막 것이 핵심입니다. 「출결 42 · 청구서 3」과 「기록 없음」이 나란히 있으면 무엇을
 * 남길지가 바로 보입니다.
 */

export type DupStudent = DupPerson;

/** 학생 id → { 표 이름: 건수 }. 표 목록은 DB가 외래키에서 스스로 찾아 셉니다. */
export type RecordCounts = Record<string, Record<string, number>>;

/**
 * 표 이름을 사람이 읽는 말로.
 *
 * 목록에 없는 표는 **감추지 않고 표 이름 그대로 보여줍니다.** 감추면 「기록 없음」이라고
 * 잘못 말하게 되고, 그 말을 믿고 지우면 기록이 사라집니다.
 */
const TABLE_LABEL: Record<string, string> = {
  attendance_records: "출결",
  attendance_entries: "출결 등록",
  wr_reports: "관찰기록",
  wr_report_entries: "관찰기록",
  shuttle_assignments: "셔틀 배정",
  shuttle_boardings: "셔틀 탑승",
  invoices: "청구서",
  payments: "수납",
  cash_receipts: "현금영수증",
  student_fee_items: "학비외 항목",
  student_fee_enrollments: "학비 신청",
  student_fee_discounts: "학비 할인",
  student_dismissal_plans: "하원수단",
  student_group_members: "수강 그룹",
  pickup_requests: "학부모 연락",
  student_notes: "특이사항",
  wr_student_term_classes: "학기별 반",
  student_uniform_sizes: "교복 사이즈",
};

export default function DuplicateStudents({
  groups,
  counts,
  canMerge,
}: {
  groups: DupGroup[];
  counts: RecordCounts;
  canMerge: boolean;
}) {
  const notify = useToast();
  const confirmAction = useConfirm();
  const [rows, setRows] = useState(groups);
  const [busy, setBusy] = useState<string | null>(null);

  const total = useMemo(() => rows.reduce((n, g) => n + g.people.length, 0), [rows]);
  if (rows.length === 0) return null;

  const totalOf = (id: string) => Object.values(counts[id] ?? {}).reduce((n, v) => n + v, 0);

  async function merge(group: DupGroup, keep: DupStudent) {
    const others = group.people.filter((s) => s.id !== keep.id);
    const keepN = totalOf(keep.id);
    const dropN = others.reduce((n, o) => n + totalOf(o.id), 0);

    // 무엇이 채워지고 무엇이 버려지는지. **누르기 전에** 보여줍니다 - 「합치면 저쪽 번호가
    // 들어오겠지」라고 생각하고 눌렀는데 실제로는 버려지는 것이 이 화면의 가장 큰 위험입니다.
    const pv = mergePreview(keep, others);

    const ok = await confirmAction(
      `${keep.name} ${others.length + 1}줄을 한 줄로 합칩니다.\n\n` +
        `남길 줄: ${keep.grade ?? "?"}학년 ${keep.class_name ?? ""} · ${keep.birth_date ?? "생일 없음"} · 기록 ${keepN}건\n` +
        `합칠 줄: ${others.map((o) => `${o.grade ?? "?"}학년 ${o.class_name ?? ""} · 기록 ${totalOf(o.id)}건`).join(" / ")}\n\n` +
        `· 기록 ${dropN}건이 남길 줄로 옮겨집니다\n` +
        (pv.filled.length > 0
          ? `\n[채워집니다 — 남길 줄이 비어 있던 칸]\n` + pv.filled.map((f) => `  ${f.label}: ${f.value}`).join("\n") + `\n`
          : "") +
        (pv.dropped.length > 0
          ? `\n⚠ [버려집니다 — 양쪽에 값이 있어 남길 줄이 이깁니다]\n` +
            pv.dropped.map((d) => `  ${d.label}: ${d.keep} 유지 / ${d.drop} 버림`).join("\n") +
            `\n  → 버릴 값을 살리려면 반대쪽 줄을 남기고 합치세요.\n`
          : "") +
        (pv.filled.length === 0 && pv.dropped.length === 0 ? `\n· 두 줄의 칸 내용이 같아 바뀌는 칸이 없습니다\n` : "") +
        `\n· 화면에 안 보이는 칸도 같은 규칙입니다 — 빈 칸만 채워지고, 양쪽에 있으면 남길 줄이 이깁니다\n` +
        `· 같은 날 출결처럼 겹치는 줄은 빈 칸끼리 합친 뒤 하나로 정리됩니다\n\n` +
        `다른 아이라면 두 아이의 출결과 관찰기록이 섞입니다. 되돌릴 수 없습니다.`,
      { danger: true },
    );
    if (!ok) return;

    setBusy(keep.id);
    const supabase = createClient();
    for (const o of others) {
      const { error } = await supabase.rpc("merge_students", { keep_id: keep.id, drop_id: o.id });
      if (error) {
        // 조용히 넘기면 화면에서는 합쳐진 것처럼 보이는데 두 줄이 그대로 남습니다.
        setBusy(null);
        notify("합치지 못했습니다: " + error.message, "error");
        return;
      }
    }
    setBusy(null);
    setRows((p) => p.filter((g) => g.key !== group.key));
    notify(`${keep.name} 을(를) 한 줄로 합쳤습니다.`, "success");
  }

  return (
    <section className="mb-4 rounded-2xl border-2 border-amber-300 bg-amber-50 p-3">
      <h2 className="mb-1 text-[15px] font-bold text-amber-900">
        👥 같은 아이일 수 있는 줄 {rows.length}건 ({total}줄)
      </h2>
      <p className="mb-2 text-[11px] leading-relaxed text-amber-800">
        근거는 <b>이름 둘</b>뿐입니다 — 이름이 같거나(진한 테두리), 한쪽 이름이 다른 쪽의 <b>앞부분</b>이거나(점선
        테두리 · 「제이콥」과 「제이콥 딜런 마」). 생년월일이나 영문 이름이 같다는 이유로는 올리지 않습니다(대부분
        다른 아이였습니다). 「김민준」과 「김민준서」처럼 <b>띄어쓰기 없이 붙은 이름</b>도 올리지 않습니다.
        이름이 같다고 같은 아이는 아닙니다 — <b>반·생년월일·보호자 번호·붙어 있는 기록</b>을 보고 판단해 주세요.
        {canMerge ? " 합치면 되돌릴 수 없습니다." : " 합치는 것은 관리자만 할 수 있습니다."}
      </p>
      {/* 이 규칙을 모르고 누르면 살리려던 값이 조용히 사라집니다. 목록 위에 못박아 둡니다. */}
      <p className="mb-2 rounded-lg bg-white/70 px-2 py-1.5 text-[11px] leading-relaxed text-amber-900">
        <b>합치기 규칙:</b> 남기는 줄의 <b>빈 칸만</b> 지우는 줄의 값으로 채워집니다. 양쪽에 값이 있으면{" "}
        <b>남기는 줄이 이기고 다른 쪽은 버려집니다.</b> 살리고 싶은 연락처가 있는 줄을 남기세요 — 누르기 전에 무엇이
        채워지고 무엇이 버려지는지 확인창에 나옵니다.
      </p>

      <div className="flex flex-col gap-2">
        {rows.map((g) => {
          const empties = g.people.filter((s) => totalOf(s.id) === 0).length;
          const filled = g.people.length - empties;
          // 이름이 정확히 같지 않고 «한쪽에 들어 있는» 묶음은 확신이 약합니다. 테두리로
          // 구분해서, 강한 근거와 같은 무게로 읽히지 않게 합니다.
          const weak = !g.reasons.includes("이름 같음");
          return (
            <div
              key={g.key}
              className={"rounded-xl border bg-white p-2 " + (weak ? "border-dashed border-slate-300" : "border-amber-200")}
            >
              <p className="mb-1.5 flex flex-wrap items-baseline gap-2 text-[13px] font-bold text-slate-800">
                {/* 이름이 서로 달라서 묶인 경우엔 두 이름을 다 보여줘야 왜 묶였는지 압니다. */}
                {weak ? g.people.map((s) => s.name).join(" · ") : g.people[0].name}
                <span className="text-[11px] font-semibold text-slate-400">{g.people.length}줄</span>
                {weak && (
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-600">
                    이름이 한쪽에 들어 있음 — 부르는 이름 / 성·미들네임까지
                  </span>
                )}
                {/* 한눈에 무엇을 해야 하는지. 이 한 줄이 대부분의 판단을 끝냅니다. */}
                {empties > 0 && filled === 1 ? (
                  <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-800">
                    한쪽이 빈 줄 — 같은 아이일 가능성이 큽니다
                  </span>
                ) : empties === 0 ? (
                  <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-bold text-rose-800">
                    양쪽 다 기록 있음 — 동명이인인지 먼저 확인
                  </span>
                ) : (
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-800">
                    기록이 나뉘어 있음
                  </span>
                )}
              </p>

              <ul className="flex flex-col gap-1">
                {g.people.map((s) => {
                  const c = counts[s.id] ?? {};
                  const entries = Object.entries(c)
                    .filter(([, n]) => n > 0)
                    .sort((a, b) => b[1] - a[1]);
                  // 번호를 하나로 합쳐 보여주면 안 됩니다. 중고등부는 **보호자 번호 때문에
                  // 줄이 나뉜** 경우가 많아서, 어느 칸에 무엇이 들어 있는지가 곧 판단 근거이고
                  // 합칠 때 무엇이 버려지는지를 정하는 값이기도 합니다.
                  const phones = [
                    { label: "모", v: s.mother_phone },
                    { label: "부", v: s.father_phone },
                    { label: "보호자", v: s.parent_phone },
                  ].filter((x) => x.v && x.v.trim());
                  return (
                    <li key={s.id} className="rounded-lg border border-slate-100 bg-slate-50/60 px-2 py-1.5">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px]">
                        <span
                          className={
                            "shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold " +
                            (s.status === "보류" ? "bg-amber-100 text-amber-800" : "bg-emerald-100 text-emerald-800")
                          }
                        >
                          {s.status === "보류" ? "보류" : "재학"}
                        </span>
                        <b className="text-slate-800">
                          {s.grade ? `${s.grade}학년` : "학년 없음"} {s.class_name ?? "반 없음"}
                        </b>
                        <span className="text-slate-500">{s.birth_date ?? "생일 없음"}</span>
                        {s.name_en && <span className="text-slate-400">{s.name_en}</span>}
                        {/* 같은 번호면 같은 집입니다. 형제일 수도, 같은 아이일 수도 있습니다. */}
                        {phones.length === 0 ? (
                          <span className="text-slate-300">연락처 없음</span>
                        ) : (
                          phones.map((x) => (
                            <span key={x.label} className="text-slate-500">
                              <span className="text-[10px] font-bold text-slate-400">{x.label}</span> {x.v}
                            </span>
                          ))
                        )}
                        <span className="text-[10px] text-slate-300">등록 {s.created_at.slice(0, 10)}</span>

                        {canMerge && (
                          <button
                            type="button"
                            disabled={busy === s.id}
                            onClick={() => void merge(g, s)}
                            className="ml-auto rounded-lg border border-amber-400 px-2 py-0.5 text-[11px] font-semibold text-amber-800 hover:bg-amber-100 disabled:opacity-40"
                            title="이 줄을 남기고 나머지를 여기에 합칩니다"
                          >
                            {busy === s.id ? "합치는 중…" : "이 줄로 합치기"}
                          </button>
                        )}
                      </div>

                      {/* 붙어 있는 기록. **없으면 「없음」이라고 말합니다** - 비워두면
                          아직 안 세어본 것인지 정말 없는 것인지 구별이 안 됩니다. */}
                      <div className="mt-1 flex flex-wrap items-center gap-1">
                        {entries.length === 0 ? (
                          <span className="rounded bg-slate-200 px-1.5 py-0.5 text-[10px] font-bold text-slate-500">
                            붙어 있는 기록 없음
                          </span>
                        ) : (
                          <>
                            <span className="text-[10px] font-semibold text-slate-400">기록 {totalOf(s.id)}건 —</span>
                            {entries.map(([t, n]) => (
                              <span
                                key={t}
                                className="rounded bg-white px-1.5 py-0.5 text-[10px] font-semibold text-slate-600 ring-1 ring-slate-200"
                                title={t}
                              >
                                {TABLE_LABEL[t] ?? t} {n}
                              </span>
                            ))}
                          </>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </div>
    </section>
  );
}
