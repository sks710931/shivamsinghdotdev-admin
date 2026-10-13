"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { ApiError, getPostsApi, type PostDetail, type RevisionDetail } from "@/lib/posts-client";
import type { UserRole } from "@/lib/directory";
import { PostMissing } from "./post-missing";
import { PostEditor } from "./post-editor";

type LoadState =
  | { kind: "loading" }
  | { kind: "error"; error: ApiError }
  | { kind: "ready"; post: PostDetail; revision: RevisionDetail | null; revisionWarning: string | null };

export function EditPostScreen({ postId, role }: { postId: string; role: UserRole }) {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<LoadState>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    const api = getPostsApi();
    void (async () => {
      try {
        const post = await api.getPost(postId);
        let revision: RevisionDetail | null = null;
        let revisionWarning: string | null = null;
        if (post.pendingRevision) {
          try {
            revision = await api.getRevision(postId);
          } catch (error: unknown) {
            revisionWarning =
              error instanceof ApiError ? error.error : "The pending revision could not be loaded.";
          }
        }
        if (!cancelled) {
          setState({ kind: "ready", post, revision, revisionWarning });
        }
      } catch (error: unknown) {
        if (cancelled) {
          return;
        }
        const apiError =
          error instanceof ApiError
            ? error
            : new ApiError({ status: 500, error: "The post could not be loaded.", code: "unknown" });
        setState({ kind: "error", error: apiError });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [postId, attempt]);

  if (state.kind === "loading") {
    return (
      <p role="status" className="text-sm text-mist">
        Loading post…
      </p>
    );
  }

  if (state.kind === "error") {
    if (state.error.code === "not_found") {
      return <PostMissing />;
    }
    return (
      <div role="alert" className="flex max-w-xl flex-col items-start gap-3">
        <p className="text-sm text-danger">{state.error.error}</p>
        <button
          type="button"
          className="inline-flex h-10 items-center rounded-lg border border-line px-3 text-sm text-paper"
          onClick={() => {
            setState({ kind: "loading" });
            setAttempt((current) => current + 1);
          }}
        >
          Try again
        </button>
        <Link href="/posts" className="text-sm font-medium text-accent">
          Back to posts
        </Link>
      </div>
    );
  }

  return (
    <PostEditor
      mode="edit"
      role={role}
      initialPost={state.post}
      initialRevision={state.revision}
      initialNotice={state.revisionWarning}
    />
  );
}
