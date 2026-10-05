"use client";

import { Editor } from "@tinymce/tinymce-react";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  Clock3,
  Code,
  Eye,
  FileText,
  Globe2,
  Highlighter,
  Image as ImageIcon,
  Italic,
  Link2,
  List,
  ListChecks,
  ListOrdered,
  Minus,
  Plus,
  Quote,
  Redo2,
  RemoveFormatting,
  Save,
  Search,
  Send,
  Strikethrough,
  Subscript,
  Superscript,
  Table,
  Underline,
  Undo2,
  X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import Prism from "prismjs";
import { useRef, useState } from "react";
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

if (Prism.languages.markup) {
  Prism.languages.xml = Prism.languages.markup;
  Prism.languages.html = Prism.languages.markup;
}

const codeLanguages = [
  { text: "Bash", value: "bash" },
  { text: "CSS", value: "css" },
  { text: "Go", value: "go" },
  { text: "HTML", value: "html" },
  { text: "Java", value: "java" },
  { text: "JavaScript", value: "javascript" },
  { text: "JSON", value: "json" },
  { text: "Markdown", value: "markdown" },
  { text: "Python", value: "python" },
  { text: "Rust", value: "rust" },
  { text: "SQL", value: "sql" },
  { text: "TypeScript", value: "typescript" },
  { text: "XML", value: "xml" },
  { text: "YAML", value: "yaml" },
];

const fieldClass =
  "h-12 w-full rounded-lg border border-line bg-ink px-3 text-sm text-paper outline-none transition-colors placeholder:text-mist/70 focus:border-accent";

function slugFromTitle(title: string): string {
  return title
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 180);
}

function previewHtml(html: string): string {
  return html.replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, "");
}

function plainText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .trim();
}

function registerDeskButtons(editor: TinyMCEEditor) {
  editor.ui.registry.addIcon(
    "tasklist",
    '<svg width="24" height="24" viewBox="0 0 24 24"><path fill="currentColor" d="M4 6h4v4H4zm1.2 1.2.8.8 1.6-1.6-.8-.8zm5.8.8h9v1.6h-9zM4 15h4v1.6H4zm7 .2h9v1.6h-9z"/></svg>',
  );
  editor.ui.registry.addToggleButton("tasklist", {
    icon: "tasklist",
    tooltip: "Task list",
    onAction: () => {
      const existing = editor.dom.getParent(editor.selection.getNode(), "ul.task-list");
      if (existing) {
        editor.dom.removeClass(existing, "task-list");
        editor.dom.setAttrib(existing, "style", null);
        return;
      }
      editor.execCommand("InsertUnorderedList");
      const list = editor.dom.getParent(editor.selection.getNode(), "ul");
      if (!list) {
        return;
      }
      editor.dom.addClass(list, "task-list");
      list.querySelectorAll(":scope > li").forEach((item) => {
        if (item.querySelector("input[type='checkbox']")) {
          return;
        }
        const box = editor.dom.create("input", { type: "checkbox" });
        item.insertBefore(box, item.firstChild);
      });
    },
    onSetup: (api) => {
      const sync = () => {
        api.setActive(Boolean(editor.dom.getParent(editor.selection.getNode(), "ul.task-list")));
      };
      editor.on("NodeChange", sync);
      return () => {
        editor.off("NodeChange", sync);
      };
    },
  });

  editor.ui.registry.addToggleButton("inlinecode", {
    icon: "sourcecode",
    tooltip: "Inline code",
    onAction: () => {
      editor.formatter.toggle("code");
      editor.nodeChanged();
    },
    onSetup: (api) => {
      const sync = () => api.setActive(editor.formatter.match("code"));
      editor.on("NodeChange", sync);
      return () => {
        editor.off("NodeChange", sync);
      };
    },
  });
}

const SUMMARY_MAX = 500;
const SEO_TITLE_MAX = 200;

function wordCount(html: string): number {
  const text = plainText(html);
  return text ? text.split(/\s+/).length : 0;
}

