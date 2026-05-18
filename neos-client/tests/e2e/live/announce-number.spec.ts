import path from "node:path";

import { expect, test } from "@playwright/test";

import {
  announceNumbers,
  endCurrentTurn,
  expectControllerHandCount,
  expectMyTurn,
  getControllerOfHandCard,
  installOnlyLiveDeck,
  LIVE_E2E_ENABLED,
  readYdkDeck,
  selectChainCardFromModal,
  setHandCard,
  setChainSetting,
  startAiDuel,
  surrenderAndClosePage,
} from "../helpers/live";

const DECK = path.resolve(
  "tests/e2e/fixtures/live/decks/announce-number-sixth-sense.ydk",
);
const DECK_NAME = "E2E Announce Number Sixth Sense";
const SIXTH_SENSE = 3280747;

test.describe("live announce_number interaction", () => {
  test.skip(
    !LIVE_E2E_ENABLED,
    "Set PLAYWRIGHT_LIVE=1 to run tests against the real ygopro server.",
  );

  test("declares two numbers for Sixth Sense", async ({ page }, testInfo) => {
    testInfo.setTimeout(Number(process.env.LIVE_E2E_TIMEOUT ?? 240000));

    await installOnlyLiveDeck(page, await readYdkDeck(DECK, DECK_NAME));
    await startAiDuel(page, {
      chainSetting: "all",
      mora: "rock",
      tp: "first",
    });
    await expectMyTurn(page);

    const initialController = await getControllerOfHandCard(page, SIXTH_SENSE);
    await expectControllerHandCount(page, initialController, 5);

    const controller = await setHandCard(page, SIXTH_SENSE);
    await setChainSetting(page, "all");

    await endCurrentTurn(page);
    await selectChainCardFromModal(page, SIXTH_SENSE);
    await announceNumbers(page, [1, 2]);

    await expect(
      page.locator(
        `[data-testid="duel-card"][data-card-code="${SIXTH_SENSE}"][data-card-controller="${controller}"][data-card-zone="GRAVE"]`,
      ),
    ).toBeVisible({ timeout: 120000 });

    await surrenderAndClosePage(page);
  });
});
