# Playwright 黑盒测试方案

## 目标

Playwright 黑盒测试用于从浏览器用户视角验证 Neos 前端行为是否正确。测试不直接调用 `src` 内部函数，不读取 `matStore`、`cardStore` 等运行时对象，也不 mock 前端业务逻辑，而是通过以下边界完成验证：

- 打开真实页面
- 点击真实 UI
- 上传 `.yrp3d` 文件
- 走前端本地 replay 解析和消息处理流程
- 等待页面跳转和渲染
- 从 DOM、文本、截图或浏览器可观察状态做断言

这种测试适合覆盖“用户实际能否完成一条流程”，例如回放文件上传、进入决斗页面、卡牌渲染、结算弹窗展示等。

## 当前实现

当前已落地一个最小回放黑盒用例：

- 配置文件：`playwright.config.ts`
- 测试文件：`tests/e2e/replay.spec.ts`
- 测试公共函数：`tests/e2e/helpers/replay.ts`
- 运行脚本：`npm run test:e2e`、`npm run test:e2e:headed`

测试流程：

1. Playwright 自动启动 Vite dev server。
2. 使用本机 Chrome 打开 `/match` 页面。
3. 测试代码临时生成一个最小 `.yrp3d` 文件。
4. 通过页面上的回放上传入口选择该文件。
5. 点击“开始回放”。
6. 前端本地解析 `.yrp3d` 数据，转换成 `STOC_GAME_MSG` 消息。
7. 本地 replay stream 按现有 socket looper 入口分发消息，前端按正常路径处理。
8. 页面跳转到 `/duel`。
9. Playwright 点击 replay 暂停按钮，让回放停在当前 DOM 状态。
10. 断言卡牌 DOM 已渲染，且结算结果尚未出现。
11. Playwright 点击 replay 下一步按钮，推进一条 `GAME_MSG`。
12. 断言出现 `Win` 结算结果。

最小 `.yrp3d` 内容包含两条记录：

- `MSG_START`：初始化双方 LP、主卡组、额外卡组和 token 占位卡。
- `MSG_WIN`：触发胜利结算弹窗。

该用例覆盖的是从“上传回放”到“决斗结束展示”的前端闭环，不验证具体卡片效果逻辑。

## 本地 Replay 流

Neos 现在不依赖远程 `replay.neos.moe` 服务来播放 `.yrp3d`。前端会在本地完成 replay worker 原本承担的轻量转换：

1. 读取 `.yrp3d` 中的每条记录：`func:uint8 + length:uint32le + data`。
2. 将记录包装成现有 `YgoProPacket`：`proto = STOC_GAME_MSG`，`exData = [func, ...data]`。
3. 通过 `LocalReplayStream.execute(onMessage)` 串行交给 `handleSocketMessage`。

因此 replay 黑盒测试仍然覆盖真实的 `adaptStoc -> handleGameMsg -> store -> DOM` 路径，但不会受远程 replay 服务、WebSocket 网络时序或服务可用性影响。

## Replay 控制

为了让真实录像的中间态断言稳定，项目侧提供了 replay 控制能力：

- 暂停：停止继续消费本地 replay 流中的后续 `GAME_MSG`。
- 下一步：在暂停状态下推进到下一条关键 `GAME_MSG`，跳过 `update_data`、`hint`、`wait` 等高频同步消息。
- 继续：恢复自动消费后续 replay 消息。

控制按钮只在 replay 模式下显示，位于 Duel 页面右下角菜单中：

- `data-testid="replay-toggle"`：暂停/继续。
- `data-testid="replay-advance"`：下一步。

默认下一步会停在卡牌移动、抽卡、阶段变化、召唤、连锁、攻击、LP 变化、胜负结算等用户可观察事件上。被跳过的消息仍然会正常进入 `adaptStoc -> handleGameMsg -> store -> DOM` 流程，只是不作为暂停点。

测试侧公共函数封装在 `tests/e2e/helpers/replay.ts`：

- `uploadReplay(page, replayPath)`：打开 `/match`，通过 UI 上传 replay，并等待进入 `/duel`。
- `pauseReplay(page)`：点击 replay 暂停按钮，并等待按钮状态变为 paused。
- `advanceReplay(page, steps)`：点击下一步按钮，每次推进到下一条关键 `GAME_MSG`。
- `advanceReplayTo(page, advanceMask)`：通过测试控制事件推进到下一条匹配 bit flag 的 `GAME_MSG`。
- `duelCards(page)`：返回所有 Duel 卡牌 DOM locator。
- `expectDuelCardZoneCounts(page, expected)`：按 zone 断言卡牌数量。
- `writeReplayFixture(testInfo, fileName, replay)`：把测试生成的 replay 写入 Playwright 临时目录。

