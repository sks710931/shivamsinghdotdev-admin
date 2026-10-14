// @vitest-environment node
import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";

const dir = path.resolve(process.cwd(), "db/migrations");

const seedPattern =
  /\b(INSERT|MERGE)\s+(INTO\s+)?(\[?dbo\]?\.)?\[?(AdminUser|UserInvite|AdminSession|Users?)\]?/i;
const hashPattern = /\$2[aby]\$\d{2}\$|\$argon2(id|i|d)\$|\$scrypt\$/i;

function stripSqlComments(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, "").replace(/--[^\r\n]*/g, "");
}

describe("db/migrations SQL files do not seed admin data or password hashes", () => {
  it("db/migrations directory exists and contains sql migration files", () => {
    expect(fs.existsSync(dir), "db/migrations directory must exist").toBe(true);
    const sqlFiles = fs.readdirSync(dir).filter((name) => name.endsWith(".sql"));
    expect(sqlFiles.length, "db/migrations must contain at least one .sql file").toBeGreaterThan(0);
  });

  const files = fs.existsSync(dir)
    ? fs
        .readdirSync(dir)
        .filter((name) => name.endsWith(".sql"))
        .sort()
    : [];

  for (const file of files) {
    it(file, () => {
      const sql = stripSqlComments(
        fs.readFileSync(path.join(dir, file), "utf8"),
      );
      expect(
        sql,
        `${file} must not INSERT or MERGE into users or admin tables`,
      ).not.toMatch(seedPattern);
      expect(sql, `${file} must not contain a password hash`).not.toMatch(
        hashPattern,
      );
    });
  }
});
