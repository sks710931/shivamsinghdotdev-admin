import "server-only";

import sql, {
  type config as MssqlConfig,
  type IResult,
  type Request,
} from "mssql";

export { sql };

const POOL_MAX = 10;
const POOL_IDLE_MS = 30_000;
const TIMEOUT_MS = 30_000;

const globalForDb = globalThis as typeof globalThis & {
  __adminMssqlPool?: sql.ConnectionPool;
  __adminMssqlConnecting?: Promise<sql.ConnectionPool>;
};

function readBoolean(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") {
    return fallback;
  }

  switch (raw.trim().toLowerCase()) {
    case "1":
    case "true":
    case "yes":
      return true;
    case "0":
    case "false":
    case "no":
      return false;
    default:
      throw new Error(`${name} must be true or false.`);
  }
}

function readPort(): number | undefined {
  const raw = process.env.DB_PORT?.trim();
  if (!raw) {
    return undefined;
  }

  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("DB_PORT must be an integer from 1 to 65535.");
  }

  return port;
}

function missingConfigError(): Error {
  return new Error(
    "Database is not configured. Set DATABASE_URL, or set DB_SERVER, DB_DATABASE, DB_USER, and DB_PASSWORD.",
  );
}

/**
 * DATABASE_URL accepts an ADO.NET connection string from Azure SQL or local
 * SQL Server. When it is empty, the DB_* variables are used instead.
 * Encryption defaults on. Trust the server certificate only for local dev.
 */
export function resolveDbConfig(): MssqlConfig {
  const connectionString = process.env.DATABASE_URL?.trim();
  if (connectionString) {
    let parsed: MssqlConfig;
    try {
      parsed = sql.ConnectionPool.parseConnectionString(connectionString);
    } catch {
      throw new Error("DATABASE_URL is not a valid SQL Server connection string.");
    }

    return {
      ...parsed,
      connectionTimeout: parsed.connectionTimeout ?? TIMEOUT_MS,
      requestTimeout: parsed.requestTimeout ?? TIMEOUT_MS,
      pool: {
        max: POOL_MAX,
        min: 0,
        idleTimeoutMillis: POOL_IDLE_MS,
        ...parsed.pool,
      },
      options: {
        ...parsed.options,
        encrypt: parsed.options?.encrypt ?? true,
        trustServerCertificate: parsed.options?.trustServerCertificate ?? false,
      },
    };
  }

  const server = process.env.DB_SERVER?.trim();
  const database = process.env.DB_DATABASE?.trim();
  const user = process.env.DB_USER?.trim();
  const password = process.env.DB_PASSWORD;
  if (!server || !database || !user || !password) {
    throw missingConfigError();
  }

  return {
    server,
    port: readPort(),
    database,
    user,
    password,
    connectionTimeout: TIMEOUT_MS,
    requestTimeout: TIMEOUT_MS,
    pool: {
      max: POOL_MAX,
      min: 0,
      idleTimeoutMillis: POOL_IDLE_MS,
    },
    options: {
      encrypt: readBoolean("DB_ENCRYPT", true),
      trustServerCertificate: readBoolean("DB_TRUST_SERVER_CERTIFICATE", false),
    },
  };
}

export async function getPool(): Promise<sql.ConnectionPool> {
  if (globalForDb.__adminMssqlPool?.connected) {
    return globalForDb.__adminMssqlPool;
  }

  if (!globalForDb.__adminMssqlConnecting) {
    const pool = new sql.ConnectionPool(resolveDbConfig());
    pool.on("error", (error: Error) => {
      const code = "code" in error ? String(error.code) : error.name;
      console.error(`SQL Server pool error: ${code}`);
      if (globalForDb.__adminMssqlPool === pool) {
        globalForDb.__adminMssqlPool = undefined;
        globalForDb.__adminMssqlConnecting = undefined;
      }
    });

    globalForDb.__adminMssqlConnecting = pool
      .connect()
      .then((connected) => {
        globalForDb.__adminMssqlPool = connected;
        return connected;
      })
      .catch((error: unknown) => {
        globalForDb.__adminMssqlPool = undefined;
        globalForDb.__adminMssqlConnecting = undefined;
        throw error;
      });
  }

  return globalForDb.__adminMssqlConnecting;
}

export async function withTransaction<T>(
  run: (transaction: sql.Transaction) => Promise<T>,
): Promise<T> {
  const pool = await getPool();
  const transaction = new sql.Transaction(pool);
  await transaction.begin();
  try {
    const result = await run(transaction);
    await transaction.commit();
    return result;
  } catch (error) {
    try {
      await transaction.rollback();
    } catch {
      // The transaction is already closed.
    }
    throw error;
  }
}

/** Run a parameterized query. Bind inputs on the request; do not interpolate SQL. */
export async function query<T>(
  statement: string,
  bind?: (request: Request) => void,
): Promise<IResult<T>> {
  const pool = await getPool();
  const request = pool.request();
  bind?.(request);
  return request.query<T>(statement);
}

export async function checkConnection(): Promise<{ ok: true }> {
  const result = await query<{ ok: number }>("SELECT 1 AS ok");
  if (result.recordset[0]?.ok !== 1) {
    throw new Error("Database connectivity check returned an unexpected result.");
  }
  return { ok: true };
}

export async function closePool(): Promise<void> {
  const connecting = globalForDb.__adminMssqlConnecting;
  globalForDb.__adminMssqlPool = undefined;
  globalForDb.__adminMssqlConnecting = undefined;
  if (!connecting) {
    return;
  }

  try {
    const pool = await connecting;
    await pool.close();
  } catch {
    // The pool never opened, so there is nothing to close.
  }
}
