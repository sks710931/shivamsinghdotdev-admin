// @vitest-environment node
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROUTE_FILES = [
  "src/app/api/posts/[id]/route.ts",
  "src/app/api/posts/[id]/publish/route.ts",
  "src/app/api/posts/[id]/unpublish/route.ts",
  "src/app/api/posts/[id]/archive/route.ts",
  "src/app/api/posts/[id]/revision/route.ts",
  "src/app/api/posts/[id]/revision/publish/route.ts",
] as const;

const HANDLER_PATTERN =
  /export\s+(async\s+)?function\s+(PATCH|POST|PUT|DELETE)\s*\(([\s\S]*?)\n\}/g;

describe("mutation handlers call assertSameOrigin before requireUser", () => {
  for (const relativePath of ROUTE_FILES) {
    const absolutePath = path.join(process.cwd(), relativePath);

    if (!existsSync(absolutePath)) {
      it.skip(relativePath, () => {});
      continue;
    }

    const source = readFileSync(absolutePath, "utf8");
    const handlers = source.matchAll(new RegExp(HANDLER_PATTERN.source, "g"));

    for (const match of handlers) {
      const method = match[2];
      const body = match[3];
      if (method === undefined || body === undefined) {
        continue;
      }

      it(`${relativePath} ${method} calls assertSameOrigin before requireUser`, () => {
        const sameOriginIndex = body.indexOf("assertSameOrigin(");
        const requireUserIndex = body.indexOf("requireUser(");

        expect(
          sameOriginIndex,
          `${relativePath} ${method} must contain assertSameOrigin(`,
        ).toBeGreaterThanOrEqual(0);

        if (sameOriginIndex !== -1 && requireUserIndex !== -1) {
          expect(
            sameOriginIndex,
            `${relativePath} ${method} must call assertSameOrigin( before requireUser(`,
          ).toBeLessThan(requireUserIndex);
        }
      });
    }
  }
});
