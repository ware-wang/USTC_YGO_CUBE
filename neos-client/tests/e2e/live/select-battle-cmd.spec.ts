import path from "node:path";

import { test } from "@playwright/test";

import {
  chooseDuelPhase,
  chooseYesNo,
  clickCardAction,
  duelCard,
  expectCardIdleAction,
  expectPlayerLifeBelow,
  getControllerOfHandCard,
  getPlayerLife,
  installOnlyLiveDeck,
  LIVE_E2E_ENABLED,
  normalSummonToMainMonsterZone,
  readYdkDeck,
  startAiDuel,
  surrenderAndClosePage,
} from "../helpers/live";

const DECK = path.resolve(
  "tests/e2e/fixtures/live/decks/select-battle-cmd-direct-attack.ydk",
);
const DECK_NAME = "E2E Select Battle Cmd Direct Attack";
const JINZO_7 = 32809211;

test.describe("live select_battle_cmd interaction", () => {
  test.skip(
    !LIVE_E2E_ENABLED,
    "Set PLAYWRIGHT_LIVE=1 to run tests against the real ygopro server.",
  );

  test("attacks through a battle command response", async ({
    page,
  }, testInfo) => {
    testInfo.setTimeout(Number(process.env.LIVE_E2E_TIMEOUT ?? 180000));

    await installOnlyLiveDeck(page, await readYdkDeck(DECK, DECK_NAME));
    await startAiDuel(page, {
      tp: "second",
    });

    const controller = await getControllerOfHandCard(page, JINZO_7);
    await normalSummonToMainMonsterZone(page, {
      cardCode: JINZO_7,
      sequence: 2,
    });
    await chooseDuelPhase(page, "battle");

    const attacker = duelCard(page, {
      code: JINZO_7,
      zone: "MZONE",
      controller,
      sequence: 2,
    });
    await expectCardIdleAction(attacker, "ATTACK", {
      source: "battle",
      directAttackable: true,
    });

    const opponentLife = await getPlayerLife(page, "op");
    await clickCardAction(page, attacker, "attack");
    await chooseYesNo(page, "yes");
    await expectPlayerLifeBelow(page, "op", opponentLife);

    await surrenderAndClosePage(page);
  });
});
