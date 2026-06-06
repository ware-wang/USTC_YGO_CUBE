# Worklog

按时间追加。重点记录：做了什么、为什么、怎么验证、还剩什么。

---

## 2026-05-27

### 目标

先快速理解 `cube-draft`，然后开始真实修问题，并补操作文档，方便后续继续接手。

### 已完成

#### 1. 项目结构与主链路梳理

确认项目由三部分组成：

- `client/`：Cube Draft 轮抽 / 组卡前端
- `server/`：主服务 + JSON WS + duel bridge
- `neos-client/`：浏览器对战前端

确认真实链路是：

- 轮抽系统不直接打牌
- 双方提交 YDK 后，server 通过 `registerPreloadedDecks` 把牌组注册到 ygopro room
- neos 再通过 7911 代理 / `/ws-duel` 进入真正对战

#### 2. 启动与基本联调验证

已验证：

- Node 20 下 server 可启动
- `/api/cubes`、`/api/stats` 正常
- `/neos/` 静态页可访问
- `server/test-ygopro-ws.js` 可跑通

#### 3. 已修问题

##### 3.1 修复 DuelRoom 默认连接目标错误

问题：

- `/neos/duelroom` 默认把 server 写成了 `<host>/ws-duel`
- 但 neos-ts 底层连接器需要的是 `host:port`

修复：

- 改为默认连接 `<hostname>:7911`

影响：

- 自动入房链路更符合当前实际部署方式

##### 3.2 修复对战入口文档与实际行为不一致

问题：

- 文档还在描述“打开 `/neos/` 后手选 `Cube Draft (local)`”
- 但当前更合理的入口已经是 `/neos/duelroom?...`

修复：

- 更新 README
- 更新 server 的 launch-duel 返回信息
- 更新 battle lobby 的说明语义

##### 3.3 修复 battle table 事件名不一致

问题：

- server 发 `battle_tables_created`
- client 只监听 `battle_tables_ready`

修复：

- client 同时监听两者
- server 在 battle create 时同时发两种消息名做兼容

##### 3.4 给遗留手动 duel 消息加保护

问题：

- `duel_start` / `duel_respond` 仍可能走到 `DuelManager` 上不存在的方法
- 这会触发运行时错误

修复：

- 在 `server/src/ws/index.js` 中加保护
- 如果触发这些旧消息，返回明确错误文案，而不是直接崩

#### 4. 文档补充

新增：

- `OPERATIONS.md`
- `llm-docs/` 整体目录

### 验证方式

已做过：

```bash
export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH"
cd server
npm start
```

以及：

```bash
cd server
node test-ygopro-ws.js
```

还验证过：

- `POST /api/launch-duel` 返回 `neosUrl=/neos/duelroom`
- `manualNeosUrl=/neos/match`
- 返回的 `players[].duelUrl` 已包含 `passwd` 和 `player`

### 本次提交

- commit: `6a8c8eb`
- message: `Fix neos auto-join flow and update ops docs`

### 当前仍未完全解决 / 继续注意

1. 需要做**真正浏览器层面的端到端回归**，不是只靠协议测试。
2. 某些卡缺 Lua 脚本时会被跳过，这会影响特定卡的实际效果。
3. 代码里仍有少量旧对战路径残留，后续最好彻底下线或重构。

### 后续补充修复

#### 5. 修复房间 WebSocket 生命周期导致的幽灵座位

问题：

- `client/src/ws/client.js` 会在模块加载时自动连接
- `client/src/room.js` 初始化时又会额外调用一次 `connect()`
- 断开连接后，server 只删 `clients` 映射，不会把房间里的玩家状态同步清理

现象：

- 房间页面可能挂出重复 WS 连接
- 玩家关闭房间页后，座位仍然残留
- 房主可能看到“人还在”，但实际上对方已经掉线

修复：

- `client/src/ws/client.js` 改成单连接模式，重复调用 `connect()` 时直接复用
- 去掉 lobby 页对 `wsClient` 的无效导入
- `server/src/ws/index.js` 在连接关闭和显式 `leave_room` 时同步更新房间
- `server/src/room/index.js` 为 idle 房间增加断线宽限和清理逻辑，并在 `getRoom*()` 时触发清理

验证：

- 新增 `server/test-room-lifecycle.mjs`
- 隔离端口回归确认：
  - 新建房间在首次 WS 加入前不会被误删
  - 玩家断线后短时间内会显示 `connected: false`
  - idle 房间断线玩家会在宽限后被清掉
  - `leave_room` 会立即移除玩家并广播 `room_update`

#### 6. 修复 neos WaitRoom 一直转圈、无法准备/开局

问题：

- `ygopro-ws` 在 `STOC_DUEL_START` 之后没有立刻补发 `MSG_START`
- neos-ts 的 `/neos/duelroom` / `/waitroom` 依赖这条 `STOC_GAME_MSG(func=4)` 初始化对局
- 缺失时前端会停在“等待游戏开始”的加载态，看起来像按钮一直转圈、无法继续

根因：

- 协议层测试原本只验证到了 `STOC_DUEL_START`
- 真正的 neos waitroom 还需要收到 `MSG_START` 才会继续跳转 `/duel`

修复：

- `server/src/duel-bridge/duel-session.js` 记录实际装载进对局的主卡组/额外卡组数量
- `server/src/duel-bridge/ygopro-ws.js` 在每个玩家收到 `STOC_DUEL_START` 后，立即补发一条按玩家视角构造的 `MSG_START`

