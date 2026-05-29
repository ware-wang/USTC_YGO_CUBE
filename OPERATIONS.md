# Cube Draft 操作文档

这份文档写给“要把项目跑起来、排障、验证”的人，不讲废话。

## 1. 运行前提

### Node 版本

**必须优先使用 Node.js 20 LTS。**

项目里的 ocgcore WASM / Emscripten 组合在 Node 22 下已知不稳定。

如果本机装了 nvm 版 Node 20，可以这样临时切换：

```bash
export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH"
node -v
```

期望输出类似：

```bash
v20.20.2
```

## 2. 目录与关键资源

项目关键目录：

- `server/` — 主服务
- `client/` — 轮抽 / 组卡前端
- `neos-client/` — 对战前端
- `server/data/cards.cdb` — 卡牌数据库
- `server/data/cubes/*.ydk` — Cube 卡池
- `ygopro/script/` — Lua 脚本

启动前至少确认：

```bash
ls server/data/cards.cdb
ls server/data/cubes
ls ../ygopro/script | head
```

## 3. 安装依赖

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

> `neos-client/dist/` 必须存在，否则 `/neos/` 页面虽然能返回，但对战前端可能不是最新构建。

## 4. 启动服务

优先从仓库根目录启动：

```bash
export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH"
./start.sh
```

`start.sh` 会同时导出：

- `YGO_SCRIPT_PATH`
- `YGOPRO_SCRIPT_PATH`

这样 duel WebSocket 链路和主进程会使用同一套 Lua 脚本目录。

正常日志应包含：

- `CardDB Loaded ... cards.cdb`
- `DuelBridge Ready`
- `Cube Loaded ...`
- `Cube Draft running on http://localhost:3131`
- `neos-ts duel client at http://localhost:3131/neos/`
- `YGOPro WS proxy on ws://localhost:7911`

## 5. 端口说明

- `3131` — 主 HTTP 服务 + JSON WebSocket + `/ws-duel`
- `7911` — ygopro 兼容 WebSocket 代理

## 6. 使用流程

### 6.1 创建轮抽房间

打开：

- `http://localhost:3131/`

创建房间后，玩家通过房间号加入。

### 6.2 开始轮抽

- 房主点击“开始轮抽”
- 所有人选牌
- 轮抽完成后进入组卡界面

### 6.3 进入对战大厅

- 点击“进入对战房间”
- 每个玩家选择座位
- 粘贴自己的 YDK
- 双方都提交后，页面会显示“打开对战”按钮

### 6.4 打开对战

当前正确入口是：

- **自动入口：** `/neos/duelroom?passwd=...&player=...`
- **手动入口：** `/neos/match`

推荐使用自动入口，因为它会自动带入：

- 房间密码
- 玩家昵称
- 默认服务器地址

### 6.5 DuelRoom 默认连接方式

`/neos/duelroom` 默认连接：

```text
<当前主机>:7911
```

不是 `/ws-duel` 路径。

原因：neos-ts 底层连接器接收的是 `host:port`，会自己拼成 `ws://host:port` 或 `wss://host:port`。

## 7. 快速健康检查

### HTTP 检查

```bash
curl http://localhost:3131/api/cubes
curl http://localhost:3131/api/stats
curl -I http://localhost:3131/
curl -I http://localhost:3131/neos/
```

### ygopro / duel 协议检查

```bash
cd server
node test-ygopro-ws.js
```

如果正常，应看到：

- 两个客户端连接
- `STOC_JOIN_GAME`
- `STOC_DUEL_START`
- 多条 `STOC_GAME_MSG`

## 8. 已修复 / 已确认的问题

### 8.1 DuelRoom 默认地址错误

之前 `/neos/duelroom` 默认用的是：

```text
<host>/ws-duel
```

这对 neos-ts 来说是不对的，因为它会直接拿这个字符串去构造 WebSocket 地址。

现在已改为：

```text
<hostname>:7911
```

### 8.2 对战入口文档过时

之前 README 仍写“打开 `/neos/`，再手动选 `Cube Draft (local)`”。

现在真实推荐流程是：

- 由 cube-draft 页面直接打开 `/neos/duelroom?...`
- 自动带参数入房
- 失败再退回手动连接

### 8.3 battle tables 事件名不一致

服务端曾发送：

- `battle_tables_created`

但前端监听的是：

- `battle_tables_ready`

现在两边都兼容了。

### 8.4 遗留消息可能调用不存在的方法

`duel_start` / `duel_respond` 在当前架构里已不是主路径，但服务端还可能调用 `DuelManager` 上不存在的方法。

