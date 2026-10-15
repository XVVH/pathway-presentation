// QR codes, drawn at build time as SVG, so the page needs no code or network
// to show one. The library only handles single-byte text, so addresses are
// normalised to ASCII first (the URL parser percent-encodes the rest).

import qrcode from "qrcode-generator";

/** A QR code for a URL: dark modules on a white square with the standard quiet zone. */
export function qrSvg(url: string): string {
  const text = new URL(url).href;
  const qr = qrcode(0, "M");
  qr.addData(text, "Byte");
  qr.make();
  const n = qr.getModuleCount(), quiet = 4, size = n + 2 * quiet;
  let d = "";
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c + quiet} ${r + quiet}h1v1h-1z`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges" role="img" aria-label="QR code for ${text.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;")}"><rect width="${size}" height="${size}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
}

/** The QR code's modules as rows of booleans, for tests and other renderers. */
export function qrModules(url: string): boolean[][] {
  const qr = qrcode(0, "M");
  qr.addData(new URL(url).href, "Byte");
  qr.make();
  const n = qr.getModuleCount();
  return Array.from({ length: n }, (_, r) => Array.from({ length: n }, (_, c) => qr.isDark(r, c)));
}
