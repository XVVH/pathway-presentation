// `pathway present`: serves a deck from this machine to a browser on this
// machine, with speaker notes for the presenter window, and reloads the page
// whenever the deck, its notes or its media change. It listens on 127.0.0.1
// only, answers only to that host name, and serves only the files the deck uses.

import { createReadStream, existsSync, statSync, watch, type FSWatcher } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { basename, dirname, join, resolve, sep } from "node:path";
import { checkDeck, type CheckResult } from "./check.ts";
import { compileDeck } from "./compile.ts";
import { escapeHtml } from "./html.ts";
import { nodeIo } from "./io-node.ts";
import { extension } from "./media.ts";
import { loadAssets, renderPage } from "./page.ts";

const TYPES: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", avif: "image/avif", svg: "image/svg+xml",
  mp4: "video/mp4", m4v: "video/mp4", mov: "video/quicktime", webm: "video/webm", woff2: "font/woff2",
};

export interface PresentOptions {
  port: number;
  notes?: string | null;
  /** Called after each (re)check, with what changed. */
  onCheck?: (result: CheckResult, reason: "start" | "change") => void;
}

export interface Presenting {
  server: Server;
  url: string;
  close(): Promise<void>;
}

interface Built {
  html: string;
  /** URL path (without the leading slash) to file on disk. */
  files: Map<string, string>;
}

export function present(deckPath: string, opts: PresentOptions): Promise<Presenting> {
  const deckDir = dirname(resolve(deckPath));
  let built: Built | null = null;
  const clients = new Set<ServerResponse>();
  let port = opts.port;

  function rebuild(reason: "start" | "change"): void {
    try { build(reason); }
    catch (e) { built = { html: problemPage(null, (e as Error).message), files: new Map() }; }
  }
  function build(reason: "start" | "change"): void {
    const check = checkDeck(deckPath, nodeIo, { notes: opts.notes });
    opts.onCheck?.(check, reason);
    // A skin kept outside the deck's folder reloads the page too.
    if (check.skin.file) watchFolder(dirname(resolve(check.skin.file)));
    const files = new Map<string, string>();
    let html: string;
    if (!check.deck.root) {
      html = problemPage(check);
    } else {
      const { payload, media } = compileDeck(check, nodeIo, { notes: true, dev: true });
      payload.problems = check.diagnostics.filter(d => d.file === check.deck.file && d.severity !== "info")
        .map(d => ({ severity: d.severity as "error" | "warning", line: d.line, message: d.message }));
      const assets = loadAssets(check.skin);
      html = renderPage(payload, assets, { connect: true });
      for (const rel of media) files.set(rel.split("/").map(encodeURIComponent).join("/"), join(deckDir, rel));
      for (const f of assets.fonts) files.set(f.to.split("/").map(encodeURIComponent).join("/"), f.from);
    }
    built = { html, files };
  }

  const host = (req: IncomingMessage) => req.headers.host ?? "";
  const allowedHosts = () => new Set([`127.0.0.1:${port}`, `localhost:${port}`]);

  const server = createServer((req, res) => {
    // A page on some other site can't reach this server by renaming itself (DNS rebinding).
    if (!allowedHosts().has(host(req))) { res.writeHead(421).end("Wrong host."); return; }
    if (req.method !== "GET" && req.method !== "HEAD") { res.writeHead(405).end(); return; }
    const path = (req.url ?? "/").split(/[?#]/)[0];
    // Other sites can't frame the page or embed its files.
    const headers = {
      "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer",
      "Cross-Origin-Resource-Policy": "same-origin", "X-Frame-Options": "DENY", "Content-Security-Policy": "frame-ancestors 'none'",
    };
    if (path === "/__pathway/events") {
      res.writeHead(200, { ...headers, "Content-Type": "text/event-stream", Connection: "keep-alive" });
      res.write(": connected\n\n");
      clients.add(res);
      req.on("close", () => clients.delete(res));
      return;
    }
    if (!built) rebuild("start");
    if (path === "/" || path === "/index.html") {
      res.writeHead(200, { ...headers, "Content-Type": "text/html; charset=utf-8" }).end(built!.html);
      return;
    }
    const file = built!.files.get(path.slice(1));
    if (!file || !existsSync(file)) { res.writeHead(404, headers).end("Not found."); return; }
    sendFile(req, res, file, { ...headers, "Content-Type": TYPES[extension(file)] ?? "application/octet-stream" });
  });

  // Reload on changes. Editors save in several steps, so wait for them to settle.
  let timer: NodeJS.Timeout | null = null;
  const watchers: FSWatcher[] = [];
  const watched = new Set<string>();
  function watchFolder(dir: string): void {
    if (watched.has(dir) || dir === deckDir || dir.startsWith(deckDir + sep)) return;
    watched.add(dir);
    try { watchers.push(watch(dir, (_e, name) => changed(name ? String(name) : null))); } catch { /* gone; the checker says so */ }
  }
  const changed = (name: string | null) => {
    if (name && /(^|[\\/])(\.|node_modules|[^\\/]*-build([\\/]|$))/.test(name)) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      rebuild("change");
      for (const c of clients) c.write("event: reload\ndata: {}\n\n");
    }, 150);
  };
  try { watchers.push(watch(deckDir, { recursive: true }, (_e, name) => changed(name ? String(name) : null))); }
  catch { watchers.push(watch(deckDir, (_e, name) => changed(name ? String(name) : null))); }
  // Keep the event streams open through proxies and sleep.
  const ping = setInterval(() => { for (const c of clients) c.write(": ping\n\n"); }, 25000);

  return new Promise((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(opts.port, "127.0.0.1", () => {
      const addr = server.address();
      if (addr && typeof addr === "object") port = addr.port;
      rebuild("start");
      resolvePromise({
        server,
        url: `http://127.0.0.1:${port}/`,
        close: () => new Promise<void>(done => {
          clearInterval(ping);
          if (timer) clearTimeout(timer);
          for (const w of watchers) w.close();
          for (const c of clients) c.end();
          server.close(() => done());
          server.closeAllConnections();
        }),
      });
    });
  });
}

