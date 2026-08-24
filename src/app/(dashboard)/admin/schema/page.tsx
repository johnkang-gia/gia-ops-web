import SchemaCheckClient from "@/components/admin/SchemaCheckClient";

// 데이터베이스 점검 화면.
//
// 요청: "마이그레이션 자동으로 해놨긴했는데 제대로 반영되는지 안되는지 편하게 확인할 수 있는
// 방법이 없을까?"
//
// 지금까지는 화면이 깨져야 알 수 있었고, 그것도 "어느 기능이 안 되는지"만 알 뿐 왜 안 되는지는
// 짐작해야 했습니다. 여기서 한 번 누르면 기능별로 초록/빨강이 나옵니다.

export default function SchemaPage() {
  return (
    <div className="mx-auto max-w-3xl p-4 sm:p-6">
      <h1 className="mb-1 text-lg font-bold">🗄️ 데이터베이스 점검</h1>
      <p className="mb-4 text-xs leading-relaxed text-slate-500">
        앱이 쓰는 표와 칸이 실제로 만들어져 있는지 확인합니다. 새 기능을 올린 뒤 여기서 한 번
        눌러보시면, 마이그레이션이 제대로 걸렸는지 바로 알 수 있습니다.
      </p>
      <SchemaCheckClient />
    </div>
  );
}