这些 helper 只封装 Playwright 对页面的操作和 DOM 读取，不 import 项目业务代码。

`advanceMask` 是 bit flag，例如：

```ts
ReplayAdvanceFlag.MOVE | ReplayAdvanceFlag.DRAW | ReplayAdvanceFlag.WIN;
```

当测试只关心卡牌移动、抽卡和结算时，可以用这个 mask 跳过其他关键消息。默认 mask 不包含 `UPDATE_DATA`，因为它通常只是同步卡牌数据，出现频率很高，不适合作为自动断言 checkpoint。

`collectReplayExpected(page)` 默认使用更窄的 expected 生成 mask：它只停在更可能影响卡牌 DOM、生命值或连锁标记的消息上，例如 `DRAW`、`MOVE`、`SET`、召唤、连锁、`POS_CHANGE`、`UPDATE_HP`、`BECOME_TARGET`、`RELOAD_FIELD`、洗牌、计数器和 `WIN`。阶段变化、攻击宣言这类当前 expected 不断言的 UI 状态不会作为默认 checkpoint。

## Expected JSON

真实 replay 用例按“一个目录一个 case”的方式组织，`replay.yrp3d` 和预期 DOM 状态 `expected.json` 放在同一个目录中：

```text
tests/e2e/fixtures/replays/<case-name>/
  replay.yrp3d
  expected.json
```

`tests/e2e/replay.spec.ts` 会在启动时扫描 `tests/e2e/fixtures/replays/*`，对每个同时包含 `replay.yrp3d` 和 `expected.json` 的目录生成一个 Playwright 测试。`UPDATE_EXPECTED=1` 时，目录里只要有 `replay.yrp3d` 就会生成或更新 `expected.json`。目录名会进入测试名，建议使用稳定的序号或可读名称，例如 `1`、`2`、`minimal-duel`。

`expected.json` 描述的是 Playwright 能从页面 DOM 观察到的对局状态，不是 `matStore`、`cardStore` 或其他内部 store 的快照。

`expected.json` 由 Playwright 自动生成。生成器会在 replay 暂停后按 expected 生成 mask 推进，每推进一次采集一次 DOM 快照；如果快照和上一个已记录 checkpoint 不同，就自动追加一个 checkpoint。

建议格式：

```json
{
  "version": 1,
  "checkpoints": [
    {
      "advance": 0,
      "cards": [
        {
          "code": 89631139,
          "controller": 0,
          "zone": "MZONE",
          "sequence": 2,
          "position": "FACEUP_ATTACK",
          "isOverlay": false,
          "overlaySequence": 0,
          "isToken": false,
          "status": 0,
          "selectable": false,
          "selected": false,
          "targeted": false,
          "disabled": false
        }
      ],
      "deckCounts": [
        {
          "controller": 0,
          "count": 34
        },
        {
          "controller": 1,
          "count": 31
        }
      ],
      "extraCounts": [
        {
          "controller": 0,
          "count": 12
        },
        {
          "controller": 1,
          "count": 9
        }
      ],
      "lifePoints": [
        {
          "player": "op",
          "life": 8000
        },
        {
          "player": "me",
          "life": 8000
        }
      ],
      "chainMarkers": [
        {
          "index": 1,
          "controller": 0,
          "zone": "MZONE",
          "sequence": 2
        }
      ]
    }
  ]
}
```

字段语义：

