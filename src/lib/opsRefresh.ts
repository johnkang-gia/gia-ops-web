import { createClient } from "@/lib/supabase/client";

// 운영 대시보드 즉시 새로고침 신호.
//
// 업무 보드에서 학부모 문의를 처리로 체크하면, 벽면 모니터의 운영 대시보드에서도 바로 사라져야
// 합니다. 폴링만으로는 아무리 촘촘해도 최대 한 주기만큼 늦고, 그동안 이미 처리한 문의가 화면에
// 남아 있어 다른 사람이 또 처리하려 들 수 있습니다.
//
// 표(pickup_requests)를 직접 구독하지 않고 방송(broadcast)을 쓰는 이유:
// 대시보드는 로그인 없이 토큰으로만 열리는 화면인데, 그 표의 구독은 로그인 사용자에게만
// 허용되어 있어(is_giamicro_user) 아무 소식도 받지 못합니다. 방송은 표 권한과 무관한 단순
// 신호라 로그인하지 않은 화면에서도 받을 수 있습니다. 내용은 담지 않습니다 - "뭔가 바뀌었으니
// 다시 불러와라"만 알리고, 실제 데이터는 각자 자기 권한으로 다시 조회합니다.
export const OPS_REFRESH_CHANNEL = "ops-board-refresh";
export const OPS_REFRESH_EVENT = "refresh";

// 신호를 보냅니다. 실패해도 조용히 넘어갑니다 - 못 보내도 다음 폴링에서 반영되므로,
// 이것 때문에 사용자가 하던 일이 막히면 안 됩니다.
export async function notifyOpsBoardRefresh(): Promise<void> {
  try {
    const supabase = createClient();
    const channel = supabase.channel(OPS_REFRESH_CHANNEL);
    await channel.subscribe();
    await channel.send({ type: "broadcast", event: OPS_REFRESH_EVENT, payload: {} });
    // 보내고 나면 바로 정리합니다(이 화면은 받을 필요가 없습니다).
    await supabase.removeChannel(channel);
  } catch {
    /* 다음 폴링에서 반영됩니다 */
  }
}

// 서버(크론·수집 라우트)에서 같은 신호를 보냅니다.
//
// 브라우저용 위 함수는 서버에서 못 씁니다(로그인 세션이 없음). 그리고 서버리스 함수에서
// 웹소켓을 새로 여는 것도 낭비라, Realtime의 HTTP 방송 창구를 씁니다 - 요청 한 번이면 끝입니다.
//
// 왜 필요한가요? 토들 수집기가 새 문의를 넣는 것은 **서버에서 일어나는 일**입니다. 표 구독
// (postgres_changes)만으로도 화면이 따라와야 하지만, 발행목록이나 RLS가 어긋나면 조용히
// 아무 일도 안 일어납니다. 실제로 그래서 업무보드가 새로고침해야만 뜨고 있었습니다.
// 방송은 표 권한과 무관해서, 표 구독이 막혀 있어도 화면은 깨어납니다.
export async function notifyRefreshFromServer(): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return;
  try {
    await fetch(`${url}/realtime/v1/api/broadcast`, {
      method: "POST",
      headers: { "content-type": "application/json", apikey: key, authorization: `Bearer ${key}` },
      body: JSON.stringify({
        messages: [{ topic: OPS_REFRESH_CHANNEL, event: OPS_REFRESH_EVENT, payload: {} }],
      }),
    });
  } catch {
    /* 못 보내도 폴링·구독이 받아줍니다 - 수집 자체가 실패하면 안 됩니다 */
  }
}
