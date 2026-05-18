import path from "node:path";

import { expect, test } from "@playwright/test";

import {
  clickCardAction,
  duelCard,
  getControllerOfHandCard,
  installOnlyLiveDeck,
  LIVE_E2E_ENABLED,
  readYdkDeck,
  resolveSummonPlacement,
  startAiDuel,
  surrenderAndClosePage,
} from "../helpers/live";

const DECK = path.resolve(
  "tests/e2e/fixtures/live/decks/select-position-cyber-dragon.ydk",
);
const DECK_NAME = "E2E Select Position Cyber Dragon";
const CYBER_DRAGON = 70095154;

test.describe("live select_position interaction", () => {
  test.skip(
    !LIVE_E2E_ENABLED,
    "Set PLAYWRIGHT_LIVE=1 to run tests against the real ygopro server.",
  );

  test("special summons Cyber Dragon in a selected battle position", async ({
    page,
  }, testInfo) => {
    testInfo.setTimeout(Number(process.env.LIVE_E2E_TIMEOUT ?? 180000));

    await installOnlyLiveDeck(page, await readYdkDeck(DECK, DECK_NAME));
    await startAiDuel(page, { tp: "second" });

    const controller = await getControllerOfHandCard(page, CYBER_DRAGON);
    const cyberDragon = duelCard(page, {
      code: CYBER_DRAGON,
      zone: "HAND",
      idleAction: "SP_SUMMON",
    }).first();

    await clickCardAction(page, cyberDragon, "sp_summon");
    await resolveSummonPlacement(page, {
      cardCode: CYBER_DRAGON,
      controller,
      sequence: 2,
      position: "FACEUP_DEFENSE",
    });

    await expect(
      duelCard(page, {
        code: CYBER_DRAGON,
        zone: "MZONE",
        controller,
        sequence: 2,
      }),
    ).toHaveAttribute("data-card-position", "FACEUP_DEFENSE");

    await surrenderAndClosePage(page);
  });
});
