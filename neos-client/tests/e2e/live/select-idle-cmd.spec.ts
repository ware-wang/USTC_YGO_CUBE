import path from "node:path";

import { expect, test } from "@playwright/test";

import {
  chooseSelectableMainMonsterZone,
  clickCardAction,
  duelCard,
  expectCardIdleAction,
  expectControllerHandCount,
  expectMyTurn,
  expectNoIdleAction,
  getControllerOfHandCard,
  installOnlyLiveDeck,
  LIVE_E2E_ENABLED,
  readYdkDeck,
  startAiDuel,
  surrenderAndClosePage,
} from "../helpers/live";

const DECK = path.resolve(
  "tests/e2e/fixtures/live/decks/select-idle-cmd-basic.ydk",
);
const DECK_NAME = "E2E Select Idle Cmd Basic";
const POT_OF_GREED = 55144522;
const MYSTICAL_ELF = 15025844;
const JAR_OF_GREED = 83968380;

test.describe("live select_idle_cmd interaction", () => {
  test.skip(
    !LIVE_E2E_ENABLED,
    "Set PLAYWRIGHT_LIVE=1 to run tests against the real ygopro server.",
  );

  test("renders idle commands and sends a summon response", async ({
    page,
  }, testInfo) => {
    testInfo.setTimeout(Number(process.env.LIVE_E2E_TIMEOUT ?? 180000));

    await installOnlyLiveDeck(page, await readYdkDeck(DECK, DECK_NAME));
    await startAiDuel(page, {
      mora: "rock",
      tp: "first",
    });
    await expectMyTurn(page);

    const controller = await getControllerOfHandCard(page, MYSTICAL_ELF);
    await expectControllerHandCount(page, controller, 5);

    const mysticalElf = duelCard(page, {
      code: MYSTICAL_ELF,
      zone: "HAND",
    }).first();
    const potOfGreed = duelCard(page, {
      code: POT_OF_GREED,
      zone: "HAND",
    }).first();
    const jarOfGreed = duelCard(page, {
      code: JAR_OF_GREED,
      zone: "HAND",
    }).first();

    await expectCardIdleAction(mysticalElf, "SUMMON", { source: "idle" });
    await expectCardIdleAction(mysticalElf, "MSET", { source: "idle" });
    await expectCardIdleAction(potOfGreed, "ACTIVATE", { source: "idle" });
    await expectCardIdleAction(jarOfGreed, "SSET", { source: "idle" });

    await clickCardAction(page, mysticalElf, "summon");
    await chooseSelectableMainMonsterZone(page, {
      controller,
      sequence: 2,
    });

    await expect(
      duelCard(page, {
        code: MYSTICAL_ELF,
        zone: "MZONE",
        controller,
        sequence: 2,
      }),
    ).toBeVisible({ timeout: 60000 });
    await expectNoIdleAction(page, "SUMMON");

    await surrenderAndClosePage(page);
  });
});
