import type { Metadata } from "next";

import { DeskFrame } from "@/components/desk-frame";
import { previewInvite } from "@/server/users";
import { AcceptForm } from "./accept-form";

export const metadata: Metadata = {
  title: "Accept invite",
};

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const invite = await previewInvite(token);

  return (
    <DeskFrame>
      <section className="mx-auto flex w-full max-w-lg flex-1 flex-col justify-center">
        <p className="font-mono text-xs tracking-[0.22em] text-accent uppercase">Invite</p>
        {invite ? (
          <>
            <h1 className="font-display mt-4 text-5xl leading-none font-medium">
              Join the desk.
            </h1>
            <p className="mt-4 text-mist">
              You are invited as {invite.role === "admin" ? "an admin" : "a guest"}. Choose a
              password of at least 12 characters.
            </p>
            <div className="mt-8 border border-line bg-panel/90 p-6">
              <AcceptForm token={token} email={invite.email} displayName={invite.displayName} />
            </div>
          </>
        ) : (
          <>
            <h1 className="font-display mt-4 text-5xl leading-none font-medium">
              This invite is closed.
            </h1>
            <p className="mt-4 text-mist">
              The link is invalid, expired, or already used. Ask an admin to send a new one.
            </p>
          </>
        )}
      </section>
    </DeskFrame>
  );
}
