import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import { isDeveloperEmail } from "@/lib/roles";
import { SCHEMA_CHECKS } from "@/lib/schemaChecks";
import { kstParts } from "@/lib/shuttleTracking";
import RunCronButtons from "@/components/dev/RunCronButtons";
import { runIntegrityChecks } from "@/lib/integrityChecks";
import fs from "node:fs";
import path from "node:path";

// 진단 화면 - 개발자 전용.
//
// 담당자: "매번 SQL 내가 붙여넣는 게 싫어서 (...) 진단 화면 만들어줘. 섭베이스 쪽도 제대로
//          되어 있는지 점검할 수 있게끔."
//
// 지금까지는 뭔가 이상할 때마다 제가 SQL을 써 드리고, 담당자님이 Supabase에서 돌리고, 결과
// 표를 복사해 주셔야 했습니다. 네 단계입니다. 그중 세 단계가 사람 손입니다.
//
// 이 화면은 그걸 한 단계로 줄입니다. **자주 보는 것들을 미리 짜 넣고, 열면 바로 답이 나옵니다.**
// 새로 봐야 할 것이 생기면 여기에 한 덩이 더 붙이면 됩니다 - 다음부터는 그것도 그냥 보입니다.
//
// 화면에 원본 줄을 그대로 쏟지 않습니다. **판정(정상/문제)과 그 이유만** 적습니다.
// 표를 다시 읽고 해석하는 일이 남으면 줄인 게 아무것도 없습니다.

export const dynamic = "force-dynamic";
export const revalidate = 0;

type Verdict = "ok" | "warn" | "bad" | "info";

function Row({ label, verdict, detail }: { label: string; verdict: Verdict; detail: string }) {
  const mark = verdict === "ok" ? "✅" : verdict === "warn" ? "⚠️" : verdict === "bad" ? "❌" : "·";
  const tone =
    verdict === "ok"
      ? "text-emerald-700"
      : verdict === "warn"
        ? "text-amber-700"
        : verdict === "bad"
          ? "text-red-600"
          : "text-slate-500";
  return (
    <div className="flex items-start gap-2 border-b border-slate-100 py-1.5 last:border-0">
      <span className="w-5 shrink-0 text-center text-sm">{mark}</span>
      <span className="w-44 shrink-0 text-xs font-semibold text-slate-700">{label}</span>
      <span className={"min-w-0 flex-1 text-xs " + tone}>{detail}</span>
    </div>
  );
}

function Card({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-3">
      <h2 className="text-sm font-bold text-slate-800">{title}</h2>
      {note && <p className="mt-0.5 text-[11px] text-slate-400">{note}</p>}
      <div className="mt-2">{children}</div>
    </section>
  );
}

function minsAgo(iso: string | null | undefined): number | null {
  if (!iso) return null;
  return Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
}

