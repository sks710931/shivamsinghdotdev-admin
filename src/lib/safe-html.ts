import DOMPurify from "dompurify";
import type { Config, DOMPurify as DOMPurifyInstance, UponSanitizeAttributeHookEvent } from "dompurify";

import { ALLOWED_ATTRIBUTES, ALLOWED_SCHEMES_BY_TAG, ALLOWED_TAGS } from "./sanitize-schema";

const ALL_ALLOWED_ATTR = Array.from(
  new Set(
    Object.values(ALLOWED_ATTRIBUTES)
      .flat()
      .filter((attr) => attr !== "data-drop")
  )
);

const FORBIDDEN_SCHEME_PATTERN = /^[\s\x00-\x1F]*(?:javascript|data|vbscript)\s*:/i;

function isForbiddenUrl(value: string): boolean {
  const normalized = value.replace(/[\u0000-\u001F\u007F-\u009F\s]+/g, "").toLowerCase();
  return (
    normalized.startsWith("javascript:") ||
    normalized.startsWith("data:") ||
    normalized.startsWith("vbscript:")
  );
}

function isSafeHref(value: string): boolean {
  if (isForbiddenUrl(value) || FORBIDDEN_SCHEME_PATTERN.test(value)) {
    return false;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return false;
  }
  try {
    const parsed = new URL(trimmed, "https://example.invalid");
    const scheme = parsed.protocol.replace(/:$/, "").toLowerCase();
    if (ALLOWED_SCHEMES_BY_TAG.a.includes(scheme) && new RegExp(`^${scheme}:`, "i").test(trimmed)) {
      return true;
    }
    if (trimmed.startsWith("/") && !trimmed.startsWith("//") && !trimmed.startsWith("/\\")) {
      return true;
    }
    if (trimmed.startsWith("#")) {
      return true;
    }
  } catch {
    return false;
  }
  return false;
}

function isSafeImgSrc(value: string): boolean {
  if (isForbiddenUrl(value) || FORBIDDEN_SCHEME_PATTERN.test(value)) {
    return false;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return false;
  }
  const allowedImgSchemes = ALLOWED_SCHEMES_BY_TAG.img;
  const hasAllowedScheme = allowedImgSchemes.some((scheme) =>
    trimmed.toLowerCase().startsWith(`${scheme}://`)
  );
  if (hasAllowedScheme) {
    return true;
  }
  if (/^\/media\/[^/\\]/.test(trimmed)) {
    return true;
  }
  return false;
}

const DOMPURIFY_CONFIG: Config = Object.freeze({
  ALLOWED_TAGS: [...ALLOWED_TAGS],
  ALLOWED_ATTR: ALL_ALLOWED_ATTR,
  ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto):|[^a-z]|[a-z+.-]+(?:[^a-z+.-:]|$))/i,
  ALLOW_DATA_ATTR: false,
  ALLOW_ARIA_ATTR: false,
  ALLOW_UNKNOWN_PROTOCOLS: false,
});

function onSanitizeAttribute(currentNode: Element, data: UponSanitizeAttributeHookEvent): void {
  const attrName = data.attrName.toLowerCase();
  const tagName = currentNode.nodeName.toLowerCase();

  // 1. Forbid event handlers
  if (attrName.startsWith("on")) {
    data.keepAttr = false;
    return;
  }

  // 2. Enforce per-tag allowed attributes according to ALLOWED_ATTRIBUTES
  const allowedForTag = ALLOWED_ATTRIBUTES[tagName];
  if (!allowedForTag || !allowedForTag.includes(attrName) || attrName === "data-drop") {
    data.keepAttr = false;
    return;
  }

  // 3. Forbid javascript:, data:, and other unsafe URLs
  if (attrName === "href") {
    if (!isSafeHref(data.attrValue)) {
      data.keepAttr = false;
      return;
    }
  }

  if (attrName === "src") {
    if (!isSafeImgSrc(data.attrValue)) {
      data.keepAttr = false;
      return;
    }
  }

  // 4. Class whitelist: language-* for pre/code, task-list for ul
  if (attrName === "class") {
    const keptClasses = data.attrValue
      .split(/\s+/)
      .filter((cls) => {
        if (tagName === "pre" || tagName === "code") {
          return /^language-[a-z0-9+#-]+$/i.test(cls);
        }
        if (tagName === "ul") {
          return cls === "task-list";
        }
        return false;
      });
    if (keptClasses.length > 0) {
      data.attrValue = keptClasses.join(" ");
    } else {
      data.keepAttr = false;
    }
  }
}

function onAfterSanitizeAttributes(currentNode: Element): void {
  const tagName = currentNode.nodeName.toLowerCase();
  if (tagName === "a" && currentNode.hasAttribute("href")) {
    currentNode.setAttribute("rel", "noopener noreferrer");
  }
  if (tagName === "img" && !currentNode.hasAttribute("src")) {
    currentNode.remove();
  }
  if (tagName === "input") {
    const input = currentNode as HTMLInputElement;
    if (input.getAttribute("type") !== "checkbox") {
      input.remove();
    } else {
      input.setAttribute("disabled", "");
    }
  }
}

let configuredPurify: DOMPurifyInstance | null = null;

function getPurify(): DOMPurifyInstance | null {
  if (typeof window === "undefined") {
    return null;
  }
  if (!configuredPurify) {
    const purify = DOMPurify(window);
    purify.addHook("uponSanitizeAttribute", onSanitizeAttribute);
    purify.addHook("afterSanitizeAttributes", onAfterSanitizeAttributes);
    configuredPurify = purify;
  }
  return configuredPurify;
}

/**
 * Sanitizes HTML on the client using a private DOMPurify instance with the shared slice-1 allow-list.
 * Explicitly forbids event handlers, javascript:/data: URLs, and non-https/non-media image sources.
 *
 * SSR behavior:
 * When no window exists (such as during Server-Side Rendering / SSR), safeHtml returns an empty
 * string (""). Preview and revision review components render HTML client-side only once the DOM
 * window environment is available.
 */
export function safeHtml(dirty: string): string {
  if (typeof window === "undefined") {
    return "";
  }
  if (!dirty || typeof dirty !== "string" || !dirty.trim()) {
    return "";
  }
  const purify = getPurify();
  if (!purify) {
    return "";
  }
  return purify.sanitize(dirty, DOMPURIFY_CONFIG);
}

