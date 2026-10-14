"use client";

import { Editor } from "@tinymce/tinymce-react";
import { Clock3, FileText, Globe2, Link2, Plus, Search, Send, X } from "lucide-react";
import { useRouter } from "next/navigation";
import Prism from "prismjs";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Editor as TinyMCEEditor } from "tinymce";

import "prismjs/components/prism-clike";
import "prismjs/components/prism-markup";
import "prismjs/components/prism-css";
import "prismjs/components/prism-javascript";
import "prismjs/components/prism-typescript";
import "prismjs/components/prism-bash";
import "prismjs/components/prism-go";
import "prismjs/components/prism-java";
import "prismjs/components/prism-json";
import "prismjs/components/prism-markdown";
import "prismjs/components/prism-python";
import "prismjs/components/prism-rust";
import "prismjs/components/prism-sql";
import "prismjs/components/prism-yaml";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { DraftRecoveryBanner } from "@/components/draft-recovery-banner";
import { PostStatusBadge } from "@/components/post-status-badge";
import type { UserRole } from "@/lib/directory";
import { normalizeEditorHtml } from "@/lib/editor-html";
import { formatIstDateTime, formatSavedIst } from "@/lib/format-ist";
import { getPostActions } from "@/lib/post-actions";
import { safeHtml } from "@/lib/safe-html";
import {
  ApiError,
  getPostsApi,
  type PostDetail,
  type RevisionDetail,
} from "@/lib/posts-client";
import { useDraftRecovery } from "@/lib/use-draft-recovery";
import { EditorActions, LiveUnchangedNotice } from "./editor-actions";
import { PostMissing } from "./post-missing";
import { RevisionReview } from "./revision-review";
import {
  createEditorInit,
  defaultToolbar,
  EditorToolbar,
  toggleTaskList,
  type ToolbarSnapshot,
} from "./editor-toolbar";

if (Prism.languages.markup) {
  Prism.languages.xml = Prism.languages.markup;
  Prism.languages.html = Prism.languages.markup;
}

const fieldClass =
  "h-12 w-full rounded-lg border border-line bg-ink px-3 text-sm text-paper outline-none transition-colors placeholder:text-mist/70 focus:border-accent";

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SUMMARY_MAX = 500;
const SEO_TITLE_MAX = 200;

type Fields = {
  title: string;
  slug: string;
  summary: string;
  seoTitle: string;
  seoKeywords: string;
  tags: string[];
  body: string;
};

type ConfirmKind = "publish" | "updateLive" | "unpublish" | "archive" | "discard" | "force";

class LocalInvalid extends Error {
  constructor() {
    super("invalid");
    this.name = "LocalInvalid";
  }
}

const confirmCopy: Record<
  ConfirmKind,
  { title: string; description: string; confirmLabel: string; tone: "default" | "danger" }
> = {
  publish: {
    title: "Publish this post?",
    description: "It will go live on the public site.",
    confirmLabel: "Publish",
    tone: "default",
  },
  updateLive: {
    title: "Update the live post?",
    description: "The pending revision replaces what is currently live.",
    confirmLabel: "Update live post",
    tone: "default",
  },
  force: {
    title: "Publish over the newer live post?",
    description: "The live post changed after this revision was started. Publishing now overwrites it.",
    confirmLabel: "Publish anyway",
    tone: "danger",
  },
  unpublish: {
    title: "Unpublish this post?",
    description: "It returns to draft and leaves the public site. A pending revision is kept.",
    confirmLabel: "Unpublish",
    tone: "danger",
  },
  archive: {
    title: "Archive this post?",
    description: "It leaves the public site. The URL slug stays reserved. Unsaved edits on this page are discarded.",
    confirmLabel: "Archive",
    tone: "danger",
  },
  discard: {
    title: "Discard this revision?",
    description: "The pending edit is deleted. The live post stays as it is. Unsaved edits in the editor are discarded with it.",
    confirmLabel: "Discard",
    tone: "danger",
  },
};

function slugFromTitle(title: string): string {
  return title
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 180);
}

function plainText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .trim();
}

function wordCount(html: string): number {
  const text = plainText(html);
  return text ? text.split(/\s+/).length : 0;
}

