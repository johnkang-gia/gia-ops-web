import { redirect } from "next/navigation";
import { getCurrentAppUser } from "@/lib/currentUser";
import { getChangelogEntries, type ChangelogEntry } from "@/lib/changelog";
import { APP_VERSION } from "@/lib/version";

export const dynamic = "force-dynamic";

// **굵게**만 처리하는 최소한의 인라인 마크다운 - CHANGELOG.md 본문은 이 세션 내내 이 정도
// 서식만 써왔으므로, 범용 마크다운 라이브러리를 새로 들이는 대신 이 파일 전용으로 짧게
// 직접 구현합니다.
function renderInline(text: string, keyPrefix: string) {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith("**") && part.endsWith("**") ? (
      <strong key={`${keyPrefix}-${i}`}>{part.slice(2, -2)}</strong>
    ) : (
      <span key={`${keyPrefix}-${i}`}>{part}</span>
    )
  );
}

// 본문을 문단/글머리표(- )/```sql 코드블록 세 종류로 나눠 그립니다 - CHANGELOG.md에 실제로
// 쓰인 서식이 이 세 가지뿐이라 충분합니다.
function ChangelogBody({ body }: { body: string }) {
  const lines = body.split("\n");
  const blocks: React.ReactNode[] = [];
  let listBuf: string[] = [];
  let paraBuf: string[] = [];
  let i = 0;

  function flushList() {
    if (listBuf.length) {
      blocks.push(
        <ul key={`ul-${blocks.length}`} className="my-1.5 list-disc space-y-1 pl-5 text-[13px] leading-relaxed text-slate-600">
          {listBuf.map((item, idx) => (
            <li key={idx}>{renderInline(item, `li-${blocks.length}-${idx}`)}</li>
          ))}
        </ul>
      );
      listBuf = [];
    }
  }
  function flushPara() {
    if (paraBuf.length) {
      blocks.push(
        <p key={`p-${blocks.length}`} className="my-1.5 text-[13px] leading-relaxed text-slate-600">
          {renderInline(paraBuf.join(" "), `p-${blocks.length}`)}
        </p>
      );
      paraBuf = [];
    }
  }

  while (i < lines.length) {
    const line = lines[i];
    if (line.trim().startsWith("```")) {
      flushList();
      flushPara();
      const fence: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith("```")) {
        fence.push(lines[i]);
        i++;
      }
      i++;
      blocks.push(
        <pre
          key={`code-${blocks.length}`}
          className="my-1.5 overflow-x-auto rounded-lg bg-slate-900 p-3 text-[11px] leading-relaxed text-slate-100"
        >
          <code>{fence.join("\n")}</code>
        </pre>
      );
      continue;
    }
    if (line.trim().startsWith("- ")) {
      flushPara();
      listBuf.push(line.trim().slice(2));
      i++;
      continue;
    }
    if (line.trim() === "") {
      flushList();
      flushPara();
      i++;
      continue;
    }
    paraBuf.push(line.trim());
    i++;
  }
  flushList();
  flushPara();

  return <div>{blocks}</div>;
}

function EntryCard({ entry, index }: { entry: ChangelogEntry; index: number }) {
  return (
    <div
      className="shell-entry-fade g-panel-solid p-4 shadow-sm"
      style={{ animationDelay: `${Math.min(index, 10) * 35}ms` }}
    >
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <span className="text-sm font-bold text-gia-navy">{entry.version}</span>
        <span className="text-[11px] text-slate-400">{entry.date}</span>
        {entry.status && (
          <span className="rounded-full bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-600">
            {entry.status}
          </span>
        )}
      </div>
      <ChangelogBody body={entry.body} />
    </div>
  );
}

/**
 * 한 번에 그리는 판 수.
 *
 * **버전 기록은 매 배포마다 늘기만 합니다.** 지금 590판인데 전부 그리면 내려받는 화면이
 * 3MB 를 넘고, 그 대부분은 아무도 읽지 않는 옛 기록입니다. 이 숫자는 앞으로도 계속 늘 테니
 * 「지금은 괜찮다」로 두면 언젠가 이 화면만 유독 느려집니다.
 *
 * 사람이 버전 기록을 여는 이유는 대개 **「방금 뭐가 바뀌었지」**입니다. 최근 것을 먼저 주고,
 * 옛 기록은 눌러서 봅니다.
 */
const RECENT = 40;

export default async function ChangelogPage({
  searchParams,
}: {
  searchParams: Promise<{ all?: string }>;
}) {
  const me = await getCurrentAppUser();
  if (!me) redirect("/login");

  const showAll = (await searchParams).all === "1";
  const all = getChangelogEntries();
  const entries = showAll ? all : all.slice(0, RECENT);
  const hidden = all.length - entries.length;

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-1 flex items-center justify-between gap-2">
        <h1 className="text-lg font-bold">버전 기록</h1>
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-500">
          현재 v{APP_VERSION}
        </span>
      </div>
      <p className="mb-6 text-xs text-slate-500">
        이 시스템이 그동안 어떻게 업데이트되어 왔는지 최신 순으로 보여줍니다.
      </p>
      <div className="flex flex-col gap-3 pb-8">
        {entries.map((entry, idx) => (
          <EntryCard key={`${entry.version}-${entry.date}-${idx}`} entry={entry} index={idx} />
        ))}
        {entries.length === 0 && <p className="text-sm text-slate-400">버전 기록을 불러올 수 없습니다.</p>}
        {/* 감춘 것이 있으면 **몇 개인지 적습니다.** 그냥 끊으면 「여기까지가 전부」로 보이고,
            v0.491 에서 84개가 조용히 빠져 있던 일이 이 화면에서 실제로 있었습니다. */}
        {hidden > 0 && (
          <a
            href="/changelog?all=1"
            className="mx-auto rounded-lg border border-slate-300 bg-white px-4 py-2 text-[13px] font-bold text-slate-600 hover:bg-slate-50"
          >
            지난 기록 {hidden}개 더 보기
          </a>
        )}
      </div>
    </div>
  );
}