现在已改为：

- 如果这些老消息被触发，返回明确错误提示
- 不再无保护地触发 `TypeError`

### 8.5 黑森林的魔女检索后连锁标志残留

曾经的现象：

- `78010363` 黑森林的魔女送入墓地后发动检索
- 检索卡加入手牌后，墓地里的黑森林仍显示连锁标志
- 对局无法回到自由时点继续操作

根因：

- `DuelSession.advance()` 在普通 game message 后遇到非 0 `status` 会提前结束
- `CONFIRM_CARDS` 后的 `CHAIN_SOLVED` / `CHAIN_END` / 下一次 `SELECT_IDLE_CMD` 被截断

现在已改为：

- 后端普通消息后继续推进 ocgcore
- 前端 `CHAIN_END` 兜底清空所有位置的 `chainIndex`

## 9. 常见故障排查

### 9.1 Node 22 下行为异常

症状：

- DuelSession 建立异常
- WASM / worker 报错
- 对战启动不稳定

处理：

```bash
export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH"
```

### 9.2 `/neos/duelroom` 打开后一直转圈或报连接失败

优先检查：

```bash
curl http://localhost:3131/api/stats
```

然后看 server 日志里是否有：

- `YGOPro WS proxy on ws://localhost:7911`
- `[WS-Duel] New ygopro binary connection`

如果 7911 没起来：

- 检查端口占用
- 或在 DuelRoom 手动填写正确的 `主机:端口`

### 9.3 提交 YDK 后没弹出对战入口

检查：

- 两边是否都已经入座
- 两边是否都提交了 YDK
- 主卡组是否满足 40–60 张（testMode 也会校验）
- 额外卡组是否不超过 15 张
- testMode 下提交的卡是否来自玩家自己的轮抽卡池
- server 日志里是否提示“缺少 Lua 脚本，过滤后不足 40 张”

testMode 下推荐使用：

```text
测试模式：从轮抽池随机组卡并提交
```

该按钮会先调用 `/api/cards/script-status` 检查 Lua 脚本，只从本次轮抽池里有脚本的主卡随机抽 40 张，并从有脚本的额外卡中抽最多 15 张。

### 9.4 某些卡报缺脚本

日志里如果出现：

- `Skipping ... cards without scripts`

说明 `ygopro/script/` 里缺对应 Lua。当前策略是：

- 主卡组缺脚本卡会被过滤。
- 过滤后主卡组少于 40 张时，服务端会拒绝启动对战。
- testMode 快速组卡会提前过滤缺脚本卡；如果有脚本的主卡不足 40 张，会留在轮抽页报错。
- 额外卡组缺脚本卡会被过滤，额外卡组最多 15 张。

如果 neos 弹出“版本不匹配”，不要先怀疑 Node/NVM。先看 server 日志是否有类似：

```text
Skipping 1 main-deck cards without scripts: 14575467
Player 1 has 39 usable main-deck cards after script filter; expected 40-60
```

这表示真实原因是 Lua 脚本缺失导致可装载主卡不足。

### 9.5 连锁处理后卡住

先确认后端是否继续输出完整连锁消息：

- `YGOProMsgChainSolved`
- `YGOProMsgChainEnd`
- 后续新的 `YGOProMsgSelectIdleCmd`

如果后端完整但 UI 仍残留标志，检查浏览器 DOM：

```text
[data-testid="duel-chain-marker"]
```

`CHAIN_END` 后它应为 0 个。

## 10. 调试建议

### 看 server 实时日志

直接前台运行：

```bash
./start.sh
```

### 单独验证 ygopro 二进制协议

```bash
cd server
node test-ygopro-ws.js
```

### 检查 neos 是否已构建

```bash
find ../neos-client/dist -maxdepth 2 -type f | head
```

## 11. 回归检查清单

每次改动后，至少检查：

- [ ] `server` 在 Node 20 下能启动
- [ ] `/api/cubes` 正常
- [ ] `/neos/` 能访问
- [ ] `node test-ygopro-ws.js` 通过
- [ ] 双方提交 YDK 后能收到 `duel_launch_neos`
- [ ] `/neos/duelroom` 默认连接到 `7911`
- [ ] 连锁结束后 `[data-testid="duel-chain-marker"]` 会清零

## 12. 后续建议

当前项目最值得继续清理的是：

1. 把 `duel_start` / `duel_respond` 这类旧 JSON 对战消息彻底下线
2. 给“轮抽 → 组卡 → 开战”补一套自动化端到端测试
3. 统一 README、前端文案、实际入口，避免再出现“文档说一套，页面走另一套”
