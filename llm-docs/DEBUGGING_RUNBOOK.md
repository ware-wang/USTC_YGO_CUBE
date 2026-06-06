# Debugging Runbook

这是当前推荐的调试/排障手册。比 README 更偏向“拿来就用”。

## 1. Node 版本

优先使用 Node 20：

```bash
export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH"
node -v
```

## 2. 安装与构建

### server

```bash
cd server
npm install
```

### neos-client

```bash
cd ../neos-client
npm install
npm run build
```

## 3. 启动

```bash
export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH"
cd server
npm start
```

正常日志应看到：

- `CardDB Loaded`
- `DuelBridge Ready`
- `Cube Loaded`
- `Cube Draft running on http://localhost:3131`
- `YGOPro WS proxy on ws://localhost:7911`

## 4. 快速健康检查

```bash
curl http://localhost:3131/api/cubes
curl http://localhost:3131/api/stats
curl -I http://localhost:3131/
curl -I http://localhost:3131/neos/
```

## 5. duel 协议检查

```bash
cd server
node test-ygopro-ws.js
```

期望看到：

- 两个连接建立
- `STOC_JOIN_GAME`
- `STOC_DUEL_START`
- `STOC_GAME_MSG` 中首条应包含 `func=4`（`MSG_START`）
- 若干 `STOC_GAME_MSG`

## 5.1 房间生命周期检查

```bash
cd server
BASE_URL=http://localhost:3131 node test-room-lifecycle.mjs
```

期望看到：

- 创建后的空房间仍可查询
- 玩家断线后先标记为 `connected: false`
- idle 房间的断线玩家会在宽限后清掉
- 显式 `leave_room` 会立即移除玩家

## 6. 当前推荐对战入口

### 自动

```text
/neos/duelroom?passwd=...&player=...
```

### 手动

```text
/neos/match
```

### DuelRoom 默认连接

```text
<hostname>:7911
```

不是 `/ws-duel`。

## 7. 常见问题

### 7.1 3131 / 7911 端口被占用

```bash
lsof -iTCP:3131 -sTCP:LISTEN -n -P
lsof -iTCP:7911 -sTCP:LISTEN -n -P
```

### 7.2 `/neos/duelroom` 连接失败

先看：

- 7911 是否成功监听
- server 日志里是否出现 `[WS-Duel] New ygopro binary connection`

### 7.3 提交 YDK 后没有打开对战

检查：

- 双方是否都已入座
- 双方是否都已提交 YDK
- 主卡组是否满足 40-60 张要求（testMode 也会校验）
- 额外卡组是否不超过 15 张
- testMode 下提交的卡是否都来自自己的轮抽卡池

### 7.3.1 打开 `/neos/duelroom` 后一直转圈 / 无法准备

先看：

- server 是否是**最新重启后的进程**
- `node test-ygopro-ws.js` 输出里，`STOC_DUEL_START` 后面是否紧跟 `STOC_GAME_MSG func=4`

如果没有这条 `func=4`：

- 说明当前进程还是旧版本，或桥接代码没有生效
- 直接重启 `server`

### 7.3.2 能进入 `/neos/duel`，但棋盘像是“活的空界面”

典型症状：

- 能看到对战板块
- 但无法正常进入抽卡/操作流程
- 点聊天或投降也像没反应

优先判断：

- 这局对战是否在**开局后立即结束**
- server 日志里是否很快出现：
  - `[ygopro-ws] Duel ended, winner: player ...`

如果是：

- 先不要把问题归因到 `/duel` 页面按钮
- 更可能是预加载进对局的牌组本身不合法、过小，或含有不可装载卡

检查：

- `DuelSession` 日志里的：
  - `Player 0 raw deck: main=...`
  - `Player 1 raw deck: main=...`
- 如果主卡组不是一个合理数量，先回到 battle lobby 检查提交内容

testMode 下建议：

- 优先点 `测试模式：从轮抽池随机组卡并提交`
- 该按钮会先调用 `/api/cards/script-status` 检查卡片可装载性
- 然后只从玩家本次轮抽得到且可被 DuelSession 装载的卡里随机抽 40 张主卡组卡，并抽最多 15 张额外卡
- 如果轮抽池里可放入主卡组的卡少于 40 张，或可装载主卡少于 40 张，页面会直接报“数量不够”

额外检查：

- 看 server 日志中的：
  - `Player X raw deck: main=...`
  - `Player X loaded deck after validation: main=..., extra=..., testMode=...`

如果 `raw deck` 是 40，但开局前报 `unloadable ... cards`：

- 说明卡不满足装载条件
- 当前版本不会再用固定调试卡组自动补足
- 普通无效果通常怪兽允许没有 Lua 脚本；效果怪兽、魔法、陷阱、额外卡组怪兽缺脚本仍会被拒绝
- 优先检查本地 `cards.cdb` 与 `ygopro/script/` 是否匹配，或换一个包含足够可装载卡的 cube

### 7.3.3 testMode 快速卡组规则

当前规则：

