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
