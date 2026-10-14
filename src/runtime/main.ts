// Entry point of the page's engine: read the deck's data, then start either the
// audience view or, when opened with ?presenter=..., the presenter window.

import type { Payload } from "../payload.ts";
import { startDeck } from "./deck.ts";
import { startPresenter } from "./presenter.ts";

function main(): void {
  const data = document.getElementById("pathway-data");
  if (!data?.textContent) throw new Error("Pathway: this page has no deck data.");
  const payload = JSON.parse(data.textContent) as Payload;
  const params = new URLSearchParams(location.search);
  const token = params.get("presenter");
  if (token) startPresenter(payload, token);
  else startDeck(payload, params);
}

main();