验证：

- 在 `ws://localhost:3131/ws-duel` 上重新跑协议联调
- 已确认现在消息顺序包含：
  - `STOC_DUEL_START`
  - `STOC_GAME_MSG func=4` (`MSG_START`)
  - 后续 `MSG_DRAW` / `MSG_HINT` / `MSG_SELECT_IDLE_CMD`

#### 7. 本次调试中的一个现实问题

这次用户反馈时，`3131` 上运行的仍是**旧进程**，没有吃到后续代码改动。

处理：

- 已手动重启 `server` 主进程
- 当前 2026-05-27 的主服务已经在 `http://localhost:3131` 跑着最新代码

#### 8. 修复 duel 内聊天不可见，并澄清“空棋盘不能操作”的根因

问题：

- `/neos/duel` 里聊天框发送消息后看不到内容
- 用户以为是 duel 页面按钮或交互整体失效

根因拆分：

1. **聊天协议不匹配**
   - neos-ts 发送的 `CTOS_CHAT` 是 UTF-16LE 字符串
   - server 之前直接把原始 `exData` 当成 `STOC_CHAT` 转发
   - neos-ts 的 `stocChat` 解析器期望的是 `2B player + UTF-16LE msg`
   - 因此聊天发送了，但前端看不到

2. **“不能抽卡/不能对战”很多时候不是 duel 按钮坏了**
   - 当预加载进对局的牌组不合法或近乎空牌组时，对局会在开局后立即结束
   - 用户仍然可能看到 `/neos/duel` 的棋盘 UI，但这已经是一局死掉的对局
   - 这时聊天、投降等交互从用户视角也会像“没反应”

修复：

- `server/src/duel-bridge/protocol-adapter.js`
  - 新增 `parseChatMessage()`
  - 修正 `buildStocChat()` 为 neos-ts 实际需要的格式
- `server/src/duel-bridge/ygopro-ws.js`
  - `CTOS_CHAT` 改为解析后再构造标准 `STOC_CHAT`
  - 同时回显给发送者和对手

验证：

- 本地二进制协议测试已确认：
  - `CTOS_CHAT('hello duel')` 会被正确转成 `STOC_CHAT`
  - 下发载荷为 `2B player + utf16le(message)`

附加确认：

- 用 `POST /api/launch-duel` 预加载一副真实 40 张主卡组后，
  `/ws-duel` 连接进入对局不会自动结束
- 说明 duel 内“无法操作”的核心前置条件仍然是：**不要让坏卡组进入对局**

#### 9. testMode 调试体验优化

问题：

- 正式 40-60 / 15 / 15 校验虽然正确，但会让联调效率很差

修复：

- `client/src/room.js`
  - `testMode` 下新增 `测试模式：一键提交合法卡组`
  - 默认可直接用当前池子补足到 40 张主卡组
- `server/src/duel-manager/index.js`
  - `testMode` 下即使提交的是小卡组，也会自动补足成可开局的合法主卡组
  - 额外/副卡组仍会截断到 15 张

结果：

- 调试流程不再必须手工凑 40 张
- 同时又能避免“进了 duel 但其实开局即死”的假阳性

---

## 2026-05-28

### 目标

修复“黑森林的魔女”送入墓地发动检索后，对局卡住、墓地卡片仍显示连锁标志的问题。

### 根因

问题不只是前端标志残留。

`server/src/duel-bridge/duel-session.js` 的 `advance()` 在普通 game message 后遇到非 0 `status` 会直接把 session 标记为 done。黑森林检索这类流程中，后端已经发出了 `YGOProMsgChaining` 和检索选择，但在 `CONFIRM_CARDS` 之后还需要继续 `process()` 才会吐出后续的 `YGOProMsgChainSolved`、`YGOProMsgChainEnd` 和新的 `YGOProMsgSelectIdleCmd`。

旧逻辑提前停止后，浏览器永远等不到连锁结束消息，所以：

- `placeStore.chainIndex` 没有完整清理
- 墓地里的黑森林仍显示连锁标志
- 对局没有回到自由时点

### 修复

- `server/src/duel-bridge/duel-session.js`
  - 普通消息发出后继续推进 ocgcore
  - 只在 `WIN`、`RETRY`、需要玩家响应的消息、或 `status === 2` 时停止
  - 行为对齐 srvpro2 的 worker 推进模型
- `neos-client/src/service/duel/chainEnd.ts`
  - 保留原本按连锁栈逐项 `pop` 的清理
  - 在 `CHAIN_END` 额外兜底清空所有场地区域的 `chainIndex`
  - 覆盖“卡片处理过程中移动位置，原位置 pop 不到”的显示残留

### 验证

已完成协议级最小复现：

- 召唤 `78010363` 黑森林的魔女
- 发动 `53129443` 黑洞
- 黑森林在墓地发动检索
- 选择一张卡加入手牌
- 确认后端继续收到：
  - `YGOProMsgChainSolved`
  - `YGOProMsgChainEnd`
  - 新的 `YGOProMsgSelectIdleCmd`

已完成真实浏览器回归：

- 启动 server：`http://localhost:3131`
- 通过 `POST /api/launch-duel` 预加载两副交替排列的黑森林/黑洞测试牌组
- 打开双方 `/neos/duelroom?passwd=...&player=...`
- 在 Alice 页面执行：
  - 通常召唤黑森林的魔女
  - 发动黑洞
  - 处理黑森林检索
