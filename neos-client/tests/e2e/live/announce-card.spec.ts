import path from "node:path";

import { test } from "@playwright/test";

import {
  activateHandCard,
  announceCardBySearch,
  getControllerOfHandCard,
  installOnlyLiveDeck,
  LIVE_E2E_ENABLED,
  readYdkDeck,
  startAiDuel,
  surrenderAndClosePage,
  waitForAnnounceCardModal,
} from "../helpers/live";

const DECK = path.resolve("tests/e2e/fixtures/live/decks/announce-card.ydk");
const DECK_NAME = "E2E Announce Card";
const PROHIBITION = 43711255;

test.describe("live announce_card interaction", () => {
  test.skip(
    !LIVE_E2E_ENABLED,
    "Set PLAYWRIGHT_LIVE=1 to run tests against the real ygopro server.",
  );

  test("declares a card name for Prohibition", async ({ page }, testInfo) => {
    testInfo.setTimeout(Number(process.env.LIVE_E2E_TIMEOUT ?? 180000));

    await installOnlyLiveDeck(page, await readYdkDeck(DECK, DECK_NAME));
    await startAiDuel(page);

    const controller = await getControllerOfHandCard(page, PROHIBITION);

    await activateHandCard(page, PROHIBITION);
    await waitForAnnounceCardModal(page, {
      controller,
      spellTrapSequence: 2,
    });
    await announceCardBySearch(page, {
      search: "青眼白龙",
    });

    await surrenderAndClosePage(page);
  });
});
