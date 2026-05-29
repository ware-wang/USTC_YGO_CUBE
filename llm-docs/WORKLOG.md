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