- 验证：
  - `[data-testid="duel-chain-marker"]` 数量回到 0
  - 黑森林位于 `GRAVE`
  - `duel-phase-select` 恢复 enabled

前端构建已通过：

```bash
cd neos-client
npm run build
```

构建只出现 Vite/sql.js/chunk size 常规警告。

### 注意

这次验证覆盖了真实 `/neos/duelroom -> /neos/duel` 内的卡片操作、效果处理和连锁结束显示；但还不是完整“轮抽建房 -> 选牌 -> 组卡 -> 对战”的业务流端到端测试。

#### 10. 修复 testMode 下“看起来是合法牌组，实际进 DuelSession 后被脚本过滤空掉”

问题：

- 用户已经使用了 `测试模式：一键提交合法卡组`
- 但进入 `/neos/duel` 后仍然像完全没连上：
  - 看不到正常抽卡
  - 看不到手牌
  - 像是棋盘有了，但游戏没真正开始

真实后端根因：

- 之前的 testMode 只保证“提交给对战桌的主卡组数量 >= 40”
- 但 `DuelSession` 在真正装载卡组时，会把**没有 Lua 脚本的卡全部过滤掉**
- 因此可能出现：
  - battle lobby 里看起来是 40 张合法主卡组
  - 实际进入 DuelSession 后只剩极少数可装载卡
  - 对局随即进入异常/空棋盘状态

修复：

- `server/src/duel-manager/index.js`
  - testMode 归一化不再优先复用用户当前池子里的任意卡
  - 统一用一组保底调试卡补足到 40 张
- `server/src/duel-bridge/ygopro-ws.js`
  - `registerPreloadedDecks()` 增加 `testMode` 标记
  - 启动 DuelSession 时把 `testMode` 透传到 `hostinfo`
- `server/src/duel-bridge/duel-session.js`
  - 在卡片脚本过滤完成后，如果仍处于 testMode 且主卡组 < 40
    - 再用**确认存在脚本的保底卡**继续补足到 40
  - 新增日志：
    - `loaded deck after script filter: main=..., extra=..., testMode=...`

验证关注点：

- 以后看到 duel 异常时，先看 server 日志中的：
  - `raw deck: main=...`
  - `loaded deck after script filter: main=...`
- 如果后者已经稳定为 40，说明不是“脚本过滤空掉”的问题了

#### 11. 修复 `/neos/duel` 主阶段不可操作、结束阶段直接胜利、看不到卡图

用户复测发现：

- 每张牌都只能后场放置，怪兽也不能普通召唤
- 无法进入战斗阶段
- 选择结束阶段后直接胜利，而不是交给另一位玩家
- 手牌卡图不可见

这次对照了成熟项目：

- `/home/wjl/.openclaw/workspace/analysis/web-duel/srvpro2/src/room/room.ts`
- `/home/wjl/.openclaw/workspace/analysis/web-duel/srvpro2/src/ocgcore-worker/ocgcore-worker.ts`
- `/home/wjl/.openclaw/workspace/analysis/web-duel/srvpro2/src/utility/calculate-duel-options.ts`

真实根因有三层：

1. `sql.js` 没有先执行 `await initSqlJs()`，导致 `DirCardReader(...).apply(cardId)` 读不到卡数据；ocgcore 无法识别怪兽/魔陷类型，主阶段动作自然异常。
2. 之前手写 `splitRawMessages()` 错拆了 `MSG_SELECT_IDLE_CMD`，把真实结构 `func + player + 多段 action list` 当成简单 count/list 解析，导致前端收到的可操作动作偏移。
3. `DuelSession` 把 `0x20` 当作 `DUEL_SINGLE`；但在 `koishipro-core.js` / `ygopro-yrp-encode` 里 `0x20` 实际是 `TagMode`。因此普通 1v1 被错误启动成 tag duel，结束阶段后会出现 `YGOProMsgTagSwap`，然后异常 `MSG_WIN`。

本轮修复：

- `server/src/index.js`
  - `duelBridge.init(await initSqlJs())`，确保 `cards.cdb` reader 真正可用。
- `server/src/duel-bridge/duel-session.js`
  - 不再手写拆 `MSG_SELECT_IDLE_CMD`，按成熟代码方式使用 `msg.playerView(player).toPayload()`。
  - response-required 消息只发给对应操作玩家，另一方发 `MSG_WAITING`。
  - `MSG_RETRY` 时重发上一条选择消息给操作玩家，避免第一回合非法战阶 retry 后 UI 丢掉可操作项。
  - `startDuel()` 改为 `{ rule: hostinfo.duel_rule, flags: tag ? [TagMode] : [] }`，不再错误 OR `0x20`。
  - 增加 `waitingResponsePlayer`，供 WS 层拒绝非当前操作玩家的响应。
- `server/src/duel-bridge/ygopro-ws.js`
  - `select` 事件按 `playerPayloads` 分别发给两个玩家。
  - `CTOS_RESPONSE` 只接受当前等待玩家的连接。
- `server/src/index.js`
  - `/ygopro-database/pics/:id.jpg` 重定向到 YGOPRODeck 图片源，解决本地没有 pics 目录时手牌无图。
- `neos-client/src/ui/BuildDeck/DeckDatabase/DeckResults/index.tsx`
  - 在线卡组列表拉取失败时降级为空列表并 `finishLoaded()`，避免本地调试被外网失败弹层挡住。

