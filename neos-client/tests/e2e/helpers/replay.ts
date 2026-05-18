import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { expect, type Page, type TestInfo } from "@playwright/test";

export interface DuelCardSnapshot {
  code: number;
  controller: number;
  zone: string;
  sequence: number;
  position: string;
  isOverlay: boolean;
  overlaySequence: number;
  isToken: boolean;
  status: number;
  selectable: boolean;
  selected: boolean;
  targeted: boolean;
  disabled: boolean;
}

export interface ChainMarkerSnapshot {
  index: number;
  controller: number;
  zone: string;
  sequence: number;
}

export interface ZoneCountSnapshot {
  controller: number;
  count: number;
}

export interface PlayerLifeSnapshot {
  player: "op" | "me";
  life: number;
}

export interface DuelDomSnapshot {
  cards: DuelCardSnapshot[];
  deckCounts: ZoneCountSnapshot[];
  extraCounts: ZoneCountSnapshot[];
  lifePoints: PlayerLifeSnapshot[];
  chainMarkers: ChainMarkerSnapshot[];
}

export interface ReplayCheckpoint extends DuelDomSnapshot {
  advance: number;
}

export interface ReplayExpected {
  version: 1;
  checkpoints: ReplayCheckpoint[];
}

export const ReplayAdvanceFlag = {
  START: 1 << 0,
  DRAW: 1 << 1,
  NEW_TURN: 1 << 2,
  NEW_PHASE: 1 << 3,
  MOVE: 1 << 4,
  SET: 1 << 5,
  SWAP: 1 << 6,
  SUMMONING: 1 << 7,
  SUMMONED: 1 << 8,
  FLIP_SUMMONING: 1 << 9,
  FLIP_SUMMONED: 1 << 10,
  SP_SUMMONING: 1 << 11,
  SP_SUMMONED: 1 << 12,
  CHAINING: 1 << 13,
  CHAIN_SOLVED: 1 << 14,
  CHAIN_END: 1 << 15,
  ATTACK: 1 << 16,
  POS_CHANGE: 1 << 17,
  UPDATE_HP: 1 << 18,
  WIN: 1 << 19,
  BECOME_TARGET: 1 << 20,
  RELOAD_FIELD: 1 << 21,
  SHUFFLE_HAND_EXTRA: 1 << 22,
  SHUFFLE_SET_CARD: 1 << 23,
  FIELD_DISABLED: 1 << 24,
  CONFIRM_CARDS: 1 << 25,
  UPDATE_COUNTER: 1 << 26,
  UPDATE_DATA: 1 << 27,
} as const;

export const DEFAULT_REPLAY_ADVANCE_MASK =
  ReplayAdvanceFlag.START |
  ReplayAdvanceFlag.DRAW |
  ReplayAdvanceFlag.NEW_TURN |
  ReplayAdvanceFlag.NEW_PHASE |
  ReplayAdvanceFlag.MOVE |
  ReplayAdvanceFlag.SET |
  ReplayAdvanceFlag.SWAP |
  ReplayAdvanceFlag.SUMMONING |
  ReplayAdvanceFlag.SUMMONED |
  ReplayAdvanceFlag.FLIP_SUMMONING |
  ReplayAdvanceFlag.FLIP_SUMMONED |
  ReplayAdvanceFlag.SP_SUMMONING |
  ReplayAdvanceFlag.SP_SUMMONED |
  ReplayAdvanceFlag.CHAINING |
  ReplayAdvanceFlag.CHAIN_SOLVED |
  ReplayAdvanceFlag.CHAIN_END |
  ReplayAdvanceFlag.ATTACK |
  ReplayAdvanceFlag.POS_CHANGE |
  ReplayAdvanceFlag.UPDATE_HP |
  ReplayAdvanceFlag.WIN |
  ReplayAdvanceFlag.BECOME_TARGET |
  ReplayAdvanceFlag.RELOAD_FIELD |
  ReplayAdvanceFlag.SHUFFLE_HAND_EXTRA |
  ReplayAdvanceFlag.SHUFFLE_SET_CARD |
  ReplayAdvanceFlag.FIELD_DISABLED |
  ReplayAdvanceFlag.CONFIRM_CARDS |
  ReplayAdvanceFlag.UPDATE_COUNTER;