- `version`：expected 文件格式版本。
- `checkpoints`：按顺序执行的断言点，只记录 DOM 快照发生变化的点。
- `advance`：从上一个已记录 checkpoint 继续推进多少次 replay 下一步。每次下一步默认会跳到下一条关键 `GAME_MSG`，不是原始消息流里的每一条 `GAME_MSG`。第一个 checkpoint 通常是 `0`，表示进入 Duel 后的初始暂停状态。
- `cards`：当前 DOM 中需要逐张断言的 `[data-testid="duel-card"]` 完整语义快照，默认精确匹配；不包含 `DECK`、`EXTRA`、`TZONE` 区域。
- `deckCounts`：当前 DOM 中 `DECK` 区域的剩余卡组数量，只按 `controller` 记录数量，不记录卡组内每张卡的 `code`、位置、状态或顺序。
- `extraCounts`：当前 DOM 中 `EXTRA` 区域的剩余额外卡组数量，只按 `controller` 记录数量，不记录额外卡组内每张卡的 `code`、位置、状态或顺序。
- `lifePoints`：当前 DOM 中双方玩家的生命值，来自 `[data-testid="duel-player-life"]`；`player = "op"` 表示上方对手生命条，`player = "me"` 表示下方己方生命条。
- `chainMarkers`：当前 DOM 中所有 `[data-testid="duel-chain-marker"]` 的可见连锁数字标记，默认精确匹配。

`cards` 不应包含 `uuid`。`data-card-uuid` 是运行时实例标识，不适合作为稳定 expected。

`cards` 也不包含 `zone = "DECK"` 或 `zone = "EXTRA"` 的卡。卡组和额外卡组通常不可见且单张卡状态断言价值低，expected 只用 `deckCounts` 和 `extraCounts` 验证剩余数量。

`TZONE` 不进入 expected。它属于当前渲染里的辅助占位区域，不作为 replay 黑盒断言对象。

`chainMarkers` 表示已经形成的连锁栈在场上的可见标记。回放不会等待玩家选择连锁，因此 `select_chain` 弹窗状态不进入 expected。当前 UI 每个位置只显示最大的连锁编号；如果同一位置存在多个连锁编号，expected 中也只记录实际可见的那个标记。

更新 expected：

```bash
UPDATE_EXPECTED=1 npm run test:e2e -- --project=chrome
```

这个命令会批量跑所有受管 replay fixture，并把每个 case 目录下的 `expected.json` 更新为当前实现生成出的 DOM snapshot。普通测试运行会重新采集 replay DOM 快照，并在每个实际 checkpoint 产生时立即和已有 `expected.json` 的对应 checkpoint 做精确比较：

```bash
npm run test:e2e -- --project=chrome
```

只跑受管 replay fixture：

```bash
npm run test:e2e -- --project=chrome --grep "managed replay fixtures"
```

真实录像耗时较长时，可以调大上限：

```bash
REPLAY_FIXTURE_TIMEOUT=600000 \
REPLAY_FIXTURE_MAX_STEPS=50000 \
npm run test:e2e -- --project=chrome --grep "managed replay fixtures"
```

验证外部真实 replay 时，可以显式传入 replay 文件和 expected 文件：

```bash
REAL_REPLAY_PATH=/path/to/replay.yrp3d \
REAL_REPLAY_EXPECTED_PATH=/path/to/expected.json \
npm run test:e2e -- --project=chrome --grep "external yrp3d"
```

自动生成的 expected 代表“当前实现的可观察行为”。第一次生成后仍然需要 review `expected.json` diff，确认它没有把已有 bug 记录成基准。

## 交互测试场景基准

Replay 黑盒测试主要覆盖 `STOC_GAME_MSG -> Neos 处理 -> DOM 状态`。它不会覆盖需要玩家输入的交互链路，因为 `.yrp3d` 回放不会真正等待玩家选择，也不会把玩家点击转换成发回服务器的响应。

后续 live 交互黑盒测试应连接真实 ygopro server，通过 Playwright 像真实用户一样点击 UI，并从用户可见结果断言流程是否顺利继续。测试不需要断言 CTOS payload 的 byte 级内容；真实 server 接受响应并继续推进对局，本身就是黑盒结果的一部分。

以下 `select_xxx` / `announce_xxx` 消息可以作为交互测试的基准场景：