验证结果：

- 后端最小实验：
  - 发送第一回合 `6`（战阶）后收到 `MSG_RETRY`，不会丢选择状态。
  - 再发送 `7`（结束）后进入对方响应/回合，不再出现 `YGOProMsgTagSwap` 和 `MSG_WIN`。
- 浏览器黑盒：
  - 行动方手牌出现 `SUMMON MSET`，等待方没有可操作项。
  - 第一回合点战阶保持 `主要阶段 1` 并保留可操作项，这是规则内 retry。
  - 点结束阶段后没有胜负弹窗，回合交给另一位玩家。
  - 第二位玩家回合可以进入 `战斗开始`。
  - 聊天消息 `hello-from-blackbox` 发送者和对手都可见。
  - 卡图请求表现为本地 `302 /ygopro-database/pics/*.jpg`，随后远端 `200 images.ygoprodeck.com/images/cards/*.jpg`。

调试注意：

- 不要只用 `controller=0` 判断“自己的手牌”。neos 前端会根据 `MsgStart.playerType` 判断 `controller 0/1` 哪边是自己，后攻视角里自己的可操作手牌可能是 `controller=1`。

---

## 2026-05-28

### 目标

修复从另一台主机访问 `3131` 后，进入 `/neos/duelroom` 时出现 `websocket connect to <host>:7911 error` 的问题。

### 根因

`neos-client/src/infra/stream.ts` 之前按“是不是本地地址”猜测协议。  
当页面是 `http://202.38.78.36:3131` 这类非本地地址时，会被强制拼成 `wss://202.38.78.36:7911`。  
但当前 7911 实际运行的是明文 WebSocket 代理，所以握手失败。

### 已修复

- 改为按当前页面协议选择目标：
  - `https:` -> `wss://`
  - 其他 -> `ws://`
- 同时允许显式传入 `ws://` / `wss://` 前缀

### 验证

- `neos-client` 重新构建通过
- 产物已包含新的协议选择逻辑
- HTTP 页面下访问远端主机时，不再误连 `wss://<host>:7911`

### 继续修复：进入对战房后弹出“版本不匹配”

现象：

- 从另一台主机访问 `3131` 后，轮抽流程正常
- 进入 `/neos/duelroom` / `/neos/duel` 时，前端弹出：
  - `版本不匹配，请联系技术人员解决`

真实根因：

- 这条文案对应的是 neos 的 `ErrorType.VERSIONERROR`
- 但服务端并没有真的校验 join version；它只是把多类 duel 启动失败都统一映射成了这个错误
- 主进程 `server/src/index.js` 读取的是 `YGO_SCRIPT_PATH`
- duel WebSocket 链路 `server/src/ws/index.js` 之前却单独读取 `YGOPRO_SCRIPT_PATH`，并在未设置时回退到一个错误的默认路径
- 该默认路径实际被算成了仓库外的 `/home/admin/ygopro/script`
- 结果是：
  - 主进程启动日志看起来脚本路径正确
  - 但真正进入 DuelSession 时读取了错误目录
  - 所有卡被判成“没有脚本”，卡组被过滤空
  - `ocgcore` 起局 `Aborted()`
  - 前端最终收到 `VERSIONERROR`

修复：

- `server/src/index.js`
  - 统一解析对战资源路径
  - `YGO_SCRIPT_PATH` 与兼容别名 `YGOPRO_SCRIPT_PATH` 都支持
  - `cards.cdb` 路径也统一收口后再传入 WebSocket 层
- `server/src/ws/index.js`
  - 不再自行拼默认脚本路径
  - 改为直接使用主进程传入的 `scriptPath` / `cardsCdbPath`
- `start.sh`
  - 在保留 `YGO_SCRIPT_PATH` 的同时，自动导出：
    - `YGOPRO_SCRIPT_PATH=$YGO_SCRIPT_PATH`
  - 避免旧链路或旧脚本名再次把 duel 资源拆成两套
- `server/src/duel-bridge/ygopro-ws.js`
  - 补强 duel 启动失败日志
  - 现在会明确打印：
    - 是否缺牌组
    - 启动时实际使用的 `scriptPath`
    - 启动时实际使用的 `cardsCdbPath`

验证：

- 直接使用根目录 `./start.sh` 启动，不再手工追加 `YGOPRO_SCRIPT_PATH=...`
- 运行 `server/test-ygopro-ws.js`
- 现在可稳定看到：
  - `DuelSession ... created successfully`
  - `STOC_DUEL_START`
- 不再出现之前那种“脚本全部缺失 -> Aborted() -> VERSIONERROR”的链路

额外结论：

- 这台服务器当前 `node -v` 仍是 `v18.20.4`
- 它不是这次“版本不匹配”弹窗的直接根因，但仍然偏离 README 要求的 Node 20 基线
- 后续仍建议把实际运行时对齐到 Node 20，减少 WASM / duel runtime 的潜在不稳定性

---

## 2026-05-29

### 修复对手盖卡在选择目标时可被查看

现象：

- 对战中选择目标时，点击对手盖放的卡会打开卡片详情，并显示真实卡名/效果。
- 攻击宣言等选择目标弹窗里的“确定/取消/完成选择”有时显示为 `?`。

真实根因：

