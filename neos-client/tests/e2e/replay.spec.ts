import { existsSync, readdirSync } from "node:fs";
import path from "node:path";

import { expect, test } from "@playwright/test";

import {
  collectReplayExpected,
  expectReplayExpected,
  expectOrUpdateReplayExpected,
  pauseReplay,
  readReplayExpected,
  uploadReplay,
  writeReplayExpected,
} from "./helpers/replay";

interface ReplayFixtureCase {
  name: string;
  replayPath: string;
  expectedPath: string;
}

const REPLAY_FIXTURE_ROOT = path.resolve("tests/e2e/fixtures/replays");
const REPLAY_FIXTURE_TIMEOUT = Number(
  process.env.REPLAY_FIXTURE_TIMEOUT ?? 300000,
);
const REPLAY_FIXTURE_MAX_STEPS = Number(
  process.env.REPLAY_FIXTURE_MAX_STEPS ?? 20000,
);
const UPDATE_EXPECTED = process.env.UPDATE_EXPECTED === "1";
const replayFixtureCases = listReplayFixtureCases(REPLAY_FIXTURE_ROOT);

test.describe("managed replay fixtures", () => {
  for (const replayCase of replayFixtureCases) {
    test(`matches expected DOM snapshots: ${replayCase.name}`, async ({
      page,
    }, testInfo) => {
      testInfo.setTimeout(REPLAY_FIXTURE_TIMEOUT);

      await uploadReplay(page, replayCase.replayPath);
      await pauseReplay(page);

      await expectOrUpdateReplayExpected(page, replayCase.expectedPath, {
        maxSteps: REPLAY_FIXTURE_MAX_STEPS,
      });

      await expect(page.getByText(/Win|Defeated/)).toBeVisible();
    });
  }
});

test("uploads an external yrp3d replay and collects snapshots", async ({
  page,
}, testInfo) => {
  testInfo.setTimeout(300000);

  const replayPath = process.env.REAL_REPLAY_PATH;
  test.skip(!replayPath, "Set REAL_REPLAY_PATH to verify an external replay.");

  await uploadReplay(page, replayPath);
  await pauseReplay(page);

  const advanceMask = process.env.REAL_REPLAY_ADVANCE_MASK
    ? Number(process.env.REAL_REPLAY_ADVANCE_MASK)
    : undefined;
  const replayOptions = {
    maxSteps: Number(process.env.REAL_REPLAY_MAX_STEPS ?? 20000),
    advanceMask,
  };
  const expectedPath = process.env.REAL_REPLAY_EXPECTED_PATH;
  const actual = expectedPath
    ? await expectReplayExpected(
        page,
        await readReplayExpected(expectedPath),
        replayOptions,
      )
    : await collectReplayExpected(page, replayOptions);
  await writeReplayExpected(testInfo.outputPath("expected.json"), actual);

  expect(actual.checkpoints.length).toBeGreaterThan(0);
  await expect(page.getByText(/Win|Defeated/)).toBeVisible();
});

function listReplayFixtureCases(root: string): ReplayFixtureCase[] {
  if (!existsSync(root)) return [];

  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const caseDir = path.join(root, entry.name);

      return {
        name: entry.name,
        replayPath: path.join(caseDir, "replay.yrp3d"),
        expectedPath: path.join(caseDir, "expected.json"),
      };
    })
    .filter(
      (replayCase) =>
        existsSync(replayCase.replayPath) &&
        (UPDATE_EXPECTED || existsSync(replayCase.expectedPath)),
    )
    .sort((left, right) => left.name.localeCompare(right.name));
}
