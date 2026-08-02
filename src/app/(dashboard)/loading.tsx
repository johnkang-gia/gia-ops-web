// 탭/메뉴를 클릭한 순간부터 다음 페이지의 실제 데이터(서버 컴포넌트 조회 결과)가 도착하기까지는
// 짧게나마 공백이 생깁니다. 지금까지는 그 사이 화면이 하얗게 비어 있어 "느리다"는 인상을 줬는데,
// Next.js는 같은 경로 그룹 안에 loading.tsx가 있으면 그 공백 동안 이 화면을 즉시 보여줍니다
// (Suspense 기반이라 별도 설정 없이 자동 적용 - 실제 전환 속도가 빨라지는 건 아니지만 "바로
// 반응한다"는 체감 속도는 확실히 좋아집니다). 어느 페이지에서 뜰지 알 수 없으므로 일부러 아주
// 단순한 스켈레톤 하나로 통일했습니다.
export default function DashboardLoading() {
  return (
    <div className="flex h-full min-h-[240px] w-full animate-pulse flex-col gap-4 p-2">
      <div className="h-6 w-40 rounded bg-slate-200" />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <div className="h-24 rounded-xl bg-slate-200" />
        <div className="h-24 rounded-xl bg-slate-200" />
        <div className="h-24 rounded-xl bg-slate-200" />
      </div>
      <div className="flex-1 rounded-xl bg-slate-100" />
    </div>
  );
}