1. `DuelSession` 对普通 `gameMsg` 仍然把 `msg.toPayload()` 的原始视角广播给双方，只有需要响应的 `select` 消息走了 `playerView(player)`。这会让移动、抽卡、放置等广播消息在某些情况下把对手视角不该知道的 `code` 送到前端。
2. neos 前端选择卡弹窗和棋盘点击逻辑直接使用本地 `card.meta` / `card.code` 打开详情或渲染卡图，没有在展示层再次按当前玩家可见性做保护。
3. 选择卡弹窗按钮直接读取 `Region.System` 的 `1211/1296/1295`，本地字符串缺失时就原样显示 `?`。

修复：

- `server/src/duel-bridge/duel-session.js`
  - 普通 `gameMsg` 也生成 `playerPayloads`。
  - 每位玩家收到的是 `msg.playerView(player).toPayload()`。
  - 尊重 `msg.getSendTargets()`，例如只应给指定玩家看的 `CONFIRM_CARDS` 不再广播给双方。
- `server/src/duel-bridge/ygopro-ws.js`
  - `gameMsg` 和 `select` 一样，优先按 `playerPayloads` 分别发送。
- `neos-client/src/service/utils/cardVisibility.ts`
  - 新增统一可见性判断：
    - 自己控制的卡可见。
    - 被规则临时公开的卡可见，例如 `CONFIRM_CARDS` 确认窗口、盖伏卡发动连锁时。
    - 对手手牌/卡组不可见。
    - 对手额外、除外、怪兽区、魔陷区、衍生物区中的盖放卡不可见。
- `neos-client/src/stores/cardStore.ts` 与 duel 消息处理
  - 新增 `revealed` 状态，区分“这张卡现在被规则公开”和“只是本地曾经缓存过 meta”。
  - `confirmCards` / `chaining` / `draw` / `updateData` 会按消息语义设置公开状态。
  - `shuffleDeck` / `shuffleSetCard` / 隐藏视角的 `move` 会清除公开状态和缓存 meta。
- `neos-client/src/service/utils/fetchCheckCardMeta.ts`
  - 选择目标时，如果目标对当前玩家不可见，不再从本地 `target.meta` 回填真实卡号/效果描述。
- `CardModal` / `CardListModal` / `SelectCardsModal` / `PlayMat/Card`
  - 详情抽屉、列表抽屉、选择弹窗、棋盘卡图统一走可见性判断。
  - 隐藏卡只显示卡背，`data-card-code` 也落为 `0`。
- `SelectCardsModal`
  - 当系统字符串返回 `?` 时，按钮文案回退到当前语言包的 `Menu.Confirm` / `Menu.Cancel` / `Menu.SelectionComplete`。

验证：

```bash
cd neos-client
npm run build
npx eslint src/service/utils/cardVisibility.ts src/service/utils/fetchCheckCardMeta.ts src/service/utils/index.ts src/ui/Duel/Message/CardModal/index.tsx src/ui/Duel/Message/CardListModal/index.tsx src/ui/Duel/Message/SelectCardsModal/index.tsx src/ui/Duel/PlayMat/Card/index.tsx
```

```bash
node --check server/src/duel-bridge/duel-session.js
node --check server/src/duel-bridge/ygopro-ws.js
```

隔离端口协议联调：

```bash
PORT=3132 YGOPRO_PROXY_PORT=7912 ./start.sh
cd server
sed 's|localhost:3131|localhost:3132|' test-ygopro-ws.js | node --input-type=module
```

结果：

- 临时服务可启动。
- 两个模拟客户端可完成 join / ready / duel start。
- `STOC_DUEL_START` 后仍能收到 `MSG_START`。
- 同一类抽牌/隐藏信息消息里，行动方收到真实卡号，非可见方收到 `00000000...`，说明后端逐玩家视角裁剪已生效。

仍需补充：

- 真实浏览器里专门复现“攻击宣言选择对手盖卡目标”，确认详情抽屉不会打开、按钮文案不再是 `?`。

### testMode 改为从轮抽池生成测试卡组，并修正开局洗牌

用户需求：

- 轮抽完毕后的快速测试不再使用固定测试卡组。
- 自动生成的测试卡组必须来自玩家本次轮抽得到的卡牌堆。
- 主卡组与额外卡组要按卡片类型区分。
- 主卡组 40-60 张，额外卡组最多 15 张。
- 如果轮抽池里主卡组可用卡不足 40 张，要直接报数量不够。
- 复查双方抽到的牌顺序相同的问题。

根因：

1. `client/src/room.js` 的 `buildTestModeYdk()` 会在主卡组不足时填入固定 `TEST_MODE_FALLBACK_MAIN_IDS`。
2. `server/src/duel-manager/index.js` 在 testMode 下也会对提交的 YDK 做固定卡补足，导致“看起来来自轮抽池”，实际进对战的是保底卡组。
3. `server/src/room/index.js` 会让 testMode 跳过卡组张数校验。
4. `DuelSession` 装载卡组时没有对双方主卡组做独立洗牌；当双方提交相同固定列表时，抽牌顺序自然容易一致。

修复：

- `client/src/room.js`
  - 移除固定测试卡组。
  - testMode 快速提交改为从 `pool/main/extra/side` 汇总出的玩家轮抽池随机抽卡。
  - 快速提交前调用 `/api/cards/script-status`，只从有 Lua 脚本的候选卡里抽卡。
  - 主卡组只抽非额外类型且可装载的卡，固定抽 40 张。
  - 额外卡组只抽融合/同调/超量/连接且可装载的卡，最多 15 张。
  - 可进主卡组的卡少于 40 张时在页面直接报错。
