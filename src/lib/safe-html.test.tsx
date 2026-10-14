import { render } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { PostEditor } from "@/app/(desk)/posts/post-editor";
import { RevisionReview } from "@/app/(desk)/posts/revision-review";
import type { PostDetail } from "@/lib/posts-client";
import { safeHtml } from "@/lib/safe-html";

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    refresh: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    prefetch: vi.fn(),
  }),
}));

vi.mock("@tinymce/tinymce-react", () => ({
  Editor: () => <div data-testid="mock-tinymce-editor" />,
}));

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
    this.open = true;
  });
  HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
    this.open = false;
  });
});

const XSS_PAYLOADS = [
  {
    name: "script tag",
    payload: '<script>alert("xss")</script><p>Safe text</p>',
  },
  {
    name: "script tag with src",
    payload: '<script src="https://evil.example.com/exploit.js"></script><p>Safe text</p>',
  },
  {
    name: "img onerror",
    payload: '<img src="https://example.com/nonexistent.jpg" onerror="alert(\'xss\')"><p>Safe text</p>',
  },
  {
    name: "img onerror with invalid src",
    payload: '<img src="x" onerror="alert(\'xss\')"><p>Safe text</p>',
  },
  {
    name: "svg onload",
    payload: '<svg onload="alert(\'xss\')"><circle r="5" /></svg><p>Safe text</p>',
  },
  {
    name: "onclick attribute on allowed element",
    payload: '<p onclick="alert(\'xss\')">Clickable text</p>',
  },
  {
    name: "onclick attribute on disallowed element",
    payload: '<button onclick="alert(\'xss\')">Click me</button><p>Safe text</p>',
  },
  {
    name: "javascript: href in anchor",
    payload: '<a href="javascript:alert(\'xss\')">Click here</a>',
  },
  {
    name: "javascript: href with leading whitespace and control characters",
    payload: '<a href=" &#x09;javascript:alert(\'xss\')">Click here</a>',
  },
  {
    name: "data: URL in anchor href",
    payload: '<a href="data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==">Data link</a>',
  },
  {
    name: "data: URL in img src",
    payload: '<img src="data:image/svg+xml;base64,PHN2ZyBvbmxvYWQ9YWxlcnQoMSk+"><p>Safe text</p>',
  },
  {
    name: "iframe with remote source",
    payload: '<iframe src="https://evil.example.com"></iframe><p>Safe text</p>',
  },
  {
    name: "iframe with javascript src",
    payload: '<iframe src="javascript:alert(\'xss\')"></iframe><p>Safe text</p>',
  },
] as const;

function assertNoExecutableArtifacts(container: HTMLElement): void {
  // 1. No script tags
  expect(container.querySelectorAll("script").length).toBe(0);

  // 2. No iframe tags
  expect(container.querySelectorAll("iframe").length).toBe(0);

  // 3. No svg tags
  expect(container.querySelectorAll("svg").length).toBe(0);

  // 4. No event handler attributes on any element (onclick, onerror, onload, etc.)
  const allElements = container.querySelectorAll("*");
  for (const element of allElements) {
    for (const attr of element.attributes) {
      expect(attr.name.toLowerCase().startsWith("on")).toBe(false);
      if (attr.name.toLowerCase() === "href" || attr.name.toLowerCase() === "src") {
        const val = attr.value.replace(/[\u0000-\u001F\u007F-\u009F\s]+/g, "").toLowerCase();
        expect(val.startsWith("javascript:")).toBe(false);
        expect(val.startsWith("data:")).toBe(false);
        expect(val.startsWith("vbscript:")).toBe(false);
      }
    }
  }

  // 5. Raw HTML string assertions
  const html = container.innerHTML.toLowerCase();
  expect(html).not.toContain("<script");
  expect(html).not.toContain("<iframe");
  expect(html).not.toContain("onerror=");
  expect(html).not.toContain("onload=");
  expect(html).not.toContain("onclick=");
  expect(html).not.toContain("javascript:");
  expect(html).not.toContain("data:text/html");
  expect(html).not.toContain("data:image/svg+xml");
}

