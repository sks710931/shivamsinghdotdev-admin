import { readFileSync } from "node:fs";
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

const { checkConnection } = await import("../src/server/db.ts");

checkConnection()
  .then(() => {
    console.log("Connected to SQL Server.");
  })
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "Database check failed.";
    console.error(message);
    process.exitCode = 1;
  });