- `server/src/index.js`
  - 新增 `/api/cards/script-status`，供浏览器生成 testMode 卡组前检查脚本存在性。
- `server/src/duel-manager/index.js`
  - 移除 testMode 固定卡补足。
  - 所有模式都校验主卡组 40-60、额外/副卡组最多 15。
  - 校验主卡组不能混入额外卡、额外卡组不能混入非额外卡。
  - testMode 额外校验提交卡组是玩家轮抽池的子集。
  - 对战桌双方 ready 后禁止重复提交，避免同一个 neos 密码被二次注册覆盖预装卡组。
- `server/src/ws/index.js`
  - 提交 YDK 时把当前 room 传入 `DuelManager`，用于服务端轮抽池校验。
  - 只有卡组从未 ready 到首次 ready 时才启动 neos 房间。
  - 注册 neos 预装房间前检查主卡组 Lua 脚本数量，缺脚本导致不足 40 时直接在轮抽页返回清晰错误。
- `server/src/duel-bridge/duel-session.js`
  - 移除脚本过滤后的固定保底补足。
  - 装载进 ocgcore 前对每位玩家主卡组用不同 seed 洗牌。
  - 脚本过滤后主卡组不足 40 张时明确报错，而不是伪装成“版本不匹配”的根因。
- `server/test-ygopro-ws.js`
  - 协议测试不再使用 8 张小卡组。
  - 改为从本地 `cards.cdb` 和 `ygopro/script` 动态挑选 40 张可装载主卡组卡。
- `client/src/room.html`
  - `room.js` 版本号从 `v=5` 提到 `v=6`，避免浏览器继续用旧模块缓存。

验证关注点：

- testMode 快速提交后，提交的 YDK 应只包含该玩家轮抽池中的卡。
- 如果当前房间参数导致每人总 picks 少于 40，快速提交应直接提示数量不够。
- 如果轮抽池中有卡缺 Lua 脚本，快速提交应避开这些卡；避不开时应在轮抽页报“有脚本的主卡不足 40”。
- 两名玩家即使提交同一组卡，`DuelSession` 装载前也会独立洗牌，不应再固定同顺序抽牌。

后续复测问题：

- 用户再次遇到 neos 里“版本不匹配”。
- server 日志显示真正原因是某位玩家主卡组里出现 `14575467`，本机 `ygopro/script/c14575467.lua` 不存在。
- `DuelSession` 过滤后主卡组从 40 张变成 39 张，所以启动失败。
- 同一日志里 `cube_6dbfa2` 被注册了两次，说明 ready 后重复提交还会覆盖同一 neos 密码的预装卡组。

追加修复：

- testMode 快速按钮生成前改为调用 `/api/cards/script-status`。
- 只从存在 Lua 脚本的轮抽池主卡里抽 40 张。
- 服务端启动 neos 前也做脚本数量预检，避免缺脚本卡继续流入 neos 并显示误导性的版本错误。
- 对战桌双方 ready 后禁止重复提交，`launchNeosDuel()` 只在首次 ready 时触发。

### 修复通常怪兽脚本误判、效果文案、额外卡组确认与选择状态残留

用户反馈：

- 无效果通常怪兽没有 Lua 脚本是正常情况，不应被当成非法卡。
- 部分效果发动/选项弹窗全是 `?`。
- 自己额外卡组无法随时确认，准备从额外特殊召唤时也看不到将要召唤哪张。
- 盖放怪兽看起来能被当成 Link 素材。

根因：

1. `/api/cards/script-status`、`validateNeosDeckScripts()` 和 `DuelSession` 都把 “没有 `c{id}.lua`” 直接等同于“不能装载”，误伤了 `TYPE_NORMAL` 且无效果的主卡组通常怪兽。
2. neos 前端部分路径直接用 `fetchStrings(System, effect_description)`，没有处理 `cardId << 4 | index` 这种卡片效果描述编码。
3. `MSG_START` 只创建额外卡组占位卡，当前桥接层没有给本人补发 EXTRA 区域的真实卡号更新。
4. `selectUnselectCard` 等选择消息没有先清掉上一轮场上选卡状态，点击已选择/可选卡发送 response 后还会继续打开详情/菜单，容易表现成旧 response 残留。

修复：

- 新增 `server/src/duel-bridge/card-script-status.js`，用 `cards.cdb` 类型 + Lua 脚本共同判断可装载性：
  - 主卡组无效果通常怪兽可无脚本。
  - 效果怪兽、魔法、陷阱、额外卡组怪兽仍要求脚本。
  - 不在 `cards.cdb` 的卡一律不可装载。
- `/api/cards/script-status` 返回 `results[id]=loadable`，并附带 `details`，方便前端和排障区分 `hasScript/scriptRequired/loadable`。
- `DuelSession` 不再“过滤缺脚本卡后继续开局”，而是对不可装载卡直接报明确错误；可装载通常怪兽会正常进入主卡组。
- testMode 快速组卡改成按 `loadable` 抽卡，不再把通常怪兽当缺脚本卡排除。
- `client/src/room.html` 的 `room.js` 版本号升到 `v=7`，避免浏览器继续缓存旧的快速组卡逻辑。
- neos 前端统一新增 `getEffectDescription()`，效果确认、效果选项、选择弹窗效果描述都走 `getStrings()` 解析卡片描述编码。
- `ygopro-ws.js` 在 `MSG_START` 后给每个玩家单独发送一条本人 EXTRA 区 `MSG_UPDATE_DATA`，只同步自己的额外卡组真实卡号。
- `selectIdleCmd` 在收到带 `card_info.code` 的可操作项时，只在当前玩家可见的情况下补齐本地卡号/元数据。
- 自己 EXTRA 背景区点击可打开卡组列表；对手 EXTRA 仍隐藏。
- `clearSelectInfo()` 改为清全场选卡状态，并在 `selectCard/selectSum/selectTribute/selectUnselectCard/wait` 开头调用。
- 场上卡被选中后发送 response 会立即清状态并返回，不再继续打开详情或下拉菜单。

