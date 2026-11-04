import Link from "@/components/common/AppLink";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import { kstDateOffset } from "@/lib/kst";
import { Who } from "@/components/common/HomonymProvider";
import { loadStudents } from "@/lib/students";

export const dynamic = "force-dynamic";

/**
 * **원문함 — 들어온 연락의 원문이 날짜별로 한 곳에.**
 *
 * 토들·전화·메모로 들어온 연락은 `pickup_requests` 한 표에만 저장됩니다(토들 글은 글 번호 source_ref 로 한 줄).
 * 오늘의 문의사항·픽업 인박스·하원수단·학생 창의 문의 탭은 전부 이 표를 **읽어서 보여주는 창**이고, 같은 글을
 * 다른 표에 옮겨 적지 않습니다. 이 화면은 그 원본을 가공 없이, 날짜별·방별로 그대로 보여줍니다 - 「그날 학부모가
 * 실제로 뭐라고 썼나」를 확인하는 자리입니다.
 *
 * 무엇으로 처리됐는지(픽업 등록·답함·처리 완료·넘김)는 같은 줄의 칸에서 읽어 옆에 붙입니다. 따로 적어 두면
 * 두 곳이 다른 말을 합니다.
 */
type RawRow = {
  id: string;
  received_at: string;
  source: string | null;
  channel_label: string | null;
  sender_name: string | null;
  raw_text: string | null;
  summary: string | null;
  student_id: string | null;
  kind: string | null;
  status: string | null;
  replied_at: string | null;
  answered_at: string | null;
  skipped_at: string | null;
  source_url: string | null;
  badges: string[] | null;
};

