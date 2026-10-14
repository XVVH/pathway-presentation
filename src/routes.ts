// The default route: the whole map, the title, then every stop in reading order,
// pulling back over each branch when it ends, and the whole map again at the end.
// Detours are skipped; they stay one key away.

import type { Deck, Stop } from "./model.ts";

export type RouteStop =
  | { kind: "map"; final: boolean }
  | { kind: "stop"; id: string }
  | { kind: "lookback"; id: string };

export function defaultRoute(deck: Deck): RouteStop[] {
  const route: RouteStop[] = [{ kind: "map", final: false }];
  const root = deck.root;
  if (root) route.push({ kind: "stop", id: root.id });
  const visit = (stop: Pick<Stop, "children">) => {
    for (const id of stop.children) {
      const child = deck.byId.get(id);
      if (!child || child.detour) continue;
      route.push({ kind: "stop", id: child.id });
      if (child.children.some(c => !deck.byId.get(c)?.detour)) {
        visit(child);
        // Two pull-backs in a row collapse into the outer one.
        if (route[route.length - 1].kind === "lookback") route.pop();
        route.push({ kind: "lookback", id: child.id });
      }
    }
  };
  // Without a # title, the top-level stops still form a route.
  visit(root ?? { children: deck.stops.filter(s => s.parent === null).map(s => s.id) });
  route.push({ kind: "map", final: true });
  return route;
}
