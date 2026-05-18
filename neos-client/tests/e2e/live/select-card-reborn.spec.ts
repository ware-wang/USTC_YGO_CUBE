import path from "node:path";

import { expect, test } from "@playwright/test";

import {
  activateHandCard,
  duelCard,
  getControllerOfHandCard,
  installOnlyLiveDeck,
  LIVE_E2E_ENABLED,
  readYdkDeck,
  selectCardsFromModal,
  startAiDuel,
  surrenderAndClosePage,
} from "../helpers/live";

const DECK = path.resolve(
  "tests/e2e/fixtures/live/decks/select-card-reborn.ydk",
);
const DECK_NAME = "E2E Select Card Reborn";
const FOOLISH_BURIAL = 81439173;
const MYSTICAL_ELF = 15025844;

test.describe("live select_card graveyard interaction", () => {
  test.skip(
    !LIVE_E2E_ENABLED,
    "Set PLAYWRIGHT_LIVE=1 to run tests against the real ygopro server.",
  );

  test("selects a deck monster to send to the graveyard", async ({
    page,
  }, testInfo) => {
    testInfo.setTimeout(Number(process.env.LIVE_E2E_TIMEOUT ?? 180000));

    await installOnlyLiveDeck(page, await readYdkDeck(DECK, DECK_NAME));
    await startAiDuel(page);

    const controller = await getControllerOfHandCard(page, FOOLISH_BURIAL);

    await activateHandCard(page, FOOLISH_BURIAL);
    await selectCardsFromModal(page, [MYSTICAL_ELF]);
    await expect(
      duelCard(page, {
        code: MYSTICAL_ELF,
        zone: "GRAVE",
        controller,
      }),
    ).toBeVisible({ timeout: 60000 });

    await surrenderAndClosePage(page);
  });
});