describe("safeHtml client helper", () => {
  for (const { name, payload } of XSS_PAYLOADS) {
    it(`neutralizes ${name}`, () => {
      const sanitized = safeHtml(payload);
      const host = document.createElement("div");
      host.innerHTML = sanitized;
      assertNoExecutableArtifacts(host);
    });
  }

  it("handles empty and non-string inputs safely", () => {
    expect(safeHtml("")).toBe("");
    expect(safeHtml("   ")).toBe("");
  });

  it("preserves allowed safe markup, links, images, and classes", () => {
    const input =
      '<p>Hello <strong>world</strong></p><pre class="language-typescript"><code>const a = 1;</code></pre>' +
      '<a href="https://example.com/docs" title="Docs">Docs</a>' +
      '<img src="https://example.com/pic.png" alt="Pic" width="200" height="100">' +
      '<ul class="task-list"><li><input type="checkbox" checked> Task done</li></ul>';

    const output = safeHtml(input);
    expect(output).toContain("<p>Hello <strong>world</strong></p>");
    expect(output).toContain('<pre class="language-typescript">');
    expect(output).toContain('href="https://example.com/docs"');
    expect(output).toContain('rel="noopener noreferrer"');
    expect(output).toContain('src="https://example.com/pic.png"');
    expect(output).toContain('type="checkbox"');
    expect(output).toContain("disabled");
  });

  it("strips disallowed classes on pre/code/ul and other elements", () => {
    const input = '<pre class="evil-class language-js">code</pre><p class="danger">text</p>';
    const output = safeHtml(input);
    expect(output).toContain('class="language-js"');
    expect(output).not.toContain("evil-class");
    expect(output).not.toContain('class="danger"');
  });
});

describe("RevisionReview component rendering with XSS payloads", () => {
  for (const { name, payload } of XSS_PAYLOADS) {
    it(`renders safely with ${name} in live and pending HTML`, () => {
      const { container } = render(
        <RevisionReview
          role="admin"
          status="published"
          liveTitle="Live Title"
          liveSummary="Live Summary"
          liveHtml={payload}
          pendingTitle="Pending Title"
          pendingSummary="Pending Summary"
          pendingHtml={payload}
          pendingAuthor="Guest Contributor"
          pendingUpdatedAt="2026-10-14T10:00:00.000Z"
          liveChangedSinceBase={false}
          busy={false}
          onPublish={vi.fn()}
          onDiscard={vi.fn()}
        />,
      );

      const previewBodies = container.querySelectorAll(".blog-preview-body");
      expect(previewBodies.length).toBe(2);
      for (const body of previewBodies) {
        if (body instanceof HTMLElement) {
          assertNoExecutableArtifacts(body);
        }
      }
      expect(container.querySelectorAll("script").length).toBe(0);
      expect(container.querySelectorAll("iframe").length).toBe(0);
      expect(container.querySelectorAll("svg").length).toBe(0);
    });
  }
});

describe("PostEditor component rendering with XSS payloads", () => {
  const samplePost: PostDetail = {
    id: "post-test-1",
    title: "Post Under Review",
    slug: "post-under-review",
    summary: "Post summary for review testing",
    tags: ["testing"],
    seoTitle: "SEO Title",
    seoKeywords: ["test"],
    bodyHtml: "<p>Initial body</p>",
    status: "published",
    authorId: "user-1",
    authorName: "Alex Author",
    createdAt: "2026-10-14T09:00:00.000Z",
    updatedAt: "2026-10-14T09:30:00.000Z",
    publishedAt: "2026-10-14T09:30:00.000Z",
    version: "2",
    pendingRevision: null,
  };

  for (const { name, payload } of XSS_PAYLOADS) {
    it(`renders preview safely with ${name} in editor body`, () => {
      const { container } = render(
        <PostEditor
          mode="edit"
          role="admin"
          initialPost={{
            ...samplePost,
            bodyHtml: payload,
          }}
        />,
      );

      const previewBody = container.querySelector(".blog-preview-body");
      if (previewBody instanceof HTMLElement) {
        assertNoExecutableArtifacts(previewBody);
      }
      // Assert that no scripts or iframes leaked anywhere into the component
      expect(container.querySelectorAll("script").length).toBe(0);
      expect(container.querySelectorAll("iframe").length).toBe(0);
    });
  }
});
