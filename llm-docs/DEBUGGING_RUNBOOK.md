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
- [ ] `POST /api/launch-duel` 返回 `/neos/duelroom`
- [ ] DuelRoom 默认地址仍是 `<hostname>:7911`
