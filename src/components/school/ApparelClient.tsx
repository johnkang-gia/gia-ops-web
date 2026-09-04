"use client";

import { useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/common/ToastProvider";
import { todayKst } from "@/lib/kst";
import type { ApparelOrder, ApparelOrderItem, ApparelOrderPiece, StudentApparelSize, StudentGroup, Term } from "@/lib/types";

/**
 * 의류 — 교복과 행사 티셔츠.
 *
 * 요점은 하나입니다. **사이즈를 매번 조사하지 않는 것.**
 *
 * 지금까지는 행사가 있을 때마다 사이즈를 다시 물었고, 그 결과는 그 행사 한 번에 쓰이고
 * 사라졌습니다. 사이즈는 행사의 성질이 아니라 **아이의 성질**입니다. 한 번 적어두면 다음에는
 * 그동안 자란 아이와 새로 온 아이만 물으면 됩니다.
 *
 * 두 가지를 **가두지 않습니다.**
 *
 * ① 사이즈는 자유 입력입니다. 만들 때마다 체계가 달라서(이번엔 S/M/L, 다음엔 100/105),
 *    고르는 목록에 없는 값이 필요한 순간이 반드시 옵니다. 그때 사람은 화면 밖으로 나가고,
 *    나가버리면 이 화면은 반쪽이 됩니다. 자주 쓰는 값은 **거들어주는 보기**로만 붙습니다.
 * ② 세트 구성도 자유입니다. 교복은 상의·하의·넥타이지만 학교마다 다르고, 행사 티셔츠는
 *    품목이 하나뿐인 세트입니다 - 같은 방식으로 다룹니다.
 */

export type ApparelStudent = { id: string; name: string; grade: string | null; className: string | null; department: string | null };

const CATEGORIES = ["행사", "교복", "체육복", "기타"];
/** 사이즈 칸의 흔한 이름. 이것도 보기일 뿐이라 직접 적을 수 있습니다. */
const SIZE_KINDS = ["상의", "하의", "외투", "체육복 상의", "체육복 하의", "신발"];
/** 이보다 오래된 사이즈는 다시 물어볼 때가 됐습니다. 아이는 1년이면 한 치수는 자랍니다. */
const STALE_DAYS = 300;

const STATUS_STYLE: Record<string, string> = {
  준비: "bg-slate-100 text-slate-600",
  진행: "bg-amber-100 text-amber-800",
  발주: "bg-teal-100 text-teal-800",
  완료: "bg-slate-100 text-slate-400",
};

function daysSince(d: string): number {
  return Math.round((Date.now() - new Date(`${d}T12:00:00+09:00`).getTime()) / 86400000);
}

export default function ApparelClient({
  initialOrders,
  initialPieces,
  initialItems,
  initialSizes,
  students,
  terms,
  groups,
  groupMembers,
  currentUserEmail,
  isDemo,
}: {
  initialOrders: ApparelOrder[];
  initialPieces: ApparelOrderPiece[];
  initialItems: ApparelOrderItem[];
  initialSizes: StudentApparelSize[];
  students: ApparelStudent[];
  terms: Term[];
  groups: StudentGroup[];
  groupMembers: Record<string, string[]>;
  currentUserEmail: string;
  isDemo: boolean;
}) {
  const notify = useToast();
  const [orders, setOrders] = useState(initialOrders);
  const [pieces, setPieces] = useState(initialPieces);
  const [items, setItems] = useState(initialItems);
  const [sizes, setSizes] = useState(initialSizes);
  const [selected, setSelected] = useState<string | null>(initialOrders[0]?.id ?? null);
  const [view, setView] = useState<"제작" | "사이즈">("제작");
  const [busy, setBusy] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const [form, setForm] = useState({ name: "", category: "행사", due_date: "" });
  /** 새 제작 건의 구성 품목. 처음엔 하나로 시작하고, 세트면 줄을 늘립니다. */
  const [draftPieces, setDraftPieces] = useState([{ name: "", size_kind: "상의", size_hints: "S,M,L,XL", unit_price: 0 }]);
  const [sizeKind, setSizeKind] = useState("상의");
  const [onlyMissing, setOnlyMissing] = useState(false);

  const order = orders.find((o) => o.id === selected) ?? null;
  const byStudent = useMemo(() => new Map(students.map((s) => [s.id, s])), [students]);

  /** 학생 → 종류 → 사이즈. 제작 건에서 기본값을 끌어오는 자리입니다. */
  const sizeMap = useMemo(() => {
    const m = new Map<string, StudentApparelSize>();
    for (const s of sizes) m.set(`${s.student_id}|${s.kind}`, s);
    return m;
  }, [sizes]);

  const orderPieces = useMemo(
    () => pieces.filter((p) => p.order_id === order?.id).sort((a, b) => a.sort_order - b.sort_order),
    [pieces, order],
  );
  const orderItems = useMemo(() => items.filter((i) => i.order_id === order?.id), [items, order]);
  /** 이 건에 들어 있는 아이들. 품목마다 줄이 있으므로 학생으로 묶습니다. */
  const orderStudentIds = useMemo(() => [...new Set(orderItems.map((i) => i.student_id))], [orderItems]);

  /** 품목 → 사이즈 → 몇 벌. **이 숫자가 곧 발주 수량입니다.** */
  const tally = useMemo(() => {
    const m = new Map<string, Map<string, number>>();
    for (const i of orderItems) {
      if (i.status !== "확정" || !i.size?.trim()) continue;
      const k = i.size.trim();
      const inner = m.get(i.piece_id) ?? new Map<string, number>();
      inner.set(k, (inner.get(k) ?? 0) + i.qty);
      m.set(i.piece_id, inner);
    }
    return m;
  }, [orderItems]);

  /**
   * 이 품목에서 거들어줄 보기.
   *
   * 처음 정해둔 보기 + **이 건에서 실제로 쓴 값**. 목록에 없던 사이즈를 한 번 적으면 다음
   * 아이부터는 그것도 보기에 뜹니다 - 손으로 다시 타이핑하지 않게.
   */
  function hintsOf(p: ApparelOrderPiece): string[] {
    const used = orderItems.filter((i) => i.piece_id === p.id && i.size?.trim()).map((i) => i.size!.trim());
    return [...new Set([...(p.size_hints ?? []), ...used])];
  }

  const pending = orderItems.filter((i) => i.status === "대기").length;

  async function createOrder() {
    const name = form.name.trim();
    const ps = draftPieces.filter((p) => p.name.trim());
    if (!name || ps.length === 0) return;
    setBusy(true);
    const supabase = createClient();
    const { data, error } = await supabase
      .from("apparel_orders")
      .insert({
        name,
        category: form.category,
        due_date: form.due_date || null,
        term_id: terms.find((t) => t.status === "진행중")?.id ?? null,
        created_by: currentUserEmail,
        is_demo: isDemo,
      })
      .select()
      .single();
    if (error || !data) {
      setBusy(false);
      notify("제작 건을 만들지 못했습니다: " + (error?.message ?? ""), "error");
      return;
    }
    const o = data as ApparelOrder;
    const { data: pd, error: pe } = await supabase
      .from("apparel_order_pieces")
      .insert(
        ps.map((p, n) => ({
          order_id: o.id,
          name: p.name.trim(),
          size_kind: p.size_kind.trim() || null,
          size_hints: p.size_hints.split(",").map((s) => s.trim()).filter(Boolean),
          unit_price: Number(p.unit_price) || 0,
          sort_order: n,
        })),
      )
      .select();
    setBusy(false);
    if (pe) {
      notify("구성 품목을 만들지 못했습니다: " + pe.message, "error");
      return;
    }
    setOrders((p) => [o, ...p]);
    setPieces((p) => [...p, ...((pd as ApparelOrderPiece[] | null) ?? [])]);
    setSelected(o.id);
    setNewOpen(false);
    setDraftPieces([{ name: "", size_kind: "상의", size_hints: "S,M,L,XL", unit_price: 0 }]);
    notify(`"${o.name}" 을 만들었습니다. 아래에서 대상을 넣어주세요.`, "success");
  }

  /**
   * 명단에 넣습니다. **저장된 사이즈가 함께 채워집니다.**
   *
   * 이것이 이 화면의 값어치입니다 - 넣는 순간 대부분의 아이는 사이즈가 이미 정해져 있고,
   * 비어 있는 아이만 물어보면 됩니다. 품목마다 한 줄씩 생깁니다.
   */
  async function addStudents(ids: string[]) {
    if (!order || orderPieces.length === 0 || ids.length === 0) return;
    const have = new Set(orderItems.map((i) => `${i.piece_id}|${i.student_id}`));
    const rows: Record<string, unknown>[] = [];
    for (const id of ids) {
      for (const p of orderPieces) {
        if (have.has(`${p.id}|${id}`)) continue;
        // 저장된 사이즈를 **그대로** 씁니다. 보기 목록에 없어도 상관없습니다 - 목록은 제한이
        // 아니라 거들어주는 것뿐입니다.
        const known = p.size_kind ? sizeMap.get(`${id}|${p.size_kind}`) : undefined;
        rows.push({
          order_id: order.id,
          piece_id: p.id,
          student_id: id,
          size: known?.size ?? null,
          status: known?.size ? "확정" : "대기",
          updated_by: currentUserEmail,
        });
      }
    }
    if (rows.length === 0) {
      notify("이미 다 들어 있습니다.", "success");
      return;
    }
    setBusy(true);
    const { data, error } = await createClient().from("apparel_order_items").insert(rows).select();
    setBusy(false);
    if (error) {
      notify("넣지 못했습니다: " + error.message, "error");
      return;
    }
    const made = (data as ApparelOrderItem[] | null) ?? [];
    setItems((p) => [...p, ...made]);
    const filled = made.filter((i) => i.size).length;
    const students = new Set(made.map((i) => i.student_id)).size;
    notify(
      filled > 0
        ? `${students}명을 넣었습니다. ${filled}칸은 저장된 사이즈로 채웠고, ${made.length - filled}칸만 물어보면 됩니다.`
        : `${students}명을 넣었습니다. 사이즈를 적어주세요.`,
      "success",
    );
  }

  async function setSize(item: ApparelOrderItem, raw: string) {
    const size = raw.trim();
    const next = { ...item, size, status: (size ? "확정" : "대기") as ApparelOrderItem["status"] };
    setItems((p) => p.map((x) => (x.id === item.id ? next : x)));
    const { error } = await createClient()
      .from("apparel_order_items")
      .update({ size: size || null, status: size ? "확정" : "대기", updated_by: currentUserEmail })
      .eq("id", item.id);
    if (error) {
      // 조용히 넘기면 화면에는 적힌 것처럼 보이는데 발주 수량에는 안 들어갑니다.
      notify("저장하지 못했습니다: " + error.message, "error");
      setItems((p) => p.map((x) => (x.id === item.id ? item : x)));
      return;
    }
    // DB 트리거가 학생 사이즈에도 남깁니다. 화면도 맞춰둬야 다음 제작 건에서 바로 보입니다.
    const piece = orderPieces.find((p) => p.id === item.piece_id);
    if (piece?.size_kind && size) {
      const key = `${item.student_id}|${piece.size_kind}`;
      setSizes((p) => [
        ...p.filter((s) => `${s.student_id}|${s.kind}` !== key),
        { id: key, student_id: item.student_id, kind: piece.size_kind!, size, measured_at: todayKst(), note: null, updated_by: currentUserEmail },
      ]);
    }
  }

  async function saveDirectSize(studentId: string, kind: string, raw: string) {
    const clean = raw.trim();
    const supabase = createClient();
    if (!clean) {
      await supabase.from("student_apparel_sizes").delete().eq("student_id", studentId).eq("kind", kind);
      setSizes((p) => p.filter((s) => !(s.student_id === studentId && s.kind === kind)));
      return;
    }
    const { error } = await supabase
      .from("student_apparel_sizes")
      .upsert({ student_id: studentId, kind, size: clean, measured_at: todayKst(), updated_by: currentUserEmail }, { onConflict: "student_id,kind" });
    if (error) {
      notify("저장하지 못했습니다: " + error.message, "error");
      return;
    }
    setSizes((p) => [
      ...p.filter((s) => !(s.student_id === studentId && s.kind === kind)),
      { id: `${studentId}|${kind}`, student_id: studentId, kind, size: clean, measured_at: todayKst(), note: null, updated_by: currentUserEmail },
    ]);
  }

  /** 사이즈 대장에서 이미 쓰인 값들. 자유 입력을 거들어줍니다. */
  const kindHints = useMemo(
    () => [...new Set(sizes.filter((s) => s.kind === sizeKind).map((s) => s.size))].sort((a, b) => a.localeCompare(b, "ko", { numeric: true })),
    [sizes, sizeKind],
  );
  const allKinds = useMemo(() => [...new Set([...SIZE_KINDS, ...sizes.map((s) => s.kind)])], [sizes]);

  const sizeRows = useMemo(
    () =>
      students
        .map((s) => ({ s, size: sizeMap.get(`${s.id}|${sizeKind}`) }))
        .filter((r) => !onlyMissing || !r.size || daysSince(r.size.measured_at) > STALE_DAYS),
    [students, sizeMap, sizeKind, onlyMissing],
  );
  const staleCount = students.filter((s) => {
    const v = sizeMap.get(`${s.id}|${sizeKind}`);
    return !v || daysSince(v.measured_at) > STALE_DAYS;
  }).length;

  return (
    <div className="mx-auto max-w-6xl p-4 sm:p-6">
      <div className="mb-1 flex flex-wrap items-baseline gap-2">
        <h1 className="text-lg font-bold">👕 의류</h1>
        <span className="text-xs text-slate-400">교복 · 행사 티셔츠 · 체육복</span>
        <span className="ml-auto flex items-center gap-1.5">
          {(["제작", "사이즈"] as const).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={
                "rounded-lg px-3 py-1.5 text-[13px] font-bold transition " +
                (view === v ? "bg-gia-navy text-white" : "border border-slate-200 text-slate-500 hover:bg-slate-50")
              }
            >
              {v === "제작" ? "제작 건" : "사이즈 대장"}
            </button>
          ))}
        </span>
      </div>
      <p className="mb-4 text-xs leading-relaxed text-slate-500">
        사이즈는 <b>아이에게 저장됩니다.</b> 행사마다 다시 조사하지 않기 위한 것입니다 — 제작 건에 아이를 넣으면 저장된 사이즈가 먼저
        채워지고, <b>비어 있는 아이와 오래된 아이만</b> 물어보면 됩니다. 사이즈는 <b>자유롭게 적습니다</b>(옆의 보기는 거들어주는 것일
        뿐 제한이 아닙니다). 청구는 여기서 하지 않습니다 — 인보이스에서 합니다.
      </p>

      {view === "사이즈" ? (
        <div>
          <div className="mb-2 flex flex-wrap items-center gap-1.5">
            {allKinds.map((k) => (
              <button
                key={k}
                onClick={() => setSizeKind(k)}
                className={
                  "rounded-lg px-2.5 py-1 text-xs font-semibold " +
                  (sizeKind === k ? "bg-slate-800 text-white" : "border border-slate-200 text-slate-600 hover:bg-slate-50")
                }
              >
                {k}
              </button>
            ))}
            <label className="ml-auto flex items-center gap-1 text-[11px] text-slate-500">
              <input type="checkbox" checked={onlyMissing} onChange={(e) => setOnlyMissing(e.target.checked)} />
              물어볼 아이만 ({staleCount}명)
            </label>
          </div>
          <p className="mb-2 text-[11px] text-slate-400">
            비어 있거나 잰 지 {STALE_DAYS}일이 넘은 것은 주황색입니다. 아이는 1년이면 한 치수는 자랍니다 — 오래된 값으로 만들면 안 맞는
            옷이 오고, 그 옷은 다시 만들어야 합니다.
          </p>
          <datalist id="size-hints">
            {kindHints.map((h) => (
              <option key={h} value={h} />
            ))}
          </datalist>
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-[11px] font-semibold text-slate-500">
                <tr>
                  <th className="px-3 py-2">이름</th>
                  <th className="w-20 px-2 py-2">반</th>
                  <th className="w-28 px-2 py-2">{sizeKind}</th>
                  <th className="w-32 px-3 py-2">잰 날</th>
                </tr>
              </thead>
              <tbody>
                {sizeRows.map(({ s, size }) => {
                  const stale = !size || daysSince(size.measured_at) > STALE_DAYS;
                  return (
                    <tr key={s.id} className="border-t border-slate-100">
                      <td className="px-3 py-1.5 text-[13px] font-semibold text-slate-700">{s.name}</td>
                      <td className="px-2 py-1.5 text-[11px] text-slate-400">{s.className ?? `${s.grade ?? "?"}학년`}</td>
                      <td className="px-2 py-1.5">
                        <input
                          list="size-hints"
                          defaultValue={size?.size ?? ""}
                          onBlur={(e) => {
                            if (e.target.value.trim() !== (size?.size ?? "")) void saveDirectSize(s.id, sizeKind, e.target.value);
                          }}
                          placeholder="자유 입력"
                          className={"w-20 rounded border px-1.5 py-0.5 text-[12px] " + (stale ? "border-amber-300 bg-amber-50" : "border-slate-200")}
                        />
                      </td>
                      <td className={"px-3 py-1.5 text-[11px] " + (stale ? "font-semibold text-amber-700" : "text-slate-400")}>
                        {size ? `${size.measured_at} (${daysSince(size.measured_at)}일 전)` : "아직 없음"}
                      </td>
                    </tr>
                  );
                })}
                {sizeRows.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-3 py-8 text-center text-sm text-slate-400">
                      물어볼 아이가 없습니다. 사이즈가 모두 최신입니다.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div>
          <div className="mb-3 flex flex-wrap items-center gap-1.5">
            {orders.map((o) => (
              <button
                key={o.id}
                onClick={() => setSelected(o.id)}
                className={
                  "rounded-lg border px-2.5 py-1.5 text-[12px] font-semibold transition " +
                  (order?.id === o.id ? "border-slate-800 bg-slate-800 text-white" : "border-slate-200 text-slate-600 hover:bg-slate-50")
                }
              >
                {o.name}
                <span className={"ml-1.5 rounded px-1 text-[10px] " + (order?.id === o.id ? "bg-white/20" : STATUS_STYLE[o.status])}>{o.status}</span>
              </button>
            ))}
            <button onClick={() => setNewOpen(true)} className="rounded-lg bg-teal-600 px-3 py-1.5 text-[12px] font-bold text-white">
              + 제작 건
            </button>
          </div>

          {!order ? (
            <div className="rounded-xl border border-dashed border-slate-200 p-8 text-center text-sm text-slate-400">
              아직 제작 건이 없습니다. «+ 제작 건»으로 만들어보세요.
            </div>
          ) : (
            <div className="rounded-xl border border-slate-200 bg-white">
              <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-3 py-2">
                <b className="text-[13px] text-slate-800">{order.name}</b>
                <span className="text-[11px] text-slate-400">
                  {order.category} · {orderPieces.map((p) => p.name).join(" + ")}
                  {order.due_date ? ` · ${order.due_date}까지` : ""}
                </span>
                <span className="text-[11px] font-semibold text-slate-600">{orderStudentIds.length}명</span>
                {pending > 0 && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-800">사이즈 빈 칸 {pending}</span>}
              </div>

              {/* 대상 넣기 - 학년·그룹 통째로. 한 명씩 넣는 것은 마지막 수단입니다. */}
              <div className="flex flex-wrap items-center gap-1.5 border-b border-slate-100 bg-slate-50/60 px-3 py-2">
                <span className="text-[11px] font-semibold text-slate-500">대상 넣기</span>
                <button
                  onClick={() => void addStudents(students.map((s) => s.id))}
                  disabled={busy}
                  className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-[11px] font-bold text-slate-600 disabled:opacity-40"
                >
                  전교생
                </button>
                {[...new Set(students.map((s) => s.grade).filter(Boolean))].map((g) => (
                  <button
                    key={g}
                    onClick={() => void addStudents(students.filter((s) => s.grade === g).map((s) => s.id))}
                    disabled={busy}
                    className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] text-slate-600 disabled:opacity-40"
                  >
                    {g}학년
                  </button>
                ))}
                {groups.map((g) => (
                  <button
                    key={g.id}
                    onClick={() => void addStudents(groupMembers[g.id] ?? [])}
                    disabled={busy}
                    className="rounded-lg border border-teal-200 bg-teal-50 px-2 py-1 text-[11px] font-semibold text-teal-700 disabled:opacity-40"
                    title={`${g.kind} · ${(groupMembers[g.id] ?? []).length}명`}
                  >
                    {g.name}
                  </button>
                ))}
              </div>

              {/* 발주 수량 — 품목마다. 이 줄이 곧 발주서입니다. */}
              {[...tally.keys()].length > 0 && (
                <div className="space-y-1 border-b border-slate-100 px-3 py-2">
                  {orderPieces.map((p) => {
                    const t = tally.get(p.id);
                    if (!t || t.size === 0) return null;
                    return (
                      <div key={p.id} className="flex flex-wrap items-center gap-1.5">
                        <span className="w-20 shrink-0 text-[11px] font-bold text-slate-700">{p.name}</span>
                        {[...t.entries()]
                          .sort((a, b) => a[0].localeCompare(b[0], "ko", { numeric: true }))
                          .map(([s, n]) => (
                            <span key={s} className="rounded-lg bg-slate-800 px-2 py-0.5 text-[12px] font-bold text-white">
                              {s} <span className="tabular-nums">{n}</span>
                            </span>
                          ))}
                        <span className="text-[11px] text-slate-400">{[...t.values()].reduce((a, b) => a + b, 0)}벌</span>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* 학생 한 줄에 품목 칸이 나란히. 세트면 상의·하의를 한 줄에서 봅니다. */}
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="bg-slate-50 text-[11px] font-semibold text-slate-500">
                    <tr>
                      <th className="px-3 py-1.5">이름</th>
                      <th className="w-16 px-2 py-1.5">반</th>
                      {orderPieces.map((p) => (
                        <th key={p.id} className="w-28 px-2 py-1.5">
                          {p.name}
                          {!p.size_kind && (
                            <span className="ml-1 font-normal text-slate-300" title="이 건에서만 적고 학생 기록에는 남기지 않습니다">
                              (이번만)
                            </span>
                          )}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {orderStudentIds.map((sid) => {
                      const s = byStudent.get(sid);
                      if (!s) return null;
                      return (
                        <tr key={sid} className="border-t border-slate-100">
                          <td className="px-3 py-1 text-[12px] font-semibold text-slate-700">{s.name}</td>
                          <td className="px-2 py-1 text-[10px] text-slate-400">{s.className ?? ""}</td>
                          {orderPieces.map((p) => {
                            const it = orderItems.find((i) => i.piece_id === p.id && i.student_id === sid);
                            if (!it) return <td key={p.id} className="px-2 py-1" />;
                            return (
                              <td key={p.id} className="px-2 py-1">
                                <input
                                  list={`hints-${p.id}`}
                                  defaultValue={it.size ?? ""}
                                  onBlur={(e) => {
                                    if (e.target.value.trim() !== (it.size ?? "")) void setSize(it, e.target.value);
                                  }}
                                  placeholder="—"
                                  className={
                                    "w-24 rounded border px-1.5 py-0.5 text-[12px] " +
                                    (it.size?.trim() ? "border-slate-200" : "border-amber-300 bg-amber-50")
                                  }
                                />
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                    {orderStudentIds.length === 0 && (
                      <tr>
                        <td colSpan={orderPieces.length + 2} className="px-3 py-8 text-center text-[12px] text-slate-400">
                          아직 아무도 없습니다. 위에서 학년·그룹을 눌러 한꺼번에 넣어보세요.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              {orderPieces.map((p) => (
                <datalist key={p.id} id={`hints-${p.id}`}>
                  {hintsOf(p).map((h) => (
                    <option key={h} value={h} />
                  ))}
                </datalist>
              ))}
            </div>
          )}
        </div>
      )}

      {newOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onClick={() => setNewOpen(false)}>
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <p className="text-[15px] font-bold text-slate-800">새 제작 건</p>
            <input
              autoFocus
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="예: 2026 체육대회 티셔츠 · 교복 세트"
              className="mt-3 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
            />
            <div className="mt-2 flex flex-wrap items-center gap-1">
              {CATEGORIES.map((c) => (
                <button
                  key={c}
                  onClick={() => setForm((f) => ({ ...f, category: c }))}
                  className={
                    "rounded-lg border px-2 py-1 text-[11px] font-semibold " +
                    (form.category === c ? "border-teal-500 bg-teal-600 text-white" : "border-slate-200 text-slate-500")
                  }
                >
                  {c}
                </button>
              ))}
              <label className="ml-auto text-[11px] text-slate-500">
                마감
                <input
                  type="date"
                  value={form.due_date}
                  onChange={(e) => setForm((f) => ({ ...f, due_date: e.target.value }))}
                  className="ml-1 rounded-lg border border-slate-300 px-1.5 py-1 text-[12px]"
                />
              </label>
            </div>

            {/* 세트 구성.
                교복은 상의·하의·넥타이가 함께 가는데 **사이즈는 품목마다 따로**입니다.
                낱개로 만드는 것은 품목이 하나뿐인 세트일 뿐이라 다루는 방식이 같습니다. */}
            <p className="mt-4 text-[12px] font-bold text-slate-700">
              구성 품목
              <span className="ml-1.5 font-normal text-slate-400">낱개면 하나, 세트면 줄을 늘립니다</span>
            </p>
            <div className="mt-1.5 space-y-1.5">
              {draftPieces.map((p, n) => (
                <div key={n} className="flex flex-wrap items-center gap-1 rounded-lg border border-slate-200 bg-slate-50/60 p-1.5">
                  <input
                    value={p.name}
                    onChange={(e) => setDraftPieces((d) => d.map((x, i) => (i === n ? { ...x, name: e.target.value } : x)))}
                    placeholder="품목 (상의)"
                    className="w-24 rounded border border-slate-300 px-1.5 py-1 text-[12px]"
                  />
                  <input
                    list="kind-hints"
                    value={p.size_kind}
                    onChange={(e) => setDraftPieces((d) => d.map((x, i) => (i === n ? { ...x, size_kind: e.target.value } : x)))}
                    placeholder="사이즈 칸"
                    title="이 종류로 학생에 저장된 사이즈를 끌어옵니다. 비우면 이번 건에서만 적습니다"
                    className="w-24 rounded border border-slate-300 px-1.5 py-1 text-[12px]"
                  />
                  <input
                    value={p.size_hints}
                    onChange={(e) => setDraftPieces((d) => d.map((x, i) => (i === n ? { ...x, size_hints: e.target.value } : x)))}
                    placeholder="자주 쓰는 사이즈 (보기용)"
                    className="min-w-0 flex-1 rounded border border-slate-300 px-1.5 py-1 text-[12px]"
                  />
                  <input
                    type="number"
                    value={p.unit_price}
                    onChange={(e) => setDraftPieces((d) => d.map((x, i) => (i === n ? { ...x, unit_price: Number(e.target.value) || 0 } : x)))}
                    className="w-20 rounded border border-slate-300 px-1.5 py-1 text-right text-[12px]"
                    title="단가(참고용). 청구는 인보이스에서 합니다"
                  />
                  {draftPieces.length > 1 && (
                    <button
                      onClick={() => setDraftPieces((d) => d.filter((_, i) => i !== n))}
                      className="px-1 text-[12px] font-bold text-slate-400 hover:text-red-600"
                    >
                      ×
                    </button>
                  )}
                </div>
              ))}
            </div>
            <datalist id="kind-hints">
              {allKinds.map((k) => (
                <option key={k} value={k} />
              ))}
            </datalist>
            <button
              onClick={() => setDraftPieces((d) => [...d, { name: "", size_kind: "", size_hints: "", unit_price: 0 }])}
              className="mt-1.5 rounded-lg border border-slate-300 px-2 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-50"
            >
              + 품목 추가 (세트)
            </button>
            <p className="mt-2 text-[11px] leading-relaxed text-slate-400">
              <b>사이즈 칸</b>을 적으면 그 종류로 학생에 저장된 사이즈를 끌어오고, 여기서 적은 값도 그리로 남습니다. 비우면 이번 건에서만
              쓰고 남기지 않습니다(넥타이처럼 사이즈가 없거나, 이번만 쓰는 체계일 때).
              <br />
              <b>자주 쓰는 사이즈</b>는 거들어주는 보기일 뿐입니다 — 여기 없는 값도 그대로 적을 수 있습니다.
            </p>

            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setNewOpen(false)} className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-semibold text-slate-600">
                그만두기
              </button>
              <button
                onClick={() => void createOrder()}
                disabled={busy || !form.name.trim() || draftPieces.every((p) => !p.name.trim())}
                className="rounded-lg bg-teal-600 px-4 py-1.5 text-sm font-semibold text-white disabled:opacity-40"
              >
                만들기
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