| MSG               | 游戏场景                                                                                                                                   |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `select_card`     | 选择一张或多张已有卡。典型场景包括选择效果对象、选择要解放的怪兽、选择召唤素材、选择要加入手牌的卡、选择要丢弃的手牌、选择墓地中的卡等。   |
| `select_chain`    | 选择是否发动可连锁效果，以及发动哪一个。典型场景包括对方发动魔法后是否连锁陷阱、怪兽召唤成功后是否发动诱发效果、多个可发动效果中选择一个。 |
| `select_place`    | 选择一个空区域位置。典型场景包括特殊召唤到哪个怪兽区、盖放到哪个魔陷区、放置灵摆刻度、放置 token、选择要占用的格子。                       |
| `select_option`   | 从若干文字选项中选择一个。典型场景包括效果有多个模式时选择其中一项，例如破坏一张卡、抽一张卡，或选择适用哪个效果。                         |
| `select_position` | 选择表示形式。典型场景包括特殊召唤时选择攻击表示或防守表示，或某些效果要求玩家选择怪兽变成哪种表示形式。                                   |
| `select_yesno`    | 是/否选择。典型场景包括是否发动可选效果、是否支付 cost、是否继续攻击、是否使用墓地效果。                                                   |
| `announce_card`   | 宣言一个卡名。典型场景包括《禁止令》《心灵崩坏》这类要求玩家从卡片数据库中声明 card code 的效果。                                          |
| `announce_number` | 宣言或选择一个数字。典型场景包括选择等级、宣言数字、选择效果要求的数量，或与掷骰、数量相关的效果。                                         |

这类 live 测试的断言重点是：

- 对应选择 UI 是否出现。
- Playwright 是否能点击目标卡牌、格子、按钮或选项。
- 点击后选择 UI 是否关闭。
- 对局是否继续推进，没有卡在等待选择。
- 后续 DOM 是否到达预期状态，例如卡牌移动、召唤成功、连锁结算、LP 或胜负结果变化。

为了让真实 server 测试稳定，优先使用自定义房间、固定测试卡组、固定卡组顺序、不洗切手牌、禁用 deck check 或使用测试专用规则，并尽量让每个 case 只覆盖一个主要交互场景。

自定义房间可以使用房间代码稳定测试条件：

- `AI`：创建房间时自动加入 AI。
- `SS`：创建后自动推进到猜拳相关流程。
- `NS` / `NOSHUFFLE`：不洗切手牌，让起手和抽牌顺序可预测。
- `NC` / `NOCHECK`：不检查卡组，便于使用测试专用卡组。
- `TIME0`：不限时，避免调试或 CI 运行较慢时因为倒计时影响结果。

Koishi server 不一定支持在聊天框通过 `/ai <name>` 召唤任意 AI。当前 live smoke 使用房间密码直接触发 AI：

```text
AI,SS,NS,NC#有栖川蓝子
```

这样 server 会自动加入名字包含“蓝子”的 AI，并进入猜拳阶段。当前公共 helper 默认选择 `rock`，如果获得先后攻选择权则选择先攻；需要让 AI 先攻的 case 可以显式传入 `tp: "second"`。结合 `NS` 固定卡组顺序后，live 交互测试的初始手牌、抽牌和对手行为都更容易稳定复现。

### Live 测试代码组织

Live 交互测试和 replay 测试分开组织：

```text
tests/e2e/
  replay.spec.ts
  live/
    room-smoke.spec.ts
    announce-card.spec.ts
    announce-number.spec.ts
    select-battle-cmd.spec.ts
    select-chain.spec.ts
    select-idle-cmd.spec.ts
    select-card-fusion.spec.ts
    select-card-link.spec.ts
    select-card-reborn.spec.ts
    select-card-synchro.spec.ts
    select-card-tribute.spec.ts
    select-card-xyz.spec.ts
    select-option.spec.ts
    select-position.spec.ts
    select-place.spec.ts
    select-yesno.spec.ts
  helpers/
    replay.ts
    live.ts
  fixtures/
    replays/
    live/
      decks/
```

约定：

- `tests/e2e/replay.spec.ts` 只覆盖离线 `.yrp3d` replay。
- `tests/e2e/live/*.spec.ts` 连接真实 ygopro server，覆盖真实用户交互。
- `tests/e2e/helpers/live.ts` 只沉淀公共页面动作，例如建房、等待自动 AI、猜拳、选择先后攻、等待进入 Duel、投降并关闭页面。
- 各 live case 的具体流程和断言直接写在 spec 文件里，不设计 `case.json`。这些交互场景差异很大，用 JSON DSL 会降低可读性并增加维护成本。
- 后续 live 测试设计如果发生变化，应同步更新本文档，让测试约定和实现保持一致。

Live 测试默认不随普通 e2e 运行，避免真实 server、网络和 bot 状态影响离线回归。运行方式：

```bash
npm run test:e2e:live
```

展示浏览器 UI：

```bash
npm run test:e2e:live:headed
```

运行单个 live case：

