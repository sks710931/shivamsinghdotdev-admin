export const ALLOWED_TAGS = Object.freeze([
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
] as const);

export type AllowedTag = (typeof ALLOWED_TAGS)[number];

export const ALLOWED_ATTRIBUTES: Readonly<{
  [tag: string]: readonly string[];
  a: readonly string[];
  img: readonly string[];
  pre: readonly string[];
  code: readonly string[];
  ul: readonly string[];
  th: readonly string[];
  td: readonly string[];
  input: readonly string[];
}> = Object.freeze({
  a: Object.freeze(["href", "title", "rel"] as const),
  img: Object.freeze(["src", "alt", "title", "width", "height", "data-drop"] as const),
  pre: Object.freeze(["class"] as const),
  code: Object.freeze(["class"] as const),
  ul: Object.freeze(["class"] as const),
  th: Object.freeze(["colspan", "rowspan", "scope"] as const),
  td: Object.freeze(["colspan", "rowspan"] as const),
  input: Object.freeze(["type", "checked", "disabled", "data-drop"] as const),
});

export const ALLOWED_SCHEMES = Object.freeze(["http", "https", "mailto"] as const);

export const ALLOWED_SCHEMES_BY_TAG: Readonly<{
  [tag: string]: readonly string[];
  a: readonly string[];
  img: readonly string[];
}> = Object.freeze({
  a: Object.freeze(["http", "https", "mailto"] as const),
  img: Object.freeze(["https"] as const),
});

export const NON_TEXT_TAGS = Object.freeze([
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
] as const);
