# Replay Fixtures

Each replay regression case lives in its own directory:

```text
tests/e2e/fixtures/replays/<case-name>/
  replay.yrp3d
  expected.json
```

`replay.spec.ts` scans this directory at startup and creates one Playwright
test for every case that contains both files. When `UPDATE_EXPECTED=1` is set,
a case only needs `replay.yrp3d`; the test will generate `expected.json`.

`expected.json` is managed by git. Update it with:

```bash
UPDATE_EXPECTED=1 npm run test:e2e -- --project=chrome
```

The expected snapshot stores DOM-observable replay state. It intentionally
does not store individual `DECK`, `EXTRA`, or `TZONE` cards.

Normal test runs compare checkpoints incrementally as the replay advances, so
the test fails as soon as a generated checkpoint diverges from `expected.json`.
