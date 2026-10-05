"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

export function LoginForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) {
      return;
    }

    const form = new FormData(event.currentTarget);
    setPending(true);
    setError(null);

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: form.get("email"),
          password: form.get("password"),
        }),
      });
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) {
        setError(body?.error ?? "Could not sign in.");
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
    <form onSubmit={onSubmit} className="flex flex-col gap-5" noValidate>
      <div className="flex flex-col gap-2">
        <label htmlFor="email" className="font-mono text-xs tracking-[0.16em] text-mist uppercase">
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          required
          spellCheck={false}
          className="h-12 border border-line bg-ink px-3 text-base text-paper outline-none transition-colors placeholder:text-mist/70 focus:border-accent"
          placeholder="you@example.com"
        />
      </div>
      <div className="flex flex-col gap-2">
        <label htmlFor="password" className="font-mono text-xs tracking-[0.16em] text-mist uppercase">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className="h-12 border border-line bg-ink px-3 text-base text-paper outline-none transition-colors focus:border-accent"
        />
      </div>
      {error ? (
        <p role="alert" className="border border-line bg-ink px-3 py-2 text-sm text-accent">
          {error}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={pending}
        className="mt-1 h-12 bg-accent text-sm font-semibold tracking-wide text-ink transition-opacity hover:opacity-90 disabled:cursor-wait disabled:opacity-60"
      >
        {pending ? "Signing in" : "Enter the desk"}
      </button>
    </form>
  );
}
