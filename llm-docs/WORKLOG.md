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
