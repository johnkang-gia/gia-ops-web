"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/common/ToastProvider";
import { todayKst } from "@/lib/kst";

/**
 * 공용 쪽지판 — 업무보드 아래에 다 같이 보는 메모.
 *
 * 채팅창이 있던 자리입니다. 사무실에 다 같이 앉아 있으니 채팅은 거의 안 쓰였습니다 -
 * 말로 해버리니까요. 그런데 **말로 한 것은 남지 않습니다.** 「3시에 소방점검 옵니다」를
 * 자리를 비운 사람은 못 듣고, 들은 사람도 두 시간 뒤엔 잊습니다.
 *
 * 그래서 대화가 아니라 **붙여두는 쪽지**입니다. 한 장씩 따로 붙고 따로 뗍니다 - 한 덩어리
 * 글(부서메모)은 두 사람이 동시에 쓰면 서로 지웁니다.
 *
 * **지우는 일을 사람에게 맡기지 않습니다.** 기본은 오늘까지고, 지나면 화면에서 빠집니다.
 * 안 그러면 판이 지난 쪽지로 덮이고, 덮인 판은 아무도 안 봅니다 - 채팅이 죽은 그 길입니다.
 */

type Note = {
  id: string;
  department: string;
  content: string;
  color: string;
  pinned: boolean;
  expires_on: string | null;
  author_email: string;
  author_name: string | null;
  created_at: string;
};

/** 색은 뜻을 코드에 박지 않습니다. 「노랑은 급한 것」 같은 약속은 쓰면서 정해집니다. */
const COLORS: { key: string; label: string; cls: string }[] = [
  { key: "yellow", label: "노랑", cls: "bg-amber-100 border-amber-300" },
  { key: "pink", label: "분홍", cls: "bg-rose-100 border-rose-300" },
  { key: "blue", label: "파랑", cls: "bg-sky-100 border-sky-300" },
  { key: "green", label: "초록", cls: "bg-emerald-100 border-emerald-300" },
];
const colorOf = (k: string) => COLORS.find((c) => c.key === k)?.cls ?? COLORS[0].cls;

/** 얼마나 오래 붙여둘 것인가. 「계속」은 만료 없음입니다. */
const KEEPS: { label: string; days: number | null }[] = [
  { label: "오늘", days: 0 },
  { label: "이번 주", days: 6 },
  { label: "계속", days: null },
];

function plusDays(base: string, n: number): string {
  const d = new Date(`${base}T12:00:00+09:00`);
  d.setDate(d.getDate() + n);
  return d.toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });
}