export const DEFAULT_EXPECTED_REPLAY_ADVANCE_MASK =
  ReplayAdvanceFlag.START |
  ReplayAdvanceFlag.DRAW |
  ReplayAdvanceFlag.MOVE |
  ReplayAdvanceFlag.SET |
  ReplayAdvanceFlag.SWAP |
  ReplayAdvanceFlag.SUMMONING |
  ReplayAdvanceFlag.SUMMONED |
  ReplayAdvanceFlag.FLIP_SUMMONING |
  ReplayAdvanceFlag.FLIP_SUMMONED |
  ReplayAdvanceFlag.SP_SUMMONING |
  ReplayAdvanceFlag.SP_SUMMONED |
  ReplayAdvanceFlag.CHAINING |
  ReplayAdvanceFlag.CHAIN_SOLVED |
  ReplayAdvanceFlag.CHAIN_END |
  ReplayAdvanceFlag.POS_CHANGE |
  ReplayAdvanceFlag.UPDATE_HP |
  ReplayAdvanceFlag.WIN |
  ReplayAdvanceFlag.BECOME_TARGET |
  ReplayAdvanceFlag.RELOAD_FIELD |
  ReplayAdvanceFlag.SHUFFLE_HAND_EXTRA |
  ReplayAdvanceFlag.SHUFFLE_SET_CARD |
  ReplayAdvanceFlag.FIELD_DISABLED |
  ReplayAdvanceFlag.CONFIRM_CARDS |
  ReplayAdvanceFlag.UPDATE_COUNTER;

const UPDATE_EXPECTED = process.env.UPDATE_EXPECTED === "1";
const REPLAY_ADVANCE_EVENT = "neos:replay-advance";
const ZONE_ORDER = [
  "DECK",
  "HAND",
  "MZONE",
  "SZONE",
  "GRAVE",
  "REMOVED",
  "EXTRA",
  "TZONE",
];

export function buildReplayRecord(func: number, extraData: Uint8Array) {
  const record = new Uint8Array(5 + extraData.byteLength);
  const recordView = new DataView(record.buffer);
  recordView.setUint8(0, func);
  recordView.setUint32(1, extraData.byteLength, true);
  record.set(extraData, 5);

  return record;
}

export function buildMinimalDuelReplay() {
  const msgStart = new Uint8Array(17);
  const dataView = new DataView(msgStart.buffer);

  dataView.setUint8(0, 0);
  dataView.setInt32(1, 8000, true);
  dataView.setInt32(5, 8000, true);
  dataView.setInt16(9, 40, true);
  dataView.setInt16(11, 15, true);
  dataView.setInt16(13, 40, true);
  dataView.setInt16(15, 15, true);

  const msgWin = new Uint8Array([0, 0]);
  const records = [
    buildReplayRecord(4, msgStart),
    buildReplayRecord(5, msgWin),
  ];
  const replay = new Uint8Array(
    records.reduce((total, record) => total + record.byteLength, 0),
  );

  let offset = 0;
  for (const record of records) {
    replay.set(record, offset);
    offset += record.byteLength;
  }

  return replay;
}

export async function writeReplayFixture(
  testInfo: TestInfo,
  fileName: string,
  replay: Uint8Array,
) {
  const replayPath = testInfo.outputPath(fileName);
  await mkdir(path.dirname(replayPath), { recursive: true });
  await writeFile(replayPath, replay);

  return replayPath;
}

export async function uploadReplay(page: Page, replayPath: string) {
  await page.goto("/match");

  await page
    .getByText(/录像回放|Replay/)
    .first()
    .click();
  await page.locator('input[type="file"]').setInputFiles(replayPath);
  await page.getByRole("button", { name: /开始回放|Start Replay/ }).click();

  await expect(page).toHaveURL(/\/duel/);
}

export async function pauseReplay(page: Page) {
  const toggle = page.getByTestId("replay-toggle");

  await expect(toggle).toBeVisible();
  if ((await toggle.getAttribute("data-replay-paused")) !== "true") {
    await toggle.click();
  }

  await expect(toggle).toHaveAttribute("data-replay-paused", "true");
  await expect(toggle).toHaveAttribute("data-replay-waiting", "true");
}

export async function advanceReplay(page: Page, steps = 1) {
  const advance = page.getByTestId("replay-advance");

  for (let i = 0; i < steps; i += 1) {
    await expect(advance).toBeEnabled();
    await advance.click();
  }
}

