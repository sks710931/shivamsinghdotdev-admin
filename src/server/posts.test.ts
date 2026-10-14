import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AuthError } from "@/server/auth-error";
import { createPost, encodeRowVersion, type PostActor } from "./posts";

const mockQuery = vi.fn();

vi.mock("@/server/db", () => ({
  sql: {
    UniqueIdentifier: "UniqueIdentifier",
    NVarChar: vi.fn(() => "NVarChar"),
    VarChar: vi.fn(() => "VarChar"),
    Int: "Int",
    MAX: "MAX",
  },
  query: (statement: string, bind?: (req: unknown) => void) => mockQuery(statement, bind),
}));

describe("encodeRowVersion", () => {
  it("encodes an 8-byte Buffer correctly to base64", () => {
    const samples = [
      Buffer.from([0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01]),
      Buffer.from([0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08]),
      Buffer.from([0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]),
      Buffer.from("12345678", "utf8"),
    ];

    for (const buf of samples) {
      expect(encodeRowVersion(buf)).toBe(buf.toString("base64"));
    }
  });

  it("throws for non-Buffer values including null, undefined, a string, and a Uint8Array", () => {
    const nonBuffers: unknown[] = [
      null,
      undefined,
      "",
      "AQIDBAUGBwg=",
      12345,
      0,
      true,
      false,
      {},
      { length: 8 },
      [1, 2, 3, 4, 5, 6, 7, 8],
      new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]),
      Symbol("rv"),
      () => {},
    ];

    for (const val of nonBuffers) {
      expect(() => encodeRowVersion(val)).toThrow("Unexpected RowVersion value from database");
    }
  });

  it("throws for Buffers with length other than 8", () => {
    const wrongLengths = [
      Buffer.alloc(0),
      Buffer.alloc(1),
      Buffer.alloc(7),
      Buffer.alloc(9),
      Buffer.alloc(16),
      Buffer.from([1, 2, 3]),
    ];

    for (const buf of wrongLengths) {
      expect(() => encodeRowVersion(buf)).toThrow("Unexpected RowVersion value from database");
    }
  });
});

describe("createPost rowVersion handling and recovery", () => {
  const actor: PostActor = { id: "11111111-1111-4111-8111-111111111111", role: "admin" };
  const validPostInput = {
    title: "Post Title",
    slug: "post-title",
    summary: "Summary text",
    tags: "tag1",
    seoKeywords: "seo",
    seoTitle: "SEO Title",
    bodyHtml: "<p>Hello world</p>",
  };
  const validBuffer = Buffer.from([0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01]);

  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    mockQuery.mockReset();
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it("returns { id, slug, version } when INSERT OUTPUT rowVersion is valid", async () => {
    mockQuery.mockImplementation(async (_sql: string, bind?: (req: unknown) => void) => {
      bind?.({ input: vi.fn() });
      return {
        recordset: [{ rowVersion: validBuffer }],
      };
    });

    const result = await createPost(actor, validPostInput);
    expect(result.slug).toBe("post-title");
    expect(result.version).toBe(validBuffer.toString("base64"));
    expect(result.id).toBeDefined();
    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });

  it("re-fetches version via getPostById when INSERT rowVersion encoding fails", async () => {
    // 1st query: INSERT returns null rowVersion
    // 2nd query: getPostById returns the row with a valid rowVersion buffer
    let callCount = 0;
    mockQuery.mockImplementation(async (_sql: string, bind?: (req: unknown) => void) => {
      bind?.({ input: vi.fn() });
      callCount++;
      if (callCount === 1) {
        return {
          recordset: [{ rowVersion: null }],
        };
      }
      return {
        recordset: [
          {
            id: "created-id",
            title: "Post Title",
            slug: "post-title",
            summary: "Summary text",
            tags: "tag1",
            seoKeywords: "seo",
            seoTitle: "SEO Title",
            bodyHtml: "<p>Hello world</p>",
            status: "draft",
            authorId: actor.id,
            rowVersion: validBuffer,
            updatedAt: new Date(),
            publishedAt: null,
            authorName: "Author",
            hasPendingRevision: 0,
          },
        ],
      };
    });

    const result = await createPost(actor, validPostInput);
    expect(result.slug).toBe("post-title");
    expect(result.version).toBe(validBuffer.toString("base64"));
    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);

    // Assert that logging is safe (error name only, no values/body)
    const logArgs = consoleErrorSpy.mock.calls.flat().map((a: unknown) => String(a)).join(" ");
    expect(logArgs).toContain("Error");
    expect(logArgs).not.toContain("Post Title");
    expect(logArgs).not.toContain("<p>Hello world</p>");
  });

  it("throws a clear, distinct AuthError if both INSERT rowVersion and getPostById fail", async () => {
    // 1st query: INSERT returns null rowVersion
    // 2nd query: getPostById returns empty recordset (post not found)
    let callCount = 0;
    mockQuery.mockImplementation(async (_sql: string, bind?: (req: unknown) => void) => {
      bind?.({ input: vi.fn() });
      callCount++;
      if (callCount === 1) {
        return {
          recordset: [{ rowVersion: null }],
        };
      }
      return {
        recordset: [],
      };
    });

    await expect(createPost(actor, validPostInput)).rejects.toSatisfy((err: unknown) => {
      expect(err).toBeInstanceOf(AuthError);
      const authErr = err as AuthError;
      expect(authErr.status).toBe(500);
      expect(authErr.code).toBe("post_saved_version_failed");
      expect(authErr.message).toBe("Draft was saved, but its version could not be retrieved.");
      expect(authErr.extra).toBeDefined();
      expect(authErr.extra?.slug).toBe("post-title");
      expect(authErr.extra?.id).toBeDefined();
      return true;
    });

    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
  });
});
