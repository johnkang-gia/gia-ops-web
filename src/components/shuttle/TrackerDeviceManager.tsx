"use client";

import { useEffect, useMemo, useState } from "react";
import QRCode from "qrcode";
import { useToast } from "@/components/common/ToastProvider";
import { driverSetupPath, setupMessage, smsHref } from "@/lib/driverSetup";
import { formatTrackWindows } from "@/lib/shuttleTracking";
import type { ShuttleRoute, ShuttleTrackerDevice, ShuttleStop, ShuttleStopObservation } from "@/lib/types";

// 요청: "기사님들은 네비를 핸드폰으로 하시는 경우도 많아서... 백그라운드에서 돌아갈 수 있도록",
// "각 정류장도 우리는 지금 정확한 정보를 가지고 있지 않아서, gps를 통해서... 정확도를 높여서"
//
// 기사님 휴대폰에 무료 앱(Traccar Client)을 깔고 여기서 발급한 기기 ID와 서버 주소만 한 번
// 넣어드리면, 그 뒤로는 조작 없이 백그라운드로 위치가 들어옵니다. 들어온 주행 기록에서 차가
// 실제로 멈춘 자리를 찾아 정류장 좌표를 학습하고, 담당자가 확인 후 반영할 수 있습니다.
export default function TrackerDeviceManager({
  routes,
  initialDevices,
  stops,
  observations,
}: {
  routes: ShuttleRoute[];
  initialDevices: ShuttleTrackerDevice[];
  stops: ShuttleStop[];
  observations: ShuttleStopObservation[];
}) {
  const notify = useToast();
  const [devices, setDevices] = useState(initialDevices);
  const [stopList, setStopList] = useState(stops);
  const [obs, setObs] = useState(observations);
  const [busy, setBusy] = useState(false);
  const [showGuide, setShowGuide] = useState(false);
  // 설정 링크 QR을 크게 띄우는 창. 기사님이 오셨을 때 이 화면을 모니터에 띄워두고 기사님
  // 휴대폰 카메라로 찍으시면, 주소를 한 글자도 치지 않고 설정 안내로 넘어갑니다.
  const [qrFor, setQrFor] = useState<ShuttleTrackerDevice | null>(null);

  const routeById = useMemo(() => new Map(routes.map((r) => [r.id, r])), [routes]);
  const stopsByRoute = useMemo(() => {
    const map = new Map<string, ShuttleStop[]>();
    for (const s of stopList) {
      const list = map.get(s.route_id) ?? [];
      list.push(s);
      map.set(s.route_id, list);
    }
    for (const list of map.values()) list.sort((a, b) => a.seq - b.seq);
    return map;
  }, [stopList]);

  const trackedRouteIds = useMemo(() => new Set(devices.map((d) => d.route_id)), [devices]);
  const unmatched = useMemo(() => obs.filter((o) => !o.matched_stop_id), [obs]);

  // 노선을 기준으로 목록을 만듭니다(기기 기준이 아니라). 기기가 아직 없는 노선도 줄이 생겨야
  // "무엇이 남았는지"가 눈에 보입니다.
  const rows = useMemo(() => {
    const deviceByRoute = new Map(devices.map((d) => [d.route_id, d]));
    return routes.map((route) => ({ route, device: deviceByRoute.get(route.id) ?? null }));
  }, [routes, devices]);

  const summary = useMemo(() => {
    let connected = 0;
    let pending = 0;
    let missing = 0;
    for (const { device } of rows) {
      if (!device) missing += 1;
      else if (isFresh(device.last_seen_at)) connected += 1;
      else pending += 1;
    }
    return { connected, pending, missing };
  }, [rows]);

  function serverUrl() {
    return typeof window === "undefined" ? "" : `${window.location.origin}/api/shuttle/track`;
  }

  function setupUrl(device: ShuttleTrackerDevice) {
    if (typeof window === "undefined" || !device.setup_code) return "";
    return `${window.location.origin}${driverSetupPath(device.setup_code)}`;
  }

  function routeLabelOf(device: ShuttleTrackerDevice) {
    const route = routeById.get(device.route_id);
    return route ? `${route.route_no}호차${route.name ? ` (${route.name})` : ""}` : "하원 차량";
  }

  async function reissue(device: ShuttleTrackerDevice) {
    if (!window.confirm(`${routeLabelOf(device)}의 설정 링크를 새로 발급할까요?\n\n예전 링크는 더 이상 열리지 않습니다. 이미 설정을 마친 휴대폰은 영향을 받지 않습니다.`)) return;
    const json = await call({ action: "reissue_setup_code", id: device.id });
    if (!json?.setupCode) return;
    setDevices((prev) =>
      prev.map((d) => (d.id === device.id ? { ...d, setup_code: json.setupCode as string, setup_opened_at: null } : d))
    );
    setQrFor(null);
    notify("설정 링크를 새로 발급했습니다.", "success");
  }

  async function call(body: Record<string, unknown>) {
    setBusy(true);
    try {
      const res = await fetch("/api/shuttle/tracker", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) {
        notify(json.error ?? "처리하지 못했습니다.", "error");
        return null;
      }
      return json;
    } finally {
      setBusy(false);
    }
  }

  async function addDevice(routeId: string) {
    const json = await call({ action: "create", routeId });
    if (!json?.device) return;
    setDevices((prev) => [json.device as ShuttleTrackerDevice, ...prev]);
    notify("기기를 발급했습니다. [설정 링크]를 눌러 기사님께 보내주세요.", "success");
  }

  // 아직 기기가 없는 노선 전부에 한 번에 발급합니다(요청: "오시는 분마다 내가 설정해 드리는것도
  // 문제"). 기기 ID는 노선당 하나면 되는 값이라, 미리 다 만들어두면 기사님이 오시기를 기다릴
  // 이유가 없습니다.
  async function bulkCreate() {
    const missing = rows.filter((r) => !r.device).map((r) => r.route.id);
    if (missing.length === 0) return;
    const json = await call({ action: "bulk_create", routeIds: missing });
    if (!json?.devices) return;
    const created = json.devices as ShuttleTrackerDevice[];
    setDevices((prev) => [...created, ...prev]);
    notify(`${created.length}개 노선에 기기를 발급했습니다.`, "success");
  }

  async function toggleDevice(device: ShuttleTrackerDevice) {
    const next = !device.enabled;
    setDevices((prev) => prev.map((d) => (d.id === device.id ? { ...d, enabled: next } : d)));
    await call({ action: "toggle", id: device.id, enabled: next });
  }

  async function removeDevice(device: ShuttleTrackerDevice) {
    if (!window.confirm(`${routeById.get(device.route_id)?.route_no ?? ""}호 기기 등록을 삭제할까요?`)) return;
    const json = await call({ action: "delete", id: device.id });
    if (json) setDevices((prev) => prev.filter((d) => d.id !== device.id));
  }

  async function applyGps(stop: ShuttleStop) {
    const json = await call({ action: "apply_gps", stopId: stop.id });
    if (!json) return;
    setStopList((prev) =>
      prev.map((s) => (s.id === stop.id ? { ...s, lat: s.gps_lat, lng: s.gps_lng, geocoded_at: new Date().toISOString() } : s))
    );
    notify("정류장 좌표를 GPS 학습값으로 바꿨습니다.", "success");
  }

  async function assignObservation(observationId: number, stopId: string) {
    const json = await call({ action: "assign_observation", observationId, stopId: stopId || null });
    if (!json) return;
    setObs((prev) => prev.map((o) => (o.id === observationId ? { ...o, matched_stop_id: stopId || null } : o)));
  }

  function copy(text: string) {
    navigator.clipboard.writeText(text).then(
      () => notify("복사했습니다.", "success"),
      () => notify("복사하지 못했습니다.", "error")
    );
  }

  // 학습 좌표가 있고, 기존 좌표와 눈에 띄게 차이 나는 정류장만 보여줍니다(그대로인 곳은 볼 필요 없음).
  const learnedStops = useMemo(
    () =>
      stopList
        .filter((s) => s.gps_lat != null && s.gps_lng != null && trackedRouteIds.has(s.route_id))
        .sort((a, b) => (b.gps_sample_count ?? 0) - (a.gps_sample_count ?? 0)),
    [stopList, trackedRouteIds]
  );

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      {qrFor && (
        <SetupLinkModal
          url={setupUrl(qrFor)}
          routeLabel={routeLabelOf(qrFor)}
          driverName={routeById.get(qrFor.route_id)?.driver_name ?? null}
          driverPhone={routeById.get(qrFor.route_id)?.driver_phone ?? null}
          deviceId={qrFor.device_id}
          onCopy={copy}
          onReissue={() => reissue(qrFor)}
          onClose={() => setQrFor(null)}
        />
      )}

      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="text-sm font-bold text-slate-800">🛰️ 기사님 휴대폰 GPS 추적 (Traccar Client)</h2>
        <button
          type="button"
          onClick={() => setShowGuide((v) => !v)}
          className="rounded-lg border border-slate-300 px-2 py-1 text-[11px] font-semibold text-slate-500"
        >
          {showGuide ? "설치 안내 닫기" : "설치 안내 보기"}
        </button>
      </div>
      <p className="mb-3 text-[11px] leading-relaxed text-slate-500">
        기사님 휴대폰에 무료 앱을 한 번만 설정해드리면, 그 뒤로는 조작 없이 백그라운드로 위치가 들어옵니다. 네비 화면은 가려지지
        않습니다. <b className="text-slate-700">하원 시간대(평일 {formatTrackWindows()})</b> 밖의 위치는 서버가 받는 즉시
        버리고 저장하지 않습니다.
      </p>

      {/* 설정 방법 - 값을 손으로 불러주는 대신 링크 하나로 끝내는 방식입니다 */}
      <div className="mb-3 rounded-lg border border-blue-200 bg-blue-50 p-3">
        <p className="mb-1 text-xs font-bold text-blue-900">📲 기사님 설정은 아래 [설정 링크] 버튼 하나로 끝냅니다</p>
        <p className="text-[11px] leading-relaxed text-blue-800">
          호차 옆 <b>[설정 링크]</b>를 누르면 QR과 문자 보내기가 나옵니다. 기사님이 <b>학교에 오셨다면</b> 이 화면의 QR을
          휴대폰 카메라로 찍으시게 하고, <b>안 오셨다면</b> [문자로 보내기]를 누르세요. 기사님은 링크를 열어 순서대로 누르기만
          하시면 되고, 서버 주소나 기기 번호를 한 글자도 치지 않으십니다.
        </p>
      </div>

      {showGuide && (
        <ol className="mb-4 list-decimal space-y-1.5 rounded-lg bg-slate-50 p-3 pl-7 text-[11px] leading-relaxed text-slate-600">
          <li>기사님 휴대폰 앱스토어(아이폰) 또는 Play 스토어(안드로이드)에서 <b>Traccar Client</b>를 설치합니다.</li>
          <li>앱 설정에서 <b>서버 주소(Server URL)</b>에 아래 주소를, <b>기기 식별자(Device identifier)</b>에 노선별 기기 ID를 넣습니다.</li>
          <li>위치 권한을 <b>&quot;항상 허용&quot;</b>으로 설정합니다(백그라운드 전송에 필수).</li>
          <li>정확도 <b>Highest</b>, 간격(Interval) <b>30초</b>, 거리(Distance) <b>0</b>, 각도(Angle) <b>0</b>, <b>정차 감지(Stop detection) 끄기</b>로 설정합니다. 정류장 좌표를 학습하려면 멈춰 있는 동안에도 위치가 계속 와야 합니다.</li>
          <li>안드로이드는 <b>배터리 최적화 예외</b>를 켜주세요(설정 → 앱 → 배터리 → 제한 없음). 안 하면 절전 모드에서 전송이 끊깁니다.</li>
          <li>마지막으로 앱 상단 스위치를 켜면 끝입니다. 이후 휴대폰을 재시작해도 자동으로 다시 켜집니다.</li>
        </ol>
      )}

      <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 p-2">
        <span className="text-[11px] font-bold text-slate-500">서버 주소</span>
        <code className="flex-1 truncate rounded bg-white px-2 py-1 text-[11px] text-slate-700">{serverUrl()}</code>
        <button
          type="button"
          onClick={() => copy(serverUrl())}
          className="rounded-lg bg-slate-700 px-2 py-1 text-[11px] font-semibold text-white"
        >
          복사
        </button>
      </div>

      {/* 설정 현황 - 기기가 없는 노선까지 함께 보여줍니다.
          기존에는 "발급된 기기"만 목록에 떠서, 아직 발급하지 않은 노선은 화면에 아예 없었습니다.
          그러면 무엇이 남았는지 담당자가 머리로 세어야 합니다. 노선 전체를 놓고 상태를 붙이면
          "몇 대 중 몇 대가 연결됐는지"가 한눈에 보입니다. */}
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="text-xs font-bold text-slate-700">설정 현황</span>
        <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-bold text-emerald-700">
          연결 {summary.connected}
        </span>
        {summary.pending > 0 && (
          <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-bold text-amber-700">
            대기 {summary.pending}
          </span>
        )}
        <span className="text-[11px] text-slate-400">전체 {rows.length}개 노선</span>
        {summary.missing > 0 && (
          <button
            type="button"
            onClick={bulkCreate}
            disabled={busy}
            className="ml-auto rounded-lg bg-slate-800 px-3 py-1.5 text-[11px] font-bold text-white disabled:opacity-50"
          >
            기기 없는 {summary.missing}개 노선에 한 번에 발급
          </button>
        )}
      </div>

      {rows.length === 0 ? (
        <p className="mb-5 py-4 text-center text-xs text-slate-400">
          등록된 하원 노선이 없습니다. [셔틀 → 노선 관리]에서 먼저 노선을 만들어주세요.
        </p>
      ) : (
        <div className="mb-5 flex flex-col gap-1.5">
          {rows.map(({ route, device }) => {
            const s = statusOf(device);
            return (
              <div
                key={route.id}
                className={"flex flex-wrap items-center gap-2 rounded-lg border p-2 " + s.tone}
              >
                <span className="text-xs font-bold text-slate-700">
                  {route.route_no}호 {route.name ?? ""}
                </span>
                <span className="text-[11px] text-slate-500">
                  {route.driver_name ?? "기사님 미등록"}
                  {route.driver_phone ? ` · ${route.driver_phone}` : ""}
                </span>
                <span className={"rounded px-1.5 py-0.5 text-[11px] font-bold " + s.chip}>{s.label}</span>
                {device && (
                  <button
                    type="button"
                    onClick={() => copy(device.device_id)}
                    title="기기 ID 복사"
                    className="rounded bg-slate-100 px-2 py-0.5 font-mono text-[11px] font-bold text-slate-600"
                  >
                    {device.device_id}
                  </button>
                )}

                <div className="ml-auto flex items-center gap-1.5">
                  {device ? (
                    <>
                      <button
                        type="button"
                        onClick={() => setQrFor(device)}
                        disabled={!device.setup_code}
                        className="rounded-lg bg-blue-600 px-2 py-1 text-[11px] font-bold text-white disabled:opacity-40"
                      >
                        설정 링크
                      </button>
                      <button
                        type="button"
                        onClick={() => toggleDevice(device)}
                        className={
                          "rounded-lg px-2 py-1 text-[11px] font-semibold " +
                          (device.enabled ? "bg-emerald-50 text-emerald-600" : "bg-slate-100 text-slate-400")
                        }
                      >
                        {device.enabled ? "사용중" : "중지됨"}
                      </button>
                      <button
                        type="button"
                        onClick={() => removeDevice(device)}
                        className="text-[11px] font-semibold text-red-500"
                      >
                        삭제
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={() => addDevice(route.id)}
                      disabled={busy}
                      className="rounded-lg border border-slate-300 px-2 py-1 text-[11px] font-bold text-slate-600 disabled:opacity-40"
                    >
                      기기 발급
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <h3 className="mb-1 text-xs font-bold text-slate-700">📍 GPS로 학습한 정류장 좌표</h3>
      <p className="mb-2 text-[11px] leading-relaxed text-slate-500">
        실제 주행에서 차가 멈춰 있던 자리를 모아 평균 낸 좌표입니다. 관측 횟수가 쌓일수록 정확해집니다. 확인 후 &quot;반영&quot;을
        누르면 정류장의 실제 좌표가 이 값으로 바뀝니다.
      </p>
      {learnedStops.length === 0 ? (
        <p className="mb-5 py-3 text-center text-xs text-slate-400">아직 학습된 좌표가 없습니다. 운행 기록이 쌓이면 표시됩니다.</p>
      ) : (
        <div className="mb-5 flex flex-col gap-1.5">
          {learnedStops.map((s) => {
            const route = routeById.get(s.route_id);
            const shift =
              s.lat != null && s.lng != null && s.gps_lat != null && s.gps_lng != null
                ? Math.round(distanceMeters(s.lat, s.lng, s.gps_lat, s.gps_lng))
                : null;
            return (
              <div key={s.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 p-2 text-[11px]">
                <span className="font-bold text-slate-700">
                  {route?.route_no ?? "?"}호 · {s.seq}번
                </span>
                <span className="max-w-[220px] truncate text-slate-500">{s.address ?? "(주소 없음)"}</span>
                <span className="text-slate-400">관측 {s.gps_sample_count}회</span>
                {shift != null && (
                  <span className={shift > 100 ? "font-bold text-orange-600" : "text-slate-400"}>기존 좌표와 {shift}m 차이</span>
                )}
                <a
                  href={`https://map.kakao.com/link/map/${encodeURIComponent(s.address ?? "정차지점")},${s.gps_lat},${s.gps_lng}`}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded border border-slate-300 px-1.5 py-0.5 text-slate-500"
                >
                  지도
                </a>
                <button
                  type="button"
                  onClick={() => applyGps(s)}
                  disabled={busy}
                  className="ml-auto rounded-lg bg-blue-600 px-2 py-1 font-semibold text-white disabled:opacity-50"
                >
                  반영
                </button>
              </div>
            );
          })}
        </div>
      )}

      {unmatched.length > 0 && (
        <>
          <h3 className="mb-1 text-xs font-bold text-slate-700">❓ 어느 정류장인지 모르는 정차 지점</h3>
          <p className="mb-2 text-[11px] leading-relaxed text-slate-500">
            차가 멈춰 있었지만 기존 정류장과 연결되지 않은 자리입니다. 등록되지 않은 정류장이거나, 기존 좌표가 많이 틀린
            경우입니다. 어느 정류장인지 골라주시면 다음부터 그 정류장의 학습에 함께 반영됩니다.
          </p>
          <div className="flex flex-col gap-1.5">
            {unmatched.slice(0, 30).map((o) => {
              const route = routeById.get(o.route_id);
              return (
                <div key={o.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 p-2 text-[11px]">
                  <span className="font-bold text-slate-700">{route?.route_no ?? "?"}호</span>
                  <span className="text-slate-500">
                    {o.service_date} · {new Date(o.arrived_at).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })} ·{" "}
                    {o.order_index ?? "?"}번째 정차 · {Math.round(o.dwell_seconds)}초
                  </span>
                  <a
                    href={`https://map.kakao.com/link/map/정차지점,${o.lat},${o.lng}`}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded border border-slate-300 bg-white px-1.5 py-0.5 text-slate-500"
                  >
                    지도
                  </a>
                  <select
                    defaultValue=""
                    onChange={(e) => assignObservation(o.id, e.target.value)}
                    className="ml-auto rounded-lg border border-slate-300 px-1.5 py-1 text-[11px]"
                  >
                    <option value="">정류장 지정...</option>
                    {(stopsByRoute.get(o.route_id) ?? []).map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.seq}번 {s.address ?? ""}
                      </option>
                    ))}
                  </select>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

// 최근 10분 안에 위치를 보내왔는지. 전송 간격이 30초라 정상이면 훨씬 자주 들어오고, 터널을
// 잠깐 지나는 정도로는 끊기지 않을 만큼 넉넉한 기준입니다(하원 운영화면과 같은 값).
function isFresh(lastSeenAt: string | null): boolean {
  if (!lastSeenAt) return false;
  return Date.now() - new Date(lastSeenAt).getTime() < 10 * 60 * 1000;
}

// 노선 한 줄의 상태를 정합니다. 담당자가 다음에 무엇을 해야 하는지가 바로 읽히도록 문구를
// "상태"가 아니라 "할 일"에 가깝게 적었습니다.
function statusOf(device: ShuttleTrackerDevice | null): { label: string; chip: string; tone: string } {
  if (!device) {
    return { label: "기기 없음", chip: "bg-slate-200 text-slate-600", tone: "border-slate-200 bg-slate-50" };
  }
  if (isFresh(device.last_seen_at)) {
    return { label: "✓ 연결됨", chip: "bg-emerald-500 text-white", tone: "border-emerald-200 bg-emerald-50/50" };
  }
  if (device.last_seen_at) {
    // 예전에 들어온 적은 있는데 지금은 조용한 경우입니다. 아이폰의 "계속 허용하시겠습니까?"를
    // 잘못 누르셨거나 절전 설정이 되돌아간 경우가 대부분이라, 그냥 넘기면 안 됩니다.
    return {
      label: `신호 끊김 · 최근 ${new Date(device.last_seen_at).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}`,
      chip: "bg-red-100 text-red-700",
      tone: "border-red-200 bg-red-50/50",
    };
  }
  if (device.setup_opened_at) {
    return { label: "링크 열어보심 · 설정 미완료", chip: "bg-amber-100 text-amber-700", tone: "border-amber-200 bg-amber-50/50" };
  }
  return { label: "링크 보내야 함", chip: "bg-blue-100 text-blue-700", tone: "border-slate-200 bg-white" };
}

// 설정 링크를 QR과 문자로 내보내는 창입니다.
//
// 왜 QR인가요? 기사님이 학교에 오셔서 휴대폰을 맡기시는 경우, 담당자가 남의 휴대폰 자판으로
// 60자짜리 주소를 치는 것이 가장 오래 걸리는 일이었습니다. 이 창을 사무실 모니터에 띄워두고
// 기사님 휴대폰 카메라(기본 카메라 앱, 두 운영체제 모두 됨)로 찍으시면 바로 설정 화면이
// 열립니다. 타자가 한 글자도 없습니다.
//
// 왜 문자인가요? 기사님이 안 오셨을 때 쓰는 길입니다. 별도 문자 발송 API(유료 가입·심사 필요)
// 대신 담당자 휴대폰의 기본 문자 앱을 열어 내용을 채워드립니다 - 지금 당장, 비용 없이 됩니다.
// 카카오톡으로 보내시려면 [링크 복사] 후 붙여넣으시면 됩니다.
function SetupLinkModal({
  url,
  routeLabel,
  driverName,
  driverPhone,
  deviceId,
  onCopy,
  onReissue,
  onClose,
}: {
  url: string;
  routeLabel: string;
  driverName: string | null;
  driverPhone: string | null;
  deviceId: string;
  onCopy: (text: string) => void;
  onReissue: () => void;
  onClose: () => void;
}) {
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    if (!url) return;
    QRCode.toDataURL(url, { width: 640, margin: 1 }).then(
      (dataUrl) => {
        if (alive) setQrDataUrl(dataUrl);
      },
      () => {
        if (alive) setQrDataUrl(null);
      }
    );
    return () => {
      alive = false;
    };
  }, [url]);

  const message = setupMessage(routeLabel, url);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="max-h-[92vh] w-full max-w-md overflow-y-auto rounded-2xl bg-white p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
        role="presentation"
      >
        <div className="mb-3 flex items-start justify-between gap-2">
          <div>
            <h3 className="text-base font-bold text-slate-800">{routeLabel} 설정 링크</h3>
            <p className="text-[11px] text-slate-500">
              {driverName ? `${driverName} 기사님` : "기사님 성함 미등록"} · 기기 ID{" "}
              <code className="font-bold text-slate-700">{deviceId}</code>
            </p>
          </div>
          <button type="button" onClick={onClose} className="text-lg text-slate-400">
            ✕
          </button>
        </div>

        <div className="mb-3 rounded-xl border border-slate-200 bg-slate-50 p-3 text-center">
          <p className="mb-2 text-xs font-bold text-slate-600">기사님이 학교에 오셨다면 — 휴대폰 카메라로 찍어주세요</p>
          {qrDataUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={qrDataUrl} alt={`${routeLabel} 설정 링크 QR 코드`} className="mx-auto h-56 w-56" />
          ) : (
            <div className="mx-auto flex h-56 w-56 items-center justify-center text-xs text-slate-400">QR 만드는 중...</div>
          )}
          <code className="mt-2 block break-all text-[11px] text-slate-500">{url}</code>
        </div>

        <p className="mb-1.5 text-xs font-bold text-slate-600">기사님이 안 오셨다면 — 보내드리세요</p>
        <div className="mb-3 flex flex-col gap-1.5">
          {driverPhone ? (
            <a
              href={smsHref(driverPhone, message)}
              className="rounded-xl bg-blue-600 px-4 py-3 text-center text-sm font-bold text-white"
            >
              📩 {driverPhone} 으로 문자 보내기
            </a>
          ) : (
            <p className="rounded-lg bg-amber-50 p-2.5 text-[11px] leading-relaxed text-amber-700">
              이 노선에 기사님 연락처가 등록되어 있지 않습니다. [셔틀 → 노선 관리]에서 연락처를 넣으시면 여기에 문자 보내기
              버튼이 생깁니다. 지금은 아래 [문구 복사]로 카카오톡에 붙여넣어 주세요.
            </p>
          )}
          <div className="flex gap-1.5">
            <button
              type="button"
              onClick={() => onCopy(url)}
              className="flex-1 rounded-xl border border-slate-300 px-3 py-2.5 text-xs font-bold text-slate-700"
            >
              링크만 복사
            </button>
            <button
              type="button"
              onClick={() => onCopy(message)}
              className="flex-1 rounded-xl border border-slate-300 px-3 py-2.5 text-xs font-bold text-slate-700"
            >
              문구 통째로 복사 (카톡용)
            </button>
          </div>
        </div>

        <button
          type="button"
          onClick={onReissue}
          className="w-full rounded-xl border border-red-200 px-3 py-2 text-[11px] font-semibold text-red-500"
        >
          링크가 엉뚱한 곳으로 갔다면 — 새로 발급
        </button>
        <p className="mt-1.5 text-[11px] leading-relaxed text-slate-400">
          새로 발급하면 예전 링크는 즉시 열리지 않습니다. 이미 설정을 마친 휴대폰은 영향을 받지 않습니다(기기 ID는 그대로).
        </p>
      </div>
    </div>
  );
}

// 화면 표시용 간단 거리 계산(서버의 haversineMeters와 같은 식).
function distanceMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const R = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
