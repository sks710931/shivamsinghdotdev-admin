import "server-only";

import { readFileSync } from "node:fs";
import { join } from "node:path";

const templatePath = join(process.cwd(), "src/server/emails/invite.html");

let cachedTemplate: string | undefined;

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function template(): string {
  cachedTemplate ??= readFileSync(templatePath, "utf8");
  return cachedTemplate;
}

export function renderInviteEmail(input: {
  name: string;
  roleLabel: string;
  acceptUrl: string;
}): string {
  return template()
    .replaceAll("{{name}}", escapeHtml(input.name))
    .replaceAll("{{role}}", escapeHtml(input.roleLabel))
    .replaceAll("{{acceptUrl}}", escapeHtml(input.acceptUrl))
    .replaceAll("{{year}}", String(new Date().getFullYear()));
}
