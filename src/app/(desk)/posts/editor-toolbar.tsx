"use client";

import {
  Bold,
  Code,
  Highlighter,
  Image as ImageIcon,
  Italic,
  Link2,
  List,
  ListChecks,
  ListOrdered,
  Minus,
  Quote,
  Redo2,
  RemoveFormatting,
  SquareCode,
  Strikethrough,
  Table,
  Undo2,
} from "lucide-react";
import type { ReactNode } from "react";
import type { Editor as TinyMCEEditor } from "tinymce";

import { EDITOR_INVALID_STYLES, EDITOR_VALID_ELEMENTS, normalizeEditorHtml } from "@/lib/editor-html";

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

export type BlockType = "p" | "h2" | "h3" | "h4";

export type ToolbarSnapshot = {
  block: BlockType;
  bold: boolean;
  italic: boolean;
  strike: boolean;
  mark: boolean;
  inlineCode: boolean;
  bullet: boolean;
  numbered: boolean;
  task: boolean;
  quote: boolean;
  codeBlock: boolean;
};

export const defaultToolbar: ToolbarSnapshot = {
  block: "p",
  bold: false,
  italic: false,
  strike: false,
  mark: false,
  inlineCode: false,
  bullet: false,
  numbered: false,
  task: false,
  quote: false,
  codeBlock: false,
};

export function isBlockType(value: string): value is BlockType {
  return value === "p" || value === "h2" || value === "h3" || value === "h4";
}

type EditorHandlers = {
  onSlash: (open: boolean) => void;
  onToolbar: (snapshot: ToolbarSnapshot) => void;
};

function matchFormat(editor: TinyMCEEditor, name: string): boolean {
  try {
    return editor.formatter.match(name) === true;
  } catch {
    return false;
  }
}

export function readToolbarState(editor: TinyMCEEditor): ToolbarSnapshot {
  const node = editor.selection.getNode();
  const blockNode = editor.dom.getParent(node, "h2,h3,h4");
  const blockName = blockNode?.nodeName.toLowerCase() ?? "";
  const block: BlockType = isBlockType(blockName) && blockName !== "p" ? blockName : "p";
  const task = Boolean(editor.dom.getParent(node, "ul.task-list"));
  return {
    block,
    bold: matchFormat(editor, "bold"),
    italic: matchFormat(editor, "italic"),
    strike: matchFormat(editor, "strikethrough"),
    mark: matchFormat(editor, "mark"),
    inlineCode: matchFormat(editor, "code"),
    bullet: !task && Boolean(editor.dom.getParent(node, "ul")),
    numbered: Boolean(editor.dom.getParent(node, "ol")),
    task,
    quote: Boolean(editor.dom.getParent(node, "blockquote")),
    codeBlock: Boolean(editor.dom.getParent(node, "pre")),
  };
}

function asElement(node: Node | null): HTMLElement | null {
  return node instanceof HTMLElement ? node : null;
}

function ensureTaskCheckboxes(editor: TinyMCEEditor): void {
  const body = editor.getBody();
  if (!body) {
    return;
  }
  body.querySelectorAll("ul.task-list > li").forEach((item) => {
    if (item.querySelector(":scope > input[type='checkbox']")) {
      return;
    }
    const box = editor.dom.create("input", { type: "checkbox", disabled: "disabled" });
    item.insertBefore(box, item.firstChild);
  });
}

