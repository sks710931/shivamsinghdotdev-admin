import { randomBytes, randomUUID } from "node:crypto";
import { appendFileSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const GUEST_EMAIL = "guest@localhost.test";

function loadEnvFile(filename: string, override: boolean) {
  let text: string;
  try {
    text = readFileSync(resolve(process.cwd(), filename), "utf8");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return;
    }
    throw error;
  }

  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separator = trimmed.indexOf("=");
    if (separator === -1) {
      continue;
    }

    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if (
      (value.startsWith("\"") && value.endsWith("\"")) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (override || process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

function isLocalDbServer(value: string | undefined): boolean {
  const server = value?.trim() ?? "";
  return server === "localhost" || server === "127.0.0.1";
}

function describeError(error: unknown): string {
  if (!(error instanceof Error)) {
    return "Seed failed.";
  }

  const sqlNumber =
    "number" in error && typeof error.number === "number" ? ` (${error.number})` : "";
  return `${error.message}${sqlNumber}`;
}

function ensureGuestPassword(): string {
  const existing = process.env.LOCAL_GUEST_PASSWORD;
  if (existing !== undefined && existing.length > 0) {
    return existing;
  }

  const generated = randomBytes(24).toString("base64url");
  const path = resolve(process.cwd(), ".env.local");
  let prefix = "";
  try {
    const text = readFileSync(path, "utf8");
    if (text.length > 0 && !text.endsWith("\n")) {
      prefix = "\n";
    }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") {
      throw error;
    }
  }

  appendFileSync(path, `${prefix}LOCAL_GUEST_PASSWORD=${generated}\n`, "utf8");
  process.env.LOCAL_GUEST_PASSWORD = generated;
  console.log("Wrote LOCAL_GUEST_PASSWORD to .env.local.");
  return generated;
}

loadEnvFile(".env", false);
loadEnvFile(".env.local", true);

if (!isLocalDbServer(process.env.DB_SERVER)) {
  console.error("Refusing to seed: DB_SERVER must be localhost or 127.0.0.1.");
  process.exit(1);
}

const { resolveDbConfig, sql } = await import("../src/server/db.ts");
const { hashPassword } = await import("../src/server/password.ts");

let pool: InstanceType<typeof sql.ConnectionPool> | undefined;

try {
  const dbConfig = resolveDbConfig();
  const resolvedServer = typeof dbConfig.server === "string" ? dbConfig.server : undefined;
  if (!isLocalDbServer(resolvedServer)) {
    throw new Error("Refusing to seed: DB_SERVER must be localhost or 127.0.0.1.");
  }

  const guestPassword = ensureGuestPassword();
  const passwordHash = await hashPassword(guestPassword);
  pool = new sql.ConnectionPool(dbConfig);
  await pool.connect();

  const existing = await pool
    .request()
    .input("email", sql.NVarChar(320), GUEST_EMAIL)
    .query("SELECT Id FROM dbo.AdminUser WHERE Email = @email");

  if (existing.recordset.length > 0) {
    await pool
      .request()
      .input("email", sql.NVarChar(320), GUEST_EMAIL)
      .input("passwordHash", sql.NVarChar(500), passwordHash)
      .query(
        `UPDATE dbo.AdminUser
         SET PasswordHash = @passwordHash, Role = 'guest', Disabled = 0
         WHERE Email = @email`,
      );
  } else {
    await pool
      .request()
      .input("id", sql.UniqueIdentifier, randomUUID())
      .input("email", sql.NVarChar(320), GUEST_EMAIL)
      .input("passwordHash", sql.NVarChar(500), passwordHash)
      .query(
        `INSERT INTO dbo.AdminUser (Id, Email, PasswordHash, Role, Disabled)
         VALUES (@id, @email, @passwordHash, 'guest', 0)`,
      );
  }

  console.log("Upserted guest user guest@localhost.test.");

  const adminEmail = process.env.ADMIN_EMAIL?.trim() ?? "";
  const adminPassword = process.env.ADMIN_PASSWORD ?? "";
  if (adminEmail.length === 0) {
    console.warn("Skipping admin user upsert: ADMIN_EMAIL is missing.");
  } else if (adminPassword.length < 12) {
    console.warn(
      "Skipping admin user upsert: ADMIN_PASSWORD is shorter than 12 characters.",
    );
  } else {
    const adminPasswordHash = await hashPassword(adminPassword);
    const existingAdmin = await pool
      .request()
      .input("email", sql.NVarChar(320), adminEmail)
      .query("SELECT Id FROM dbo.AdminUser WHERE Email = @email");

    if (existingAdmin.recordset.length > 0) {
      await pool
        .request()
        .input("email", sql.NVarChar(320), adminEmail)
        .input("passwordHash", sql.NVarChar(500), adminPasswordHash)
        .query(
          `UPDATE dbo.AdminUser
           SET PasswordHash = @passwordHash, Role = 'admin', Disabled = 0
           WHERE Email = @email`,
        );
    } else {
      await pool
        .request()
        .input("id", sql.UniqueIdentifier, randomUUID())
        .input("email", sql.NVarChar(320), adminEmail)
        .input("passwordHash", sql.NVarChar(500), adminPasswordHash)
        .query(
          `INSERT INTO dbo.AdminUser (Id, Email, PasswordHash, Role, Disabled)
           VALUES (@id, @email, @passwordHash, 'admin', 0)`,
        );
    }

    console.log(`Upserted admin user ${adminEmail}.`);
  }
} catch (error: unknown) {
  console.error(describeError(error));
  process.exitCode = 1;
} finally {
  if (pool) {
    try {
      await pool.close();
    } catch {
      // The pool is already closed.
    }
  }
}