export async function advanceReplayTo(page: Page, advanceMask: number) {
  await expect(page.getByTestId("replay-advance")).toBeEnabled();
  await page.evaluate(
    ({ eventName, mask }) => {
      window.dispatchEvent(
        new CustomEvent(eventName, {
          detail: { advanceMask: mask },
        }),
      );
    },
    { eventName: REPLAY_ADVANCE_EVENT, mask: advanceMask },
  );
}

export function duelCards(page: Page) {
  return page.getByTestId("duel-card");
}

export async function snapshotDuelDom(page: Page): Promise<DuelDomSnapshot> {
  const cards = await page.getByTestId("duel-card").evaluateAll((nodes) => {
    const readStringAttr = (node: Element, name: string) => {
      const value = node.getAttribute(name);
      if (value === null) throw new Error(`${name} is missing.`);

      return value;
    };
    const readNumberAttr = (node: Element, name: string, fallback?: number) => {
      const value = node.getAttribute(name);
      if (value === null) {
        if (fallback !== undefined) return fallback;
        throw new Error(`${name} is missing.`);
      }

      return Number(value);
    };
    const readBoolAttr = (node: Element, name: string) =>
      readStringAttr(node, name) === "true";

    return nodes.map((node) => ({
      code: readNumberAttr(node, "data-card-code"),
      controller: readNumberAttr(node, "data-card-controller"),
      zone: readStringAttr(node, "data-card-zone"),
      sequence: readNumberAttr(node, "data-card-sequence"),
      position: readStringAttr(node, "data-card-position"),
      isOverlay: readBoolAttr(node, "data-card-is-overlay"),
      overlaySequence: readNumberAttr(node, "data-card-overlay-sequence", 0),
      isToken: readBoolAttr(node, "data-card-is-token"),
      status: readNumberAttr(node, "data-card-status"),
      selectable: readBoolAttr(node, "data-card-selectable"),
      selected: readBoolAttr(node, "data-card-selected"),
      targeted: readBoolAttr(node, "data-card-targeted"),
      disabled: readBoolAttr(node, "data-card-disabled"),
    }));
  });

  const chainMarkers = await page
    .getByTestId("duel-chain-marker")
    .evaluateAll((nodes) => {
      const readStringAttr = (node: Element, name: string) => {
        const value = node.getAttribute(name);
        if (value === null) throw new Error(`${name} is missing.`);

        return value;
      };
      const readNumberAttr = (node: Element, name: string) => {
        const value = node.getAttribute(name);
        if (value === null) throw new Error(`${name} is missing.`);

        return Number(value);
      };

      return nodes.map((node) => ({
        index: readNumberAttr(node, "data-chain-index"),
        controller: readNumberAttr(node, "data-chain-controller"),
        zone: readStringAttr(node, "data-chain-zone"),
        sequence: readNumberAttr(node, "data-chain-sequence"),
      }));
    });

  const lifePoints = await page
    .getByTestId("duel-player-life")
    .evaluateAll((nodes) => {
      const readStringAttr = (node: Element, name: string) => {
        const value = node.getAttribute(name);
        if (value === null) throw new Error(`${name} is missing.`);

        return value;
      };
      const readNumberAttr = (node: Element, name: string) => {
        const value = node.getAttribute(name);
        if (value === null) throw new Error(`${name} is missing.`);

        return Number(value);
      };

      return nodes.map((node) => {
        const player = readStringAttr(node, "data-player");
        if (player !== "op" && player !== "me") {
          throw new Error(`Invalid data-player: ${player}.`);
        }

        return {
          player,
          life: readNumberAttr(node, "data-life"),
        };
      });
    });

  return {
    cards: cards.filter(isAssertedCard).sort(compareCards),
    deckCounts: collectZoneCounts(cards, "DECK"),
    extraCounts: collectZoneCounts(cards, "EXTRA"),
    lifePoints: lifePoints.sort(comparePlayerLife),
    chainMarkers: chainMarkers.sort(compareChainMarkers),
  };
}