function keywords(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

export function previewHtml(html: string): string {
  if (typeof window === "undefined") {
    return "";
  }
  return safeHtml(normalizeEditorHtml(html));
}

function emptyFields(): Fields {
  return { title: "", slug: "", summary: "", seoTitle: "", seoKeywords: "", tags: [], body: "" };
}

function fieldsFrom(post: PostDetail, revision: RevisionDetail | null): Fields {
  const source = revision ?? post;
  return {
    title: source.title,
    slug: post.status === "draft" ? source.slug : post.slug,
    summary: source.summary,
    seoTitle: source.seoTitle,
    seoKeywords: source.seoKeywords.join(", "),
    tags: [...source.tags],
    body: source.bodyHtml,
  };
}

function canonical(fields: Fields): string {
  return JSON.stringify({
    title: fields.title.trim(),
    slug: fields.slug.trim(),
    summary: fields.summary.trim(),
    seoTitle: fields.seoTitle.trim(),
    seoKeywords: fields.seoKeywords.trim(),
    tags: fields.tags,
    body: normalizeEditorHtml(fields.body),
  });
}

function localProblems(fields: Fields): Record<string, string> {
  const problems: Record<string, string> = {};
  if (!fields.title.trim()) {
    problems.title = "Title is required.";
  }
  const slug = fields.slug.trim();
  if (!slug || !SLUG.test(slug)) {
    problems.slug = "URL slug can use lowercase letters, numbers, and hyphens.";
  }
  if (!plainText(fields.body)) {
    problems.bodyHtml = "Write the post before saving.";
  }
  return problems;
}

function clearKeys(current: Record<string, string>, keys: string[]): Record<string, string> {
  const next = { ...current };
  for (const key of keys) {
    delete next[key];
  }
  return next;
}

export function PostEditor({
  mode,
  role,
  userId,
  initialPost,
  initialRevision = null,
  initialNotice = null,
  initialSavedAt = null,
}: {
  mode: "create" | "edit";
  role: UserRole;
  userId: string;
  initialPost?: PostDetail;
  initialRevision?: RevisionDetail | null;
  initialNotice?: string | null;
  initialSavedAt?: string | null;
}) {
  const router = useRouter();
  const starting = initialPost ? fieldsFrom(initialPost, initialRevision) : emptyFields();
  const [post, setPost] = useState<PostDetail | null>(initialPost ?? null);
  const [revision, setRevision] = useState<RevisionDetail | null>(initialRevision);
  const [fields, setFields] = useState<Fields>(starting);
  const [savedFields, setSavedFields] = useState<Fields>(starting);
  const [initialBody] = useState(starting.body);
  const [slugTouched, setSlugTouched] = useState(mode === "edit");
  const [pending, setPending] = useState(false);
  const [saveBlocked, setSaveBlocked] = useState(false);
  const [reloadPostId, setReloadPostId] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(initialNotice);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [conflict, setConflict] = useState<ApiError | null>(null);
  const [revisionStale, setRevisionStale] = useState<ApiError | null>(null);
  const [savedLabel, setSavedLabel] = useState<string | null>(initialSavedAt ? formatSavedIst(initialSavedAt) : null);
  const [confirm, setConfirm] = useState<ConfirmKind | null>(null);
  const [missing, setMissing] = useState(false);
  const [restoredBaseVersion, setRestoredBaseVersion] = useState<string | null>(null);
  const [tagDraft, setTagDraft] = useState("");
  const [blocksOpen, setBlocksOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [toolbar, setToolbar] = useState<ToolbarSnapshot>(defaultToolbar);
  const [newDraftId] = useState(() => crypto.randomUUID());
  const serverVersion = revision?.version ?? post?.version ?? null;
  const serverUpdatedAt = revision?.updatedAt ?? post?.updatedAt ?? null;
  const recovery = useDraftRecovery(
    userId,
    post?.id ?? "new:" + newDraftId,
    fields.title,
    fields.body,
    serverVersion,
    serverUpdatedAt,
  );
  const editorRef = useRef<TinyMCEEditor | null>(null);
  const previewRef = useRef<HTMLDialogElement>(null);
  const dirty = canonical(fields) !== canonical(savedFields);
  const slugLocked = (post?.status ?? "draft") !== "draft";
  const actions = getPostActions(role, post?.status ?? "draft", Boolean(post?.pendingRevision) || Boolean(revision));
  const words = wordCount(fields.body);

  const init = useMemo(
    () =>
      createEditorInit({
        onSlash: setBlocksOpen,
        onToolbar: (snapshot) => {
          setToolbar((current) => (JSON.stringify(current) === JSON.stringify(snapshot) ? current : snapshot));
        },
      }),
    [],
  );

  useEffect(() => {
    if (!dirty) {
      return;
    }
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  useEffect(() => {
    const dialog = previewRef.current;
    if (!dialog) {
      return;
    }
    if (previewOpen && !dialog.open) {
      try {
        dialog.showModal();
      } catch {
        dialog.setAttribute("open", "");
      }
      dialog.querySelector<HTMLElement>("[data-autofocus]")?.focus();
    } else if (!previewOpen && dialog.open) {
      dialog.close();
    }
  }, [previewOpen]);

  function patchFields(partial: Partial<Fields>, errorKeys: string[] = []) {
    setFields((current) => ({ ...current, ...partial }));
    if (errorKeys.length > 0) {
      setFieldErrors((current) => clearKeys(current, errorKeys));
    }
  }

  function applyLoaded(fresh: PostDetail, nextRevision: RevisionDetail | null) {
    const nextFields = fieldsFrom(fresh, nextRevision);
    setPost(fresh);
    setRevision(nextRevision);
    setFields(nextFields);
    setSavedFields(nextFields);
    setRestoredBaseVersion(null);
    setSlugTouched(true);
    editorRef.current?.setContent(nextFields.body);
  }

  function applyApiError(error: ApiError) {
    if (error.code === "stale_version") {
      setConflict(error);
      setBanner(null);
      return;
    }
    if (error.code === "revision_stale") {
      setRevisionStale(error);
      setBanner(null);
      return;
    }
    if (error.code === "slug_taken") {
      setFieldErrors({ slug: error.fields?.slug ?? error.error });
      setBanner(null);
      return;
    }
    if (error.code === "not_found") {
      setMissing(true);
      return;
    }
    if (error.code === "validation") {
      setFieldErrors(error.fields ?? {});
      setBanner(error.fields ? null : error.error);
      return;
    }
    setBanner(error.error);
  }

  async function persist(options?: { navigate?: boolean }): Promise<{ post: PostDetail; revision: RevisionDetail | null }> {
    if (saveBlocked) {
      throw new LocalInvalid();
    }
    const problems = localProblems(fields);
    if (Object.keys(problems).length > 0) {
      setFieldErrors(problems);
      throw new LocalInvalid();
    }
    const api = getPostsApi();
    const bodyHtml = normalizeEditorHtml(fields.body);
    setConflict(null);
    setRevisionStale(null);

    if (!post) {
      let createdId: string;
      let createdSlug: string;
      let createdVersion: string;
      let postCreatedAt: string | undefined;
      let postUpdatedAt: string | undefined;
      let postAuthorName: string | undefined;

      try {
        const created = await api.createPost({
          title: fields.title.trim(),
          slug: fields.slug.trim(),
          summary: fields.summary.trim(),
          tags: fields.tags.join(", "),
          seoKeywords: fields.seoKeywords.trim(),
          seoTitle: fields.seoTitle.trim(),
          bodyHtml,
        });
        createdId = created.id;
        createdSlug = created.slug;
        createdVersion = created.version;
      } catch (error: unknown) {
        if (
          error instanceof ApiError &&
          error.code === "post_saved_version_failed" &&
          typeof error.id === "string" &&
          typeof error.slug === "string"
        ) {
          createdId = error.id;
          createdSlug = error.slug;
          try {
            const fetched = await api.getPost(error.id);
            createdVersion = fetched.version;
            postCreatedAt = fetched.createdAt;
            postUpdatedAt = fetched.updatedAt;
            postAuthorName = fetched.authorName;
          } catch {
            setSaveBlocked(true);
            setReloadPostId(createdId);
            setFields((current) => ({ ...current, slug: createdSlug }));
            setSavedFields((current) => ({ ...current, slug: createdSlug }));
            setSavedLabel(null);
            setSlugTouched(true);
            recovery.clear();
            throw new LocalInvalid();
          }
        } else {
          throw error;
        }
      }

      recovery.clear();
      setRestoredBaseVersion(null);
      const now = new Date().toISOString();
      const detail: PostDetail = {
        id: createdId,
        title: fields.title.trim(),
        slug: createdSlug,
        summary: fields.summary.trim(),
        tags: [...fields.tags],
        seoTitle: fields.seoTitle.trim(),
        seoKeywords: keywords(fields.seoKeywords),
        bodyHtml,
        status: "draft",
        authorId: userId,
        authorName: postAuthorName ?? "",
        createdAt: postCreatedAt ?? now,
        updatedAt: postUpdatedAt ?? now,
        publishedAt: null,
        version: createdVersion,
        pendingRevision: null,
      };
      const nextFields = { ...fields, body: bodyHtml, slug: detail.slug };
      setPost(detail);
      setFields(nextFields);
      setSavedFields(nextFields);
      setSavedLabel(formatSavedIst(detail.updatedAt));
      setSlugTouched(true);
      if (options?.navigate !== false) {
        sessionStorage.setItem(`desk-post-saved:${detail.id}`, detail.updatedAt);
        router.replace(`/posts/${detail.id}`);
      }
      return { post: detail, revision: null };
    }

    const currentToken = post.status === "published" && revision ? revision.version : post.version;
    const token = restoredBaseVersion ?? currentToken;
    const result = await api.patchPost(post.id, {
      version: token,
      title: fields.title.trim(),
      summary: fields.summary.trim(),
      tags: fields.tags,
      seoTitle: fields.seoTitle.trim(),
      seoKeywords: keywords(fields.seoKeywords),
      bodyHtml,
      ...(slugLocked ? {} : { slug: fields.slug.trim() }),
    });
    recovery.clear();
    setRestoredBaseVersion(null);
    const nextFields = { ...fields, body: bodyHtml, slug: slugLocked ? post.slug : fields.slug.trim() };

    if (result.appliedTo === "pendingRevision") {
      const nextRevision: RevisionDetail = {
        id: post.id,
        revisionId: result.revisionId ?? revision?.revisionId ?? "",
        title: nextFields.title.trim(),
        slug: nextFields.slug,
        summary: nextFields.summary.trim(),
        tags: [...nextFields.tags],
        seoTitle: nextFields.seoTitle.trim(),
        seoKeywords: keywords(nextFields.seoKeywords),
        bodyHtml,
        status: post.status,
        authorId: revision?.authorId ?? post.authorId,
        authorName: revision?.authorName ?? post.pendingRevision?.authorName ?? post.authorName,
        createdAt: revision?.createdAt ?? result.updatedAt,
        updatedAt: result.updatedAt,
        publishedAt: post.publishedAt,
        version: result.version,
        baseVersion: revision?.baseVersion ?? post.version,
        liveChangedSinceBase: revision?.liveChangedSinceBase ?? false,
      };
      const nextPost: PostDetail = {
        ...post,
        pendingRevision: {
          id: nextRevision.revisionId,
          authorName: nextRevision.authorName,
          updatedAt: result.updatedAt,
        },
      };
      setPost(nextPost);
      setRevision(nextRevision);
      setFields(nextFields);
      setSavedFields(nextFields);
      setSavedLabel(formatSavedIst(result.updatedAt));
      return { post: nextPost, revision: nextRevision };
    }

    const nextPost: PostDetail = {
      ...post,
      title: nextFields.title.trim(),
      slug: nextFields.slug,
      summary: nextFields.summary.trim(),
      tags: [...nextFields.tags],
      seoTitle: nextFields.seoTitle.trim(),
      seoKeywords: keywords(nextFields.seoKeywords),
      bodyHtml,
      version: result.version,
      updatedAt: result.updatedAt,
    };
    setPost(nextPost);
    setFields(nextFields);
    setSavedFields(nextFields);
    setSavedLabel(formatSavedIst(result.updatedAt));
    return { post: nextPost, revision };
  }

  async function run(action: () => Promise<void>, fallback: string) {
    if (pending) {
      return;
    }
    setPending(true);
    setBanner(null);
    try {
      await action();
    } catch (error: unknown) {
      if (error instanceof LocalInvalid) {
        return;
      }
      if (error instanceof ApiError) {
        applyApiError(error);
        return;
      }
      setBanner(fallback);
    } finally {
      setPending(false);
    }
  }

  function save() {
    if (saveBlocked) {
      return;
    }
    void run(async () => {
      await persist();
      setFieldErrors({});
    }, "The post could not be saved.");
  }

  function publish(force: boolean) {
    if (saveBlocked) {
      return;
    }
    void run(async () => {
      // A draft publish writes the live row. A set-aside revision stays off this
      // request; a live post with a pending revision uses publishRevision.
      const draftHoldsRevision = Boolean(post && post.status !== "published" && revision);
      const model = dirty || !post || draftHoldsRevision ? await persist({ navigate: false }) : { post, revision };
      if (model.post.status === "archived") {
        setBanner("Archived posts cannot be published.");
        return;
      }
      const publishingRevision = model.post.status === "published" && model.revision ? model.revision : null;
      const result = publishingRevision
        ? await getPostsApi().publishRevision(model.post.id, {
            version: publishingRevision.version,
            ...(force ? { force: true } : {}),
          })
        : await getPostsApi().publishPost(model.post.id, { version: model.post.version });
      recovery.clear();
      const source = publishingRevision ?? model.post;
      const next: PostDetail = {
        ...model.post,
        title: source.title,
        slug: model.post.status === "draft" ? source.slug : model.post.slug,
        summary: source.summary,
        tags: [...source.tags],
        seoTitle: source.seoTitle,
        seoKeywords: [...source.seoKeywords],
        bodyHtml: source.bodyHtml,
        status: "published",
        version: result.version,
        publishedAt: result.publishedAt,
        updatedAt: result.publishedAt,
        pendingRevision: null,
      };
      setPost(next);
      setRevision(null);
      setSavedLabel(formatSavedIst(result.publishedAt));
      setRevisionStale(null);
      setFieldErrors({});
      if (mode === "create") {
        router.replace(`/posts/${next.id}`);
      }
    }, "The post could not be published.");
  }

  function unpublish() {
    if (saveBlocked) {
      return;
    }
    void run(async () => {
      const model = dirty || !post ? await persist({ navigate: false }) : { post, revision };
      const result = await getPostsApi().unpublishPost(model.post.id, { version: model.post.version });
      setPost(result);
      setRevision(null);
      setFieldErrors({});
    }, "The post could not be unpublished.");
  }

  function archive() {
    if (saveBlocked) {
      return;
    }
    void run(async () => {
      if (!post) {
        setBanner("Save the post before archiving it.");
        return;
      }
      await getPostsApi().archivePost(post.id, { version: post.version });
      try {
        const fresh = await getPostsApi().getPost(post.id);
        const nextRevision = fresh.pendingRevision ? await getPostsApi().getRevision(post.id) : null;
        applyLoaded(fresh, nextRevision);
      } catch {
        applyLoaded({ ...post, status: "archived" }, revision);
      }
      setFieldErrors({});
    }, "The post could not be archived.");
  }

  function discard() {
    if (saveBlocked) {
      return;
    }
    void run(async () => {
      if (!post?.pendingRevision || !revision) {
        return;
      }
      await getPostsApi().deleteRevision(post.id, { version: revision.version });
      applyLoaded({ ...post, pendingRevision: null }, null);
    }, "The revision could not be discarded.");
  }

  async function reload() {
    const targetId = post?.id ?? reloadPostId;
    if (!targetId) {
      return;
    }
    await run(async () => {
      const fresh = await getPostsApi().getPost(targetId);
      const nextRevision = fresh.pendingRevision ? await getPostsApi().getRevision(targetId) : null;
      applyLoaded(fresh, nextRevision);
      setReloadPostId(null);
      setSaveBlocked(false);
      setConflict(null);
      setRevisionStale(null);
      setFieldErrors({});
      setSavedLabel(formatSavedIst(fresh.updatedAt));
      if (mode === "create") {
        sessionStorage.setItem(`desk-post-saved:${fresh.id}`, fresh.updatedAt);
        router.replace(`/posts/${fresh.id}`);
      }
    }, "The post could not be reloaded.");
  }

  function runCommand(command: string, value?: string) {
    const editor = editorRef.current;
    if (!editor) {
      return;
    }
    editor.focus();
    if (command === "mceInsertTable") {
      editor.execCommand("mceInsertTable", false, { rows: 2, columns: 2 });
    } else if (value === undefined) {
      editor.execCommand(command);
    } else {
      editor.execCommand(command, false, value);
    }
    editor.nodeChanged();
  }

  function toggleFormat(format: "mark" | "code") {
    const editor = editorRef.current;
    if (!editor) {
      return;
    }
    editor.focus();
    editor.formatter.toggle(format);
    editor.nodeChanged();
  }

  function insertBlock(kind: "h2" | "quote" | "list" | "numbered" | "tasks" | "code" | "rule" | "image" | "table") {
    const editor = editorRef.current;
    if (!editor) {
      return;
    }
    editor.focus();
    const node = editor.selection.getNode();
    if ((node.textContent ?? "").trim() === "/") {
      editor.dom.setHTML(node, "");
    }
    if (kind === "h2") {
      editor.execCommand("FormatBlock", false, "h2");
    } else if (kind === "quote") {
      editor.execCommand("mceBlockQuote");
    } else if (kind === "list") {
      editor.execCommand("InsertUnorderedList");
    } else if (kind === "numbered") {
      editor.execCommand("InsertOrderedList");
    } else if (kind === "tasks") {
      toggleTaskList(editor);
    } else if (kind === "code") {
      editor.execCommand("CodeSample");
    } else if (kind === "rule") {
      editor.execCommand("InsertHorizontalRule");
    } else if (kind === "image") {
      editor.execCommand("mceImage");
    } else if (kind === "table") {
      editor.execCommand("mceInsertTable", false, { rows: 2, columns: 2 });
    }
    editor.nodeChanged();
    setBlocksOpen(false);
  }

  function addTag(raw: string) {
    const next = raw.trim();
    if (!next || fields.tags.includes(next)) {
      setTagDraft("");
      return;
    }
    if ([...fields.tags, next].join(", ").length > 500) {
      return;
    }
    patchFields({ tags: [...fields.tags, next] }, ["tags"]);
    setTagDraft("");
  }

  function askUpdate() {
    setConfirm(revision?.liveChangedSinceBase ? "force" : "updateLive");
  }

  if (missing) {
    return <PostMissing />;
  }

  const activeConfirm = confirm ? confirmCopy[confirm] : null;
  const visibility = post?.status === "published" ? "Published" : post?.status === "archived" ? "Archived" : "Private";

  return (
    <form
      className="flex w-full flex-col gap-6 pb-28 xl:pb-0"
      onSubmit={(event) => {
        event.preventDefault();
        if (saveBlocked) {
          return;
        }
        if (actions.save || actions.saveDraft) {
          save();
        }
      }}
    >
      <header>
        <p className="font-mono text-[11px] tracking-[0.18em] text-accent uppercase">Posts</p>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h2 className="font-display text-4xl leading-none font-medium tracking-tight text-paper">
            {mode === "create" && !post ? "New post" : "Edit post"}
          </h2>
          {post ? <PostStatusBadge status={post.status} /> : null}
        </div>
        <p className="mt-3 text-sm text-mist">Draft and edit content inline before publishing.</p>
      </header>

      {recovery.pending ? (
        <DraftRecoveryBanner
          savedAt={recovery.pending.savedAt}
          stale={recovery.pending.stale}
          onRestore={() => {
            const s = recovery.restore();
            if (s) {
              setFields((f) => ({ ...f, title: s.title, body: s.body }));
              editorRef.current?.setContent(s.body);
              if (s.baseVersion !== null) {
                setRestoredBaseVersion(s.baseVersion);
              }
            }
          }}
          onDiscard={() => {
            recovery.discard();
          }}
        />
      ) : null}

      {actions.guestLiveBanner ? <LiveUnchangedNotice /> : null}
      {post?.status === "archived" ? (
        <p className="rounded-lg border border-line bg-panel px-3 py-2 text-sm text-mist">
          This post is archived. The URL slug stays reserved and it is not on the public site.
        </p>
      ) : null}
      {reloadPostId ? (
        <div
          role="status"
          aria-label="Saved. Reload to continue editing."
          className="rounded-lg border border-accent/30 bg-accent/10 px-4 py-3 text-sm text-paper"
        >
          <p>Saved. Reload to continue editing.</p>
          <button
            type="button"
            onClick={() => void reload()}
            className="mt-3 inline-flex h-9 items-center rounded-lg border border-line px-3 text-sm text-paper transition-colors hover:border-paper/30"
          >
            Reload
          </button>
        </div>
      ) : null}
      {banner ? (
        <p role="alert" className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
          {banner}
        </p>
      ) : null}
      {conflict?.code === "stale_version" ? (
        <div role="alert" className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-3 text-sm text-danger">
          <p>{conflict.error}</p>
          {conflict.updatedBy || conflict.updatedAt ? (
            <p className="mt-1">
              {conflict.updatedBy ? `Updated by ${conflict.updatedBy}` : "Updated"}
              {conflict.updatedAt ? ` at ${formatIstDateTime(conflict.updatedAt)}` : ""}. Reload discards unsaved edits.
            </p>
          ) : null}
          <button
            type="button"
            onClick={() => void reload()}
            className="mt-3 inline-flex h-9 items-center rounded-lg border border-danger/40 px-3 text-sm text-paper"
          >
            Reload
          </button>
        </div>
      ) : null}
      {revisionStale ? (
        <div role="alert" className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-3 text-sm text-danger">
          <p>{revisionStale.error}</p>
          <button
            type="button"
            onClick={() => setConfirm("force")}
            className="mt-3 inline-flex h-9 items-center rounded-lg border border-danger/40 px-3 text-sm text-paper"
          >
            Publish anyway
          </button>
        </div>
      ) : null}

      {post?.pendingRevision && revision ? (
        <RevisionReview
          role={role}
          status={post.status}
          liveTitle={post.title}
          liveSummary={post.summary}
          liveHtml={post.bodyHtml}
          pendingTitle={revision.title}
          pendingSummary={revision.summary}
          pendingHtml={revision.bodyHtml}
          pendingAuthor={post.pendingRevision.authorName}
          pendingUpdatedAt={post.pendingRevision.updatedAt}
          liveChangedSinceBase={revision.liveChangedSinceBase}
          busy={pending}
          onPublish={askUpdate}
          onDiscard={() => setConfirm("discard")}
        />
      ) : null}

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_22.5rem]">
        <section className="rounded-2xl border border-line bg-panel p-5 shadow-sm shadow-black/20 sm:p-6">
          <label className="flex flex-col gap-2">
            <span className="text-xs font-medium tracking-wide text-mist">Title</span>
            <input
              name="title"
              required
              maxLength={200}
              value={fields.title}
              placeholder="Write your headline…"
              aria-invalid={fieldErrors.title ? true : undefined}
              aria-describedby={fieldErrors.title ? "title-error" : undefined}
              className="h-14 w-full rounded-lg border border-transparent bg-transparent px-1 font-display text-3xl text-paper outline-none placeholder:text-mist/50 focus:border-accent/70"
              onChange={(event) => {
                const title = event.target.value;
                const next: Partial<Fields> = { title };
                if (!slugTouched && !slugLocked) {
                  next.slug = slugFromTitle(title);
                }
                patchFields(next, ["title", ...(next.slug ? ["slug"] : [])]);
              }}
            />
            <FieldError id="title-error" message={fieldErrors.title} />
          </label>
          <div className="mt-5">
            <label className="flex flex-col gap-2 text-sm">
              <span className="text-xs font-medium tracking-wide text-mist">URL slug</span>
              <span className="relative">
                <Link2 aria-hidden className="pointer-events-none absolute top-3.5 left-3 h-4 w-4 text-mist" strokeWidth={1.75} />
                <input
                  name="slug"
                  required
                  maxLength={180}
                  readOnly={slugLocked}
                  value={fields.slug}
                  pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
                  placeholder="e.g. my-awesome-post"
                  aria-invalid={fieldErrors.slug ? true : undefined}
                  aria-describedby={fieldErrors.slug ? "slug-error" : slugLocked ? "slug-locked" : undefined}
                  className={`${fieldClass} pl-9 ${slugLocked ? "text-mist" : ""}`}
                  onChange={(event) => {
                    setSlugTouched(true);
                    patchFields({ slug: event.target.value }, ["slug"]);
                  }}
                />
              </span>
              {slugLocked ? (
                <span id="slug-locked" className="text-xs text-mist">
                  The URL slug stays reserved once a post has been published.
                </span>
              ) : null}
              <FieldError id="slug-error" message={fieldErrors.slug} />
            </label>
          </div>
          <label className="mt-5 flex flex-col gap-2 text-sm">
            <span className="flex items-center justify-between text-xs font-medium tracking-wide text-mist">
              Summary
              <span>
                {fields.summary.length}/{SUMMARY_MAX}
              </span>
            </span>
            <textarea
              name="summary"
              value={fields.summary}
              maxLength={SUMMARY_MAX}
              rows={3}
              placeholder="Write a short summary or excerpt for this post…"
              aria-invalid={fieldErrors.summary ? true : undefined}
              aria-describedby={fieldErrors.summary ? "summary-error" : undefined}
              onChange={(event) => patchFields({ summary: event.target.value }, ["summary"])}
              className="w-full rounded-lg border border-line bg-ink px-3 py-3 text-sm text-paper outline-none transition-colors placeholder:text-mist/70 focus:border-accent"
            />
            <FieldError id="summary-error" message={fieldErrors.summary} />
          </label>
          <div className="relative mt-6 rounded-xl border border-line bg-ink">
            <EditorToolbar
              snapshot={toolbar}
              onCommand={runCommand}
              onBlock={(block) => {
                runCommand("FormatBlock", block);
                setToolbar((current) => ({ ...current, block }));
              }}
              onFormat={toggleFormat}
              onTask={() => {
                const editor = editorRef.current;
                if (!editor) {
                  return;
                }
                editor.focus();
                toggleTaskList(editor);
              }}
            />
            <Editor
              id="post-body"
              licenseKey="gpl"
              inline
              tagName="div"
              tinymceScriptSrc="/tinymce/tinymce.min.js"
              initialValue={initialBody}
              onInit={(_event, editor) => {
                editorRef.current = editor;
                const content = editor.getContent();
                setFields((current) => ({ ...current, body: content }));
                setSavedFields((current) => ({ ...current, body: content }));
              }}
              onEditorChange={(content) => patchFields({ body: content }, ["bodyHtml"])}
              init={init}
            />
            <FieldError id="body-error" message={fieldErrors.bodyHtml} />
            <div className="flex items-end justify-between gap-3 px-3 py-2">
              <div className="relative">
                <button
                  type="button"
                  className="inline-flex items-center gap-2 text-xs text-mist hover:text-paper"
                  aria-expanded={blocksOpen}
                  onClick={() => setBlocksOpen((open) => !open)}
                >
                  <Plus className="h-3.5 w-3.5" strokeWidth={1.75} />
                  Type / to insert a block…
                </button>
                {blocksOpen ? (
                  <div className="absolute bottom-8 left-0 z-20 w-52 rounded-lg border border-line bg-panel p-1 shadow-lg shadow-black/30">
                    {(
                      [
                        ["h2", "Heading"],
                        ["quote", "Quote"],
                        ["list", "Bullet list"],
                        ["numbered", "Numbered list"],
                        ["tasks", "Task list"],
                        ["code", "Code block"],
                        ["image", "Image"],
                        ["table", "Table"],
                        ["rule", "Divider"],
                      ] as const
                    ).map(([kind, label]) => (
                      <button
                        key={kind}
                        type="button"
                        className="block w-full rounded-md px-2 py-1.5 text-left text-sm text-paper hover:bg-white/[0.04]"
                        onClick={() => insertBlock(kind)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
              <p className="text-xs text-mist">{words} words</p>
            </div>
          </div>
        </section>
        <aside className="flex flex-col gap-4">
          <section className="hidden rounded-2xl border border-line bg-panel p-5 shadow-sm shadow-black/20 xl:block">
            <div className="flex items-start justify-between gap-3">
              <div className="flex gap-3">
                <Send aria-hidden className="mt-0.5 h-4 w-4 text-accent" strokeWidth={1.75} />
                <div>
                  <h3 className="text-sm font-medium text-paper">Publish</h3>
                  <p className="mt-1 text-xs leading-5 text-mist">Manage the status and publish your post.</p>
                </div>
              </div>
              {post ? <PostStatusBadge status={post.status} /> : <PostStatusBadge status="draft" />}
            </div>
            <div className="mt-4">
              <EditorActions
                layout="stack"
                pending={pending}
                savedLabel={savedLabel}
                actions={actions}
                canArchive={Boolean(post) && actions.archive}
                canUpdate={actions.updateLive}
                onSave={save}
                saveDisabled={saveBlocked}
                onPublish={() => {
                  if (!saveBlocked) {
                    setConfirm("publish");
                  }
                }}
                onUpdate={askUpdate}
                onUnpublish={() => setConfirm("unpublish")}
                onArchive={() => setConfirm("archive")}
                onPreview={() => setPreviewOpen(true)}
              />
            </div>
            <dl className="mt-4 space-y-3 border-t border-line pt-4 text-sm">
              <div className="flex items-center justify-between gap-3 text-mist">
                <dt className="inline-flex items-center gap-2">
                  <Clock3 className="h-3.5 w-3.5" strokeWidth={1.75} /> Last edited
                </dt>
                <dd>{post ? formatIstDateTime(post.updatedAt) : "Not saved yet"}</dd>
              </div>
              <div className="flex items-center justify-between gap-3 text-mist">
                <dt className="inline-flex items-center gap-2">
                  <FileText className="h-3.5 w-3.5" strokeWidth={1.75} /> Word count
                </dt>
                <dd>{words} words</dd>
              </div>
              <div className="flex items-center justify-between gap-3 text-mist">
                <dt className="inline-flex items-center gap-2">
                  <Globe2 className="h-3.5 w-3.5" strokeWidth={1.75} /> Visibility
                </dt>
                <dd>{visibility}</dd>
              </div>
            </dl>
          </section>
          <section className="rounded-2xl border border-line bg-panel p-5 shadow-sm shadow-black/20">
            <div className="flex gap-3">
              <Search aria-hidden className="mt-0.5 h-4 w-4 text-accent" strokeWidth={1.75} />
              <div>
                <h3 className="text-sm font-medium text-paper">SEO & metadata</h3>
                <p className="mt-1 text-xs leading-5 text-mist">Optimize for search engines.</p>
              </div>
            </div>
            <label className="mt-4 flex flex-col gap-2 text-sm">
              <span className="flex items-center justify-between text-xs font-medium tracking-wide text-mist">
                SEO title
                <span>
                  {fields.seoTitle.length}/{SEO_TITLE_MAX}
                </span>
              </span>
              <input
                name="seoTitle"
                value={fields.seoTitle}
                maxLength={SEO_TITLE_MAX}
                placeholder="Falls back to the post title"
                aria-invalid={fieldErrors.seoTitle ? true : undefined}
                aria-describedby={fieldErrors.seoTitle ? "seo-title-error" : undefined}
                onChange={(event) => patchFields({ seoTitle: event.target.value }, ["seoTitle"])}
                className={fieldClass}
              />
              <FieldError id="seo-title-error" message={fieldErrors.seoTitle} />
            </label>
            <label className="mt-4 flex flex-col gap-2 text-sm">
              <span className="text-xs font-medium tracking-wide text-mist">SEO keywords</span>
              <input
                name="seoKeywords"
                value={fields.seoKeywords}
                maxLength={500}
                placeholder="e.g. nextjs, react, tutorial"
                aria-invalid={fieldErrors.seoKeywords ? true : undefined}
                aria-describedby="seo-keywords-hint"
                onChange={(event) => patchFields({ seoKeywords: event.target.value }, ["seoKeywords"])}
                className={fieldClass}
              />
              <span id="seo-keywords-hint" className="text-xs text-mist">
                Comma separated keywords
              </span>
              <FieldError id="seo-keywords-error" message={fieldErrors.seoKeywords} />
            </label>
            <div className="mt-4 flex flex-col gap-2 text-sm">
              <span className="text-xs font-medium tracking-wide text-mist">Tags</span>
              <div className="flex min-h-12 flex-wrap items-center gap-2 rounded-lg border border-line bg-ink px-2 py-2 focus-within:border-accent">
                {fields.tags.map((tag) => (
                  <span key={tag} className="inline-flex items-center gap-1 rounded-full border border-line px-2 py-1 text-xs text-paper">
                    {tag}
                    <button
                      type="button"
                      aria-label={`Remove ${tag}`}
                      onClick={() => patchFields({ tags: fields.tags.filter((item) => item !== tag) }, ["tags"])}
                    >
                      <X className="h-3 w-3" strokeWidth={1.75} />
                    </button>
                  </span>
                ))}
                <input
                  value={tagDraft}
                  maxLength={80}
                  placeholder={fields.tags.length === 0 ? "design, notes" : ""}
                  aria-invalid={fieldErrors.tags ? true : undefined}
                  onChange={(event) => setTagDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === ",") {
                      event.preventDefault();
                      addTag(tagDraft.replace(/,/g, ""));
                    }
                  }}
                  onBlur={() => {
                    if (tagDraft.trim()) {
                      addTag(tagDraft);
                    }
                  }}
                  className="min-w-24 flex-1 bg-transparent px-1 text-sm text-paper outline-none placeholder:text-mist/70"
                />
              </div>
              <span className="text-xs text-mist">Comma separated tags</span>
              <FieldError id="tags-error" message={fieldErrors.tags} />
            </div>
          </section>
        </aside>
      </div>

      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-panel/95 px-3 py-3 backdrop-blur lg:left-60 xl:hidden">
        <EditorActions
          layout="bar"
          pending={pending}
          savedLabel={savedLabel}
          actions={actions}
          canArchive={Boolean(post) && actions.archive}
          canUpdate={actions.updateLive}
          onSave={save}
          saveDisabled={saveBlocked}
          onPublish={() => {
            if (!saveBlocked) {
              setConfirm("publish");
            }
          }}
          onUpdate={askUpdate}
          onUnpublish={() => setConfirm("unpublish")}
          onArchive={() => setConfirm("archive")}
          onPreview={() => setPreviewOpen(true)}
        />
      </div>

      {activeConfirm && confirm ? (
        <ConfirmDialog
          open
          title={activeConfirm.title}
          description={activeConfirm.description}
          confirmLabel={activeConfirm.confirmLabel}
          tone={activeConfirm.tone}
          pending={pending}
          onClose={() => setConfirm(null)}
          onConfirm={() => {
            const kind = confirm;
            setConfirm(null);
            if (kind === "publish") {
              publish(false);
            } else if (kind === "updateLive") {
              publish(false);
            } else if (kind === "force") {
              publish(true);
            } else if (kind === "unpublish") {
              unpublish();
            } else if (kind === "archive") {
              archive();
            } else if (kind === "discard") {
              discard();
            }
          }}
        />
      ) : null}

      <dialog
        ref={previewRef}
        aria-labelledby="post-preview-title"
        aria-modal="true"
        className="h-[calc(100%-2rem)] w-[calc(100%-2rem)] max-w-3xl rounded-xl border border-line bg-[#0b1110] p-0 text-[#e6eae4] backdrop:bg-black/70"
        onCancel={(event) => {
          event.preventDefault();
          setPreviewOpen(false);
        }}
        onClick={(event) => {
          if (event.target === previewRef.current) {
            setPreviewOpen(false);
          }
        }}
      >
        <div className="flex items-center justify-between border-b border-[#26372f] px-5 py-3">
          <p className="font-mono text-[11px] tracking-[0.18em] text-[#bcf3a4] uppercase">Preview</p>
          <button
            type="button"
            data-autofocus
            onClick={() => setPreviewOpen(false)}
            className="h-9 rounded-lg border border-[#26372f] px-3 text-sm text-[#e6eae4]"
          >
            Close
          </button>
        </div>
        <article className="blog-preview max-h-[calc(100%-3.5rem)] overflow-y-auto px-6 py-8 sm:px-10">
          <p className="font-mono text-xs tracking-[0.16em] text-[#bcf3a4]">shivamsingh.dev</p>
          <h1 id="post-preview-title" className="font-display mt-4 text-4xl leading-tight font-medium sm:text-5xl">
            {fields.title.trim() || "Untitled"}
          </h1>
          {fields.summary.trim() ? <p className="mt-5 text-lg leading-8 text-[#89968f]">{fields.summary.trim()}</p> : null}
          {fields.tags.length > 0 ? (
            <ul className="mt-5 flex flex-wrap gap-2">
              {fields.tags.map((tag) => (
                <li key={tag} className="rounded-full border border-[#26372f] px-3 py-1 text-xs text-[#89968f]">
                  {tag}
                </li>
              ))}
            </ul>
          ) : null}
          {plainText(fields.body) ? (
            <div className="blog-preview-body mt-8" dangerouslySetInnerHTML={{ __html: previewHtml(fields.body) }} />
          ) : (
            <p className="mt-8 text-sm text-[#89968f]">The body is empty.</p>
          )}
        </article>
      </dialog>
    </form>
  );
}

function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) {
    return null;
  }
  return (
    <p id={id} className="text-xs text-danger">
      {message}
    </p>
  );
}
