// Small DOM and text helpers shared by the audience page and the presenter.

import type { Flight } from "./timeline.ts";

export const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
export const pad2 = (n: number) => String(n).padStart(2, "0");
export const fmtTime = (s: number) => `${Math.floor(s / 60)}:${pad2(Math.floor(s % 60))}`;

export function byId<T extends HTMLElement = HTMLElement>(id: string, root: Document = document): T {
  const el = root.getElementById(id);
  if (!el) throw new Error(`Pathway: missing #${id}`);
  return el as T;
}

/** Storage can be missing or throw (private windows, file pages): never rely on it. */
export const store = {
  get(key: string): string | null { try { return sessionStorage.getItem(key); } catch { return null; } },
  set(key: string, value: string): void { try { sessionStorage.setItem(key, value); } catch { /* not available */ } },
};

/** The skin's colours and camera feel, read from its CSS custom properties. */
export interface Tokens {
  ground: string; contour: string; contourMajor: string; trail: string; route: string; ink: string; ink2: string;
  terrain: string;
  flight: Flight;
}

export function readTokens(root: HTMLElement = document.documentElement): Tokens {
  const cs = getComputedStyle(root), g = (k: string) => cs.getPropertyValue(k).trim();
  const num = (k: string, d: number) => { const v = parseFloat(g(k)); return Number.isFinite(v) && v > 0 ? v : d; };
  return {
    ground: g("--ground"), contour: g("--contour"), contourMajor: g("--contour-major"), trail: g("--trail"), route: g("--route"),
    ink: g("--ink"), ink2: g("--ink-2"), terrain: g("--terrain") || "contours",
    flight: { speed: num("--flight-speed", 1), max: num("--flight-max", 3.6), rho: num("--flight-rho", Math.SQRT2) },
  };
}