```bash
npm run test:e2e:live:headed -- tests/e2e/live/announce-number.spec.ts --project=chrome
```

live 脚本在没有传入路径时默认运行 `tests/e2e/live`；传入 spec 路径时只运行该 spec，避免“目录 + 单文件”同时命中导致其他 case 先运行。

也可以显式使用环境变量：

```bash
PLAYWRIGHT_LIVE=1 npm run test:e2e -- tests/e2e/live
```

`PLAYWRIGHT_LIVE=1` 时 Playwright 固定使用 1 个 worker。真实 server 测试会使用固定 AI 房间密码，不能并发跑，否则不同 case 可能互相抢占房间或影响先后攻流程。

当前已落地的 smoke 流程：

1. 打开 `/match`。
2. 进入普通自定义房间入口。
3. 使用 `AI,SS,NS,NC#有栖川蓝子` 创建 AI 自定义房间。
4. 进入等待房间。
5. 等名字包含“蓝子”的 AI 出现在对手位置。
6. 进入猜拳阶段后选择 `paper`。
7. 如果获得先后攻选择权，则选择先攻。
8. 断言进入 `/duel` 并渲染出 Duel 卡牌 DOM。
9. 点击投降，断言结算弹窗出现，再关闭页面。

注意测试昵称要保持较短。真实 server 会截断过长昵称，导致等待房间里展示的玩家名和测试输入不完全一致。

Live 测试应优先使用公共 helper 优雅退出真实对局：

```ts
await surrenderAndClosePage(page);
```

该 helper 会点击投降、确认投降、等待 `duel-end-modal` 出现，并关闭当前页面。这样比直接让测试结束或关闭浏览器更干净，可以减少真实 server 上残留房间或异常断线。

当前已落地的 `select_place` 流程：

1. 在浏览器 IndexedDB 中只安装 `tests/e2e/fixtures/live/decks/select-place.ydk`。
2. 该卡组使用重复的 `Mystical Elf`（`15025844`），保证起手有可普通召唤、无额外效果分支的怪兽。
3. 使用 `AI,SS,NS,NC#有栖川蓝子` 进入 AI 对局，并选择先攻。
4. 等待手牌中的 `Mystical Elf` 出现 `data-card-idle-actions~="SUMMON"`。
5. 点击该手牌卡，点击 `duel-action-summon`。
6. 等待目标 MZONE 出现 `data-place-selectable="true"`。
7. 点击指定 MZONE。
8. 断言 `Mystical Elf` 出现在该 `MZONE` 的指定 `sequence`。
9. 调用 `surrenderAndClosePage(page)` 清理真实对局。

当前已落地并验证过的 live 交互场景：

| spec                          | 覆盖点                                   | 关键卡组                              |
| ----------------------------- | ---------------------------------------- | ------------------------------------- |
| `room-smoke.spec.ts`          | 建房、AI 入场、猜拳、进入 Duel、投降清理 | 现有默认卡组                          |
| `select-idle-cmd.spec.ts`     | 主要阶段可操作命令、通常召唤响应         | `select-idle-cmd-basic.ydk`           |
| `select-battle-cmd.spec.ts`   | 战斗阶段攻击命令、battle 响应和 LP 变化  | `select-battle-cmd-direct-attack.ydk` |
| `select-place.spec.ts`        | 普通召唤时选择 MZONE                     | `select-place.ydk`                    |
| `select-card-reborn.spec.ts`  | 从卡组选择怪兽送墓                       | `select-card-reborn.ydk`              |
| `select-card-tribute.spec.ts` | 上级召唤选择解放素材                     | `select-card-tribute.ydk`             |
| `select-card-fusion.spec.ts`  | 融合召唤选择融合素材                     | `select-card-fusion.ydk`              |
| `select-card-link.spec.ts`    | 链接召唤素材选择和落场                   | `select-card-link.ydk`                |
| `select-card-xyz.spec.ts`     | 超量召唤选择素材、放置和 overlay DOM     | `select-card-xyz.ydk`                 |
| `select-card-synchro.spec.ts` | 同调召唤等级合计素材选择和落场           | `select-card-synchro.ydk`             |
| `select-chain.spec.ts`        | 多个可选连锁候选、连续连锁和连锁标记     | `select-chain-free-chain-traps.ydk`   |
| `select-position.spec.ts`     | 特殊召唤选择表示形式和放置区域           | `select-position-cyber-dragon.ydk`    |
| `select-option.spec.ts`       | 多效果选项弹窗                           | `select-option-enemy-controller.ydk`  |
| `select-yesno.spec.ts`        | 可选诱发效果 yes/no 弹窗                 | `select-yesno-sangan.ydk`             |
| `announce-card.spec.ts`       | 卡名宣言搜索和选择                       | `announce-card.ydk`                   |
| `announce-number.spec.ts`     | 数字宣言弹窗，选择两个数字               | `announce-number-sixth-sense.ydk`     |

