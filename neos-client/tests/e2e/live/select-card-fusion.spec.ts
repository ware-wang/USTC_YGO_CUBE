import path from "node:path";

import { test } from "@playwright/test";

import {
  activateHandCard,
  getControllerOfHandCard,
  installOnlyLiveDeck,
  LIVE_E2E_ENABLED,
  readYdkDeck,
  resolveSummonPlacement,
  selectCardsFromModal,
  startAiDuel,
  surrenderAndClosePage,
} from "../helpers/live";

const DECK = path.resolve(
  "tests/e2e/fixtures/live/decks/select-card-fusion.ydk",
);
const DECK_NAME = "E2E Select Card Fusion";
const POLYMERIZATION = 24094653;
const AVIAN = 21844576;
const BURSTINATRIX = 58932615;
const FLAME_WINGMAN = 35809262;

test.describe("live select_card fusion interaction", () => {
  test.skip(
    !LIVE_E2E_ENABLED,
    "Set PLAYWRIGHT_LIVE=1 to run tests against the real ygopro server.",
  );

  test("selects fusion materials and summons a fusion monster", async ({
    page,
  }, testInfo) => {
    testInfo.setTimeout(Number(process.env.LIVE_E2E_TIMEOUT ?? 180000));

    await installOnlyLiveDeck(page, await readYdkDeck(DECK, DECK_NAME));
    await startAiDuel(page);

    const controller = await getControllerOfHandCard(page, POLYMERIZATION);

    await activateHandCard(page, POLYMERIZATION);
    await selectCardsFromModal(page, [AVIAN, BURSTINATRIX]);
    await resolveSummonPlacement(page, {
      cardCode: FLAME_WINGMAN,
      controller,
      sequence: 2,
      position: "FACEUP_ATTACK",
    });

    await surrenderAndClosePage(page);
  });
});