export default function NoteBoard({
  department,
  currentUserEmail,
  currentUserName,
}: {
  department: string;
  currentUserEmail: string;
  currentUserName?: string | null;
}) {
  const notify = useToast();
  const [notes, setNotes] = useState<Note[]>([]);
  const [text, setText] = useState("");
  const [color, setColor] = useState("yellow");
  const [keep, setKeep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!department || department === "전체") return;
    const today = todayKst();
    const { data, error } = await createClient()
      .from("board_notes")
      .select("*")
      .eq("department", department)
      // 지난 쪽지는 안 보여줍니다. 남아 있어도 화면을 덮지 않습니다.
      .or(`expires_on.is.null,expires_on.gte.${today}`)
      .order("pinned", { ascending: false })
      .order("created_at", { ascending: false });
    // 못 읽었으면 빈 판이 아니라 이유를 띄웁니다. 빈 판은 「쪽지가 없다」로 읽힙니다.
    if (error) return setLoadError(error.message);
    setLoadError(null);
    setNotes((data as Note[] | null) ?? []);
  }, [department]);

  useEffect(() => {
    void load();
    if (!department || department === "전체") return;
    // 옆자리에서 붙인 쪽지가 내 화면에 안 뜨면, 결국 다시 말로 하게 됩니다.
    const ch = createClient()
      .channel(`board-notes-${department}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "board_notes" }, () => void load())
      .subscribe();
    return () => {
      void createClient().removeChannel(ch);
    };
  }, [department, load]);

  async function add() {
    const body = text.trim();
    if (!body) return;
    setBusy(true);
    const days = KEEPS[keep].days;
    const { error } = await createClient().from("board_notes").insert({
      department,
      content: body,
      color,
      expires_on: days === null ? null : plusDays(todayKst(), days),
      author_email: currentUserEmail,
      author_name: currentUserName ?? null,
    });
    setBusy(false);
    if (error) return notify(`쪽지를 붙이지 못했습니다: ${error.message}`, "error");
    setText("");
    await load();
  }

  async function remove(n: Note) {
    const { error } = await createClient().from("board_notes").delete().eq("id", n.id);
    if (error) return notify(`떼지 못했습니다: ${error.message}`, "error");
    await load();
  }

  async function togglePin(n: Note) {
    const { error } = await createClient().from("board_notes").update({ pinned: !n.pinned }).eq("id", n.id);
    if (error) return notify(`고정하지 못했습니다: ${error.message}`, "error");
    await load();
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* 쓰는 자리를 **위**에 둡니다. 아래에 있으면 쪽지가 늘 때마다 입력칸이 밀려 내려가고,
          그러면 붙이려던 사람이 먼저 스크롤을 해야 합니다. */}
      <div className="mb-1.5 flex shrink-0 flex-wrap items-center gap-1.5">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.nativeEvent.isComposing) void add();
          }}
          placeholder="다같이 볼 쪽지 (엔터로 붙이기)"
          className="min-w-0 flex-1 rounded-lg border border-slate-300 px-2 py-1.5 text-[12px]"
        />
        <div className="flex items-center gap-1">
          {COLORS.map((c) => (
            <button
              key={c.key}
              type="button"
              onClick={() => setColor(c.key)}
              title={c.label}
              className={
                "h-5 w-5 rounded border-2 " + c.cls + (color === c.key ? " ring-2 ring-slate-500 ring-offset-1" : "")
              }
            />
          ))}
        </div>
        <select
          value={keep}
          onChange={(e) => setKeep(Number(e.target.value))}
          className="rounded-lg border border-slate-300 px-1.5 py-1.5 text-[11px]"
          title="언제까지 붙여둘까요"
        >
          {KEEPS.map((k, i) => (
            <option key={k.label} value={i}>
              {k.label}
            </option>
          ))}
        </select>
        <button
          onClick={() => void add()}
          disabled={busy || !text.trim()}
          className="rounded-lg bg-slate-800 px-2.5 py-1.5 text-[12px] font-bold text-white disabled:opacity-30"
        >
          붙이기
        </button>
      </div>

      {loadError && (
        <p className="mb-1 rounded bg-rose-50 px-2 py-1 text-[11px] font-bold text-rose-700">
          쪽지를 읽지 못했습니다: {loadError}
        </p>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {notes.length === 0 && !loadError ? (
          <p className="py-3 text-center text-[11px] text-slate-400">
            아직 쪽지가 없습니다. 말로 하고 지나가는 것들을 여기 붙여두면 자리를 비운 사람도 봅니다.
          </p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {notes.map((n) => (
              <div
                key={n.id}
                className={"group relative w-[170px] rounded-lg border p-2 text-[12px] leading-relaxed " + colorOf(n.color)}
              >
                <p className="whitespace-pre-wrap break-words text-slate-800">{n.content}</p>
                <p className="mt-1 flex items-center gap-1 text-[10px] text-slate-500">
                  {n.pinned && <span title="위에 고정">📌</span>}
                  <span className="truncate">{n.author_name || n.author_email.split("@")[0]}</span>
                  {n.expires_on && <span className="ml-auto shrink-0">~{n.expires_on.slice(5)}</span>}
                </p>
                {/* 지우는 것은 **붙인 사람만**입니다. 남의 쪽지가 말없이 사라지면 그 사람은
                    자기가 붙인 것이 왜 없어졌는지 영영 모릅니다. */}
                {n.author_email === currentUserEmail && (
                  <div className="absolute right-1 top-1 hidden gap-0.5 group-hover:flex">
                    <button
                      onClick={() => void togglePin(n)}
                      className="rounded bg-white/80 px-1 text-[10px]"
                      title={n.pinned ? "고정 풀기" : "위에 고정"}
                    >
                      📌
                    </button>
                    <button onClick={() => void remove(n)} className="rounded bg-white/80 px-1 text-[10px]" title="떼기">
                      ✕
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
