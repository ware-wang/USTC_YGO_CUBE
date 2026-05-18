# Live Interaction Deck Fixtures

This directory is reserved for tiny, deterministic decks used by Playwright
tests that connect to a real ygopro server.

Live decks should be organized by interaction scenario:

```text
tests/e2e/fixtures/live/decks/
  announce-card.ydk
  announce-number-sixth-sense.ydk
  select-battle-cmd-direct-attack.ydk
  select-chain-free-chain-traps.ydk
  select-card-link.ydk
  select-card-synchro.ydk
  select-card-xyz.ydk
  select-idle-cmd-basic.ydk
  select-position.ydk
  select-place.ydk
  select-yesno.ydk
  select-chain.ydk
  select-card.ydk
  select-option.ydk
```

These decks are test fixtures, not normal playable decks. Prefer the smallest
deck that reliably triggers the target UI interaction. The live tests use custom
room codes such as `NS` and `NC`, so deck order can be fixed and normal deck
size or forbidden-list constraints do not need to drive fixture design.

`select-place.ydk` intentionally contains repeated copies of `Mystical Elf`
(`15025844`) so the opening hand has a normal summonable monster with no effect
branches. The related test clears the browser deck IndexedDB and installs this
fixture as the only deck before entering the live room.

`announce-number-sixth-sense.ydk` uses a fixed card order with `Sixth Sense`
(`03280747`) in the opening hand. The related test sets it on the first turn,
passes to the opponent, turns chain prompts on, then declares two numbers.

`select-chain-free-chain-traps.ydk` opens `Jar of Greed` (`83968380`) and
`Reckless Greed` (`37576645`). The related test sets both traps, passes to the
opponent, asserts the `select_chain` modal exposes both candidates, then chains
both cards and checks the visible chain markers.

`select-idle-cmd-basic.ydk` opens `Pot of Greed` (`55144522`), `Mystical Elf`
(`15025844`), and `Jar of Greed` (`83968380`) so the first main phase exposes
activate, summon, monster set, and spell/trap set idle commands.

`select-battle-cmd-direct-attack.ydk` opens `Jinzo #7` (`32809211`), a simple
normal summonable monster with an unconditional direct attack effect and
non-zero ATK. The related test goes second, enters battle phase, asserts the
attack action comes from `select_battle_cmd`, confirms direct attack, then
verifies opponent LP drops.

`select-card-link.ydk` opens repeated `Mystical Elf` (`15025844`) and
`Link Spider` (`98978921`) in the Extra Deck. The related test selects
the field-selectable `Mystical Elf` as link material, summons `Link Spider`,
and asserts the link monster is on the field.

`select-card-xyz.ydk` uses the same three level 4 candidate monsters, then xyz
summons `Number 39: Utopia` (`84013237`) and asserts the summoned monster plus
two visible overlay materials.

`select-card-synchro.ydk` opens `Photon Thrasher` (`65367484`), `Double Summon`
(`43422537`), `Angel Trumpeter` (`87979586`), and `Mystical Elf` (`15025844`).
The related test opens `Stardust Dragon` (`44508094`) from the Extra Deck and
selects `Angel Trumpeter` and then `Photon Thrasher` as synchro materials.
