"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { PendingReviewBadge, PostStatusBadge } from "@/components/post-status-badge";
import { formatIstDateTime } from "@/lib/format-ist";
import { ApiError, getPostsApi, type PostListItem, type PostStatus } from "@/lib/posts-client";

const PAGE_SIZE = 20;

type StatusFilter = "all" | PostStatus;

type Query = {
  status: StatusFilter;
  pending: boolean;
  page: number;
};

type ListState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; items: PostListItem[]; total: number };

const fieldClass =
  "h-10 rounded-lg border border-line bg-ink px-3 text-sm text-paper outline-none focus:border-accent";

export function PostsList() {
  const [query, setQuery] = useState<Query>({ status: "all", pending: false, page: 1 });
  const [nonce, setNonce] = useState(0);
  const [result, setResult] = useState<ListState>({ kind: "loading" });

  useEffect(() => {
    const request = query;
    let cancelled = false;
    void getPostsApi()
      .listPosts({
        status: request.status === "all" ? undefined : request.status,
        pending: request.pending || undefined,
        page: request.page,
        pageSize: PAGE_SIZE,
      })
      .then((data) => {
        if (!cancelled) {
          setResult({ kind: "ready", items: data.items, total: data.total });
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setResult({
            kind: "error",
            message: error instanceof ApiError ? error.error : "The posts could not be loaded.",
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [query, nonce]);

  function replaceQuery(next: Partial<Query>) {
    setResult({ kind: "loading" });
    setQuery((current) => ({ ...current, page: 1, ...next }));
  }

  const filtered = query.status !== "all" || query.pending;
  const pageCount = result.kind === "ready" ? Math.max(1, Math.ceil(result.total / PAGE_SIZE)) : 1;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm text-mist">
          <span className="sr-only">Status</span>
          <select
            aria-label="Status"
            value={query.status}
            onChange={(event) => {
              const value = event.target.value;
              const status: StatusFilter =
                value === "draft" || value === "published" || value === "archived" ? value : "all";
              replaceQuery({ status });
            }}
            className={fieldClass}
          >
            <option value="all">All statuses</option>
            <option value="draft">Draft</option>
            <option value="published">Published</option>
            <option value="archived">Archived</option>
          </select>
        </label>
        <label className="inline-flex h-10 items-center gap-2 rounded-lg border border-line bg-ink px-3 text-sm text-paper">
          <input
            type="checkbox"
            checked={query.pending}
            onChange={(event) => replaceQuery({ pending: event.target.checked })}
            className="h-4 w-4 accent-accent"
          />
          Pending review only
        </label>
      </div>

      {result.kind === "loading" ? (
        <p role="status" className="text-sm text-mist">
          Loading posts…
        </p>
      ) : null}

      {result.kind === "error" ? (
        <div role="alert" className="flex flex-wrap items-center gap-3 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
          <p>{result.message}</p>
          <button
            type="button"
            className="inline-flex h-9 items-center rounded-lg border border-danger/40 px-3 text-sm text-paper"
            onClick={() => {
              setResult({ kind: "loading" });
              setNonce((current) => current + 1);
            }}
          >
            Try again
          </button>
        </div>
      ) : null}

      {result.kind === "ready" && result.items.length === 0 ? (
        <p className="text-sm text-mist">{filtered ? "No posts match these filters." : "No posts yet."}</p>
      ) : null}

      {result.kind === "ready" && result.items.length > 0 ? (
        <section className="overflow-hidden rounded-xl border border-line bg-panel" aria-busy="false">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[48rem] border-collapse text-left text-sm">
              <thead className="text-xs tracking-wide text-mist uppercase">
                <tr className="border-b border-line">
                  <th className="px-5 py-3 font-medium sm:px-6">Title</th>
                  <th className="px-3 py-3 font-medium">Slug</th>
                  <th className="px-3 py-3 font-medium">Status</th>
                  <th className="px-3 py-3 font-medium">Author</th>
                  <th className="px-5 py-3 font-medium sm:px-6">Updated</th>
                </tr>
              </thead>
              <tbody>
                {result.items.map((post) => (
                  <tr key={post.id} className="border-b border-line/80 last:border-b-0">
                    <td className="px-5 py-4 sm:px-6">
                      <Link href={`/posts/${post.id}`} className="font-medium text-paper hover:text-accent">
                        {post.title || "Untitled"}
                      </Link>
                    </td>
                    <td className="px-3 py-4 font-mono text-xs text-mist">{post.slug}</td>
                    <td className="px-3 py-4">
                      <span className="flex flex-wrap items-center gap-2">
                        <PostStatusBadge status={post.status} />
                        {post.hasPendingRevision ? <PendingReviewBadge /> : null}
                      </span>
                    </td>
                    <td className="px-3 py-4 text-mist">{post.authorName || "—"}</td>
                    <td className="px-5 py-4 text-mist sm:px-6">{formatIstDateTime(post.updatedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {result.total > PAGE_SIZE ? (
            <div className="flex items-center justify-between gap-3 border-t border-line px-5 py-3 text-sm text-mist sm:px-6">
              <button
                type="button"
                disabled={query.page <= 1}
                onClick={() => {
                  setResult({ kind: "loading" });
                  setQuery((current) => ({ ...current, page: current.page - 1 }));
                }}
                className="inline-flex h-9 items-center rounded-lg border border-line px-3 text-paper disabled:opacity-40"
              >
                Previous
              </button>
              <p>
                Page {query.page} of {pageCount}
              </p>
              <button
                type="button"
                disabled={query.page >= pageCount}
                onClick={() => {
                  setResult({ kind: "loading" });
                  setQuery((current) => ({ ...current, page: current.page + 1 }));
                }}
                className="inline-flex h-9 items-center rounded-lg border border-line px-3 text-paper disabled:opacity-40"
              >
                Next
              </button>
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