export function toggleTaskList(editor: TinyMCEEditor): void {
  const existing = asElement(editor.dom.getParent(editor.selection.getNode(), "ul.task-list"));
  if (existing) {
    editor.dom.removeClass(existing, "task-list");
    existing.querySelectorAll(":scope > li > input[type='checkbox']").forEach((input) => {
      input.remove();
    });
    editor.nodeChanged();
    return;
  }
  editor.execCommand("InsertUnorderedList");
  const list = asElement(editor.dom.getParent(editor.selection.getNode(), "ul"));
  if (!list) {
    return;
  }
  editor.dom.addClass(list, "task-list");
  ensureTaskCheckboxes(editor);
  editor.nodeChanged();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function createEditorInit(handlers: EditorHandlers) {
  return {
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
    formats: {
      mark: { inline: "mark" },
    },
    valid_elements: EDITOR_VALID_ELEMENTS,
    invalid_elements: "script,iframe,object,embed,form,svg,u,sub,sup",
    invalid_styles: EDITOR_INVALID_STYLES,
    valid_children: "+li[input]",
    setup: (editor: TinyMCEEditor) => {
      let adjusting = false;
      editor.on("NodeChange", () => {
        if (!adjusting) {
          adjusting = true;
          ensureTaskCheckboxes(editor);
          adjusting = false;
        }
        handlers.onToolbar(readToolbarState(editor));
      });
      editor.on("PostProcess", (event: unknown) => {
        if (!isRecord(event) || event.get !== true || typeof event.content !== "string") {
          return;
        }
        event.content = normalizeEditorHtml(event.content);
      });
      editor.on("keyup", (event: unknown) => {
        const key = isRecord(event) && typeof event.key === "string" ? event.key : "";
        if (key === "Escape") {
          handlers.onSlash(false);
          return;
        }
        const text = (editor.selection.getNode().textContent ?? "").trim();
        handlers.onSlash(text === "/");
      });
    },
  };
}

function toolClass(active: boolean): string {
  return [
    "inline-flex h-8 w-8 items-center justify-center rounded-md transition-colors hover:bg-white/[0.04] hover:text-paper focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
    active ? "bg-white/[0.08] text-paper" : "text-mist",
  ].join(" ");
}

function ToolButton({
  label,
  pressed,
  onClick,
  children,
}: {
  label: string;
  pressed?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={toolClass(pressed === true)}
      aria-label={label}
      aria-pressed={pressed}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

export function EditorToolbar({
  snapshot,
  onCommand,
  onBlock,
  onFormat,
  onTask,
}: {
  snapshot: ToolbarSnapshot;
  onCommand: (command: string, value?: string) => void;
  onBlock: (block: BlockType) => void;
  onFormat: (format: "mark" | "code") => void;
  onTask: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1 border-b border-line px-2 py-2">
      <select
        aria-label="Paragraph type"
        value={snapshot.block}
        onChange={(event) => {
          if (isBlockType(event.target.value)) {
            onBlock(event.target.value);
          }
        }}
        className="h-8 rounded-md border border-line bg-ink px-2 text-xs text-paper outline-none focus:border-accent"
      >
        <option value="p">Paragraph</option>
        <option value="h2">Heading 2</option>
        <option value="h3">Heading 3</option>
        <option value="h4">Heading 4</option>
      </select>
      <ToolButton label="Bold" pressed={snapshot.bold} onClick={() => onCommand("Bold")}>
        <Bold className="h-4 w-4" strokeWidth={1.75} />
      </ToolButton>
      <ToolButton label="Italic" pressed={snapshot.italic} onClick={() => onCommand("Italic")}>
        <Italic className="h-4 w-4" strokeWidth={1.75} />
      </ToolButton>
      <ToolButton label="Strikethrough" pressed={snapshot.strike} onClick={() => onCommand("Strikethrough")}>
        <Strikethrough className="h-4 w-4" strokeWidth={1.75} />
      </ToolButton>
      <ToolButton label="Highlight" pressed={snapshot.mark} onClick={() => onFormat("mark")}>
        <Highlighter className="h-4 w-4" strokeWidth={1.75} />
      </ToolButton>
      <ToolButton label="Inline code" pressed={snapshot.inlineCode} onClick={() => onFormat("code")}>
        <Code className="h-4 w-4" strokeWidth={1.75} />
      </ToolButton>
      <ToolButton label="Bullet list" pressed={snapshot.bullet} onClick={() => onCommand("InsertUnorderedList")}>
        <List className="h-4 w-4" strokeWidth={1.75} />
      </ToolButton>
      <ToolButton label="Numbered list" pressed={snapshot.numbered} onClick={() => onCommand("InsertOrderedList")}>
        <ListOrdered className="h-4 w-4" strokeWidth={1.75} />
      </ToolButton>
      <ToolButton label="Task list" pressed={snapshot.task} onClick={onTask}>
        <ListChecks className="h-4 w-4" strokeWidth={1.75} />
      </ToolButton>
      <ToolButton label="Quote" pressed={snapshot.quote} onClick={() => onCommand("mceBlockQuote")}>
        <Quote className="h-4 w-4" strokeWidth={1.75} />
      </ToolButton>
      <ToolButton label="Code block" pressed={snapshot.codeBlock} onClick={() => onCommand("CodeSample")}>
        <SquareCode className="h-4 w-4" strokeWidth={1.75} />
      </ToolButton>
      <ToolButton label="Link" onClick={() => onCommand("mceLink")}>
        <Link2 className="h-4 w-4" strokeWidth={1.75} />
      </ToolButton>
      <ToolButton label="Image" onClick={() => onCommand("mceImage")}>
        <ImageIcon className="h-4 w-4" strokeWidth={1.75} />
      </ToolButton>
      <ToolButton label="Table" onClick={() => onCommand("mceInsertTable")}>
        <Table className="h-4 w-4" strokeWidth={1.75} />
      </ToolButton>
      <ToolButton label="Horizontal rule" onClick={() => onCommand("InsertHorizontalRule")}>
        <Minus className="h-4 w-4" strokeWidth={1.75} />
      </ToolButton>
      <ToolButton label="Clear formatting" onClick={() => onCommand("RemoveFormat")}>
        <RemoveFormatting className="h-4 w-4" strokeWidth={1.75} />
      </ToolButton>
      <ToolButton label="Undo" onClick={() => onCommand("Undo")}>
        <Undo2 className="h-4 w-4" strokeWidth={1.75} />
      </ToolButton>
      <ToolButton label="Redo" onClick={() => onCommand("Redo")}>
        <Redo2 className="h-4 w-4" strokeWidth={1.75} />
      </ToolButton>
    </div>
  );
}
