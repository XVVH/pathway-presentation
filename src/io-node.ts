import { closeSync, existsSync, openSync, readdirSync, readFileSync, readSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Io } from "./io.ts";

export const nodeIo: Io = {
  read(path) {
    try { return readFileSync(path, "utf8"); } catch { return null; }
  },
  exists: existsSync,
  head(path, max) {
    let fd: number | null = null;
    try {
      fd = openSync(path, "r");
      const buf = new Uint8Array(max);
      const n = readSync(fd, buf, 0, max, 0);
      return buf.subarray(0, n);
    } catch {
      return null;
    } finally {
      if (fd !== null) closeSync(fd);
    }
  },
  list(dir) {
    try { return readdirSync(dir); } catch { return []; }
  },
  dirname,
  join,
};
