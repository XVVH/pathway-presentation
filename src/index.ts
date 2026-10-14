// Library entry point: parse and check decks from code.

export { checkDeck, type CheckOptions, type CheckResult, type Summary } from "./check.ts";
export { estimateStop, type Estimate } from "./layout.ts";
export { memoryIo, type Io } from "./io.ts";
export type * from "./model.ts";
export { parseNotes, defaultNotesPath } from "./notes.ts";
export { parseDeck } from "./parse.ts";
export { defaultRoute, type RouteStop } from "./routes.ts";
export { CARD, DENSITY, SKINS, TYPE, type Density } from "./typography.ts";