export async function collectReplayExpected(
  page: Page,
  options: { maxSteps?: number; advanceMask?: number } = {},
): Promise<ReplayExpected> {
  const maxSteps = options.maxSteps ?? 10000;
  const advanceMask =
    options.advanceMask ?? DEFAULT_EXPECTED_REPLAY_ADVANCE_MASK;
  let lastSnapshot = await snapshotDuelDom(page);
  let advanceSinceLastCheckpoint = 0;
  const checkpoints: ReplayCheckpoint[] = [
    {
      advance: 0,
      ...lastSnapshot,
    },
  ];

  for (let step = 0; step < maxSteps; step += 1) {
    if ((await waitForReplayAdvanceOrEnd(page)) === "end") {
      return {
        version: 1,
        checkpoints,
      };
    }

    const previousIndex = await getReplayIndex(page);

    await advanceReplayTo(page, advanceMask);
    await waitForReplayAdvanced(page, previousIndex);
    advanceSinceLastCheckpoint += 1;

    const snapshot = await snapshotDuelDom(page);
    if (stableSnapshot(snapshot) !== stableSnapshot(lastSnapshot)) {
      checkpoints.push({
        advance: advanceSinceLastCheckpoint,
        ...snapshot,
      });
      advanceSinceLastCheckpoint = 0;
      lastSnapshot = snapshot;
    }
  }

  throw new Error(`Replay snapshot collection exceeded ${maxSteps} steps.`);
}

export async function expectOrUpdateReplayExpected(
  page: Page,
  expectedPath: string,
  options: { maxSteps?: number; advanceMask?: number } = {},
) {
  if (UPDATE_EXPECTED) {
    const actual = await collectReplayExpected(page, options);
    await writeReplayExpected(expectedPath, actual);

    return actual;
  }

  const expected = await readReplayExpected(expectedPath);
  return expectReplayExpected(page, expected, options);
}

export async function expectReplayExpected(
  page: Page,
  expected: ReplayExpected,
  options: { maxSteps?: number; advanceMask?: number } = {},
): Promise<ReplayExpected> {
  expect(expected.version).toBe(1);
  expect(expected.checkpoints.length).toBeGreaterThan(0);

  const maxSteps = options.maxSteps ?? 10000;
  const advanceMask =
    options.advanceMask ?? DEFAULT_EXPECTED_REPLAY_ADVANCE_MASK;
  let lastSnapshot = await snapshotDuelDom(page);
  let advanceSinceLastCheckpoint = 0;
  const checkpoints: ReplayCheckpoint[] = [
    {
      advance: 0,
      ...lastSnapshot,
    },
  ];

  expect(checkpoints[0], "Replay checkpoint 0 mismatch.").toEqual(
    expected.checkpoints[0],
  );

  for (let step = 0; step < maxSteps; step += 1) {
    if ((await waitForReplayAdvanceOrEnd(page)) === "end") {
      expect(
        checkpoints.length,
        `Replay ended after ${checkpoints.length} checkpoints, expected ${expected.checkpoints.length}.`,
      ).toBe(expected.checkpoints.length);

      return {
        version: 1,
        checkpoints,
      };
    }

    const previousIndex = await getReplayIndex(page);

    await advanceReplayTo(page, advanceMask);
    await waitForReplayAdvanced(page, previousIndex);
    advanceSinceLastCheckpoint += 1;

    const snapshot = await snapshotDuelDom(page);
    if (stableSnapshot(snapshot) !== stableSnapshot(lastSnapshot)) {
      const checkpoint = {
        advance: advanceSinceLastCheckpoint,
        ...snapshot,
      };
      checkpoints.push(checkpoint);

      const checkpointIndex = checkpoints.length - 1;
      expect(
        expected.checkpoints[checkpointIndex],
        `Replay produced unexpected checkpoint ${checkpointIndex}.`,
      ).toBeDefined();
      expect(
        checkpoint,
        `Replay checkpoint ${checkpointIndex} mismatch.`,
      ).toEqual(expected.checkpoints[checkpointIndex]);

      advanceSinceLastCheckpoint = 0;
      lastSnapshot = snapshot;

      continue;
    }

    const nextExpectedCheckpoint = expected.checkpoints[checkpoints.length];
    if (nextExpectedCheckpoint) {
      expect(
        advanceSinceLastCheckpoint,
        `Expected checkpoint ${checkpoints.length} after ${nextExpectedCheckpoint.advance} advances, but DOM stayed unchanged for ${advanceSinceLastCheckpoint} advances.`,
      ).toBeLessThanOrEqual(nextExpectedCheckpoint.advance);
    }
  }

  throw new Error(`Replay snapshot collection exceeded ${maxSteps} steps.`);
}

