// Small text helpers shared by the parser and the checker.

/** Stop ids made from titles: lowercase letters and digits, everything else becomes '-'. */
export function slugify(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
}

const WORD = /[\p{L}\p{N}]+(?:['’.\-][\p{L}\p{N}]+)*/gu;
export function countWords(s: string): number {
  return (s.match(WORD) ?? []).length;
}

function distance(a: string, b: string): number {
  const prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const up = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = up;
    }
  }
  return prev[b.length];
}

/** The closest candidate, if it's close enough to be a likely typo. */
export function closest(target: string, candidates: Iterable<string>): string | null {
  const t = target.toLowerCase();
  let best: string | null = null;
  let bestD = Infinity;
  for (const c of candidates) {
    const d = distance(t, c.toLowerCase());
    if (d < bestD) { bestD = d; best = c; }
  }
  const allowed = Math.max(1, Math.floor(t.length / 3));
  return best !== null && bestD <= allowed ? best : null;
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}
