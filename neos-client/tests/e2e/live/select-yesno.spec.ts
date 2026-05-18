import path from "node:path";

import { test } from "@playwright/test";

import {
  chooseYesNo,
  installOnlyLiveDeck,
  LIVE_E2E_ENABLED,
  normalSummonToMainMonsterZone,
  readYdkDeck,
  startAiDuel,
  surrenderAndClosePage,
} from "../helpers/live";

const DECK = path.resolve(
  "tests/e2e/fixtures/live/decks/select-yesno-sangan.ydk",
);
const DECK_NAME = "E2E Select YesNo Tour Guide";
const TOUR_GUIDE = 10802915;

test.describe("live select_yesno interaction", () => {
  test.skip(
    !LIVE_E2E_ENABLED,
    "Set PLAYWRIGHT_LIVE=1 to run tests against the real ygopro server.",
  );

  test("answers no to Tour Guide's optional summon trigger", async ({
    page,
  }, testInfo) => {
    testInfo.setTimeout(Number(process.env.LIVE_E2E_TIMEOUT ?? 180000));

    await installOnlyLiveDeck(page, await readYdkDeck(DECK, DECK_NAME));
    await startAiDuel(page);

    await normalSummonToMainMonsterZone(page, {
      cardCode: TOUR_GUIDE,
      sequence: 2,
    });
    await chooseYesNo(page, "no");

    await surrenderAndClosePage(page);
  });
});
