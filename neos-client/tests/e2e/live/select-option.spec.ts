import path from "node:path";

import { test } from "@playwright/test";

import {
  chooseFirstOption,
  chooseSelectableZoneIfAvailable,
  clickCardAction,
  duelCard,
  getControllerOfHandCard,
  installOnlyLiveDeck,
  LIVE_E2E_ENABLED,
  normalSummonToMainMonsterZone,
  readYdkDeck,
  startAiDuel,
  surrenderAndClosePage,
} from "../helpers/live";

const DECK = path.resolve(
  "tests/e2e/fixtures/live/decks/select-option-enemy-controller.ydk",
);
const DECK_NAME = "E2E Select Option Enemy Controller";
const ENEMY_CONTROLLER = 98045062;
const MYSTICAL_ELF = 15025844;

test.describe("live select_option interaction", () => {
  test.skip(
    !LIVE_E2E_ENABLED,
    "Set PLAYWRIGHT_LIVE=1 to run tests against the real ygopro server.",
  );

  test("chooses an Enemy Controller effect option", async ({
    page,
  }, testInfo) => {
    testInfo.setTimeout(Number(process.env.LIVE_E2E_TIMEOUT ?? 180000));

    await installOnlyLiveDeck(page, await readYdkDeck(DECK, DECK_NAME));
    await startAiDuel(page, { tp: "second" });

    const controller = await getControllerOfHandCard(page, ENEMY_CONTROLLER);
    await normalSummonToMainMonsterZone(page, {
      cardCode: MYSTICAL_ELF,
      sequence: 2,
    });

    const enemyController = duelCard(page, {
      code: ENEMY_CONTROLLER,
      zone: "HAND",
      idleAction: "ACTIVATE",
    }).first();
    await clickCardAction(page, enemyController, "activate");
    await chooseSelectableZoneIfAvailable(page, {
      zone: "SZONE",
      controller,
      sequence: 2,
      timeout: 5000,
    });
    await chooseFirstOption(page);

    await surrenderAndClosePage(page);
  });
});