const timeKst = (iso: string) =>
  new Date(iso).toLocaleTimeString("ko-KR", { timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit", hour12: false });

function shiftDay(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00+09:00`);
  d.setUTCDate(d.getUTCDate() + n);
  // kst-ok: 한국 자정에서 하루씩 옮긴 시각을 다시 한국 날짜로 적습니다.
  return new Date(d.getTime() + 9 * 3600_000).toISOString().slice(0, 10);
}

export default async function RawLogPage({ searchParams }: { searchParams: Promise<{ d?: string; src?: string }> }) {
  const me = await getCurrentAppUser();
  if (!me) redirect("/login");
  const sp = await searchParams;
  const today = kstDateOffset(0);
  const day = sp.d && /^\d{4}-\d{2}-\d{2}$/.test(sp.d) ? sp.d : today;
  const src = sp.src === "토들" || sp.src === "직원" ? sp.src : "전체";

  const supabase = await createClient();
  let q = supabase
    .from("pickup_requests")
    .select("id, received_at, source, channel_label, sender_name, raw_text, summary, student_id, kind, status, replied_at, answered_at, skipped_at, source_url, badges")
    .eq("is_demo", false)
    .gte("received_at", `${day}T00:00:00+09:00`)
    .lt("received_at", `${shiftDay(day, 1)}T00:00:00+09:00`)
    .order("received_at", { ascending: true })
    .limit(1000);
  if (src === "토들") q = q.eq("source", "토들");
  if (src === "직원") q = q.neq("source", "토들");
  const { data, error } = await q;
  const rows = (data ?? []) as RawRow[];
  const ids = [...new Set(rows.map((r) => r.student_id).filter((v): v is string => !!v))];
  const { rows: studs } = ids.length ? await loadStudents(supabase, { ids, status: "all" }) : { rows: [] as { id: string; name: string }[] };
  const nameOf = new Map(studs.map((s) => [s.id, s.name]));

  // 방(토들 채널)별로 묶습니다. 같은 집이 하루에 여러 번 쓰면 이어서 읽혀야 앞뒤가 보입니다.
  const groups = new Map<string, RawRow[]>();
  for (const r of rows) {
    const k = r.source === "토들" ? r.channel_label || "(방 이름 없음)" : `${r.source ?? "직접"} · ${r.sender_name ?? ""}`;
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  const ordered = [...groups.entries()].sort((a, b) => a[1][0].received_at.localeCompare(b[1][0].received_at));

  const href = (d: string, s = src) => `/work/raw-log?d=${d}${s !== "전체" ? `&src=${encodeURIComponent(s)}` : ""}`;

  return (
    <div className="space-y-3 p-3 text-[13px]">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-[16px] font-extrabold text-slate-800">📚 원문함</h1>
        <Link href={href(shiftDay(day, -1))} className="rounded border border-slate-300 px-2 py-0.5 text-[12px]">
          ◀ 전날
        </Link>
        <form action="/work/raw-log" className="flex items-center gap-1">
          <input type="date" name="d" defaultValue={day} className="rounded border border-slate-300 px-1.5 py-0.5 text-[12px]" />
          {src !== "전체" && <input type="hidden" name="src" value={src} />}
          <button className="rounded bg-slate-700 px-2 py-0.5 text-[12px] font-bold text-white">보기</button>
        </form>
        <Link href={href(shiftDay(day, 1))} className="rounded border border-slate-300 px-2 py-0.5 text-[12px]">
          다음날 ▶
        </Link>
        {day !== today && (
          <Link href={href(today)} className="text-[12px] text-indigo-700 underline">
            오늘로
          </Link>
        )}
        <span className="ml-2 flex gap-1">
          {(["전체", "토들", "직원"] as const).map((s) => (
            <Link
              key={s}
              href={href(day, s)}
              className={`rounded-full px-2.5 py-0.5 text-[12px] font-bold ${src === s ? "bg-slate-800 text-white" : "bg-slate-100 text-slate-600"}`}
            >
              {s === "직원" ? "전화·메모" : s}
            </Link>
          ))}
        </span>
        <span className="ml-auto text-[11px] text-slate-500">
          {day} · {rows.length}건 · 방 {groups.size}개 — 고치지 않은 원문 그대로입니다
        </span>
      </div>

      {error && <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-red-700">읽지 못했습니다: {error.message}</div>}
      {!error && rows.length === 0 && <div className="rounded border border-slate-200 bg-white p-6 text-center text-slate-400">이날 들어온 연락이 없습니다.</div>}

      <div className="grid gap-2 lg:grid-cols-2">
        {ordered.map(([room, list]) => (
          <section key={room} className="rounded-lg border border-slate-200 bg-white">
            <header className="flex items-center gap-2 border-b border-slate-100 px-3 py-1.5">
              <span className="truncate font-bold text-slate-700">{room}</span>
              <span className="text-[11px] text-slate-400">{list.length}건</span>
              {list[0].source_url && (
                <a href={list[0].source_url} target="_blank" rel="noreferrer" className="ml-auto text-[11px] font-bold text-blue-600 hover:underline">
                  토들 방 ↗
                </a>
              )}
            </header>
            <ul className="divide-y divide-slate-50">
              {list.map((r) => (
                <li key={r.id} className="px-3 py-1.5">
                  <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500">
                    <span className="tabular-nums">{timeKst(r.received_at)}</span>
                    {r.sender_name && <span>{r.sender_name}</span>}
                    {r.student_id && <Who id={r.student_id} name={nameOf.get(r.student_id) ?? "?"} />}
                    {r.kind === "픽업" && r.status === "확정" && <span className="rounded bg-amber-100 px-1 font-bold text-amber-800">🚗 픽업 등록</span>}
                    {r.replied_at && <span className="rounded bg-emerald-50 px-1 font-bold text-emerald-700">답함</span>}
                    {r.answered_at && <span className="rounded bg-slate-100 px-1 font-bold text-slate-600">처리 완료</span>}
                    {r.skipped_at && <span className="rounded bg-slate-100 px-1 text-slate-400">넘김</span>}
                    {(r.badges ?? []).slice(0, 2).map((b) => (
                      <span key={b} className="rounded-full border border-slate-200 px-1 text-[10px]">
                        {b}
                      </span>
                    ))}
                  </div>
                  <p className="mt-0.5 whitespace-pre-wrap text-slate-800">{r.raw_text || r.summary || "(내용 없음)"}</p>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
