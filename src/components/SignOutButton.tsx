"use client";

import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function SignOutButton({ dark = false }: { dark?: boolean }) {
  const router = useRouter();

  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <button
      onClick={handleSignOut}
      className={
        "text-sm transition-colors " +
        (dark
          ? "text-white/60 hover:text-white"
          : "text-[var(--shell-text-muted,#64748b)] hover:text-[var(--shell-text,#0f172a)]")
      }
    >
      로그아웃 <span className="opacity-60">Sign out</span>
    </button>
  );
}