- 浏览器端不再使用固定测试卡组。
- 快速提交会从玩家轮抽池随机抽 40 张可进主卡组且可装载的卡。
- 无效果通常怪兽不需要 Lua 脚本，只要编号存在于 `cards.cdb` 即可参与随机组卡。
- 额外卡组从玩家轮抽池里可装载的融合/同调/超量/连接卡随机抽取，最多 15 张。
- 副卡组留空。
- 服务端会重新校验张数、主/额外类型，以及 testMode 卡组是否是玩家轮抽池的子集。
- 服务端在注册 neos 预装房间前还会检查卡片可装载性，避免进入 neos 后才显示误导性的“版本不匹配”。
- DuelSession 开局前会对每个玩家的主卡组使用不同 seed 洗牌，避免双方提交相同列表时抽牌顺序也相同。

### 7.3.4 对战内卡片可见性与选择状态

规则口径：

- 自己的额外卡组可以随时确认；对手的额外卡组在盖放状态下仍应隐藏。
- 对手盖放怪兽/盖卡只在规则允许公开时显示真实信息，例如反转、伤害判定或效果确认。
- 新的素材/对象选择消息到达时，前端必须清掉上一轮选择状态，避免旧 response 残留导致看起来能选择非法素材。

排查重点：

- 自己额外卡组不显示时，看 `ygopro-ws.js` 是否在 `MSG_START` 后给本人发送了 `MSG_UPDATE_DATA` 的 EXTRA 区私有更新。
- 效果发动选项显示 `?` 时，看前端是否使用 `getEffectDescription()` / `getStrings()` 解析 `effect_description`，而不是直接按系统字符串编号读取。
- 盖放怪兽疑似能作为 Link 素材时，先看 DOM 上旧的 `data-card-selectable` 是否没有被清掉；如果清理后仍可选，再继续查 ocgcore 返回的候选列表或对应 Lua 过程。

### 7.3.5 已进入 `主要阶段 1`，但仍然像“不能操作”

这说明：

- 后端起局链大概率已经通了
- 重点转向 duel 内可操作消息兼容

先检查浏览器黑盒 / DOM：

- 是否已经存在 `HAND` 区 5 张手牌
- 手牌的 `data-card-code` 是否非 0
- 手牌或场上卡的 `data-card-idle-actions` 是否为空

如果：

- 手牌存在
- `code` 正常
- 但 `idle-actions` 基本为空

那么优先继续查：

- `MSG_SELECT_IDLE_CMD`
- `MSG_HINT`
- 以及 `ygopro-msg-encode` 重编码后的 payload 是否与 neos-ts 期望完全一致

### 7.3.6 效果处理后连锁标志残留 / 无法回到自由时点

典型复现场景：

- 通常召唤 `78010363` 黑森林的魔女
- 发动 `53129443` 黑洞
- 黑森林送入墓地后发动检索
- 选择卡加入手牌后，墓地里的黑森林仍显示连锁标志，且无法继续操作

排查顺序：

1. 先看后端是否继续吐出完整连锁消息：
   - `YGOProMsgChaining`
   - `YGOProMsgChainSolved`
   - `YGOProMsgChainEnd`
   - 后续新的 `YGOProMsgSelectIdleCmd`
2. 如果停在 `CONFIRM_CARDS` 附近，优先检查 `DuelSession.advance()` 是否在普通 game message 后因为非 0 `status` 提前 done。
3. 如果后端消息完整，但前端仍有标志残留，再查：
   - `neos-client/src/service/duel/chaining.ts`
   - `neos-client/src/service/duel/chainSolved.ts`
   - `neos-client/src/service/duel/chainEnd.ts`
   - `placeStore.inner[*].*.chainIndex`

当前修复后的预期：

- `CHAIN_END` 后 DOM 中 `[data-testid="duel-chain-marker"]` 应为 0
- 阶段控件 `duel-phase-select` 应恢复可用
- `chainEnd.ts` 会兜底清空所有位置的 `chainIndex`

### 7.3.7 选择目标时能看到对手盖卡

这类问题优先按“后端视角裁剪 + 前端展示保护”两层查。

后端先看：

- `server/src/duel-bridge/duel-session.js` 的普通 `gameMsg` 是否仍然带 `playerPayloads`
- `server/src/duel-bridge/ygopro-ws.js` 是否按 `playerPayloads` 分别发给 `room.players[0/1]`
- 协议联调里，对手不可见的抽牌/盖卡消息是否被裁成 `code=0`

前端再看：

- 棋盘卡 DOM 的 `data-card-code`：对手盖卡应为 `0`
- 选择目标弹窗的 `data-card-code`：对手盖卡应为 `0`
- 点击对手盖卡不应打开 `CardModal`
- 卡图应显示卡背，不应请求真实卡图 URL
- 合法公开窗口里，`card.revealed` 应短暂为 `true`，例如 `CONFIRM_CARDS` 或盖伏卡发动连锁

相关文件：

