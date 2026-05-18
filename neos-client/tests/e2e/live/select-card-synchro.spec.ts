import path from "node:path";

import { expect, test } from "@playwright/test";

import {
  activateHandCard,
  duelCard,
  expectSelectCardsModal,
  installOnlyLiveDeck,
  LIVE_E2E_ENABLED,
  normalSummonToMainMonsterZone,
  readYdkDeck,
  resolveSummonToAnyMainMonsterZone,
  selectCardsFromModal,
  specialSummonExtraDeckCardToMainMonsterZone,
  specialSummonHandCardToMainMonsterZone,
  startAiDuel,
  surrenderAndClosePage,
} from "../helpers/live";

const DECK = path.resolve(
  "tests/e2e/fixtures/live/decks/select-card-synchro.ydk",
);
const DECK_NAME = "E2E Select Card Synchro";
const PHOTON_THRASHER = 65367484;
const DOUBLE_SUMMON = 43422537;
const ANGEL_TRUMPETER = 87979586;
const MYSTICAL_ELF = 15025844;
const STARDUST_DRAGON = 44508094;

test.describe("live select_card synchro summon interaction", () => {
  test.skip(
    !LIVE_E2E_ENABLED,
    "Set PLAYWRIGHT_LIVE=1 to run tests against the real ygopro server.",
  );

  test("selects synchro materials and summons a synchro monster", async ({
    page,
  }, testInfo) => {
    testInfo.setTimeout(Number(process.env.LIVE_E2E_TIMEOUT ?? 180000));

    await installOnlyLiveDeck(page, await readYdkDeck(DECK, DECK_NAME));
    await startAiDuel(page);

    const controller = await specialSummonHandCardToMainMonsterZone(page, {
      cardCode: PHOTON_THRASHER,
      sequence: 0,
    });
    await normalSummonToMainMonsterZone(page, {
      cardCode: ANGEL_TRUMPETER,
      sequence: 1,
    });
    await activateHandCard(page, DOUBLE_SUMMON);
    await normalSummonToMainMonsterZone(page, {
      cardCode: MYSTICAL_ELF,
      sequence: 3,
    });

    await specialSummonExtraDeckCardToMainMonsterZone(page, STARDUST_DRAGON);
    await expectSelectCardsModal(page, {
      cardCodes: [ANGEL_TRUMPETER],
      min: 1,
      max: 1,
      cancelable: true,
    });
    await selectCardsFromModal(page, [ANGEL_TRUMPETER]);
    await expectSelectCardsModal(page, {
      cardCodes: [PHOTON_THRASHER],
      cancelable: false,
    });
    await expect(
      page
        .locator('[data-testid="duel-select-card-option"][data-card-zone="MZONE"]')
        .first(),
    ).toBeVisible({ timeout: 60000 });
    await selectCardsFromModal(page, [PHOTON_THRASHER]);
    const synchroSequence = await resolveSummonToAnyMainMonsterZone(page, {
      cardCode: STARDUST_DRAGON,
      controller,
      position: "FACEUP_ATTACK",
    });

    await expect(
      duelCard(page, {
        code: STARDUST_DRAGON,
        zone: "MZONE",
        controller,
        sequence: synchroSequence,
      }),
    ).toBeVisible({ timeout: 60000 });

    await surrenderAndClosePage(page);
  });
});
