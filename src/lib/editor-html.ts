const LANGUAGE_CLASS = /^language-[\w-]+$/;

const DROP = new Set(["script", "style", "iframe", "object", "embed", "form", "svg", "link", "meta", "base"]);

const ALLOWED = new Set([
  "p",
  "h2",
  "h3",
  "h4",
  "strong",
  "em",
  "s",
  "code",
  "pre",
  "blockquote",
  "ul",
  "ol",
  "li",
  "table",
  "thead",
  "tbody",
  "tfoot",
  "tr",
  "th",
  "td",
  "caption",
  "hr",
  "br",
  "a",
  "img",
  "figure",
  "figcaption",
  "mark",
  "input",
]);

const RENAME: Record<string, string> = {
  b: "strong",
  i: "em",
  strike: "s",
  del: "s",
};

/**
 * Rewrites editor HTML onto the slice-1 allow-list before preview or save.
 * The server sanitiser remains the boundary that stores HTML.
 */
export function normalizeEditorHtml(html: string): string {
  if (!html.trim() || typeof DOMParser === "undefined") {
    return html;
  }

  const document = new DOMParser().parseFromString(html, "text/html");
  normalizeChildren(document.body, document);
  return document.body.innerHTML;
}

function normalizeChildren(parent: HTMLElement, document: Document): void {
  for (const child of [...parent.childNodes]) {
    if (child.nodeType === Node.TEXT_NODE) {
      continue;
    }
    if (!(child instanceof HTMLElement)) {
      child.remove();
      continue;
    }

    const original = child.tagName.toLowerCase();
    if (DROP.has(original)) {
      child.remove();
      continue;
    }

    let element = child;
    const renamed = RENAME[original];
    if (renamed) {
      const next = document.createElement(renamed);
      while (element.firstChild) {
        next.append(element.firstChild);
      }
      element.replaceWith(next);
      element = next;
    }

    const tag = element.tagName.toLowerCase();
    if (!ALLOWED.has(tag)) {
      normalizeChildren(element, document);
      while (element.firstChild) {
        parent.insertBefore(element.firstChild, element);
      }
      element.remove();
      continue;
    }

    if (tag === "input" && !taskCheckbox(element)) {
      element.remove();
      continue;
    }

    normalizeChildren(element, document);
    applyAttributes(element, document);

    if (tag === "a" && !element.getAttribute("href")) {
      while (element.firstChild) {
        parent.insertBefore(element.firstChild, element);
      }
      element.remove();
    }
  }
}

function taskCheckbox(element: HTMLElement): boolean {
  const item = element.parentElement;
  const list = item?.parentElement;
  return (
    item?.tagName.toLowerCase() === "li" &&
    list?.tagName.toLowerCase() === "ul" &&
    list.classList.contains("task-list")
  );
}

function applyAttributes(element: HTMLElement, document: Document): void {
  const tag = element.tagName.toLowerCase();
  const language = [...element.classList].find((name) => LANGUAGE_CLASS.test(name)) ?? null;
  const taskList = element.classList.contains("task-list");
  const href = safeHref(element.getAttribute("href"));
  const src = safeImageSrc(element.getAttribute("src"));
  const alt = element.getAttribute("alt");
  const width = digits(element.getAttribute("width"));
  const height = digits(element.getAttribute("height"));
  const colspan = digits(element.getAttribute("colspan"));
  const rowspan = digits(element.getAttribute("rowspan"));
  const scope = element.getAttribute("scope");
  const checked = element.hasAttribute("checked");

  for (const attribute of [...element.attributes]) {
    element.removeAttribute(attribute.name);
  }

  if ((tag === "pre" || tag === "code") && language) {
    element.className = language;
  }
  if (tag === "ul" && taskList) {
    element.className = "task-list";
  }
  if (tag === "a" && href) {
    element.setAttribute("href", href);
    element.setAttribute("rel", "noopener noreferrer");
  }
  if (tag === "img") {
    if (!src) {
      element.remove();
      return;
    }
    element.setAttribute("src", src);
    element.setAttribute("alt", alt ?? "");
    if (width) {
      element.setAttribute("width", width);
    }
    if (height) {
      element.setAttribute("height", height);
    }
  }
  if ((tag === "th" || tag === "td") && colspan) {
    element.setAttribute("colspan", colspan);
  }
  if ((tag === "th" || tag === "td") && rowspan) {
    element.setAttribute("rowspan", rowspan);
  }
  if (tag === "th" && scope && ["row", "col", "rowgroup", "colgroup"].includes(scope)) {
    element.setAttribute("scope", scope);
  }
  if (tag === "input") {
    element.setAttribute("type", "checkbox");
    if (checked) {
      element.setAttribute("checked", "");
    }
    element.setAttribute("disabled", "");
  }
  if (tag === "pre") {
    ensureCodeSample(element, document, language);
  }
}

function ensureCodeSample(pre: HTMLElement, document: Document, language: string | null): void {
  if (!language) {
    return;
  }
  let code = [...pre.children].find((child) => child.tagName.toLowerCase() === "code");
  if (!(code instanceof HTMLElement)) {
    const created = document.createElement("code");
    while (pre.firstChild) {
      created.append(pre.firstChild);
    }
    pre.append(created);
    code = created;
  }
  code.classList.add(language);
}

function safeHref(value: string | null): string | null {
  if (!value) {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  try {
    const url = new URL(trimmed, "https://example.invalid");
    if ((url.protocol === "http:" || url.protocol === "https:") && /^https?:/i.test(trimmed)) {
      return url.href;
    }
    if (url.protocol === "mailto:" && /^mailto:/i.test(trimmed)) {
      return trimmed;
    }
  } catch {
    return null;
  }
  return null;
}

function safeImageSrc(value: string | null): string | null {
  if (!value) {
    return null;
  }
  const trimmed = value.trim();
  if (trimmed.startsWith("/") && !trimmed.startsWith("//") && !trimmed.startsWith("/\\")) {
    return trimmed;
  }
  try {
    const url = new URL(trimmed);
    if (url.protocol === "https:") {
      return url.href;
    }
  } catch {
    return null;
  }
  return null;
}

function digits(value: string | null): string | null {
  if (!value || !/^\d{1,5}$/.test(value)) {
    return null;
  }
  return value;
}

/** Elements TinyMCE may keep while editing. Output is passed through normalizeEditorHtml. */
export const EDITOR_VALID_ELEMENTS = [
  "p",
  "h2",
  "h3",
  "h4",
  "strong/b",
  "em/i",
  "s/del/strike",
  "code[class]",
  "pre[class|id]",
  "blockquote",
  "ul[class]",
  "ol",
  "li",
  "table",
  "thead",
  "tbody",
  "tfoot",
  "tr",
  "th[colspan|rowspan|scope]",
  "td[colspan|rowspan]",
  "caption",
  "hr",
  "br",
  "a[href|rel|target|title]",
  "img[src|alt|width|height]",
  "figure",
  "figcaption",
  "mark",
  "input[type|checked|disabled]",
  "span[class]",
].join(",");

export const EDITOR_INVALID_STYLES =
  "color,background,background-color,font-size,font-family,text-align,text-decoration,text-decoration-line,font-weight,font-style,margin,margin-left,margin-right,padding,border,width,height,line-height,vertical-align";
