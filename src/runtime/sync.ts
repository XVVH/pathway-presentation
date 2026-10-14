// The audience page and the presenter window talk by postMessage. The audience
// page is the source of truth: it sends where it is, and the presenter sends
// back what to do. Works from a file on disk as well as from `pathway present`.

import type { Target } from "../payload.ts";
import type { Cam } from "./math.ts";

export interface DeckState {
  route: string | null;
  ri: number;
  target: Target;
  offRoute: boolean;
  excursion: { i: number; n: number; detour: string } | null;
  ahead: Target | null;
  /** Detours one key away from here. */
  detours: string[];
  /** Trails fully walked, by stop id. */
  walked: string[];
  cam: Cam;
  /** Screen height over width, for the minimap's view box. */
  aspect: number;
  blank: boolean;
  touring: boolean;
}

export type Command =
  | { cmd: "next" | "prev" | "dive" | "surface" | "map" | "blank" }
  | { cmd: "detour" | "visit"; id: string }
  | { cmd: "route"; name: string | null };

export type Message =
  | { pathway: 1; token: string; type: "hello" }
  | { pathway: 1; token: string; type: "state"; state: DeckState }
  | { pathway: 1; token: string; type: "cmd"; command: Command };

const SIMPLE = new Set(["next", "prev", "dive", "surface", "map", "blank"]);

/** Accepts only well-formed messages carrying this session's token. */
export function readMessage(data: unknown, token: string | null): Message | null {
  if (!token || typeof data !== "object" || data === null) return null;
  const m = data as Record<string, unknown>;
  if (m.pathway !== 1 || m.token !== token) return null;
  if (m.type === "hello") return m as Message;
  if (m.type === "state" && typeof m.state === "object" && m.state !== null) return m as Message;
  if (m.type === "cmd" && typeof m.command === "object" && m.command !== null) {
    const c = m.command as Record<string, unknown>;
    if (typeof c.cmd !== "string") return null;
    if (SIMPLE.has(c.cmd)) return m as Message;
    if ((c.cmd === "detour" || c.cmd === "visit") && typeof c.id === "string") return m as Message;
    if (c.cmd === "route" && (c.name === null || typeof c.name === "string")) return m as Message;
  }
  return null;
}

/** postMessage can only name a target origin for http(s) pages; a file page's origin is opaque. */
export const targetOrigin = () => (/^https?:$/.test(location.protocol) ? location.origin : "*");

export function newToken(): string {
  const a = new Uint8Array(12);
  crypto.getRandomValues(a);
  return [...a].map(b => b.toString(16).padStart(2, "0")).join("");
}
