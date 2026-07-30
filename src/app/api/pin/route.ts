import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { genSalt, hashPin, makePinCookieValue, pinCookieMaxAge, pinCookieName } from "@/lib/pinCookie";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const { data } = await supabase.from("pins").select("user_email").eq("user_email", user.email).maybeSingle();
  return NextResponse.json({ hasPin: !!data });
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !user.email) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const pin = String(body.pin || "").trim();
  const mode = body.mode === "setup" ? "setup" : "verify";

  if (!/^\d{4,8}$/.test(pin)) {
    return NextResponse.json({ error: "PIN은 숫자 4~8자리로 입력해주세요." }, { status: 400 });
  }

  const { data: existing } = await supabase
    .from("pins")
    .select("salt, hash")
    .eq("user_email", user.email)
    .maybeSingle();

  if (mode === "setup") {
    if (existing) {
      return NextResponse.json(
        { error: "이미 PIN이 설정되어 있습니다. 분실했다면 개발자에게 초기화를 요청하세요." },
        { status: 409 }
      );
    }
    const salt = genSalt();
    const hash = hashPin(pin, salt);
    const { error } = await supabase.from("pins").insert({ user_email: user.email, salt, hash });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const res = NextResponse.json({ success: true });
    res.cookies.set(pinCookieName(), makePinCookieValue(user.id), {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      maxAge: pinCookieMaxAge(),
      path: "/",
    });
    return res;
  }

  // verify
  if (!existing) {
    return NextResponse.json({ error: "설정된 PIN이 없습니다. 먼저 PIN을 설정해주세요." }, { status: 404 });
  }
  const computed = hashPin(pin, existing.salt);
  if (computed !== existing.hash) {
    return NextResponse.json({ error: "PIN이 일치하지 않습니다." }, { status: 401 });
  }

  const res = NextResponse.json({ success: true });
  res.cookies.set(pinCookieName(), makePinCookieValue(user.id), {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: pinCookieMaxAge(),
    path: "/",
  });
  return res;
}
