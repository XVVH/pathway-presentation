// File access, kept behind an interface so the checker can also run in a browser
// (a folder dropped onto a page) or against in-memory files in tests.

export interface Io {
  read(path: string): string | null;
  exists(path: string): boolean;
  /** The first `max` bytes of a file, or null if it can't be read. */
  head(path: string, max: number): Uint8Array | null;
  /** Names of the entries in a directory, or [] if it can't be listed. */
  list(dir: string): string[];
  dirname(path: string): string;
  join(...parts: string[]): string;
}

/** Joins and normalises POSIX-style paths without touching the file system. */
export function joinPosix(...parts: string[]): string {
  const absolute = parts.find(p => p)?.startsWith("/") ?? false;
  const out: string[] = [];
  for (const seg of parts.join("/").split("/")) {
    if (!seg || seg === ".") continue;
    if (seg === ".." && out.length && out[out.length - 1] !== "..") out.pop();
    else if (seg === "..") { if (!absolute) out.push(seg); }
    else out.push(seg);
  }
  return (absolute ? "/" : "") + (out.join("/") || (absolute ? "" : "."));
}

export function dirnamePosix(path: string): string {
  const i = path.lastIndexOf("/");
  return i < 0 ? "." : i === 0 ? "/" : path.slice(0, i);
}

/** In-memory files, for tests and the browser. */
export function memoryIo(files: Record<string, string | Uint8Array>): Io {
  const get = (p: string) => files[joinPosix(p)];
  return {
    read: p => { const f = get(p); return typeof f === "string" ? f : f ? new TextDecoder().decode(f) : null; },
    exists: p => get(p) !== undefined,
    head: (p, max) => { const f = get(p); return f === undefined ? null : (typeof f === "string" ? new TextEncoder().encode(f) : f).subarray(0, max); },
    list: dir => {
      const prefix = joinPosix(dir) === "." ? "" : `${joinPosix(dir)}/`;
      return [...new Set(Object.keys(files).filter(k => k.startsWith(prefix)).map(k => k.slice(prefix.length).split("/")[0]))];
    },
    dirname: dirnamePosix,
    join: joinPosix,
  };
}
