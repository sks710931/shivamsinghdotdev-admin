"use client";

import { LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function SignOutButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function signOut() {
    if (pending) {
      return;
    }

    setPending(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } finally {
      router.refresh();
      router.push("/login");
    }
  }

  return (
    <button
      type="button"
      onClick={signOut}
      disabled={pending}
      className="inline-flex h-9 items-center gap-2 rounded-lg border border-line px-3 text-sm text-paper transition-colors hover:border-accent/70 hover:text-accent disabled:cursor-not-allowed disabled:opacity-50"
    >
      <LogOut aria-hidden className="h-4 w-4" strokeWidth={1.75} />
      {pending ? "Signing out" : "Sign out"}
    </button>
  );
}