export async function readReplayExpected(
  expectedPath: string,
): Promise<ReplayExpected> {
  return JSON.parse(await readFile(expectedPath, "utf-8")) as ReplayExpected;
}

export async function writeReplayExpected(
  expectedPath: string,
  expected: ReplayExpected,
) {
  await mkdir(path.dirname(expectedPath), { recursive: true });
  await writeFile(expectedPath, `${JSON.stringify(expected, null, 2)}\n`);
}

export async function expectDuelCardZoneCounts(
  page: Page,
  expected: Record<string, number>,
) {
  await Promise.all(
    Object.entries(expected).map(([zone, count]) =>
      expect(
        page.locator(`[data-testid="duel-card"][data-card-zone="${zone}"]`),
      ).toHaveCount(count),
    ),
  );
}

async function isReplayAdvanceEnabled(page: Page) {
  const advance = page.getByTestId("replay-advance");

  return (await advance.isVisible()) && (await advance.isEnabled());
}

async function waitForReplayAdvanceOrEnd(page: Page) {
  const deadline = Date.now() + 30000;

  while (Date.now() < deadline) {
    if (await isReplayEndVisible(page)) {
      return "end";
    }

    if (await isReplayAdvanceEnabled(page)) {
      return "advance";
    }

    await page.waitForTimeout(100);
  }

  throw new Error("Replay did not become advanceable or end within 30s.");
}

async function getReplayIndex(page: Page) {
  const value = await page
    .getByTestId("replay-toggle")
    .getAttribute("data-replay-index");

  if (value === null) {
    throw new Error("Replay index is missing.");
  }

  return Number(value);
}

async function waitForReplayAdvanced(page: Page, previousIndex: number) {
  const toggle = page.getByTestId("replay-toggle");

  await expect
    .poll(async () => {
      const advance = page.getByTestId("replay-advance");
      const index = await toggle.getAttribute("data-replay-index");
      const waiting = await toggle.getAttribute("data-replay-waiting");
      const currentIndex = Number(index);

      if (await isReplayEndVisible(page)) return "ready";
      if (currentIndex <= previousIndex) return "pending";
      if (waiting === "true" && (await advance.isEnabled())) return "ready";

      return "pending";
    })
    .toBe("ready");
}

async function isReplayEndVisible(page: Page) {
  return page
    .getByText(/Win|Defeated/)
    .first()
    .isVisible();
}

function stableSnapshot(snapshot: DuelDomSnapshot) {
  return JSON.stringify(snapshot);
}

function compareCards(left: DuelCardSnapshot, right: DuelCardSnapshot) {
  return (
    left.controller - right.controller ||
    zoneRank(left.zone) - zoneRank(right.zone) ||
    left.sequence - right.sequence ||
    Number(left.isOverlay) - Number(right.isOverlay) ||
    left.overlaySequence - right.overlaySequence ||
    left.code - right.code ||
    left.position.localeCompare(right.position) ||
    left.status - right.status ||
    Number(left.isToken) - Number(right.isToken)
  );
}

function isAssertedCard(card: DuelCardSnapshot) {
  return !["DECK", "EXTRA", "TZONE"].includes(card.zone);
}

function collectZoneCounts(
  cards: DuelCardSnapshot[],
  zone: string,
): ZoneCountSnapshot[] {
  const counts = new Map<number, number>();

  for (const card of cards) {
    if (card.zone !== zone) continue;
    counts.set(card.controller, (counts.get(card.controller) ?? 0) + 1);
  }

  return Array.from(counts, ([controller, count]) => ({
    controller,
    count,
  })).sort((left, right) => left.controller - right.controller);
}

function compareChainMarkers(
  left: ChainMarkerSnapshot,
  right: ChainMarkerSnapshot,
) {
  return (
    left.index - right.index ||
    left.controller - right.controller ||
    zoneRank(left.zone) - zoneRank(right.zone) ||
    left.sequence - right.sequence
  );
}

function comparePlayerLife(
  left: PlayerLifeSnapshot,
  right: PlayerLifeSnapshot,
) {
  return playerLifeRank(left.player) - playerLifeRank(right.player);
}

function playerLifeRank(player: PlayerLifeSnapshot["player"]) {
  return player === "op" ? 0 : 1;
}

function zoneRank(zone: string) {
  const index = ZONE_ORDER.indexOf(zone);

  return index === -1 ? ZONE_ORDER.length : index;
}
