import { NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { getCurrentAppUser } from "@/lib/currentUser";
import { isAdminUser } from "@/lib/roles";
import {
  SHARED_ACCOUNT_DOMAIN,
  accountKindOf,
  isSharedAccount,
  toSharedAccountEmail,
} from "@/lib/sharedAccounts";

export const dynamic = "force-dynamic";

// 공용 가계정(도서관 노트북 · 오리엔테이션 교육용) 관리 API입니다.
//
// 요청: "로그인할때, 아이디랑 비번 넣고 들어갈 수 있도록 만들어서, 도서관이랑, 오리엔테이션용
// 가계정을 만들어서 관리하게 해줘"
//
// 계정 생성과 비밀번호 변경은 Supabase의 관리자 API로만 할 수 있고, 그 API는 service role
// 키를 요구합니다. 이 키는 모든 보안규칙을 통과하는 마스터 키라 브라우저에 절대 내려보내면
// 안 되므로, 화면에서 직접 호출하지 않고 이 서버 라우트를 거칩니다.
//
// 비밀번호는 이 서버가 Supabase로 넘겨주기만 하고 우리 DB나 로그에는 남기지 않습니다. 한 번
// 정한 비밀번호는 다시 꺼내볼 수 없고(단방향 저장), 잊어버리면 새로 정하는 것만 가능합니다.

function service() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createServiceClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

// 관리자·개발자만. 이 API는 계정을 새로 만들 수 있어서, 권한 확인이 뚫리면 누구나 임의의
// 계정을 만들어 들어올 수 있게 됩니다. 화면 쪽 제한과 별개로 여기서 반드시 다시 확인합니다.
async function requireAdmin() {
  const me = await getCurrentAppUser();
  if (!me || !isAdminUser(me)) return null;
  return me;
}

export async function GET() {
  const me = await requireAdmin();
  if (!me) return NextResponse.json({ error: "권한이 없습니다." }, { status: 403 });

  const supabase = service();
  if (!supabase) return NextResponse.json({ error: "서버 설정 오류입니다." }, { status: 500 });

  // 공용 계정은 많아야 몇 개라 한 페이지면 충분합니다.
  const { data, error } = await supabase.auth.admin.listUsers({ page: 1, perPage: 200 });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const shared = data.users.filter((u) => isSharedAccount(u.email));
  const emails = shared.map((u) => (u.email ?? "").toLowerCase());

  const { data: appUsers } = emails.length
    ? await supabase.from("app_users").select("email, name, position, status").in("email", emails)
    : { data: [] as { email: string; name: string | null; position: string | null; status: string }[] };
  const appUserByEmail = new Map(((appUsers ?? []) as { email: string; name: string | null; position: string | null; status: string }[]).map((u) => [u.email, u]));

  const items = shared
    .map((u) => {
      const email = (u.email ?? "").toLowerCase();
      const appUser = appUserByEmail.get(email);
      return {
        email,
        kind: accountKindOf(email),
        name: appUser?.name ?? null,
        position: appUser?.position ?? null,
        status: appUser?.status ?? null,
        createdAt: u.created_at,
        lastSignInAt: u.last_sign_in_at ?? null,
        // 사용중지된 계정은 Supabase가 banned_until을 미래 시각으로 표시합니다.
        disabled: !!(u as { banned_until?: string | null }).banned_until,
      };
    })
    .sort((a, b) => a.email.localeCompare(b.email));

  return NextResponse.json({ items });
}

export async function POST(req: Request) {
  const me = await requireAdmin();
  if (!me) return NextResponse.json({ error: "권한이 없습니다." }, { status: 403 });

  const supabase = service();
  if (!supabase) return NextResponse.json({ error: "서버 설정 오류입니다." }, { status: 500 });

  const body = (await req.json().catch(() => null)) as { accountId?: string; password?: string } | null;
  const email = toSharedAccountEmail(body?.accountId ?? "");
  const password = body?.password ?? "";

  if (!isSharedAccount(email)) {
    return NextResponse.json(
      { error: `공용 계정 아이디는 "gia-"로 시작하고 ${SHARED_ACCOUNT_DOMAIN}로 끝나야 합니다.` },
      { status: 400 }
    );
  }
  // Supabase 기본 최소 길이는 6자이지만, 여러 사람이 공유하고 오래 쓰는 계정이라 조금 더
  // 길게 요구합니다.
  if (password.length < 10) {
    return NextResponse.json({ error: "비밀번호는 10자 이상으로 정해주세요." }, { status: 400 });
  }

  // 이미 있는 계정이면 비밀번호만 새로 정하고, 없으면 새로 만듭니다. 화면에서 두 경우를 따로
  // 고르게 하면 "있는 줄 알았는데 없었다"는 상황마다 오류를 보게 되므로, 서버가 알아서 판단합니다.
  const { data: listed, error: listError } = await supabase.auth.admin.listUsers({ page: 1, perPage: 200 });
  if (listError) return NextResponse.json({ error: listError.message }, { status: 500 });
  const existing = listed.users.find((u) => (u.email ?? "").toLowerCase() === email);

  if (existing) {
    const { error } = await supabase.auth.admin.updateUserById(existing.id, { password });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, created: false, email });
  }

  const { error } = await supabase.auth.admin.createUser({
    email,
    password,
    // 공용 계정은 받을 사람이 없는 주소라 확인 메일을 보낼 수 없습니다. 관리자가 직접 만드는
    // 계정이므로 처음부터 확인된 것으로 둡니다.
    email_confirm: true,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // 승인 대기 화면에 걸리지 않도록 app_users 행도 함께 만들어 둡니다. 오리엔테이션 계정은
  // 교사로, 도서관 계정은 운영앱에 못 들어오지만 형식상 행정직원으로 둡니다.
  const kind = accountKindOf(email);
  await supabase.from("app_users").upsert(
    {
      email,
      name: kind === "demo" ? "오리엔테이션 데모" : "도서관 노트북",
      department: "초등부",
      position: kind === "demo" ? "교사" : "행정직원",
      status: "approved",
      decided_by: me.email,
      decided_at: new Date().toISOString(),
    },
    { onConflict: "email" }
  );

  return NextResponse.json({ ok: true, created: true, email });
}

// 사용중지 / 재사용. 계정을 지우지 않고 잠그는 이유는, 지우면 그 계정이 남긴 기록(작성자
// 표시 등)의 연결이 끊기고 같은 아이디를 다시 만들 때 다른 계정으로 취급되기 때문입니다.
export async function PATCH(req: Request) {
  const me = await requireAdmin();
  if (!me) return NextResponse.json({ error: "권한이 없습니다." }, { status: 403 });

  const supabase = service();
  if (!supabase) return NextResponse.json({ error: "서버 설정 오류입니다." }, { status: 500 });

  const body = (await req.json().catch(() => null)) as { email?: string; disabled?: boolean } | null;
  const email = (body?.email ?? "").toLowerCase();
  const disabled = !!body?.disabled;
  if (!isSharedAccount(email)) return NextResponse.json({ error: "공용 계정이 아닙니다." }, { status: 400 });

  const { data: listed, error: listError } = await supabase.auth.admin.listUsers({ page: 1, perPage: 200 });
  if (listError) return NextResponse.json({ error: listError.message }, { status: 500 });
  const target = listed.users.find((u) => (u.email ?? "").toLowerCase() === email);
  if (!target) return NextResponse.json({ error: "계정을 찾을 수 없습니다." }, { status: 404 });

  // "876000h"는 약 100년입니다. Supabase에는 "영구 잠금"이 따로 없어서 아주 먼 미래를 넣습니다.
  const { error } = await supabase.auth.admin.updateUserById(target.id, {
    ban_duration: disabled ? "876000h" : "none",
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, disabled });
}
