import { test } from "@playwright/test";

import {
  completeDuelStartSelections,
  createCustomRoom,
  DEFAULT_AI_ROOM_PASSWORD,
  expectDuelStarted,
  LIVE_E2E_ENABLED,
  surrenderAndClosePage,
  waitForAutoBot,
} from "../helpers/live";

test.describe("live interaction smoke", () => {
  test.skip(
    !LIVE_E2E_ENABLED,
    "Set PLAYWRIGHT_LIVE=1 to run tests against the real ygopro server.",
  );

  test("creates an AI custom room and enters duel", async ({
    page,
  }, testInfo) => {
    testInfo.setTimeout(Number(process.env.LIVE_E2E_TIMEOUT ?? 180000));

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
    await surrenderAndClosePage(page);
  });
});