验证：

```bash
node --check server/src/duel-bridge/card-script-status.js
node --check server/src/duel-bridge/duel-session.js
node --check server/src/duel-bridge/ygopro-ws.js
node --check server/src/ws/index.js
node --check server/src/index.js
```

```bash
cd neos-client
npx eslint src/api/strings.ts src/service/duel/selectCard.ts src/service/duel/selectEffectYn.ts src/service/duel/selectIdleCmd.ts src/service/duel/selectSum.ts src/service/duel/selectTribute.ts src/service/duel/selectUnselectCard.ts src/service/duel/wait.ts src/service/utils/fetchCheckCardMeta.ts src/ui/Duel/Message/OptionModal/index.tsx src/ui/Duel/PlayMat/Bg/index.tsx src/ui/Duel/PlayMat/Card/index.tsx src/ui/Duel/utils/clearSelectInfo.ts
npm run build
```

功能验证：

- `14575467` 返回 `existsInDb=true, hasScript=false, scriptRequired=false, loadable=true`。
- 由 `14575467 + 39` 张有脚本主卡组成的 40 张主卡组可以创建 `DuelSession`，双方装载后均为 `main=40`。
- 隔离端口 `PORT=3132 YGOPRO_PROXY_PORT=7912 ./start.sh` 可启动。
- `curl http://localhost:3132/api/cubes` 正常。
- `POST /api/cards/script-status` 对 `14575467/71413901` 返回 `loadable=true`。
- `server/test-ygopro-ws.js` 经端口替换后可完成 join / ready / duel start，并收到 `MSG_START` 与后续对局消息。

注意：

- `npm run lint` 全量仍会失败，原因是 neos-client 中已有多个未触碰文件存在 Prettier 旧问题；本次改动文件的定向 lint 已通过。
- 这台环境没有安装 Playwright Chromium，因此没有做真实浏览器截图级验证；已用 Vite 构建、HTTP 健康检查和协议联调覆盖主要回归面。

### 修复对战中系统提示全是问号

处理顺序：

- 先按用户要求提交当前版本快照：
  - commit: `8babd42`
  - message: `Fix duel card loadability and visibility`
- 然后定位 duel 内系统提示显示为 `?` 的根因。

根因：

- `neos-client/public/ygopro-database/zh-CN/strings.conf` 和构建产物里的 `neos-client/dist/ygopro-database/zh-CN/strings.conf` 都只有 `# Empty strings`。
- `initStrings()` 依赖该文件把 `!system_<id>` 写入 localStorage；文件为空时，`fetchStrings(Region.System, id)` 只能返回 `?`。
- 原解析逻辑使用 `line.split(" ", 3)`，即使以后补入真实 `strings.conf`，带空格的提示文本也会被截断。

修复：

- `neos-client/src/api/strings.ts`
  - 加载 `strings.conf` 时检查 HTTP 状态，失败时给出 console warning。
  - 改用正则解析前三段，保留第三列之后的完整提示文本。
  - `fetchStrings()` 把本地缓存中的 `?` 视作缺失。
  - 增加常用 duel 系统提示中文 fallback，覆盖阶段、等待、效果选择、区域/属性/种族/类型、常见错误和胜利原因。
  - 对未知编号返回 `系统提示 <id>`，避免继续显示裸 `?`。

验证：

```bash
cd neos-client
npx eslint src/api/strings.ts
npm run build
```

隔离端口验证：

- `PORT=3132 YGOPRO_PROXY_PORT=7912 ./start.sh` 可启动。
- `curl -I http://localhost:3132/neos/` 返回 200。
- `curl http://localhost:3132/api/cubes` 正常。
- 构建后的 bundle 内可以检索到 `等待对方操作`、`抽卡阶段`、`请选择要发动的效果` 等 fallback 文本。

### 修复多人多桌对战串台

用户反馈：

- 单人/单桌对战基本正常。
- 多人轮抽后开启多个对战桌时，第一桌进入 neos 对战后，其他桌玩家好像无法进入自己的对战。

根因：

- `server/src/ws/index.js` 的 `broadcastDuel()` 注释说是广播给一张对战桌的两名玩家，但实际按 `roomId` 广播给整个轮抽房间。
- 第一桌双方提交卡组后，`duel_launch_neos` 被发给了同房间所有玩家。
- `client/src/room.js` 的 `handleLaunchNeos()` 没有过滤 `payload.tableId` 或玩家 ID，所有收到事件的人都会打开第一桌的 `cube_<tableId>` neos 房间。
- neos 二进制房间最多 2 人，其他桌玩家误连第一桌时会被拒绝，于是表现为“其他人无法进入”。

修复：

