"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import { RoleBadge, StatusBadge } from "@/components/status-badge";
import { UserAvatar } from "@/components/user-avatar";
import type { DirectoryUser, PendingInvite } from "@/lib/directory";

type ShownInvite = PendingInvite & { expiresLabel: string };

const fieldClass =
  "h-12 w-full rounded-lg border border-line bg-ink pl-10 pr-3 text-sm text-paper outline-none transition-colors placeholder:text-mist/70 focus:border-accent";

async function send(url: string, method: string, body?: unknown): Promise<void> {
  const response = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = (await response.json().catch(() => null)) as { error?: string } | null;
  if (!response.ok) {
    throw new Error(payload?.error ?? "The request failed.");
  }
}

function FieldIcon({ children }: { children: React.ReactNode }) {
  return (
    <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-mist">
      {children}
    </span>
  );
}

function IconSvg({ children }: { children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  );
}

export function UsersPanel({
  currentUserId,
  users,
  invites,
}: {
  currentUserId: string;
  users: DirectoryUser[];
  invites: ShownInvite[];
}) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [tab, setTab] = useState<"accounts" | "invites">("accounts");

  function openInvite() {
    setInviteError(null);
    dialogRef.current?.showModal();
  }

  function closeInvite() {
    if (pending) {
      return;
    }
    dialogRef.current?.close();
  }

  async function run(action: () => Promise<void>, success: string) {
    if (pending) {
      return;
    }
    setPending(true);
    setError(null);
    setNotice(null);
    try {
      await action();
      setNotice(success);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The request failed.");
    } finally {
      setPending(false);
    }
  }

  async function onInvite(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) {
      return;
    }
    const form = new FormData(event.currentTarget);
    const target = event.currentTarget;
    setPending(true);
    setInviteError(null);
    setNotice(null);
    try {
      await send("/api/users/invites", "POST", {
        email: form.get("email"),
        displayName: form.get("displayName"),
        role: form.get("role"),
      });
      target.reset();
      dialogRef.current?.close();
      setNotice("Invite sent.");
      router.refresh();
    } catch (caught) {
      setInviteError(caught instanceof Error ? caught.message : "The request failed.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="font-mono text-[11px] tracking-[0.18em] text-accent uppercase">Access</p>
          <h2 className="font-display mt-2 text-4xl leading-none font-medium tracking-tight text-paper">
            Users
          </h2>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-mist sm:text-base">
            Admins can manage the desk. Guests can sign in, but they cannot manage users.
          </p>
        </div>
        <button
          type="button"
          onClick={openInvite}
          className="inline-flex h-11 shrink-0 items-center gap-2 self-start rounded-lg bg-accent px-4 text-sm font-semibold text-ink transition-[filter] hover:brightness-110"
        >
          <IconSvg>
            <path d="M21 3 10.5 13.5" />
            <path d="m21 3-7.2 18-3.3-7.5L3 10.2z" />
          </IconSvg>
          Send invite
        </button>
      </div>

      {error ? (
        <p role="alert" className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="rounded-lg border border-accent/30 bg-accent/10 px-3 py-2 text-sm text-accent">{notice}</p>
      ) : null}

      <dialog
        ref={dialogRef}
        aria-labelledby="invite-title"
        className="m-auto w-[calc(100%-2rem)] max-w-lg rounded-xl border border-line bg-panel p-0 text-paper backdrop:bg-black/70"
        onClick={(event) => {
          if (event.target === dialogRef.current) {
            closeInvite();
          }
        }}
        onCancel={(event) => {
          if (pending) {
            event.preventDefault();
          }
        }}
      >
        <form onSubmit={onInvite} className="flex flex-col gap-4 p-5 sm:p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 id="invite-title" className="font-display text-xl font-medium">
                Send an invite
              </h2>
              <p className="mt-1 text-sm leading-6 text-mist">
                This does not create the account. The person accepts the link and chooses a password.
              </p>
            </div>
            <button
              type="button"
              onClick={closeInvite}
              disabled={pending}
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-line text-mist transition-colors hover:text-paper disabled:opacity-40"
              aria-label="Close"
            >
              <IconSvg>
                <path d="M6 6l12 12M18 6 6 18" />
              </IconSvg>
            </button>
          </div>
          {inviteError ? (
            <p role="alert" className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
              {inviteError}
            </p>
          ) : null}
          <label className="flex flex-col gap-2 text-sm">
            <span className="text-xs font-medium tracking-wide text-mist">Name</span>
            <span className="relative">
              <FieldIcon>
                <IconSvg>
                  <circle cx="12" cy="8" r="3" />
                  <path d="M6 19c.8-2.6 2.8-4 6-4s5.2 1.4 6 4" />
                </IconSvg>
              </FieldIcon>
              <input name="displayName" maxLength={120} autoComplete="name" className={fieldClass} />
            </span>
          </label>
          <label className="flex flex-col gap-2 text-sm">
            <span className="text-xs font-medium tracking-wide text-mist">Email</span>
            <span className="relative">
              <FieldIcon>
                <IconSvg>
                  <path d="M4 7h16v10H4z" />
                  <path d="m4 7 8 6 8-6" />
                </IconSvg>
              </FieldIcon>
              <input name="email" type="email" required autoComplete="email" className={fieldClass} />
            </span>
          </label>
          <label className="flex flex-col gap-2 text-sm">
            <span className="text-xs font-medium tracking-wide text-mist">Role</span>
            <span className="relative">
              <FieldIcon>
                <IconSvg>
                  <path d="M12 3.5 19 6.5v5.2c0 3.6-2.7 6.4-7 8.3-4.3-1.9-7-4.7-7-8.3V6.5z" />
                </IconSvg>
              </FieldIcon>
              <select name="role" defaultValue="guest" className={`${fieldClass} appearance-none pr-8`}>
                <option value="guest">Guest</option>
                <option value="admin">Admin</option>
              </select>
            </span>
          </label>
          <div className="flex justify-end pt-1">
            <button
              type="submit"
              disabled={pending}
              className="inline-flex h-12 items-center justify-center gap-2 rounded-lg bg-accent px-4 text-sm font-semibold text-ink transition-[filter] hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <IconSvg>
                <path d="M21 3 10.5 13.5" />
                <path d="m21 3-7.2 18-3.3-7.5L3 10.2z" />
              </IconSvg>
              {pending ? "Sending" : "Send invite"}
            </button>
          </div>
        </form>
      </dialog>

      <section className="overflow-hidden rounded-xl border border-line bg-panel">
        <div role="tablist" aria-label="Directory" className="flex border-b border-line">
          {(
            [
              ["accounts", "Accounts"],
              ["invites", "Pending Invites"],
            ] as const
          ).map(([id, label]) => {
            const selected = tab === id;
            return (
              <button
                key={id}
                type="button"
                role="tab"
                id={`${id}-tab`}
                aria-selected={selected}
                aria-controls={`${id}-panel`}
                tabIndex={selected ? 0 : -1}
                onClick={() => setTab(id)}
                onKeyDown={(event) => {
                  if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") {
                    return;
                  }
                  event.preventDefault();
                  const next = id === "accounts" ? "invites" : "accounts";
                  setTab(next);
                  document.getElementById(`${next}-tab`)?.focus();
                }}
                className={`h-12 px-5 text-sm font-medium transition-colors sm:px-6 ${
                  selected
                    ? "border-b-2 border-accent text-paper"
                    : "border-b-2 border-transparent text-mist hover:text-paper"
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>

        {tab === "accounts" ? (
        <div role="tabpanel" id="accounts-panel" aria-labelledby="accounts-tab" className="overflow-x-auto">
          <table className="w-full min-w-[44rem] border-collapse text-left text-sm">
            <thead className="text-xs tracking-wide text-mist uppercase">
              <tr className="border-b border-line">
                <th className="px-5 py-3 font-medium sm:px-6">Name</th>
                <th className="px-3 py-3 font-medium">Email</th>
                <th className="px-3 py-3 font-medium">Role</th>
                <th className="px-3 py-3 font-medium">Status</th>
                <th className="px-5 py-3 text-right font-medium sm:px-6">Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => {
                const mine = user.id === currentUserId;
                return (
                  <tr key={user.id} className="border-b border-line/80 last:border-b-0">
                    <td className="px-5 py-4 sm:px-6">
                      <span className="flex items-center gap-3">
                        <UserAvatar name={user.displayName} email={user.email} />
                        <span className="font-medium text-paper">{user.displayName || "—"}</span>
                      </span>
                    </td>
                    <td className="px-3 py-4 text-mist">{user.email}</td>
                    <td className="px-3 py-4">
                      <RoleBadge role={user.role} />
                    </td>
                    <td className="px-3 py-4">
                      <StatusBadge disabled={user.disabled} />
                    </td>
                    <td className="px-5 py-4 text-right sm:px-6">
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          disabled={pending || mine}
                          onClick={() =>
                            void run(
                              () => send(`/api/users/${user.id}`, "PATCH", { disabled: !user.disabled }),
                              user.disabled ? "Account enabled." : "Account disabled.",
                            )
                          }
                          className="h-9 rounded-lg border border-line px-3 text-sm text-paper transition-colors hover:border-paper/30 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          {user.disabled ? "Enable" : "Disable"}
                        </button>
                        <button
                          type="button"
                          disabled={pending || mine}
                          onClick={() => {
                            if (!window.confirm(`Delete ${user.email}?`)) {
                              return;
                            }
                            void run(() => send(`/api/users/${user.id}`, "DELETE"), "Account deleted.");
                          }}
                          className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-danger/50 px-3 text-sm text-danger transition-colors hover:bg-danger/10 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          <IconSvg>
                            <path d="M4 7h16" />
                            <path d="M9 7V5.5h6V7" />
                            <path d="M8 7l.7 12h6.6L16 7" />
                          </IconSvg>
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        ) : (
        <div role="tabpanel" id="invites-panel" aria-labelledby="invites-tab" className="px-5 py-5 sm:px-6">
        {invites.length === 0 ? (
          <p className="text-sm text-mist">No invites are waiting.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {invites.map((invite) => (
              <li
                key={invite.id}
                className="flex flex-col gap-3 rounded-lg border border-line/80 px-3 py-3 sm:flex-row sm:items-center"
              >
                <UserAvatar name={invite.displayName} email={invite.email} />
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-paper">{invite.displayName || invite.email}</p>
                  <p className="truncate text-sm text-mist">
                    {invite.email} · {invite.role === "admin" ? "Admin" : "Guest"} · expires{" "}
                    {invite.expiresLabel} IST
                  </p>
                </div>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() =>
                    void run(() => send(`/api/users/invites/${invite.id}`, "DELETE"), "Invite revoked.")
                  }
                  className="h-9 self-start rounded-lg border border-line px-3 text-sm text-paper transition-colors hover:border-paper/30 disabled:cursor-not-allowed disabled:opacity-40 sm:self-center"
                >
                  Revoke
                </button>
              </li>
            ))}
          </ul>
        )}
        </div>
        )}
      </section>
    </div>
  );
}
