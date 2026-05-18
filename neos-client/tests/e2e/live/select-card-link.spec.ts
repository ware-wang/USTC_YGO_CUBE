import path from "node:path";

import { expect, test } from "@playwright/test";

import {
  duelCard,
  expectSelectableCards,
  installOnlyLiveDeck,
  LIVE_E2E_ENABLED,
  normalSummonToMainMonsterZone,
  readYdkDeck,
  resolveSummonToAnyMainMonsterZone,
  selectCardsFromModal,
  specialSummonExtraDeckCardToMainMonsterZone,
  startAiDuel,
  surrenderAndClosePage,
} from "../helpers/live";

const DECK = path.resolve("tests/e2e/fixtures/live/decks/select-card-link.ydk");
const DECK_NAME = "E2E Select Card Link";
const MYSTICAL_ELF = 15025844;
const LINK_SPIDER = 98978921;

test.describe("live select_card link summon interaction", () => {
  test.skip(
    !LIVE_E2E_ENABLED,
    "Set PLAYWRIGHT_LIVE=1 to run tests against the real ygopro server.",
  );

  test("selects link material and summons a link monster", async ({
    page,
  }, testInfo) => {
    testInfo.setTimeout(Number(process.env.LIVE_E2E_TIMEOUT ?? 180000));

    await installOnlyLiveDeck(page, await readYdkDeck(DECK, DECK_NAME));
    await startAiDuel(page);

    await normalSummonToMainMonsterZone(page, {
      cardCode: MYSTICAL_ELF,
      sequence: 2,
    });
    const controller = await duelCard(page, {
      code: MYSTICAL_ELF,
      zone: "MZONE",
      sequence: 2,
    })
      .first()
      .getAttribute("data-card-controller");
    expect(
      controller,
      "Expected link material to have a controller.",
    ).not.toBeNull();

    await specialSummonExtraDeckCardToMainMonsterZone(page, LINK_SPIDER);
    await expectSelectableCards(page, [MYSTICAL_ELF]);
    await selectCardsFromModal(page, [MYSTICAL_ELF]);
    const linkSequence = await resolveSummonToAnyMainMonsterZone(page, {
      cardCode: LINK_SPIDER,
      controller: controller!,
      position: "FACEUP_ATTACK",
    });

    await expect(
      duelCard(page, {
        code: LINK_SPIDER,
        zone: "MZONE",
        controller,
        sequence: linkSequence,
      }),
    ).toBeVisible({ timeout: 60000 });

    await surrenderAndClosePage(page);
  });
});