- `server/src/ws/index.js`
  - 保留房间级桌位同步：`duel_table_update` 仍发给同一轮抽房间所有玩家。
  - 新增 table-only 发送路径：`duel_launch_neos` 和启动失败提示只发给该桌 seat 上的两个玩家。
  - `handleDuelJoin()` / `handleDuelSubmit()` 增加 table-room 归属校验，防止跨房间 tableId 串用。
  - neos 房间注册成功后把桌状态标成 `dueling`，再广播桌位状态。
- `server/src/duel-manager/index.js`
  - `joinTable()` 清理旧座位时只清同一个 room 的桌，不再跨 room 清座。
  - 增加 `tableBelongsToRoom()`、`getTableSeatIds()`、`markTableDueling()`。
- `client/src/room.js`
  - `handleLaunchNeos()` 先判断当前玩家是否属于 `payload.playerIds` 或 `payload.tableId` 对应桌位；不是本桌玩家时直接忽略。
- `client/src/room.html`
  - `room.js` 版本号从 `v=7` 提到 `v=8`，避免浏览器缓存旧的 battle lobby 逻辑。
- `server/src/duel-bridge/ygopro-ws.js`
  - YGOPro 房间复用断线留下的空 seat，不再只用 `players.length` 判断满员。
  - close 时只清理属于当前 ws 的 seat，避免误清新连接。
- 新增 `server/test-battle-tables.mjs` 覆盖同房间换桌、跨房间同 playerId 不互相清座、table-room 归属和 `dueling` 状态。

验证：

```bash
node --check server/src/ws/index.js
node --check server/src/duel-manager/index.js
node --check server/src/duel-bridge/ygopro-ws.js
node --check --input-type=module < client/src/room.js
node server/test-battle-tables.mjs
```

隔离端口验证：

- `PORT=3132 YGOPRO_PROXY_PORT=7912 ./start.sh` 可启动。
- `curl http://localhost:3132/api/cubes` 正常。
- `curl -I http://localhost:3132/` 返回 200。
- `curl -I http://localhost:3132/neos/` 返回 200。
- `curl http://localhost:3132/room.js` 可看到 `isDuelLaunchForCurrentPlayer()` 和 `playerIds` 过滤逻辑。

### 轮抽中显示本人已选卡牌

需求：

- 轮抽进行中，玩家需要随时查看自己已经挑选了哪些卡。
- 已选卡按主卡和额外卡分开显示。

实现：

- `server/src/draft/index.js`
  - `getCurrentPack()` 增加 `pickedCards`，只返回当前查询玩家自己的已选卡详情。
  - 新增 `getPlayerPoolCards(playerId)`，把 `playerPools` 中的卡号转换为 `cards.cdb` 详情。
- `server/src/ws/index.js`
  - `pick_result` 返回当前玩家最新 `pickedCards`，玩家确认选择后面板立即刷新。
  - 后续 `pack` 也会带 `pickedCards`，刷新/补包时可恢复当前已选列表。
- `client/src/room.html`
  - 轮抽视图增加右侧“已选卡牌”面板，分为主卡和额外。
  - `room.js` 版本号从 `v=8` 提到 `v=9`，避免浏览器缓存旧轮抽界面。
- `client/src/room.js`
  - 增加 `state.draft.pickedCards`。
  - `pack` / `pick_result` 都会调用 `setDraftPickedCards()`。
  - 已选卡面板按 `isExtraType()` 分为主卡/额外，点击已选卡可打开卡片详情。
- `client/src/style.css`
  - 桌面端使用“卡包区 + 已选侧栏”布局。
  - 移动端自动改为上下布局。

验证：

```bash
node --check server/src/draft/index.js
node --check server/src/ws/index.js
node --check --input-type=module < client/src/room.js
git diff --check
```

行为验证：

- 使用 `DraftEngine` 初始化 2 人轮抽。
- 玩家 `p1` 确认选择后，`getPlayerPoolCards('p1')` 返回 1 张卡片详情。

### 主界面品牌、开发者信息与轮抽界面美化

需求：

- 主界面增加开发者信息：
  - warren
  - `warren.wang0826@gmail.com`
  - QQ：1094676771
- 增加反馈 Bug 按钮，使用 `mailto:warren.wang0826@gmail.com`。
- 项目名称改为 `USTC-OnlineCube`。
- 轮抽界面更美观。

实现：

- `client/src/index.html`
  - 首页标题改为 `USTC-OnlineCube`。
  - 增加开发者信息面板。
  - 增加 `反馈 Bug` mailto 链接。
  - `app.js` 版本号从 `v=5` 提到 `v=6`，并修掉多余 `</script>`。
- `client/src/room.html` / `client/src/duel.html`
  - 页面标题改为 `USTC-OnlineCube`。
- `client/src/style.css`
  - 首页品牌区、开发者信息区、反馈按钮增加样式。
  - 轮抽 header、当前卡包区域、操作区和已选卡侧栏增加边框、间距和移动端适配。
- `server/package.json` / `server/package-lock.json`
  - 包名改为 `ustc-onlinecube`。
- `server/src/index.js`
  - 启动日志改为 `USTC-OnlineCube running ...`。
- `README.md`、`OPERATIONS.md`、`llm-docs/DEBUGGING_RUNBOOK.md`
  - 更新启动日志说明。
- `neos-client/neos.config*.json`
  - 本地服务器显示名改为 `USTC-OnlineCube (local)`。
- `client/src/room.js`、`server/src/draft/index.js`
  - YDK created-by 标识改为 `USTC-OnlineCube`。