链接、超量、同调这三类额外卡组召唤 case 使用固定小卡组，并都会继续完成召唤，从实际落场 DOM 读取 sequence 做后续断言。链接素材选择是场上卡牌 `data-card-selectable="true"` 的直接选择；超量额外断言 overlay material DOM 数量；同调会按 server 提示分两段选择调整怪兽和非调整怪兽，避免误命中额外卡组候选弹窗。

为了支持这类断言，Duel DOM 暴露以下 live 交互测试属性：

- `data-card-idle-actions`：当前卡牌可执行的 action，例如 `SUMMON`、`ATTACK`。
- `data-card-idle-responses` / `data-card-idle-response-sources`：当前 action 对应的 response 与来源，来源可为 `idle` 或 `battle`。
- `data-card-attack-directable`：`select_battle_cmd` 中攻击命令是否可直接攻击。
- `data-testid="duel-action-<action>"`：卡牌动作菜单项，例如 `duel-action-summon`、`duel-action-attack`，包含 `data-action-response-source`。
- `data-testid="duel-zone"`：场地区块。
- `data-zone`、`data-controller`、`data-sequence`：场地区块语义位置。
- `data-place-selectable`：当前格子是否可作为 `select_place` 响应目标。
- `data-testid="duel-chain-setting"` / `duel-chain-setting-ignore`：连锁开关。常规 case 默认切到 ignore，专门测试连锁时再切回 all。
- `data-testid="duel-phase-select"` / `duel-phase-end`：阶段切换入口和阶段项，用于需要过回合或切阶段的 live case。
- `data-testid="duel-select-cards-modal"`：卡片/连锁选择弹窗，包含 `data-select-min`、`data-select-max`、`data-select-is-chain`、`data-select-cancelable`。
- `data-testid="duel-select-card-option"`：弹窗内的卡片选择项，包含 `data-card-code`、`data-card-controller`、`data-card-zone`、`data-card-zone-value`、`data-card-sequence`、`data-card-response`。
- `data-testid="duel-option-modal"` / `duel-option-item`：选项弹窗和选项项。
- `data-testid="duel-position-modal"` / `duel-position-option`：表示形式弹窗和选项项。
- `data-testid="duel-yesno-yes"` / `duel-yesno-no`：yes/no 弹窗按钮。
- `data-testid="duel-announce-*"`：卡名宣言弹窗、搜索框、搜索按钮、结果项和确认按钮。

### Live 测试卡组组织

交互测试卡组应按“触发场景”设计，而不是按正常构筑设计。配合 `NC` 和 `NS`，测试卡组可以规避卡组张数、禁限表和洗牌随机性：

- 卡组尽量小，只包含触发目标交互所需的关键卡。
- 卡序固定，让起手和抽牌可预测。
- 效果尽量简单，避免复杂裁定或额外分支。
- 每个卡组服务一个主要交互场景。
- spec 文件顶部说明该卡组的意图、关键起手和预期触发窗口。

建议目录：

```text
tests/e2e/fixtures/live/decks/
  announce-card.ydk
  announce-number-sixth-sense.ydk
  select-battle-cmd-direct-attack.ydk
  select-chain-free-chain-traps.ydk
  select-idle-cmd-basic.ydk
  select-card-fusion.ydk
  select-card-link.ydk
  select-card-reborn.ydk
  select-card-synchro.ydk
  select-card-tribute.ydk
  select-card-xyz.ydk
  select-option-enemy-controller.ydk
  select-position-cyber-dragon.ydk
  select-place.ydk
  select-yesno-sangan.ydk
```

公共 helper `installOnlyLiveDeck(page, deck)` 会先打开一个空白同源 seed 页面写入 IndexedDB，再进入真实应用页面。这样可以避开首页初始化预设卡组和测试写入卡组之间的竞态，确保 `/match` 和 `/waitroom` 读到的是测试卡组。

