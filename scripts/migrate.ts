import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

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

loadEnvFile(".env", false);
loadEnvFile(".env.local", true);

const { resolveDbConfig, sql } = await import("../src/server/db.ts");

const MIGRATIONS_DIR = resolve(process.cwd(), "db/migrations");
const VERSION_LENGTH = 200;

function migrationNames(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith(".sql"))
    .sort((left, right) => left.localeCompare(right, "en"));
}

function readVersion(row: Record<string, unknown>): string {
  if (typeof row.Version === "string") {
    return row.Version;
  }

  const key = Object.keys(row).find((name) => name.toLowerCase() === "version");
  const value = key ? row[key] : undefined;
  return typeof value === "string" ? value : "";
}

function describeError(error: unknown): string {
  if (!(error instanceof Error)) {
    return "Migration failed.";
  }

  const sqlNumber =
    "number" in error && typeof error.number === "number" ? ` (${error.number})` : "";
  return `${error.message}${sqlNumber}`;
}

async function ensureSchemaVersion(pool: InstanceType<typeof sql.ConnectionPool>): Promise<void> {
  await pool.request().query(`
    IF OBJECT_ID(N'dbo.SchemaVersion', N'U') IS NULL
    BEGIN
      CREATE TABLE dbo.SchemaVersion (
        Version nvarchar(${VERSION_LENGTH}) NOT NULL CONSTRAINT PK_SchemaVersion PRIMARY KEY,
        AppliedAt datetimeoffset NOT NULL CONSTRAINT DF_SchemaVersion_AppliedAt DEFAULT SYSUTCDATETIME()
      );
    END
  `);
}

async function appliedVersions(pool: InstanceType<typeof sql.ConnectionPool>): Promise<Set<string>> {
  const result = await pool.request().query<Record<string, unknown>>(
    "SELECT Version FROM dbo.SchemaVersion",
  );
  const versions = new Set<string>();
  for (const row of result.recordset) {
    const version = readVersion(row);
    if (version) {
      versions.add(version);
    }
  }
  return versions;
}

async function applyMigration(
  pool: InstanceType<typeof sql.ConnectionPool>,
  name: string,
  body: string,
): Promise<void> {
  const transaction = new sql.Transaction(pool);
  await transaction.begin();
  try {
    await new sql.Request(transaction).query(`SET XACT_ABORT ON;\n${body}`);
    const insert = new sql.Request(transaction);
    insert.input("version", sql.NVarChar(VERSION_LENGTH), name);
    await insert.query("INSERT INTO dbo.SchemaVersion (Version) VALUES (@version)");
    await transaction.commit();
  } catch (error) {
    try {
      await transaction.rollback();
    } catch {
      // The transaction is already closed.
    }
    throw error;
  }
}

let pool: InstanceType<typeof sql.ConnectionPool> | undefined;

try {
  pool = new sql.ConnectionPool(resolveDbConfig());
  await pool.connect();
  await ensureSchemaVersion(pool);

  const applied = await appliedVersions(pool);
  let pending = 0;

  for (const name of migrationNames()) {
    if (name.length > VERSION_LENGTH) {
      throw new Error(`Migration name is longer than ${VERSION_LENGTH} characters: ${name}`);
    }

    if (applied.has(name)) {
      console.log(`Skipping ${name} (already applied).`);
      continue;
    }

    const body = readFileSync(resolve(MIGRATIONS_DIR, name), "utf8").replace(/^\uFEFF/, "");
    if (body.trim().length === 0) {
      throw new Error(`Migration ${name} is empty.`);
    }

    pending += 1;
    console.log(`Applying ${name}`);
    try {
      await applyMigration(pool, name, body);
    } catch (error) {
      throw new Error(`Migration ${name} failed: ${describeError(error)}`, { cause: error });
    }
    console.log(`Applied ${name}`);
  }

  if (pending === 0) {
    console.log("No pending migrations.");
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
