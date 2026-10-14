// @vitest-environment node
import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";

const dir = path.resolve(process.cwd(), "db/migrations");

const seedPattern =
  /\b(INSERT|MERGE)\s+(INTO\s+)?(\[?dbo\]?\.)?\[?(AdminUser|UserInvite|AdminSession)\]?/i;
const hashPattern = /\$2[aby]\$\d{2}\$|\$argon2(id|i|d)\$|\$scrypt\$/;

function stripSqlComments(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, "").replace(/--[^\r\n]*/g, "");
}

if (!fs.existsSync(dir)) {
  describe.skip("db/migrations SQL files do not seed admin data or password hashes", () => {});
} else {
  const files = fs
    .readdirSync(dir)
    .filter((name) => name.endsWith(".sql"))
    .sort();

  describe("db/migrations SQL files do not seed admin data or password hashes", () => {
    for (const file of files) {
      it(file, () => {
        const sql = stripSqlComments(
          fs.readFileSync(path.join(dir, file), "utf8"),
        );
        expect(
          sql,
          `${file} must not INSERT or MERGE into AdminUser, UserInvite, or AdminSession`,
        ).not.toMatch(seedPattern);
        expect(sql, `${file} must not contain a password hash`).not.toMatch(
          hashPattern,
        );
      });
    }
  });
}