## 黑盒边界

这类测试应该避免：

- 直接 import 或调用 `src` 中的业务函数。
- 直接读写 `matStore`、`cardStore`、`roomStore`。
- 用测试代码替换前端 WebSocket、adapter、service 或 store。
- 通过私有运行时状态判断测试结果。

这类测试可以使用：

- 页面文本，例如按钮、弹窗、结果文字。
- 用户交互，例如点击、上传、输入。
- DOM 结构和属性，例如卡牌节点是否出现。
- 浏览器 URL，例如是否进入 `/duel`。
- 截图和 trace，用于定位 UI 失败原因。

当前测试使用 `[data-testid="duel-card"]` 和 `data-card-zone` 等 DOM 属性断言卡牌渲染结果。这些属性被当作页面可观察输出，不代表测试直接读取内部 store。

连锁标记使用 `[data-testid="duel-chain-marker"]` 和 `data-chain-*` 属性断言。关键属性包括：

- `data-chain-index`
- `data-chain-controller`
- `data-chain-zone`
- `data-chain-zone-value`
- `data-chain-sequence`

Replay 控制同样通过真实 DOM 按钮完成，测试不直接调用 `replayStore.pause()` 或 `replayStore.advance()`。

## 运行方法

普通无头模式：

```bash
npm run test:e2e
```

展示 Chrome UI：

```bash
npm run test:e2e:headed
```

只跑 Chrome 项目：

```bash
npm run test:e2e -- --project=chrome
```

打开 Playwright 交互式 UI：

```bash
npm run test:e2e -- --ui
```

放慢 headed 测试，便于观察：

```bash
npm run test:e2e -- --project=chrome --headed --slow-mo=300
```

## Dev Server 配置

默认情况下，Playwright 会自动启动：

```bash
npm run dev -- --host 127.0.0.1 --port 5173
```

如果希望连接已经手动启动的 dev server，可以设置：

```bash
PLAYWRIGHT_SKIP_WEB_SERVER=true \
PLAYWRIGHT_BASE_URL=http://127.0.0.1:5173 \
npm run test:e2e:headed
```

默认脚本会显式设置 `PLAYWRIGHT_SKIP_WEB_SERVER=false`，避免本机 shell 环境变量导致 Vite 没有被启动。

## 浏览器要求

当前 Playwright project 使用本机 Chrome：

```ts
channel: "chrome";
```

这样可以避免额外下载 Playwright 自带浏览器。运行机器需要已经安装 Google Chrome。

如果后续 CI 环境没有 Chrome，可以改为安装 Playwright 浏览器：

```bash
npx playwright install chromium
```

并把 `playwright.config.ts` 中的 `channel: "chrome"` 移除或改成 Chromium 项目。

## 常见问题

### `ERR_CONNECTION_REFUSED`

说明测试访问了 `baseURL`，但 dev server 没有启动。

检查：

- 是否设置了 `PLAYWRIGHT_SKIP_WEB_SERVER=true`。
- `PLAYWRIGHT_BASE_URL` 是否指向正确端口。
- 是否有已有服务占用或阻止 `5173`。

普通运行建议直接用：

```bash
npm run test:e2e:headed
```

### 页面卡在 1%

通常是卡片数据库、禁限表、strings 等远端资源加载失败。常见原因是本机代理、网络或 CDN 访问问题。

这些资源属于真实页面初始化流程。黑盒测试默认不 mock 这些资源，因此网络环境需要能访问配置中的资源地址。

### Replay 流程不稳定

当前黑盒测试走前端本地 replay 流，不依赖 `replay.neos.moe`。如果仍然出现不稳定，优先检查 replay 控制是否已经进入 paused/waiting 状态，再检查 DOM 断言是否依赖动画尚未完成的瞬间状态。

## 后续扩展

可以逐步增加以下用例：

- 上传真实历史 `.yrp3d` 文件，验证复杂回放可进入 Duel。
- 检查不同阶段的页面文字、弹窗和按钮状态。
- 对关键页面做截图回归。
- 使用 Playwright trace 分析失败现场。
- 增加多个浏览器项目，例如 Chromium、Firefox、WebKit。
- 在 CI 中运行无头模式测试，并上传失败截图和 trace。

扩展测试时优先保持黑盒边界：从页面入口驱动，从用户可见结果断言。