export default async function DevDiagnosticsPage() {
  const me = await getCurrentAppUser();
  if (!isDeveloperEmail(me?.email)) redirect("/home");

  const supabase = await createClient();
  const { iso: today, hour, minute } = kstParts(new Date());
  const nowLabel = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;

  // ── ① Supabase 연결 ───────────────────────────────────────────────────────
  //
  // 화면이 안 뜰 때 제일 먼저 갈리는 것은 "DB에 못 붙는 건가, 붙었는데 없는 건가"입니다.
  // 그래서 가장 단순한 조회 하나를 먼저 던져봅니다.
  const t0 = Date.now();
  const { error: pingError, count: studentCount } = await supabase
    .from("wr_students")
    .select("id", { count: "exact", head: true })
    .eq("status", "active")
    .eq("is_demo", false);
  const pingMs = Date.now() - t0;

  // ── ② 스키마 ─────────────────────────────────────────────────────────────
  //
  // information_schema를 뒤지지 않고 **앱과 똑같이 그 칸을 읽어봅니다.** 칸이 있어도
  // 권한(RLS)이 막으면 기능은 똑같이 안 되기 때문입니다.
  const schemaResults: { feature: string; ok: boolean; migration: string; impact: string; note: string | null }[] = [];
  for (const check of SCHEMA_CHECKS) {
    let note: string | null = null;
    let ok = true;
    for (const col of check.columns) {
      const { error } = await supabase.from(check.table).select(col).limit(1);
      if (error) {
        ok = false;
        note = error.message;
        break;
      }
    }
    schemaResults.push({ feature: check.feature, ok, migration: check.migration, impact: check.impact, note });
  }
  const schemaBad = schemaResults.filter((r) => !r.ok);

  // 이번 주에 새로 만든 칸들은 SCHEMA_CHECKS에 아직 없을 수 있어 따로 확인합니다.
  const extraCols: { label: string; table: string; column: string; migration: string }[] = [
    { label: "행선지 선택 묶음", table: "shuttle_assignments", column: "choice_group", migration: "20260828120000" },
    { label: "행선지 버튼 이름", table: "shuttle_assignments", column: "choice_label", migration: "20260828140000" },
  ];
  const extraResults: { label: string; ok: boolean; migration: string }[] = [];
  for (const e of extraCols) {
    const { error } = await supabase.from(e.table).select(e.column).limit(1);
    extraResults.push({ label: e.label, ok: !error, migration: e.migration });
  }

  // ── ③ 셔틀 오늘 ──────────────────────────────────────────────────────────
  const { data: routes } = await supabase
    .from("shuttle_routes")
    .select("id, route_no, vehicle_no, driver_name, term")
    .eq("active", true)
    .eq("direction", "하원");
  const routeById = new Map((routes ?? []).map((r) => [r.id as string, r]));

  const { data: events } = await supabase
    .from("shuttle_run_events")
    .select("route_id, event, created_by, created_at")
    .eq("service_date", today);

  const { data: devices } = await supabase
    .from("shuttle_tracker_devices")
    .select("route_id, last_seen_at, enabled");

  // GPS가 켜진 노선별 상태. 27호만 보지 않고 켜진 것 전부 봅니다 - 앞으로 늘어날 것이고,
  // "27호만 되고 나머지는?"을 다시 묻게 되기 때문입니다.
  const gpsRows = (devices ?? [])
    .filter((d) => d.enabled !== false)
    .map((d) => {
      const r = routeById.get(d.route_id as string);
      const ago = minsAgo(d.last_seen_at as string | null);
      const ev = (events ?? []).filter((e) => e.route_id === d.route_id);
      const arrived = ev.find((e) => e.event === "현장도착");
      const departed = ev.find((e) => e.event === "출발");
      return {
        routeNo: r?.route_no ?? "(노선 없음)",
        ago,
        arrived: arrived ? `${arrived.created_by ?? "?"}` : null,
        departed: departed ? `${departed.created_by ?? "?"}` : null,
      };
    })
    .sort((a, b) => a.routeNo.localeCompare(b.routeNo, "ko", { numeric: true }));

  // 정류장 좌표. 좌표가 없으면 아무리 가까이 가도 도착이 안 잡힙니다.
  const routeIds = (routes ?? []).map((r) => r.id as string);
  const { data: stops } = routeIds.length
    ? await supabase.from("shuttle_stops").select("id, route_id, address, lat, lng, seq").in("route_id", routeIds)
    : { data: [] as { id: string; route_id: string; address: string | null; lat: number | null; lng: number | null; seq: number }[] };
  const noCoord = (stops ?? []).filter((s) => s.lat == null || s.lng == null);
  const noAddress = (stops ?? []).filter((s) => !s.address || !s.address.trim());

  // ── ④ 행선지 선택 학생 ───────────────────────────────────────────────────
  const { data: choiceRows } = await supabase
    .from("shuttle_assignments")
    .select("id, student_name_raw, choice_group, choice_label, stop_id")
    .not("choice_group", "is", null);
  const stopById = new Map((stops ?? []).map((s) => [s.id as string, s]));
  const choiceByName = new Map<string, { label: string | null; hasAddress: boolean }[]>();
  for (const a of choiceRows ?? []) {
    const list = choiceByName.get(a.student_name_raw as string) ?? [];
    const stop = stopById.get(a.stop_id as string);
    list.push({ label: (a.choice_label as string | null) ?? null, hasAddress: !!stop?.address });
    choiceByName.set(a.student_name_raw as string, list);
  }

  // ── ⑧ 마이그레이션 실행 이력 ─────────────────────────────────────────────
  //
  // 담당자: "마이그레이션 실행 이력."
  //
  // `column ... does not exist` 오류의 원인은 늘 같습니다 - **무엇이 돌았고 무엇이 안
  // 돌았는지 아무도 모른다.** 파일은 폴더에 있고 실행 기록은 DB 안쪽에 있어서, 맞춰보려면
  // 매번 사람이 SQL을 쳐야 했습니다. 여기서 대조합니다.
  let migFiles: string[] = [];
  try {
    migFiles = fs
      .readdirSync(path.join(process.cwd(), "supabase", "migrations"))
      .filter((f) => f.endsWith(".sql"))
      .map((f) => f.replace(/\.sql$/, ""))
      .sort();
  } catch {
    // 배포본에 파일이 안 실려 있으면 이 칸만 비워둡니다. 다른 점검은 그대로 돌아갑니다.
  }
  const { data: appliedRows, error: appliedError } = await supabase
    .from("applied_migrations")
    .select("version, name");
  const applied = new Set(((appliedRows ?? []) as { version: string }[]).map((r) => r.version));
  // 파일 이름은 `20260828120000_설명`, DB에는 앞의 숫자(version)만 들어갑니다.
  const notApplied = migFiles.filter((f) => !applied.has(f.split("_")[0]));

  // ── ⑦ 데이터 무결성 ──────────────────────────────────────────────────────
  //
  // 화면에서는 멀쩡해 보이는데 실제로는 틀린 것들을 미리 셉니다. 이번 주에 겪은 문제가
  // 전부 이 종류였습니다 - 사고가 나거나 누가 이상하다고 말하기 전까지 아무도 몰랐습니다.
  const integrity = await runIntegrityChecks(supabase);
  const integrityBad = integrity.filter((i) => i.count > 0);

  // ── ⑤ 크론 심박 ──────────────────────────────────────────────────────────
  const { data: beats } = await supabase
    .from("integration_heartbeats")
    .select("key, last_seen_at, status, detail")
    .order("key");

  // ── ⑥ 오늘 인박스 ────────────────────────────────────────────────────────
  const dayStart = new Date(`${today}T00:00:00+09:00`).toISOString();
  const { count: todayReq } = await supabase
    .from("pickup_requests")
    .select("id", { count: "exact", head: true })
    .gte("received_at", dayStart);
  const { count: todayPickup } = await supabase
    .from("pickup_requests")
    .select("id", { count: "exact", head: true })
    .eq("kind", "픽업")
    .eq("service_date", today);
  const { count: openInquiry } = await supabase
    .from("pickup_requests")
    .select("id", { count: "exact", head: true })
    .eq("kind", "문의")
    .is("answered_at", null);

  return (
    <div className="mx-auto max-w-4xl space-y-3 p-4">
      <div className="flex items-baseline justify-between">
        <h1 className="text-lg font-black text-slate-800">🔎 진단</h1>
        <span className="text-[11px] text-slate-400">
          {today} {nowLabel} (한국) · <Link href="/dev" className="underline">개발자 대시보드</Link>
        </span>
      </div>

      <Card title="① Supabase 연결" note="붙는지, 얼마나 걸리는지. 여기가 빨간색이면 아래는 볼 것도 없습니다.">
        <Row
          label="연결"
          verdict={pingError ? "bad" : pingMs > 1500 ? "warn" : "ok"}
          detail={pingError ? `조회 실패: ${pingError.message}` : `정상 · 응답 ${pingMs}ms`}
        />
        <Row
          label="재학생 수"
          verdict={studentCount && studentCount > 0 ? "ok" : "bad"}
          detail={studentCount != null ? `${studentCount}명` : "읽지 못했습니다"}
        />
      </Card>

      <Card title="② 스키마" note="마이그레이션이 실제로 걸렸는지. 앱과 똑같은 방식으로 그 칸을 읽어봅니다(권한까지 확인됩니다).">
        <Row
          label="기능별 점검"
          verdict={schemaBad.length === 0 ? "ok" : "bad"}
          detail={
            schemaBad.length === 0
              ? `${schemaResults.length}개 항목 모두 정상`
              : `${schemaBad.length}개 문제 · ${schemaBad.map((b) => b.feature).join(", ")}`
          }
        />
        {schemaBad.map((b) => (
          <Row key={b.feature} label={`└ ${b.feature}`} verdict="bad" detail={`${b.impact} → ${b.migration} 실행 필요${b.note ? ` (${b.note})` : ""}`} />
        ))}
        {extraResults.map((e) => (
          <Row
            key={e.label}
            label={e.label}
            verdict={e.ok ? "ok" : "bad"}
            detail={e.ok ? "칸 있음" : `없음 → ${e.migration} 마이그레이션 실행 필요`}
          />
        ))}
      </Card>

      <Card title="③ GPS 차량" note="신호가 들어오는지, 오늘 도착·출발이 찍혔는지. 도착·출발 판정은 오후 4시부터 시작합니다.">
        {gpsRows.length === 0 ? (
          <Row label="기기" verdict="warn" detail="GPS가 켜진 노선이 없습니다." />
        ) : (
          gpsRows.map((g) => (
            <Row
              key={g.routeNo}
              label={`${g.routeNo}호`}
              verdict={g.ago == null ? "bad" : g.ago <= 5 ? "ok" : g.ago <= 60 ? "warn" : "bad"}
              detail={
                (g.ago == null ? "신호 없음" : g.ago <= 0 ? "방금 신호" : `${g.ago}분 전 신호`) +
                ` · 도착 ${g.arrived ? `기록됨(${g.arrived})` : "없음"}` +
                ` · 출발 ${g.departed ? `기록됨(${g.departed})` : "없음"}`
              }
            />
          ))
        )}
        <Row
          label="정류장 좌표"
          verdict={noCoord.length === 0 ? "ok" : "bad"}
          detail={
            noCoord.length === 0
              ? `${(stops ?? []).length}곳 모두 좌표 있음`
              : `${noCoord.length}곳 좌표 없음 — 이 정류장은 아무리 가까이 가도 도착이 안 잡힙니다`
          }
        />
        <Row
          label="정류장 주소"
          verdict={noAddress.length === 0 ? "ok" : "warn"}
          detail={noAddress.length === 0 ? "모두 있음" : `${noAddress.length}곳 주소 비어 있음 — 기사님이 어디서 내릴지 알 수 없습니다`}
        />
      </Card>

      <Card title="④ 행선지 선택 학생" note="정하기 전에는 어느 명단에도 안 나오는 학생들. 버튼에 적힐 말이 없으면 회색 '?'로 뜹니다.">
        {choiceByName.size === 0 ? (
          <Row label="대상" verdict="info" detail="없습니다." />
        ) : (
          [...choiceByName.entries()].map(([name, opts]) => {
            const noLabel = opts.filter((o) => !o.label).length;
            const noAddr = opts.filter((o) => !o.hasAddress).length;
            return (
              <Row
                key={name}
                label={name}
                verdict={noLabel === 0 && noAddr === 0 ? "ok" : "warn"}
                detail={
                  `선택지 ${opts.length}개 (${opts.map((o) => o.label ?? "이름없음").join(", ")})` +
                  (noLabel > 0 ? ` · 이름 없는 선택지 ${noLabel}개` : "") +
                  (noAddr > 0 ? ` · 주소 없는 정류장 ${noAddr}개` : "")
                }
              />
            );
          })
        )}
      </Card>

      <Card
        title="⑦ 데이터 무결성"
        note="화면에서는 멀쩡해 보이는데 실제로는 틀린 것들. 여기서 고치지 않고, 무엇이 문제이고 어디서 고치는지만 알려줍니다."
      >
        {integrityBad.length === 0 ? (
          <Row label="전체" verdict="ok" detail={`${integrity.length}가지 항목 모두 정상`} />
        ) : (
          integrity
            .filter((i) => i.count > 0)
            .sort((a, b) => (a.severity === b.severity ? b.count - a.count : a.severity === "high" ? -1 : 1))
            .map((i) => (
              <div key={i.label} className="border-b border-slate-100 py-1.5 last:border-0">
                <div className="flex items-start gap-2">
                  <span className="w-5 shrink-0 text-center text-sm">{i.severity === "high" ? "❌" : "⚠️"}</span>
                  <span className="w-44 shrink-0 text-xs font-semibold text-slate-700">
                    {i.label} <b className={i.severity === "high" ? "text-red-600" : "text-amber-700"}>{i.count}건</b>
                  </span>
                  <span className="min-w-0 flex-1 text-xs text-slate-500">
                    {i.why}
                    {i.href && (
                      <>
                        {" "}
                        <Link href={i.href} className="underline">
                          고치러 가기 →
                        </Link>
                      </>
                    )}
                  </span>
                </div>
                {i.samples.length > 0 && (
                  <p className="ml-7 mt-0.5 truncate text-[11px] text-slate-400">
                    {i.samples.join(" · ")}
                    {i.count > i.samples.length && ` 외 ${i.count - i.samples.length}건`}
                  </p>
                )}
              </div>
            ))
        )}
      </Card>

      <Card title="⑧ 마이그레이션" note="폴더의 파일과 DB에 실제로 실행된 기록을 대조합니다.">
        {appliedError ? (
          <Row
            label="실행 기록"
            verdict="warn"
            detail={`아직 볼 수 없습니다 → 20260830120000_applied_migrations_view.sql 실행 필요 (${appliedError.message})`}
          />
        ) : migFiles.length === 0 ? (
          <Row label="파일 목록" verdict="warn" detail="배포본에 마이그레이션 파일이 실려 있지 않습니다." />
        ) : (
          <>
            <Row
              label="대조"
              verdict={notApplied.length === 0 ? "ok" : "bad"}
              detail={
                notApplied.length === 0
                  ? `파일 ${migFiles.length}개 · DB ${applied.size}개 — 모두 반영됨`
                  : `파일 ${migFiles.length}개 중 ${notApplied.length}개가 DB에 안 들어갔습니다`
              }
            />
            {notApplied.slice(0, 10).map((f) => (
              <Row key={f} label={`└ 안 걸림`} verdict="bad" detail={`${f}.sql`} />
            ))}
            {notApplied.length > 10 && (
              <Row label="" verdict="info" detail={`외 ${notApplied.length - 10}개`} />
            )}
          </>
        )}
      </Card>

      <Card
        title="⑤ 자동 작업(크론)"
        note="마지막으로 돈 시각. 오래됐으면 그 기능은 지금 멈춰 있는 것입니다. 아래 버튼으로 지금 바로 돌려볼 수 있습니다."
      >
        {/* 설정을 바꾸고 그게 먹었는지 다음 예약 시각까지 기다리면, 그 사이 다른 것을
            건드리게 되고 무엇 때문에 됐는지도 흐려집니다. 바꾸고 → 눌러보고 → 결과를 본다. */}
        <div className="mb-2 border-b border-slate-100 pb-2">
          <RunCronButtons />
        </div>
        {(beats ?? []).length === 0 ? (
          <Row label="기록" verdict="warn" detail="아직 기록이 없습니다." />
        ) : (
          (beats ?? []).map((b) => {
            const ago = minsAgo(b.last_seen_at as string | null);
            return (
              <Row
                key={b.key as string}
                label={b.key as string}
                verdict={
                  b.status === "error"
                    ? "bad"
                    : b.status === "skipped"
                      ? "warn" // 고장이 아니라 "아직 설정 안 됨". 빨강으로 두면 진짜 고장과 안 갈립니다.
                      : ago == null
                        ? "bad"
                        : ago <= 60 * 26
                          ? "ok"
                          : "warn"
                }
                detail={
                  (ago == null
                    ? "한 번도 돈 적 없음"
                    : ago < 60
                      ? `${ago}분 전`
                      : `${Math.floor(ago / 60)}시간 전`) +
                  (b.status === "skipped" ? " · 설정 안 됨" : b.status && b.status !== "ok" ? ` · ${b.status}` : "") +
                  (b.detail ? ` · ${b.detail}` : "")
                }
              />
            );
          })
        )}
      </Card>

      <Card title="⑥ 오늘 들어온 학부모 연락">
        <Row label="오늘 수집" verdict={(todayReq ?? 0) > 0 ? "ok" : "warn"} detail={`${todayReq ?? 0}건`} />
        <Row label="오늘 픽업" verdict="info" detail={`${todayPickup ?? 0}건`} />
        <Row label="미답변 문의" verdict={(openInquiry ?? 0) > 20 ? "warn" : "info"} detail={`${openInquiry ?? 0}건`} />
      </Card>

      <p className="pb-6 text-[11px] leading-relaxed text-slate-400">
        새로 확인해야 할 것이 생기면 이 화면에 한 덩이 더 붙입니다. 다음부터는 SQL 없이 여기서 바로 보입니다.
      </p>
    </div>
  );
}
