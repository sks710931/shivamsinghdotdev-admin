import sanitize from "sanitize-html";

const LANGUAGE = (c: string) => /^language-[a-z0-9+#-]+$/i.test(c);
const TASK_LIST = (c: string) => c === "task-list";

function classOnly(attribs: sanitize.Attributes, allowed: (c: string) => boolean): sanitize.Attributes {
  const { class: cls, ...rest } = attribs;
  const kept = (cls ?? "").split(/\s+/).filter((c) => c && allowed(c));
  return kept.length > 0 ? { ...rest, class: kept.join(" ") } : rest;
}

function safeImgSrc(src: string | undefined): boolean {
  if (!src) return false;
  return src.startsWith("https://") || /^\/media\/[^/\\]/.test(src);
}

/**
 * Sanitises post HTML against the contract v1.1 allow-list.
 * - input is kept only as a disabled checkbox directly inside ul.task-list > li
 * - a href limited to http/https/mailto; rel="noopener noreferrer" forced
 * - img src limited to https:// or /media/
 * - class only language-* on pre/code and task-list on ul
 */
export function sanitizeHtml(html: string): string {
  // Stack of open elements so input can check its parent chain at open time.
  const stack: { tag: string; taskList: boolean }[] = [];

  return sanitize(html ?? "", {
    allowedTags: [
      "p", "h2", "h3", "h4", "strong", "em", "s", "code", "pre", "blockquote", "ul", "ol", "li",
      "table", "thead", "tbody", "tfoot", "tr", "th", "td", "caption", "hr", "br", "a", "img",
      "figure", "figcaption", "mark", "input",
    ],
    allowedAttributes: {
      a: ["href", "title", "rel"],
      img: ["src", "alt", "title", "width", "height", "data-drop"],
      pre: ["class"],
      code: ["class"],
      ul: ["class"],
      th: ["colspan", "rowspan", "scope"],
      td: ["colspan", "rowspan"],
      input: ["type", "checked", "disabled", "data-drop"],
    },
    allowedSchemes: ["http", "https", "mailto"],
    allowedSchemesByTag: { a: ["http", "https", "mailto"], img: ["https"] },
    allowedSchemesAppliedToAttributes: ["href", "src"],
    allowProtocolRelative: false,
    disallowedTagsMode: "discard",
    nonTextTags: ["script", "style", "textarea", "option", "noscript", "iframe", "svg", "math", "object", "embed", "form", "template"],
    onOpenTag: (name, attribs) => {
      stack.push({ tag: name, taskList: name === "ul" && (attribs.class ?? "").split(/\s+/).includes("task-list") });
    },
    onCloseTag: () => {
      stack.pop();
    },
    // Elements marked by transformTags below are removed entirely.
    exclusiveFilter: (frame) => frame.attribs["data-drop"] !== undefined,
    transformTags: {
      a: (tagName, attribs) => ({ tagName, attribs: { ...attribs, rel: "noopener noreferrer" } }),
      pre: (tagName, attribs) => ({ tagName, attribs: classOnly(attribs, LANGUAGE) }),
      code: (tagName, attribs) => ({ tagName, attribs: classOnly(attribs, LANGUAGE) }),
      ul: (tagName, attribs) => ({ tagName, attribs: classOnly(attribs, TASK_LIST) }),
      img: (tagName, attribs) =>
        safeImgSrc(attribs.src) && attribs["data-drop"] === undefined ? { tagName, attribs } : { tagName, attribs: { "data-drop": "1" } },
      input: (tagName, attribs) => {
        // stack top is this input; parent must be li whose parent is ul.task-list
        const li = stack[stack.length - 2];
        const ul = stack[stack.length - 3];
        const ok = attribs.type === "checkbox" && li?.tag === "li" && ul?.tag === "ul" && ul.taskList;
        if (!ok) return { tagName, attribs: { "data-drop": "1" } };
        const kept: sanitize.Attributes = { type: "checkbox", disabled: "disabled" };
        if (attribs.checked !== undefined) kept.checked = "checked";
        return { tagName, attribs: kept };
      },
    },
  });
}
