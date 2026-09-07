import type { PageTab } from "@/components/common/PageTabs";

/**
 * 「명부 관리」 한 자리에 모인 화면들.
 *
 * 명부를 보는 일, 시트에서 받아오는 일, 겹친 줄을 정리하는 일, 처음 한 번 통째로 넣는 일은
 * 전부 **같은 명부**를 두고 하는 일입니다. 상단 탭에 하나씩 늘어놓았더니 「학생」 아래에만
 * 여덟 줄이 생겼고, 서로 무슨 관계인지 알 수 없었습니다.
 *
 * 목록을 여기 한 곳에 둡니다 - 화면마다 각자 적으면 한 곳을 고칠 때 나머지가 어긋납니다.
 */
export const ROSTER_TABS: PageTab[] = [
  { label: "명부", href: "/weekly-report/admin/students" },
  { label: "구글시트 연결", href: "/school/sheet" },
  { label: "명부 점검", href: "/school/data-check" },
  { label: "처음 가져오기", href: "/school/import", admin: true },
];
