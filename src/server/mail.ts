import "server-only";

import { SendMailClient } from "zeptomail";

import { AuthError } from "@/server/auth-error";
import { renderInviteEmail } from "@/server/emails/render-invite";

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new AuthError("Email is not configured.", 500);
  }
  return value;
}

export async function sendInviteEmail(input: {
  to: string;
  name: string;
  roleLabel: string;
  acceptUrl: string;
}): Promise<void> {
  const token = required("ZEPTOMAIL_TOKEN");
  const fromAddress = required("ZEPTOMAIL_FROM_ADDRESS");
  if (!fromAddress.includes("@") || fromAddress.startsWith("@")) {
    throw new AuthError("ZEPTOMAIL_FROM_ADDRESS must be a full email address.", 500);
  }

  const fromName = process.env.ZEPTOMAIL_FROM_NAME?.trim() || "noreply";
  const url = process.env.ZEPTOMAIL_URL?.trim() || "https://cpaas.zoho.in/v1.1/email";
  const client = new SendMailClient({ url, token });

  try {
    await client.sendMail({
      from: { address: fromAddress, name: fromName },
      to: [{ email_address: { address: input.to, name: input.name } }],
      subject: "You're invited to the blog desk",
      track_clicks: false,
      track_opens: false,
      htmlbody: renderInviteEmail({
        name: input.name,
        roleLabel: input.roleLabel,
        acceptUrl: input.acceptUrl,
      }),
    });
  } catch (error) {
    console.error("Invite email failed", error instanceof Error ? error.name : "error");
    throw new AuthError("The invite email could not be sent.", 502);
  }
}