/** Sends a file, honouring a single byte range so video can seek. */
function sendFile(req: IncomingMessage, res: ServerResponse, file: string, headers: Record<string, string>): void {
  const size = statSync(file).size;
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? "");
  if (range && (range[1] || range[2])) {
    let start = range[1] ? Number(range[1]) : size - Number(range[2]);
    let end = range[1] && range[2] ? Number(range[2]) : size - 1;
    start = Math.max(0, start); end = Math.min(size - 1, end);
    if (start > end) { res.writeHead(416, { ...headers, "Content-Range": `bytes */${size}` }).end(); return; }
    res.writeHead(206, { ...headers, "Accept-Ranges": "bytes", "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": String(end - start + 1) });
    if (req.method === "HEAD") { res.end(); return; }
    createReadStream(file, { start, end }).pipe(res);
    return;
  }
  res.writeHead(200, { ...headers, "Accept-Ranges": "bytes", "Content-Length": String(size) });
  if (req.method === "HEAD") { res.end(); return; }
  createReadStream(file).pipe(res);
}

/** When there's no deck to draw, say why, and check again shortly. */
function problemPage(check: CheckResult | null, failure?: string): string {
  const errors = check ? check.diagnostics.filter(d => d.severity === "error").map(d => `Line ${d.line}: ${d.message}`) : [failure ?? "Unknown problem."];
  return `<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="2"><title>${escapeHtml(check ? basename(check.deck.file) : "Pathway")}</title>
<body style="font:15px/1.5 system-ui,sans-serif;max-width:720px;margin:40px auto;padding:0 16px">
<h1 style="font-size:20px">This deck can't be drawn yet</h1>
<ul>${errors.map(e => `<li>${escapeHtml(e)}</li>`).join("")}</ul>
<p style="color:#666">Fix the deck and save; this page checks again every two seconds.</p></body>`;
}
