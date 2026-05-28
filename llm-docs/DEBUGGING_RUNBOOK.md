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
- 主卡组是否满足张数要求（非 testMode）

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
- 更可能是预加载进对局的牌组本身不合法、过小，或被过滤脚本后几乎为空

检查：

- `DuelSession` 日志里的：
  - `Player 0 raw deck: main=...`
  - `Player 1 raw deck: main=...`
- 如果主卡组不是一个合理数量，先回到 battle lobby 检查提交内容

testMode 下建议：

- 优先点 `测试模式：一键提交合法卡组`
- 或让 server 自动补足调试牌组

额外检查：

- 看 server 日志中的：
  - `Player X raw deck: main=...`
  - `Player X loaded deck after script filter: main=..., extra=..., testMode=...`

如果 `raw deck` 是 40，但 `loaded deck after script filter` 很小：

- 说明卡被 Lua 脚本过滤掉了
- 当前版本在 `testMode` 下会继续自动补足到真正可开局的 40 张
- 如果仍然没有补足成功，优先检查本地 `ygopro/script/` 是否完整

### 7.3.3 已进入 `主要阶段 1`，但仍然像“不能操作”

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

### 7.4 某些卡在日志中被跳过

这通常是缺 Lua 脚本。先看：

```bash
find ../ygopro/script -maxdepth 1 -type f | head
```

## 8. 回归清单

每次改动后尽量至少检查：

- [ ] Node 20 下 server 能启动
- [ ] `/api/cubes` 正常
- [ ] `/neos/` 正常
- [ ] `node test-ygopro-ws.js` 通过
- [ ] `STOC_DUEL_START` 后能看到 `STOC_GAME_MSG func=4`
- [ ] duel 内 `CTOS_CHAT` 能回显为 `STOC_CHAT`
- [ ] `POST /api/launch-duel` 返回 `/neos/duelroom`
- [ ] DuelRoom 默认地址仍是 `<hostname>:7911`
