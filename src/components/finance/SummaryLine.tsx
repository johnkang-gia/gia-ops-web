/**
 * **표 맨 위의 숫자 한 줄** — 지금 보이는 학생들의 대상·청구·수납·남음.
 *
 * 합계는 표 맨 아래 줄에 있었는데, 학생이 많으면 굴려 내려가야 보였습니다. 「이 반은 얼마 남았지」는
 * 표를 열자마자 묻는 질문이라 위에 둡니다. 숫자는 표와 같은 계산에서 나옵니다(화면이 따로 세지 않음).
 */
const won = (n: number) => `${Math.round(n).toLocaleString("ko-KR")}원`;

export default function SummaryLine({
  people,
  items,
}: {
  people: number;
  items: { label: string; value: number; tone?: "slate" | "sky" | "emerald" | "rose" | "amber" }[];
}) {
  const tone = {
    slate: "text-slate-800",
    sky: "text-sky-700",
    emerald: "text-emerald-700",
    rose: "text-rose-700",
    amber: "text-amber-700",
  } as const;
  return (
    <div className="mb-2 flex flex-wrap items-baseline gap-x-4 gap-y-1 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-[12px]">
      <span className="text-slate-500">
        대상 <b className="tabular-nums text-slate-800">{people}명</b>
      </span>
      {items.map((it) => (
        <span key={it.label} className="text-slate-500">
          {it.label} <b className={"tabular-nums " + tone[it.tone ?? "slate"]}>{won(it.value)}</b>
        </span>
      ))}
    </div>
  );
}
