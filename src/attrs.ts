// Pandoc-style attributes: {#id .class key=value key="quoted value" flag}.
// Used after headings and media. Written here rather than borrowed so the
// errors can say exactly what is wrong.

export interface Attrs {
  id: string | null;
  classes: string[];
  kv: Record<string, string | true>;
  errors: string[];
}

const ID = /^[\p{L}\p{N}][\p{L}\p{N}_.:-]*$/u;
const NAME = /^[\p{L}\p{N}_][\p{L}\p{N}_-]*$/u;

export function parseAttrs(src: string): Attrs {
  const out: Attrs = { id: null, classes: [], kv: {}, errors: [] };
  let i = 0;
  const n = src.length;
  const word = () => {
    const start = i;
    while (i < n && !/\s/.test(src[i])) i++;
    return src.slice(start, i);
  };
  while (i < n) {
    if (/\s/.test(src[i])) { i++; continue; }
    if (src[i] === "#") {
      i++;
      const id = word();
      if (!id) out.errors.push("'#' needs an id after it, like {#intake}");
      else if (!ID.test(id)) out.errors.push(`'${id}' isn't a valid id: use letters, digits, '-' and '_'`);
      else if (out.id) out.errors.push(`a stop has one id, but this one has '${out.id}' and '${id}'`);
      else out.id = id;
      continue;
    }
    if (src[i] === ".") {
      i++;
      const cls = word();
      if (!cls) out.errors.push("'.' needs a class name after it, like {.detour}");
      else if (!NAME.test(cls)) out.errors.push(`'${cls}' isn't a valid class name`);
      else out.classes.push(cls);
      continue;
    }
    const start = i;
    while (i < n && !/[\s=]/.test(src[i])) i++;
    const key = src.slice(start, i);
    if (!NAME.test(key)) { out.errors.push(`'${key}' isn't a valid attribute name`); word(); continue; }
    if (src[i] !== "=") { out.kv[key] = true; continue; }
    i++;
    const q = src[i];
    if (q === '"' || q === "'") {
      const end = src.indexOf(q, i + 1);
      if (end < 0) { out.errors.push(`the value of '${key}' opens a quote that never closes`); i = n; continue; }
      out.kv[key] = src.slice(i + 1, end);
      i = end + 1;
    } else {
      const value = word();
      if (!value) out.errors.push(`'${key}=' needs a value`);
      else out.kv[key] = value;
    }
  }
  return out;
}

/**
 * Splits a trailing {attributes} block off a heading's text. A backslash before
 * the brace keeps it as literal text.
 */
export function splitTrailingAttrs(text: string): { text: string; attrs: string | null } {
  const m = text.match(/(^|[^\\])\{([^{}]*)\}\s*$/);
  if (!m || m.index === undefined) return { text: text.replace(/\\\{/g, "{"), attrs: null };
  const cut = m.index + m[1].length;
  return { text: text.slice(0, cut).trimEnd(), attrs: m[2] };
}
