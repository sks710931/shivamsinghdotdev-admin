import "server-only";

import { createHash, randomBytes, randomUUID } from "node:crypto";

import { cookies } from "next/headers";
import { connection } from "next/server";

import type { UserRole } from "@/lib/directory";
import { SESSION_COOKIE } from "@/lib/session-cookie";
import { AuthError } from "@/server/auth-error";
import { query, sql } from "@/server/db";
import { hashPassword, verifyPassword } from "@/server/password";

const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const MAX_LOGIN_FAILURES = 8;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type { UserRole };

export type AdminUser = {
  id: string;
  email: string;
  role: UserRole;
  displayName: string | null;
};

type AttemptBucket = {
  failures: number;
  resetAt: number;
};

const attempts = new Map<string, AttemptBucket>();

let schemaReady: Promise<void> | undefined;
let dummyPasswordHash: Promise<string> | undefined;

function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function field(row: Record<string, unknown>, name: string): unknown {
  if (name in row) {
    return row[name];
  }

  const match = Object.keys(row).find((key) => key.toLowerCase() === name.toLowerCase());
  return match ? row[match] : undefined;
}

function assertLoginAllowed(clientKey: string): void {
  const bucket = attempts.get(clientKey);
  if (!bucket || bucket.resetAt <= Date.now()) {
    return;
  }

  if (bucket.failures >= MAX_LOGIN_FAILURES) {
    throw new AuthError("Too many attempts. Try again later.", 429);
  }
}

function recordLoginFailure(clientKey: string): void {
  const now = Date.now();
  const bucket = attempts.get(clientKey);
  if (!bucket || bucket.resetAt <= now) {
    attempts.set(clientKey, { failures: 1, resetAt: now + LOGIN_WINDOW_MS });
    return;
  }

  bucket.failures += 1;
}

function clearLoginFailures(clientKey: string): void {
  attempts.delete(clientKey);
}

async function rejectPassword(password: string): Promise<never> {
  dummyPasswordHash ??= hashPassword(randomBytes(32).toString("base64url"));
  await verifyPassword(password, await dummyPasswordHash);
  throw new AuthError("Invalid email or password.", 401);
}

function sessionCookie(expires: Date) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    expires,
  };
}

/** Schema comes from db/migrations. This only bootstraps the first admin from env (needs INSERT, not DDL). */
async function bootstrapFirstAdmin(): Promise<void> {

  const existing = await query<Record<string, unknown>>(
    "SELECT COUNT(*) AS total FROM dbo.AdminUser",
  );
  const total = Number(field(existing.recordset[0] ?? {}, "total") ?? 0);
  if (total > 0) {
    return;
  }

  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD ?? "";
  if (!email || !EMAIL_PATTERN.test(email) || password.length < 12) {
    console.error(
      "No admin user exists. Set ADMIN_EMAIL and an ADMIN_PASSWORD of at least 12 characters.",
    );
    return;
  }

  const passwordHash = await hashPassword(password);
  await query(
    `INSERT INTO dbo.AdminUser (Id, Email, PasswordHash, Role, Disabled)
     VALUES (@id, @email, @passwordHash, 'admin', 0)`,
    (request) => {
      request.input("id", sql.UniqueIdentifier, randomUUID());
      request.input("email", sql.NVarChar(320), email);
      request.input("passwordHash", sql.NVarChar(500), passwordHash);
    },
  );
}

export function ensureAuthSchema(): Promise<void> {
  schemaReady ??= bootstrapFirstAdmin().catch((error: unknown) => {
    schemaReady = undefined;
    throw error;
  });
  return schemaReady;
}

function readCredentials(emailInput: string, passwordInput: string): { email: string; password: string } {
  const email = emailInput.trim().toLowerCase();
  const password = passwordInput;
  if (!email || !password) {
    throw new AuthError("Enter your email and password.", 400);
  }
  if (!EMAIL_PATTERN.test(email) || email.length > 320) {
    throw new AuthError("Enter a valid email.", 400);
  }
  if (password.length > 200) {
    throw new AuthError("Invalid email or password.", 401);
  }
  return { email, password };
}

