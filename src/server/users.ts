import "server-only";

import { createHash, randomBytes, randomUUID } from "node:crypto";

import { AuthError } from "@/server/auth-error";
import type { DirectoryUser, PendingInvite, UserRole } from "@/lib/directory";
import { ensureAuthSchema, readRole, startSession } from "@/server/auth";
import { query, sql, withTransaction } from "@/server/db";
import { sendInviteEmail } from "@/server/mail";
import { hashPassword } from "@/server/password";

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type { DirectoryUser, PendingInvite };

function field(row: Record<string, unknown>, name: string): unknown {
  if (name in row) {
    return row[name];
  }
  const match = Object.keys(row).find((key) => key.toLowerCase() === name.toLowerCase());
  return match ? row[match] : undefined;
}

function text(value: unknown): string {
  return typeof value === "string" ? value : value == null ? "" : String(value);
}

function nameOrNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, 120) : null;
}

function asDate(value: unknown): string {
  if (value instanceof Date) {
    return value.toISOString();
  }
  const date = new Date(text(value));
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

function isDisabled(value: unknown): boolean {
  return value === true || value === 1;
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function normalizeEmail(email: string): string {
  const normalized = email.trim().toLowerCase();
  if (!EMAIL_PATTERN.test(normalized) || normalized.length > 320) {
    throw new AuthError("Enter a valid email.", 400);
  }
  return normalized;
}

function parseRole(role: string): UserRole {
  if (role === "admin" || role === "guest") {
    return role;
  }
  throw new AuthError("Choose an Admin or Guest role.", 400);
}

function roleLabel(role: UserRole): string {
  return role === "admin" ? "Admin" : "Guest";
}

function appBaseUrl(): string {
  const value = process.env.APP_URL?.trim().replace(/\/$/, "");
  if (!value) {
    throw new AuthError("APP_URL is not configured.", 500);
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new AuthError("APP_URL is not a valid URL.", 500);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new AuthError("APP_URL must start with http or https.", 500);
  }
  return url.origin;
}

async function txQuery<T>(
  transaction: sql.Transaction,
  statement: string,
  bind?: (request: sql.Request) => void,
) {
  const request = new sql.Request(transaction);
  bind?.(request);
  return request.query<T>(statement);
}

function mapUser(row: Record<string, unknown>): DirectoryUser {
  return {
    id: text(field(row, "id")),
    email: text(field(row, "email")),
    displayName: nameOrNull(text(field(row, "displayName"))),
    role: readRole(field(row, "role")),
    disabled: isDisabled(field(row, "disabled")),
    createdAt: asDate(field(row, "createdAt")),
  };
}

export async function listDirectory(): Promise<{ users: DirectoryUser[]; invites: PendingInvite[] }> {
  await ensureAuthSchema();
  const users = await query<Record<string, unknown>>(
    `SELECT Id AS id, Email AS email, DisplayName AS displayName, Role AS role, Disabled AS disabled, CreatedAt AS createdAt
     FROM dbo.AdminUser
     ORDER BY CreatedAt`,
  );
  const invites = await query<Record<string, unknown>>(
    `SELECT Id AS id, Email AS email, DisplayName AS displayName, Role AS role, ExpiresAt AS expiresAt, CreatedAt AS createdAt
     FROM dbo.UserInvite
     WHERE AcceptedAt IS NULL AND RevokedAt IS NULL AND ExpiresAt > SYSUTCDATETIME()
     ORDER BY CreatedAt DESC`,
  );

  return {
    users: users.recordset.map(mapUser),
    invites: invites.recordset.map((row) => ({
      id: text(field(row, "id")),
      email: text(field(row, "email")),
      displayName: nameOrNull(text(field(row, "displayName"))),
      role: readRole(field(row, "role")),
      expiresAt: asDate(field(row, "expiresAt")),
      createdAt: asDate(field(row, "createdAt")),
    })),
  };
}

export async function createInvite(input: {
  email: string;
  displayName: string;
  role: string;
  invitedBy: string;
}): Promise<PendingInvite> {
  await ensureAuthSchema();
  const email = normalizeEmail(input.email);
  const role = parseRole(input.role);
  const displayName = nameOrNull(input.displayName);
  const existing = await query<Record<string, unknown>>(
    "SELECT Id AS id FROM dbo.AdminUser WHERE Email = @email",
    (request) => {
      request.input("email", sql.NVarChar(320), email);
    },
  );
  if (existing.recordset[0]) {
    throw new AuthError("That email already has an account.", 409);
  }

  const token = randomBytes(32).toString("base64url");
  const id = randomUUID();
  const expiresAt = new Date(Date.now() + INVITE_TTL_MS);
  await query(
    `UPDATE dbo.UserInvite
     SET RevokedAt = SYSUTCDATETIME()
     WHERE Email = @email AND AcceptedAt IS NULL AND RevokedAt IS NULL`,
    (request) => {
      request.input("email", sql.NVarChar(320), email);
    },
  );
  await query(
    `INSERT INTO dbo.UserInvite (Id, Email, DisplayName, Role, TokenHash, ExpiresAt, InvitedBy)
     VALUES (@id, @email, @displayName, @role, @tokenHash, @expiresAt, @invitedBy)`,
    (request) => {
      request.input("id", sql.UniqueIdentifier, id);
      request.input("email", sql.NVarChar(320), email);
      request.input("displayName", sql.NVarChar(120), displayName);
      request.input("role", sql.VarChar(20), role);
      request.input("tokenHash", sql.VarChar(64), hashToken(token));
      request.input("expiresAt", sql.DateTimeOffset, expiresAt);
      request.input("invitedBy", sql.UniqueIdentifier, input.invitedBy);
    },
  );

  try {
    await sendInviteEmail({
      to: email,
      name: displayName || email,
      roleLabel: roleLabel(role),
      acceptUrl: `${appBaseUrl()}/invite/${token}`,
    });
  } catch (error) {
    await query("DELETE FROM dbo.UserInvite WHERE Id = @id", (request) => {
      request.input("id", sql.UniqueIdentifier, id);
    });
    throw error;
  }

  return {
    id,
    email,
    displayName,
    role,
    expiresAt: expiresAt.toISOString(),
    createdAt: new Date().toISOString(),
  };
}

export async function revokeInvite(id: string): Promise<void> {
  await ensureAuthSchema();
  const result = await query(
    `UPDATE dbo.UserInvite
     SET RevokedAt = SYSUTCDATETIME()
     WHERE Id = @id AND AcceptedAt IS NULL AND RevokedAt IS NULL`,
    (request) => {
      request.input("id", sql.UniqueIdentifier, id);
    },
  );
  if ((result.rowsAffected[0] ?? 0) === 0) {
    throw new AuthError("That invite is no longer pending.", 404);
  }
}

async function assertCanChange(actorId: string, userId: string, nextDisabled: boolean | null): Promise<void> {
  if (actorId === userId) {
    throw new AuthError("You cannot change your own account here.", 400);
  }

  const target = await query<Record<string, unknown>>(
    "SELECT Role AS role, Disabled AS disabled FROM dbo.AdminUser WHERE Id = @id",
    (request) => {
      request.input("id", sql.UniqueIdentifier, userId);
    },
  );
  const row = target.recordset[0];
  if (!row) {
    throw new AuthError("That user was not found.", 404);
  }

  const removingAdmin =
    readRole(field(row, "role")) === "admin" &&
    !isDisabled(field(row, "disabled")) &&
    nextDisabled !== false;
  if (!removingAdmin) {
    return;
  }

  const others = await query<Record<string, unknown>>(
    `SELECT COUNT(*) AS total
     FROM dbo.AdminUser
     WHERE Role = 'admin' AND Disabled = 0 AND Id <> @id`,
    (request) => {
      request.input("id", sql.UniqueIdentifier, userId);
    },
  );
  if (Number(field(others.recordset[0] ?? {}, "total") ?? 0) === 0) {
    throw new AuthError("Keep at least one active admin.", 400);
  }
}

export async function setUserDisabled(actorId: string, userId: string, disabled: boolean): Promise<void> {
  await ensureAuthSchema();
  await assertCanChange(actorId, userId, disabled);
  const result = await query(
    "UPDATE dbo.AdminUser SET Disabled = @disabled WHERE Id = @id",
    (request) => {
      request.input("id", sql.UniqueIdentifier, userId);
      request.input("disabled", sql.Bit, disabled);
    },
  );
  if ((result.rowsAffected[0] ?? 0) === 0) {
    throw new AuthError("That user was not found.", 404);
  }
  if (disabled) {
    await query("DELETE FROM dbo.AdminSession WHERE UserId = @id", (request) => {
      request.input("id", sql.UniqueIdentifier, userId);
    });
  }
}

export async function deleteUser(actorId: string, userId: string): Promise<void> {
  await ensureAuthSchema();
  await assertCanChange(actorId, userId, null);
  const result = await query("DELETE FROM dbo.AdminUser WHERE Id = @id", (request) => {
    request.input("id", sql.UniqueIdentifier, userId);
  });
  if ((result.rowsAffected[0] ?? 0) === 0) {
    throw new AuthError("That user was not found.", 404);
  }
}

export async function previewInvite(token: string): Promise<{
  email: string;
  displayName: string | null;
  role: UserRole;
} | null> {
  if (!token || token.length > 200) {
    return null;
  }
  await ensureAuthSchema();
  const result = await query<Record<string, unknown>>(
    `SELECT Email AS email, DisplayName AS displayName, Role AS role
     FROM dbo.UserInvite
     WHERE TokenHash = @tokenHash
       AND AcceptedAt IS NULL
       AND RevokedAt IS NULL
       AND ExpiresAt > SYSUTCDATETIME()`,
    (request) => {
      request.input("tokenHash", sql.VarChar(64), hashToken(token));
    },
  );
  const row = result.recordset[0];
  if (!row) {
    return null;
  }
  return {
    email: text(field(row, "email")),
    displayName: nameOrNull(text(field(row, "displayName"))),
    role: readRole(field(row, "role")),
  };
}

export async function acceptInvite(input: {
  token: string;
  password: string;
  displayName: string;
}): Promise<{ id: string; email: string; role: UserRole; displayName: string | null }> {
  if (!input.token || input.token.length > 200) {
    throw new AuthError("This invite is no longer valid.", 400);
  }
  if (input.password.length < 12 || input.password.length > 200) {
    throw new AuthError("Use a password of at least 12 characters.", 400);
  }

  const passwordHash = await hashPassword(input.password);
  const created = await withTransaction(async (transaction) => {
    const found = await txQuery<Record<string, unknown>>(
      transaction,
      `SELECT Id AS id, Email AS email, DisplayName AS displayName, Role AS role
       FROM dbo.UserInvite WITH (UPDLOCK, ROWLOCK)
       WHERE TokenHash = @tokenHash
         AND AcceptedAt IS NULL
         AND RevokedAt IS NULL
         AND ExpiresAt > SYSUTCDATETIME()`,
      (request) => {
        request.input("tokenHash", sql.VarChar(64), hashToken(input.token));
      },
    );
    const invite = found.recordset[0];
    if (!invite) {
      throw new AuthError("This invite is no longer valid.", 400);
    }

    const email = text(field(invite, "email"));
    const displayName = nameOrNull(input.displayName) ?? nameOrNull(text(field(invite, "displayName")));
    const role = readRole(field(invite, "role"));
    const taken = await txQuery<Record<string, unknown>>(
      transaction,
      "SELECT Id AS id FROM dbo.AdminUser WHERE Email = @email",
      (request) => {
        request.input("email", sql.NVarChar(320), email);
      },
    );
    if (taken.recordset[0]) {
      throw new AuthError("That email already has an account.", 409);
    }

    const userId = randomUUID();
    await txQuery(
      transaction,
      `INSERT INTO dbo.AdminUser (Id, Email, PasswordHash, Role, Disabled, DisplayName)
       VALUES (@id, @email, @passwordHash, @role, 0, @displayName)`,
      (request) => {
        request.input("id", sql.UniqueIdentifier, userId);
        request.input("email", sql.NVarChar(320), email);
        request.input("passwordHash", sql.NVarChar(500), passwordHash);
        request.input("role", sql.VarChar(20), role);
        request.input("displayName", sql.NVarChar(120), displayName);
      },
    );
    const updated = await txQuery(
      transaction,
      `UPDATE dbo.UserInvite
       SET AcceptedAt = SYSUTCDATETIME()
       WHERE Id = @id AND AcceptedAt IS NULL`,
      (request) => {
        request.input("id", sql.UniqueIdentifier, text(field(invite, "id")));
      },
    );
    if ((updated.rowsAffected[0] ?? 0) === 0) {
      throw new AuthError("This invite is no longer valid.", 400);
    }

    return { id: userId, email, role, displayName };
  });

  await startSession(created.id);
  return created;
}
