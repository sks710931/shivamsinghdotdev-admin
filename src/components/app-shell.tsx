"use client";

import { FileText, House, Menu, Users } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import { SignOutButton } from "@/components/sign-out-button";
import type { UserRole } from "@/lib/directory";

const NAV = [
  { href: "/", label: "Desk", adminOnly: false, icon: House },
  { href: "/posts", label: "Posts", adminOnly: false, icon: FileText },
  { href: "/users", label: "Users", adminOnly: true, icon: Users },
] as const;

function sectionTitle(pathname: string): string {
  const match = NAV.find((item) =>
    item.href === "/" ? pathname === "/" : pathname === item.href || pathname.startsWith(`${item.href}/`),
  );
  return match?.label ?? "Desk";
}

export function AppShell({
  email,
  role,
  children,
}: {
  email: string;
  role: UserRole;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const items = NAV.filter((item) => !item.adminOnly || role === "admin");
  const title = sectionTitle(pathname);

  useEffect(() => {
    if (!menuOpen) {
      return;
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setMenuOpen(false);
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [menuOpen]);

  return (
    <div className="min-h-dvh bg-ink text-paper">
      <div className="flex min-h-dvh">
        {menuOpen ? (
          <button
            type="button"
            className="fixed inset-0 z-20 bg-black/70 lg:hidden"
            aria-label="Close menu"
            onClick={() => setMenuOpen(false)}
          />
        ) : null}
        <aside
          id="desk-sidebar"
          className={`fixed inset-y-0 left-0 z-30 flex w-60 shrink-0 flex-col border-r border-line bg-[#0c1211] px-3 py-5 transition-transform lg:sticky lg:top-0 lg:h-dvh lg:translate-x-0 ${
            menuOpen ? "translate-x-0" : "-translate-x-full"
          }`}
        >
          <div className="flex items-center gap-3 px-2">
            <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-accent font-display text-sm font-semibold text-ink">
              S
            </span>
            <span>
              <span className="block font-display text-base leading-none text-paper">Blog desk</span>
              <span className="mt-1 block font-mono text-[10px] tracking-[0.16em] text-mist">
                shivamsingh.dev
              </span>
            </span>
          </div>
          <nav aria-label="Desk" className="mt-8 flex flex-col gap-1">
            {items.map((item) => {
              const active =
                item.href === "/"
                  ? pathname === "/"
                  : pathname === item.href || pathname.startsWith(`${item.href}/`);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  onClick={() => setMenuOpen(false)}
                  className={`flex items-center gap-3 rounded-lg border-l-2 px-3 py-2.5 text-sm transition-colors ${
                    active
                      ? "border-accent bg-accent/10 text-accent"
                      : "border-transparent text-mist hover:bg-white/[0.04] hover:text-paper"
                  }`}
                >
                  <item.icon aria-hidden className="h-4 w-4 shrink-0" strokeWidth={1.75} />
                  {item.label}
                </Link>
              );
            })}
          </nav>
          <div className="mt-auto border-t border-line px-3 pt-4">
            <p className="font-mono text-[10px] tracking-[0.16em] text-mist uppercase">Private</p>
          </div>
        </aside>
        <div className="relative flex min-w-0 flex-1 flex-col">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(183,243,162,0.09),transparent_46%),linear-gradient(180deg,rgba(183,243,162,0.03),transparent_18rem)]" />
          <header className="sticky top-0 z-10 flex h-14 items-center gap-3 border-b border-line bg-ink px-4 sm:px-6">
            <button
              type="button"
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-line text-paper transition-colors hover:border-accent/70 lg:hidden"
              aria-expanded={menuOpen}
              aria-controls="desk-sidebar"
              aria-label="Menu"
              onClick={() => setMenuOpen((open) => !open)}
            >
              <Menu aria-hidden className="h-4 w-4" strokeWidth={1.75} />
            </button>
            <p className="sr-only">{title}</p>
            <div className="ml-auto flex min-w-0 items-center gap-3">
              <p className="hidden max-w-64 truncate text-sm text-mist sm:block">{email}</p>
              <SignOutButton />
            </div>
          </header>
          <main className="relative w-full flex-1 px-4 py-8 sm:px-8">{children}</main>
        </div>
      </div>
    </div>
  );
}