export function PostEditor() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [body, setBody] = useState("");
  const [summary, setSummary] = useState("");
  const [seoTitle, setSeoTitle] = useState("");
  const [status, setStatus] = useState<"draft" | "published">("draft");
  const [tags, setTags] = useState<string[]>([]);
  const [tagDraft, setTagDraft] = useState("");
  const [blocksOpen, setBlocksOpen] = useState(false);
  const [preview, setPreview] = useState<{ title: string; summary: string; tags: string } | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const editorRef = useRef<TinyMCEEditor | null>(null);
  const words = wordCount(body);

  function addTag(raw: string) {
    const next = raw.trim();
    if (!next || tags.includes(next)) {
      setTagDraft("");
      return;
    }
    const joined = [...tags, next].join(", ");
    if (joined.length > 500) {
      return;
    }
    setTags((current) => [...current, next]);
    setTagDraft("");
  }

  function runCommand(command: string, value?: string | Record<string, number>) {
    const editor = editorRef.current;
    if (!editor) {
      return;
    }
    editor.focus();
    editor.execCommand(command, false, value as string);
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
      editor.execCommand("InsertUnorderedList");
      const list = editor.dom.getParent(editor.selection.getNode(), "ul");
      if (list) {
        editor.dom.addClass(list, "task-list");
      }
    } else if (kind === "code") {
      editor.execCommand("CodeSample");
    } else if (kind === "rule") {
      editor.execCommand("InsertHorizontalRule");
    } else if (kind === "image") {
      editor.execCommand("mceImage");
    } else if (kind === "table") {
      editor.execCommand("mceInsertTable", false, { rows: 2, columns: 2 });
    }
    setBlocksOpen(false);
  }

  function openPreview() {
    const form = formRef.current;
    if (!form) {
      return;
    }
    const fields = new FormData(form);
    setPreview({
      title: String(fields.get("title") ?? "").trim() || "Untitled",
      summary: String(fields.get("summary") ?? "").trim(),
      tags: String(fields.get("tags") ?? "").trim(),
    });
    dialogRef.current?.showModal();
  }

  const toolButton =
    "inline-flex h-8 w-8 items-center justify-center rounded-md text-mist transition-colors hover:bg-white/[0.04] hover:text-paper focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

  return (
    <form
      ref={formRef}
      className="flex w-full flex-col gap-6"
      onSubmit={(event) => {
        event.preventDefault();
        if (pending) {
          return;
        }
        const form = event.currentTarget;
        const data = new FormData(form);
        if (!plainText(body)) {
          setError("Write the post before saving.");
          return;
        }
        const payload = {
          title: data.get("title"),
          slug: data.get("slug"),
          summary: data.get("summary"),
          tags: data.get("tags"),
          seoKeywords: data.get("seoKeywords"),
          seoTitle: data.get("seoTitle"),
          status: data.get("status"),
          bodyHtml: body,
        };
        setPending(true);
        setError(null);
        void (async () => {
          try {
            const response = await fetch("/api/posts", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify(payload),
            });
            const result = (await response.json().catch(() => null)) as { error?: string } | null;
            if (!response.ok) {
              setError(result?.error ?? "The post could not be saved.");
              return;
            }
            router.push("/posts");
            router.refresh();
          } catch {
            setError("The post could not be saved.");
          } finally {
            setPending(false);
          }
        })();
      }}
    >
      <header>
        <p className="font-mono text-[11px] tracking-[0.18em] text-accent uppercase">Posts</p>
        <h2 className="font-display mt-2 text-4xl leading-none font-medium tracking-tight text-paper">New post</h2>
        <p className="mt-3 text-sm text-mist">Draft and edit content inline before publishing.</p>
      </header>
      {error ? (
        <p role="alert" className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
          {error}
        </p>
      ) : null}
      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_22.5rem]">
        <section className="rounded-2xl border border-line bg-panel p-5 shadow-sm shadow-black/20 sm:p-6">
          <label className="flex flex-col gap-2">
            <span className="text-xs font-medium tracking-wide text-mist">Title</span>
            <input
              name="title"
              required
              maxLength={200}
              placeholder="Write your headline…"
              className="h-14 w-full rounded-lg border border-transparent bg-transparent px-1 font-display text-3xl text-paper outline-none placeholder:text-mist/50 focus:border-accent/70"
              onChange={(event) => {
                const slug = event.currentTarget.form?.elements.namedItem("slug");
                if (slug instanceof HTMLInputElement && slug.dataset.touched !== "true") {
                  slug.value = slugFromTitle(event.currentTarget.value);
                }
              }}
            />
          </label>
          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <label className="flex flex-col gap-2 text-sm">
              <span className="text-xs font-medium tracking-wide text-mist">URL slug</span>
              <span className="relative">
                <Link2 aria-hidden className="pointer-events-none absolute top-3.5 left-3 h-4 w-4 text-mist" strokeWidth={1.75} />
                <input
                  name="slug"
                  required
                  maxLength={180}
                  pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
                  placeholder="e.g. my-awesome-post"
                  className={`${fieldClass} pl-9`}
                  onChange={(event) => {
                    event.currentTarget.dataset.touched = "true";
                  }}
                />
              </span>
            </label>
            <label className="flex flex-col gap-2 text-sm">
              <span className="text-xs font-medium tracking-wide text-mist">Status</span>
              <select
                name="status"
                value={status}
                onChange={(event) => setStatus(event.target.value === "published" ? "published" : "draft")}
                className={fieldClass}
              >
                <option value="draft">Draft</option>
                <option value="published">Published</option>
              </select>
            </label>
          </div>
          <label className="mt-5 flex flex-col gap-2 text-sm">
            <span className="flex items-center justify-between text-xs font-medium tracking-wide text-mist">
              Summary
              <span>
                {summary.length}/{SUMMARY_MAX}
              </span>
            </span>
            <textarea
              name="summary"
              value={summary}
              maxLength={SUMMARY_MAX}
              rows={3}
              placeholder="Write a short summary or excerpt for this post…"
              onChange={(event) => setSummary(event.target.value)}
              className="w-full rounded-lg border border-line bg-ink px-3 py-3 text-sm text-paper outline-none transition-colors placeholder:text-mist/70 focus:border-accent"
            />
          </label>
          <div className="relative mt-6 rounded-xl border border-line bg-ink">
            <div className="flex flex-wrap items-center gap-1 border-b border-line px-2 py-2">
              <select
                aria-label="Paragraph type"
                defaultValue="p"
                onChange={(event) => runCommand("FormatBlock", event.target.value)}
                className="h-8 rounded-md border border-line bg-ink px-2 text-xs text-paper outline-none focus:border-accent"
              >
                <option value="p">Paragraph</option>
                <option value="h2">Heading 2</option>
                <option value="h3">Heading 3</option>
                <option value="h4">Heading 4</option>
              </select>
              <button type="button" className={toolButton} aria-label="Bold" onClick={() => runCommand("Bold")}>
                <Bold className="h-4 w-4" strokeWidth={1.75} />
              </button>
              <button type="button" className={toolButton} aria-label="Italic" onClick={() => runCommand("Italic")}>
                <Italic className="h-4 w-4" strokeWidth={1.75} />
              </button>
              <button type="button" className={toolButton} aria-label="Underline" onClick={() => runCommand("Underline")}>
                <Underline className="h-4 w-4" strokeWidth={1.75} />
              </button>
              <button type="button" className={toolButton} aria-label="Strikethrough" onClick={() => runCommand("Strikethrough")}>
                <Strikethrough className="h-4 w-4" strokeWidth={1.75} />
              </button>
              <button type="button" className={toolButton} aria-label="Highlight" onClick={() => runCommand("HiliteColor", "#314232")}>
                <Highlighter className="h-4 w-4" strokeWidth={1.75} />
              </button>
              <button type="button" className={toolButton} aria-label="Inline code" onClick={() => editorRef.current?.formatter.toggle("code")}>
                <Code className="h-4 w-4" strokeWidth={1.75} />
              </button>
              <button type="button" className={toolButton} aria-label="Subscript" onClick={() => runCommand("Subscript")}>
                <Subscript className="h-4 w-4" strokeWidth={1.75} />
              </button>
              <button type="button" className={toolButton} aria-label="Superscript" onClick={() => runCommand("Superscript")}>
                <Superscript className="h-4 w-4" strokeWidth={1.75} />
              </button>
              <button type="button" className={toolButton} aria-label="Align left" onClick={() => runCommand("JustifyLeft")}>
                <AlignLeft className="h-4 w-4" strokeWidth={1.75} />
              </button>
              <button type="button" className={toolButton} aria-label="Align center" onClick={() => runCommand("JustifyCenter")}>
                <AlignCenter className="h-4 w-4" strokeWidth={1.75} />
              </button>
              <button type="button" className={toolButton} aria-label="Align right" onClick={() => runCommand("JustifyRight")}>
                <AlignRight className="h-4 w-4" strokeWidth={1.75} />
              </button>
              <button type="button" className={toolButton} aria-label="Bullet list" onClick={() => runCommand("InsertUnorderedList")}>
                <List className="h-4 w-4" strokeWidth={1.75} />
              </button>
              <button type="button" className={toolButton} aria-label="Numbered list" onClick={() => runCommand("InsertOrderedList")}>
                <ListOrdered className="h-4 w-4" strokeWidth={1.75} />
              </button>
              <button type="button" className={toolButton} aria-label="Task list" onClick={() => insertBlock("tasks")}>
                <ListChecks className="h-4 w-4" strokeWidth={1.75} />
              </button>
              <button type="button" className={toolButton} aria-label="Quote" onClick={() => runCommand("mceBlockQuote")}>
                <Quote className="h-4 w-4" strokeWidth={1.75} />
              </button>
              <button type="button" className={toolButton} aria-label="Code block" onClick={() => runCommand("CodeSample")}>
                <Code className="h-4 w-4" strokeWidth={1.75} />
              </button>
              <button type="button" className={toolButton} aria-label="Link" onClick={() => runCommand("mceLink")}>
                <Link2 className="h-4 w-4" strokeWidth={1.75} />
              </button>
              <button type="button" className={toolButton} aria-label="Image" onClick={() => runCommand("mceImage")}>
                <ImageIcon className="h-4 w-4" strokeWidth={1.75} />
              </button>
              <button type="button" className={toolButton} aria-label="Table" onClick={() => insertBlock("table")}>
                <Table className="h-4 w-4" strokeWidth={1.75} />
              </button>
              <button type="button" className={toolButton} aria-label="Horizontal rule" onClick={() => runCommand("InsertHorizontalRule")}>
                <Minus className="h-4 w-4" strokeWidth={1.75} />
              </button>
              <button type="button" className={toolButton} aria-label="Clear formatting" onClick={() => runCommand("RemoveFormat")}>
                <RemoveFormatting className="h-4 w-4" strokeWidth={1.75} />
              </button>
              <button type="button" className={toolButton} aria-label="Undo" onClick={() => runCommand("Undo")}>
                <Undo2 className="h-4 w-4" strokeWidth={1.75} />
              </button>
              <button type="button" className={toolButton} aria-label="Redo" onClick={() => runCommand("Redo")}>
                <Redo2 className="h-4 w-4" strokeWidth={1.75} />
              </button>
            </div>
            <Editor
              id="post-body"
              licenseKey="gpl"
              inline
              tagName="div"
              tinymceScriptSrc="/tinymce/tinymce.min.js"
              onInit={(_event, editor) => {
                editorRef.current = editor;
              }}
              onEditorChange={setBody}
              init={{
                inline: true,
                skin: "oxide-dark",
                toolbar: false,
                menubar: false,
                statusbar: false,
                branding: false,
                promotion: false,
                placeholder: "Start writing your post…",
                plugins: "lists advlist link autolink codesample code image table",
                codesample_global_prismjs: true,
                codesample_languages: codeLanguages,
                extended_valid_elements: "input[type|checked]",
                valid_children: "+li[input]",
                setup: (editor) => {
                  registerDeskButtons(editor);
                  editor.on("keyup", (event) => {
                    if (event.key === "Escape") {
                      setBlocksOpen(false);
                      return;
                    }
                    const text = (editor.selection.getNode().textContent ?? "").trim();
                    setBlocksOpen(text === "/");
                  });
                },
              }}
            />
            <div className="flex items-end justify-between gap-3 px-3 py-2">
              <div className="relative">
                <button
                  type="button"
                  className="inline-flex items-center gap-2 text-xs text-mist hover:text-paper"
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
          {!plainText(body) ? (
            <p className="mt-3 text-sm text-mist">You can format text, add links, images, lists and more.</p>
          ) : null}
        </section>
        <aside className="flex flex-col gap-4">
          <section className="rounded-2xl border border-line bg-panel p-5 shadow-sm shadow-black/20">
            <div className="flex items-start justify-between gap-3">
              <div className="flex gap-3">
                <Send aria-hidden className="mt-0.5 h-4 w-4 text-accent" strokeWidth={1.75} />
                <div>
                  <h3 className="text-sm font-medium text-paper">Publish</h3>
                  <p className="mt-1 text-xs leading-5 text-mist">Manage the status and publish your post.</p>
                </div>
              </div>
              <span className="rounded-full border border-accent/30 bg-accent/10 px-2 py-0.5 text-[11px] text-accent">
                {status === "published" ? "Published" : "Draft"}
              </span>
            </div>
            <button
              type="submit"
              disabled={pending}
              className="mt-4 inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-accent text-sm font-semibold text-ink transition-[filter] hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Save className="h-4 w-4" strokeWidth={1.75} />
              {pending ? "Saving" : "Save post"}
            </button>
            <button
              type="button"
              onClick={openPreview}
              className="mt-2 inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg border border-line text-sm text-paper transition-colors hover:border-paper/30"
            >
              <Eye className="h-4 w-4" strokeWidth={1.75} />
              Preview
            </button>
            <dl className="mt-4 space-y-3 border-t border-line pt-4 text-sm">
              <div className="flex items-center justify-between gap-3 text-mist">
                <dt className="inline-flex items-center gap-2">
                  <Clock3 className="h-3.5 w-3.5" strokeWidth={1.75} /> Last edited
                </dt>
                <dd>Not saved yet</dd>
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
                <dd>Private</dd>
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
                  {seoTitle.length}/{SEO_TITLE_MAX}
                </span>
              </span>
              <input
                name="seoTitle"
                value={seoTitle}
                maxLength={SEO_TITLE_MAX}
                placeholder="Falls back to the post title"
                onChange={(event) => setSeoTitle(event.target.value)}
                className={fieldClass}
              />
            </label>
            <label className="mt-4 flex flex-col gap-2 text-sm">
              <span className="text-xs font-medium tracking-wide text-mist">SEO keywords</span>
              <input name="seoKeywords" maxLength={500} placeholder="e.g. nextjs, react, tutorial" className={fieldClass} />
              <span className="text-xs text-mist">Comma separated keywords</span>
            </label>
            <div className="mt-4 flex flex-col gap-2 text-sm">
              <span className="text-xs font-medium tracking-wide text-mist">Tags</span>
              <input type="hidden" name="tags" value={tags.join(", ")} />
              <div className="flex min-h-12 flex-wrap items-center gap-2 rounded-lg border border-line bg-ink px-2 py-2 focus-within:border-accent">
                {tags.map((tag) => (
                  <span key={tag} className="inline-flex items-center gap-1 rounded-full border border-line px-2 py-1 text-xs text-paper">
                    {tag}
                    <button type="button" aria-label={`Remove ${tag}`} onClick={() => setTags((current) => current.filter((item) => item !== tag))}>
                      <X className="h-3 w-3" strokeWidth={1.75} />
                    </button>
                  </span>
                ))}
                <input
                  value={tagDraft}
                  maxLength={80}
                  placeholder={tags.length === 0 ? "design, notes" : ""}
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
            </div>
          </section>
        </aside>
      </div>
      <dialog
        ref={dialogRef}
        aria-labelledby="post-preview-title"
        className="h-[calc(100%-2rem)] w-[calc(100%-2rem)] max-w-3xl rounded-xl border border-line bg-[#0b1110] p-0 text-[#e6eae4] backdrop:bg-black/70"
        onClick={(event) => {
          if (event.target === dialogRef.current) {
            dialogRef.current?.close();
          }
        }}
      >
        <div className="flex items-center justify-between border-b border-[#26372f] px-5 py-3">
          <p className="font-mono text-[11px] tracking-[0.18em] text-[#bcf3a4] uppercase">Preview</p>
          <button
            type="button"
            onClick={() => dialogRef.current?.close()}
            className="h-9 rounded-lg border border-[#26372f] px-3 text-sm text-[#e6eae4]"
          >
            Close
          </button>
        </div>
        <article className="blog-preview max-h-[calc(100%-3.5rem)] overflow-y-auto px-6 py-8 sm:px-10">
          <p className="font-mono text-xs tracking-[0.16em] text-[#bcf3a4]">shivamsingh.dev</p>
          <h1 id="post-preview-title" className="font-display mt-4 text-4xl leading-tight font-medium sm:text-5xl">
            {preview?.title}
          </h1>
          {preview?.summary ? <p className="mt-5 text-lg leading-8 text-[#89968f]">{preview.summary}</p> : null}
          {preview?.tags ? (
            <ul className="mt-5 flex flex-wrap gap-2">
              {preview.tags
                .split(",")
                .map((tag) => tag.trim())
                .filter(Boolean)
                .map((tag) => (
                  <li key={tag} className="rounded-full border border-[#26372f] px-3 py-1 text-xs text-[#89968f]">
                    {tag}
                  </li>
                ))}
            </ul>
          ) : null}
          {plainText(body) ? (
            <div className="blog-preview-body mt-8" dangerouslySetInnerHTML={{ __html: previewHtml(body) }} />
          ) : (
            <p className="mt-8 text-sm text-[#89968f]">The body is empty.</p>
          )}
        </article>
      </dialog>
    </form>
  );
}
