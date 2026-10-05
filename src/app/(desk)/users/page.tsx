import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { getCurrentUser } from "@/server/auth";
import { listDirectory } from "@/server/users";
import { UsersPanel } from "./users-panel";

const expiryFormat = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Kolkata",
});

function formatExpiry(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return expiryFormat.format(date);
}

export const metadata: Metadata = {
  title: "Users",
};

export default async function UsersPage() {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }
  if (user.role !== "admin") {
    redirect("/");
  }

  const directory = await listDirectory();

  return (
    <UsersPanel
      currentUserId={user.id}
      users={directory.users}
      invites={directory.invites.map((invite) => ({
        ...invite,
        expiresLabel: formatExpiry(invite.expiresAt),
      }))}
    />
  );
}
