import path from "node:path";

import { expect, test } from "@playwright/test";

import {
  endCurrentTurn,
  expectChainMarker,
  expectControllerHandCount,
  expectMyTurn,
  expectSelectChainModal,
  getControllerOfHandCard,
  installOnlyLiveDeck,
  LIVE_E2E_ENABLED,
  readYdkDeck,
  selectChainCardFromModal,
  setChainSetting,
  setHandCardToSpellTrapZone,
  startAiDuel,
  surrenderAndClosePage,
} from "../helpers/live";

const DECK = path.resolve(
  "tests/e2e/fixtures/live/decks/select-chain-free-chain-traps.ydk",
);
const DECK_NAME = "E2E Select Chain Free Chain Traps";
const JAR_OF_GREED = 83968380;
const RECKLESS_GREED = 37576645;

test.describe("live select_chain interaction", () => {
  test.skip(
    !LIVE_E2E_ENABLED,
    "Set PLAYWRIGHT_LIVE=1 to run tests against the real ygopro server.",
  );

  test("chooses among multiple optional trap chain candidates", async ({
    page,
  }, testInfo) => {
    testInfo.setTimeout(Number(process.env.LIVE_E2E_TIMEOUT ?? 240000));

    await installOnlyLiveDeck(page, await readYdkDeck(DECK, DECK_NAME));
    await startAiDuel(page, {
      chainSetting: "all",
      mora: "rock",
      tp: "first",
    });
    await expectMyTurn(page);

    const controller = await getControllerOfHandCard(page, JAR_OF_GREED);
    await expectControllerHandCount(page, controller, 5);

    await setHandCardToSpellTrapZone(page, JAR_OF_GREED, { sequence: 1 });
    await setHandCardToSpellTrapZone(page, RECKLESS_GREED, { sequence: 3 });
    await setChainSetting(page, "all");

    await endCurrentTurn(page);

    await expectSelectChainModal(page, {
      cardCodes: [JAR_OF_GREED, RECKLESS_GREED],
      controller,
      zone: "SZONE",
    });
    await selectChainCardFromModal(page, JAR_OF_GREED);
    await expectChainMarker(page, {
      index: 1,
      controller,
      zone: "SZONE",
      sequence: 1,
    });

    await expectSelectChainModal(page, {
      cardCodes: [RECKLESS_GREED],
      controller,
      zone: "SZONE",
    });
    await selectChainCardFromModal(page, RECKLESS_GREED);
    await expectChainMarker(page, {
      index: 2,
      controller,
      zone: "SZONE",
      sequence: 3,
    });

    await expect(
      page.locator(
        `[data-testid="duel-card"][data-card-code="${JAR_OF_GREED}"][data-card-controller="${controller}"][data-card-zone="GRAVE"]`,
      ),
    ).toBeVisible({ timeout: 120000 });
    await expect(
      page.locator(
        `[data-testid="duel-card"][data-card-code="${RECKLESS_GREED}"][data-card-controller="${controller}"][data-card-zone="GRAVE"]`,
      ),
    ).toBeVisible({ timeout: 120000 });

    await surrenderAndClosePage(page);
  });
});
