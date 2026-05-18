import path from "node:path";

import { test } from "@playwright/test";

import {
  activateHandCard,
  clickCardAction,
  duelCard,
  getControllerOfHandCard,
  installOnlyLiveDeck,
  LIVE_E2E_ENABLED,
  normalSummonToMainMonsterZone,
  readYdkDeck,
  resolveSummonPlacement,
  selectCardsFromModal,
  startAiDuel,
  surrenderAndClosePage,
} from "../helpers/live";

const DECK = path.resolve(
  "tests/e2e/fixtures/live/decks/select-card-tribute.ydk",
);
const DECK_NAME = "E2E Select Card Tribute";
const MYSTICAL_ELF = 15025844;
const DOUBLE_SUMMON = 43422537;
const SUMMONED_SKULL = 70781052;

test.describe("live select_card tribute interaction", () => {
  test.skip(
    !LIVE_E2E_ENABLED,
    "Set PLAYWRIGHT_LIVE=1 to run tests against the real ygopro server.",
  );

  test("selects a tribute for a tribute summon", async ({ page }, testInfo) => {
    testInfo.setTimeout(Number(process.env.LIVE_E2E_TIMEOUT ?? 180000));

    await installOnlyLiveDeck(page, await readYdkDeck(DECK, DECK_NAME));
    await startAiDuel(page);

    const controller = await getControllerOfHandCard(page, MYSTICAL_ELF);

    await normalSummonToMainMonsterZone(page, {
      cardCode: MYSTICAL_ELF,
      sequence: 2,
    });
    await activateHandCard(page, DOUBLE_SUMMON);

    const tributeSummon = duelCard(page, {
      code: SUMMONED_SKULL,
      zone: "HAND",
      idleAction: "SUMMON",
    }).first();
    await clickCardAction(page, tributeSummon, "summon");

    await selectCardsFromModal(page, [MYSTICAL_ELF]);
    await resolveSummonPlacement(page, {
      cardCode: SUMMONED_SKULL,
      controller,
      sequence: 2,
    });

    await surrenderAndClosePage(page);
  });
});
