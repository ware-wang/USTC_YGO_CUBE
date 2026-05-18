import path from "node:path";

import { test } from "@playwright/test";

import {
  completeDuelStartSelections,
  createCustomRoom,
  DEFAULT_AI_ROOM_PASSWORD,
  expectDuelStarted,
  installOnlyLiveDeck,
  LIVE_E2E_ENABLED,
  normalSummonToMainMonsterZone,
  readYdkDeck,
  surrenderAndClosePage,
  waitForAutoBot,
} from "../helpers/live";

const SELECT_PLACE_DECK = path.resolve(
  "tests/e2e/fixtures/live/decks/select-place.ydk",
);
const SELECT_PLACE_DECK_NAME = "E2E Select Place";
const MYSTICAL_ELF = 15025844;

test.describe("live select_place interaction", () => {
  test.skip(
    !LIVE_E2E_ENABLED,
    "Set PLAYWRIGHT_LIVE=1 to run tests against the real ygopro server.",
  );

  test("normal summons a fixed monster to a selected zone", async ({
    page,
  }, testInfo) => {
    testInfo.setTimeout(Number(process.env.LIVE_E2E_TIMEOUT ?? 180000));

    await installOnlyLiveDeck(
      page,
      await readYdkDeck(SELECT_PLACE_DECK, SELECT_PLACE_DECK_NAME),
    );

    const room = await createCustomRoom(page, {
      botName: process.env.LIVE_E2E_BOT_NAME,
      playerName: process.env.LIVE_E2E_PLAYER_NAME,
      roomPassword:
        process.env.LIVE_E2E_ROOM_PASSWORD ?? DEFAULT_AI_ROOM_PASSWORD,
      roomCodes: process.env.LIVE_E2E_ROOM_CODES,
      roomPrefix: process.env.LIVE_E2E_ROOM_PREFIX,
    });

    await waitForAutoBot(page, room.botName);
    await completeDuelStartSelections(page, {
      mora: "paper",
      tp: "first",
    });
    await expectDuelStarted(page);

    await normalSummonToMainMonsterZone(page, {
      cardCode: MYSTICAL_ELF,
      sequence: 2,
    });

    await surrenderAndClosePage(page);
  });
});
