import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { DeskFrame } from "@/components/desk-frame";
import { getCurrentUser } from "@/server/auth";
import { LoginForm } from "./login-form";

export const metadata: Metadata = {
  title: "Sign in",
};

export default async function LoginPage() {
  const user = await getCurrentUser();
  if (user) {
    redirect("/");
  }

  return (
    <DeskFrame>
      <div className="grid flex-1 items-end gap-12 lg:grid-cols-[1.15fr_0.85fr] lg:items-center">
        <header className="max-w-xl">
          <p className="font-mono text-xs tracking-[0.22em] text-accent uppercase">01 / Access</p>
          <h1 className="font-display mt-4 text-5xl leading-[0.95] font-medium tracking-tight sm:text-7xl">
            The blog desk is locked.
          </h1>
          <p className="mt-6 max-w-md text-lg leading-8 text-mist">
            Sign in to draft and publish posts for the portfolio. This door is private.
          </p>
        </header>
        <section className="border border-line bg-panel/90 p-6 backdrop-blur-sm sm:p-8">
          <p className="font-mono text-xs tracking-[0.18em] text-mist uppercase">Admin session</p>
          <h2 className="font-display mt-3 text-3xl font-medium">Sign in</h2>
          <div className="mt-8">
            <LoginForm />
          </div>
        </section>
      </div>
    </DeskFrame>
  );
}