- `neos-client/src/stores/cardStore.ts`
- `neos-client/src/service/utils/cardVisibility.ts`
- `neos-client/src/service/utils/fetchCheckCardMeta.ts`
- `neos-client/src/ui/Duel/Message/CardModal/index.tsx`
- `neos-client/src/ui/Duel/Message/CardListModal/index.tsx`
- `neos-client/src/ui/Duel/Message/SelectCardsModal/index.tsx`
- `neos-client/src/ui/Duel/PlayMat/Card/index.tsx`

### 7.3.8 选择目标弹窗按钮显示 `?`

优先检查 `SelectCardsModal`：

- `Region.System` 缺 `1211/1296/1295` 时，应回退到语言包：
  - `Menu.Confirm`
  - `Menu.Cancel`
  - `Menu.SelectionComplete`
- 如果仍然显示 `?`，先看 `neos-client/src/ui/I18N/Source/*/translation.json` 中对应 key 是否存在。

### 7.3.9 对战中的系统提示全是 `?`

这通常不是 Node / nvm 版本问题，而是 neos 前端语言包问题。

先检查：

```bash
sed -n '1,40p' neos-client/public/ygopro-database/zh-CN/strings.conf
sed -n '1,40p' neos-client/dist/ygopro-database/zh-CN/strings.conf
```

如果只看到 `# Empty strings`，说明 `Region.System` 的提示编号没有中文文本来源，前端会把阶段、等待、效果选择、胜利原因等系统提示渲染成 `?`。

当前修复后的预期：

- `neos-client/src/api/strings.ts` 会优先使用 `strings.conf`。
- 如果 `strings.conf` 缺项或本地缓存里是旧的 `?`，会回退到内置常用中文系统提示。
- 未覆盖的编号会显示为 `系统提示 <id>`，不再显示裸 `?`。
- 解析 `strings.conf` 时保留第三列之后的完整文本，避免带空格的提示被截断。

验证：

```bash
cd neos-client
npx eslint src/api/strings.ts
npm run build
grep -R "等待对方操作\\|抽卡阶段\\|请选择要发动的效果" -n dist/assets
```

### 7.3.10 多人多桌时其他桌误进第一桌

典型症状：

- 4 人或更多玩家轮抽结束后创建多张对战桌。
- 第一桌两人提交卡组并启动 neos 后，其他桌玩家也看到“对战已就绪”或自动打开同一个 neos 房间。
- 其他桌玩家连接 7911 时被拒绝，表现为无法进入或房间已满。

优先检查：

- `server/src/ws/index.js` 中启动 neos 的 `duel_launch_neos` 是否只发给该 table 的两个 seat 玩家。
- `client/src/room.js` 的 `handleLaunchNeos()` 是否会过滤 `payload.playerIds` / `payload.tableId`，不是本桌玩家时必须忽略。
- `DuelManager.joinTable()` 清理旧座位时是否只清同一个 room 下的桌，不能跨 room 清座。

当前修复后的预期：

- `duel_table_update` 仍广播给整个轮抽房间，用于所有人同步桌位状态。
- `duel_launch_neos` 和启动失败提示只发送给该桌两名玩家。
- neos 启动后该桌状态变为 `dueling`，其他桌仍可继续入座和提交卡组。
- `ygopro-ws` 会复用断线留下的空 seat，避免重新打开同一个 duelUrl 时因数组空洞误判满员。

验证：

```bash
node server/test-battle-tables.mjs
node --check server/src/ws/index.js
node --check server/src/duel-manager/index.js
node --check server/src/duel-bridge/ygopro-ws.js
node --check --input-type=module < client/src/room.js
```

### 7.4 某些卡开局前报无法装载

通常先分两类看：

- 无效果通常怪兽：可以没有 Lua 脚本，只要 `cards.cdb` 里存在该编号。
- 其他卡：效果怪兽、魔法、陷阱、额外卡组怪兽通常需要 `c{id}.lua`。

先看：

```bash
find ../ygopro/script -maxdepth 1 -type f | head
```

再用接口确认：

```bash
curl -sS -H 'Content-Type: application/json' \
  -d '{"ids":[14575467,71413901]}' \
  http://localhost:3131/api/cards/script-status
```

## 8. 回归清单

每次改动后尽量至少检查：

- [ ] Node 20 下 server 能启动
- [ ] `/api/cubes` 正常
- [ ] `/neos/` 正常
- [ ] `node test-ygopro-ws.js` 通过
- [ ] `STOC_DUEL_START` 后能看到 `STOC_GAME_MSG func=4`
- [ ] duel 内 `CTOS_CHAT` 能回显为 `STOC_CHAT`
- [ ] 对手盖卡在棋盘、选择弹窗、列表抽屉中 `data-card-code=0`
- [ ] 点击对手盖卡不会打开卡片详情抽屉
- [ ] 自己额外卡组点击可打开并显示真实卡名/卡图，对手额外仍隐藏
- [ ] 多效果发动选项和 `SELECT_EFFECTYN` 不显示 `?`
- [ ] 新的选择消息到达后旧 `data-card-selectable` 会被清掉
- [ ] 选择目标弹窗按钮不显示 `?`
- [ ] `POST /api/launch-duel` 返回 `/neos/duelroom`
- [ ] DuelRoom 默认地址仍是 `<hostname>:7911`
