import { NextRequest, NextResponse } from "next/server";

// 이 크론은 /api/cron/shuttle-auto 로 합쳐졌습니다.
//
// 도착 판단과 출발 판단은 같은 시각에 같은 표(shuttle_run_events)를 보고 이뤄지는데, 예전에는
// 두 라우트가 각자 1분마다 불려 각자 그 표를 조회하고 각자 25초씩 함수를 붙잡았습니다.
// 한 번 조회해 둘 다 판단하면 될 일이라 하나로 합쳤습니다(루프 시간·DB 왕복 모두 절반).
//
// 외부 스케줄러(cron-job.org)에서 이 주소로 걸린 작업은 지우고, /api/cron/shuttle-auto 하나만
// 1분마다 부르도록 바꿔주세요. 그 전까지 이 주소가 불려도 아무 일도 하지 않습니다(중복 처리
// 방지) - 실수로 두 번 도는 것보다 한쪽이 조용히 쉬는 편이 안전합니다.
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return NextResponse.json({
    ok: true,
    moved: "/api/cron/shuttle-auto",
    message: "이 크론은 /api/cron/shuttle-auto 로 합쳐졌습니다. 외부 스케줄러 설정을 바꿔주세요.",
  });
}