export async function login(input: {
  email: string;
  password: string;
  clientKey: string;
}): Promise<AdminUser> {
  await ensureAuthSchema();
  assertLoginAllowed(input.clientKey);
  const credentials = readCredentials(input.email, input.password);

  const found = await query<Record<string, unknown>>(
    `SELECT Id AS id, PasswordHash AS passwordHash, Role AS role, Disabled AS disabled, DisplayName AS displayName
     FROM dbo.AdminUser
     WHERE Email = @email`,
    (request) => {
      request.input("email", sql.NVarChar(320), credentials.email);
    },
  );
  const row = found.recordset[0];
  const userId = row ? String(field(row, "id") ?? "") : "";
  const passwordHash = row ? String(field(row, "passwordHash") ?? "") : "";
  if (!row || !userId || !passwordHash) {
    recordLoginFailure(input.clientKey);
    await rejectPassword(credentials.password);
  }

  const matches = await verifyPassword(credentials.password, passwordHash);
  if (!matches) {
    recordLoginFailure(input.clientKey);
    throw new AuthError("Invalid email or password.", 401);
  }

  if (isDisabled(field(row, "disabled"))) {
    throw new AuthError("This account is disabled.", 403);
  }

  clearLoginFailures(input.clientKey);
  await startSession(userId);
  return {
    id: userId,
    email: credentials.email,
    role: readRole(field(row, "role")),
    displayName: readName(field(row, "displayName")),
  };
}

export async function startSession(userId: string): Promise<void> {
  await query("DELETE FROM dbo.AdminSession WHERE ExpiresAt <= SYSUTCDATETIME()");
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await query(
    `INSERT INTO dbo.AdminSession (Id, UserId, TokenHash, ExpiresAt)
     VALUES (@id, @userId, @tokenHash, @expiresAt)`,
    (request) => {
      request.input("id", sql.UniqueIdentifier, randomUUID());
      request.input("userId", sql.UniqueIdentifier, userId);
      request.input("tokenHash", sql.VarChar(64), hashSessionToken(token));
      request.input("expiresAt", sql.DateTimeOffset, expiresAt);
    },
  );

  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, token, sessionCookie(expiresAt));
}

export async function logout(): Promise<void> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (token) {
    await ensureAuthSchema();
    await query(
      "DELETE FROM dbo.AdminSession WHERE TokenHash = @tokenHash",
      (request) => {
        request.input("tokenHash", sql.VarChar(64), hashSessionToken(token));
      },
    );
  }

  cookieStore.set(SESSION_COOKIE, "", sessionCookie(new Date(0)));
}

export async function getCurrentUser(): Promise<AdminUser | null> {
  await connection();
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token || token.length > 200) {
    return null;
  }

  await ensureAuthSchema();
  const result = await query<Record<string, unknown>>(
    `SELECT u.Id AS id, u.Email AS email, u.Role AS role, u.DisplayName AS displayName
     FROM dbo.AdminSession AS s
     INNER JOIN dbo.AdminUser AS u ON u.Id = s.UserId
     WHERE s.TokenHash = @tokenHash
       AND s.ExpiresAt > SYSUTCDATETIME()
       AND u.Disabled = 0`,
    (request) => {
      request.input("tokenHash", sql.VarChar(64), hashSessionToken(token));
    },
  );
  const row = result.recordset[0];
  const id = row ? String(field(row, "id") ?? "") : "";
  const email = row ? String(field(row, "email") ?? "") : "";
  if (!id || !email) {
    return null;
  }

  return {
    id,
    email,
    role: readRole(field(row, "role")),
    displayName: readName(field(row, "displayName")),
  };
}

export async function requireUser(): Promise<AdminUser> {
  const user = await getCurrentUser();
  if (!user) {
    throw new AuthError("Sign in required.", 401);
  }
  return user;
}

export async function requireAdmin(): Promise<AdminUser> {
  const user = await getCurrentUser();
  if (!user) {
    throw new AuthError("Sign in required.", 401);
  }
  if (user.role !== "admin") {
    throw new AuthError("You do not have access to users.", 403);
  }
  return user;
}

export function readRole(value: unknown): UserRole {
  return value === "admin" ? "admin" : "guest";
}

function readName(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const name = value.trim();
  return name || null;
}

function isDisabled(value: unknown): boolean {
  return value === true || value === 1;
}
