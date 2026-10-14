// What kind of media a path is, and the pixel size of an image read from its
// header, so the checker can estimate how much room an image takes on a card.

export const IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "gif", "webp", "avif", "svg"];
export const VIDEO_EXTENSIONS = ["mp4", "webm", "mov", "m4v"];

export function extension(src: string): string {
  const clean = src.split(/[?#]/)[0];
  const dot = clean.lastIndexOf(".");
  return dot < 0 ? "" : clean.slice(dot + 1).toLowerCase();
}

export function mediaKind(src: string): "image" | "video" | "unknown" {
  const ext = extension(src);
  if (IMAGE_EXTENSIONS.includes(ext)) return "image";
  if (VIDEO_EXTENSIONS.includes(ext)) return "video";
  return "unknown";
}

/** URLs with a scheme (http:, https:, data:...). Windows drive letters don't count. */
export function isRemote(src: string): boolean {
  return /^[a-z][a-z0-9+.-]+:/i.test(src);
}

export interface Size { width: number; height: number }

const u16be = (b: Uint8Array, i: number) => (b[i] << 8) | b[i + 1];
const u16le = (b: Uint8Array, i: number) => b[i] | (b[i + 1] << 8);
const u24le = (b: Uint8Array, i: number) => b[i] | (b[i + 1] << 8) | (b[i + 2] << 16);
const ascii = (b: Uint8Array, i: number, n: number) => String.fromCharCode(...b.subarray(i, i + n));

/** Reads width and height from PNG, GIF, JPEG, WebP or SVG bytes. Null if unknown. */
export function imageSize(b: Uint8Array): Size | null {
  if (b.length >= 24 && b[0] === 0x89 && ascii(b, 1, 3) === "PNG") {
    return { width: (u16be(b, 16) << 16) | u16be(b, 18), height: (u16be(b, 20) << 16) | u16be(b, 22) };
  }
  if (b.length >= 10 && ascii(b, 0, 4) === "GIF8") return { width: u16le(b, 6), height: u16le(b, 8) };
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) { i++; continue; }
      const marker = b[i + 1];
      if (marker === 0xff) { i++; continue; }
      if ((marker >= 0xd0 && marker <= 0xd9) || marker === 0x01) { i += 2; continue; }
      const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
      if (isSof) return { height: u16be(b, i + 5), width: u16be(b, i + 7) };
      i += 2 + u16be(b, i + 2);
    }
    return null;
  }
  if (b.length >= 30 && ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 4) === "WEBP") {
    const chunk = ascii(b, 12, 4);
    if (chunk === "VP8 ") return { width: u16le(b, 26) & 0x3fff, height: u16le(b, 28) & 0x3fff };
    if (chunk === "VP8L") {
      const b0 = b[21], b1 = b[22], b2 = b[23], b3 = b[24];
      return { width: 1 + (((b1 & 0x3f) << 8) | b0), height: 1 + (((b3 & 0xf) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6)) };
    }
    if (chunk === "VP8X") return { width: 1 + u24le(b, 24), height: 1 + u24le(b, 27) };
    return null;
  }
  const head = new TextDecoder().decode(b.subarray(0, Math.min(b.length, 4096)));
  const svg = head.match(/<svg\b[^>]*>/i)?.[0];
  if (svg) {
    const num = (name: string) => {
      const m = svg.match(new RegExp(`\\s${name}\\s*=\\s*["']\\s*([\\d.]+)(px)?\\s*["']`, "i"));
      return m ? Number(m[1]) : null;
    };
    const w = num("width"), h = num("height");
    if (w && h) return { width: w, height: h };
    const vb = svg.match(/viewBox\s*=\s*["']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)\s*["']/i);
    if (vb) return { width: Number(vb[1]), height: Number(vb[2]) };
  }
  return null;
}
