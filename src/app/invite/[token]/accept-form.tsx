"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function AcceptForm({
  token,
  email,
  displayName,
}: {
  token: string;
  email: string;
  displayName: string | null;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) {
      return;
    }

    const form = new FormData(event.currentTarget);
    const password = String(form.get("password") ?? "");
    const confirm = String(form.get("confirm") ?? "");
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }

    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/auth/invites/accept", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          token,
          password,
          displayName: form.get("displayName"),
        }),
      });
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) {
        setError(body?.error ?? "The invite could not be accepted.");
        setPending(false);
        return;
      }
      router.refresh();
      router.push("/");
    } catch {
      setError("Could not reach the server.");
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="mt-8 flex flex-col gap-5">
      <label className="flex flex-col gap-2">
        <span className="font-mono text-xs tracking-[0.16em] text-mist uppercase">Name</span>
        <input
          name="displayName"
          defaultValue={displayName ?? ""}
          maxLength={120}
          className="h-12 border border-line bg-ink px-3 outline-none focus:border-accent"
        />
      </label>
      <p className="text-sm text-mist">{email}</p>
      <label className="flex flex-col gap-2">
        <span className="font-mono text-xs tracking-[0.16em] text-mist uppercase">Password</span>
        <input
          name="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={12}
          className="h-12 border border-line bg-ink px-3 outline-none focus:border-accent"
        />
      </label>
      <label className="flex flex-col gap-2">
        <span className="font-mono text-xs tracking-[0.16em] text-mist uppercase">Confirm password</span>
        <input
          name="confirm"
          type="password"
          autoComplete="new-password"
          required
          minLength={12}
          className="h-12 border border-line bg-ink px-3 outline-none focus:border-accent"
        />
      </label>
      {error ? (
        <p role="alert" className="border border-line px-3 py-2 text-sm text-accent">
          {error}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={pending}
        className="h-12 bg-accent text-sm font-semibold text-ink disabled:opacity-60"
      >
        {pending ? "Creating account" : "Accept invite"}
      </button>
    </form>
  );
}
