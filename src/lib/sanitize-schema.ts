export const ALLOWED_TAGS = [
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
] as const;

export type AllowedTag = (typeof ALLOWED_TAGS)[number];

export const ALLOWED_ATTRIBUTES: Record<string, string[]> = {
  a: ["href", "title", "rel"],
  img: ["src", "alt", "title", "width", "height", "data-drop"],
  pre: ["class"],
  code: ["class"],
  ul: ["class"],
  th: ["colspan", "rowspan", "scope"],
  td: ["colspan", "rowspan"],
  input: ["type", "checked", "disabled", "data-drop"],
};

export const ALLOWED_SCHEMES = ["http", "https", "mailto"] as const;

export const NON_TEXT_TAGS = [
  "script",
  "style",
  "textarea",
  "option",
  "noscript",
  "iframe",
  "svg",
  "math",
  "object",
  "embed",
  "form",
  "template",
] as const;
