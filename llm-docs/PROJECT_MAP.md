# Project Map

## 1. 项目一句话

这是一个把 **游戏王 Cube 轮抽** 和 **浏览器内实时对战** 接在一起的项目：

- 前半段：自研房间 / 轮抽 / 组卡系统
- 后半段：`neos-ts` 对战前端
- 服务端中间层：把 neos/ygopro 协议桥接到 `ocgcore WASM`

## 2. 顶层目录

- `client/` — 轮抽大厅、房间、组卡、对战入口（原生 HTML/CSS/JS）
- `server/` — 主服务，REST + WebSocket + duel bridge
- `neos-client/` — neos-ts 前端（React + TypeScript + Vite）
- `archives/` — 归档备份
- `llm-docs/` — 交接/操作文档（本目录）

## 3. 关键模块

### 3.1 `server/src/index.js`

主入口，负责：

- 初始化 card DB
- 初始化 duel bridge
- 加载 cube
- 创建 Express / HTTP server
- 注册 REST API
- 挂载 `/ws` 和 `/ws-duel`
- 提供 `/neos` 与 `/neos-assets` 静态资源
- 启动 7911 ygopro 代理

### 3.2 `server/src/ws/index.js`

JSON WebSocket 层，负责：

- 房间加入/离开
- 开始轮抽
- 选牌确认
- 聊天
- 对战桌加入
- YDK 提交
- 对战入口广播（`duel_launch_neos`）

### 3.3 `server/src/room/index.js`

房间管理：

- 创建房间
- 玩家入房
- 密码校验
- 座位交换
- 聊天记录
- 空房自动清理

### 3.4 `server/src/draft/index.js`

轮抽核心状态机：

- 发包
- 选牌
- 传包
- 方向切换
- 统计玩家牌池
- 导出 YDK

### 3.5 `server/src/duel-manager/index.js`

对战桌逻辑：

- 生成 battle tables
- 座位分配
- YDK 提交
- 主卡组张数校验

它**不是**真正的对战执行器。

### 3.6 `server/src/duel-bridge/*`

这是核心桥接层：

- `ygopro-ws.js` — 处理 neos / ygopro 二进制协议
- `ygopro-proxy.js` — 7911 → `/ws-duel` 代理
- `duel-session.js` — WASM 对战会话
- `card-script-status.js` — 按 `cards.cdb` 类型与 Lua 脚本共同判断卡片是否可装载
- `ocgcore-worker.mjs` — Worker 封装
- `protocol-adapter.js` — 协议编解码

## 4. 前端职责切分

### `client/`
负责：

- 建房
- 入房
- 轮抽 UI
- 组卡 UI
- 导出 YDK
- 打开对战入口

### `neos-client/`
负责：

- 对战大厅 / 等待房间 / 对战 UI
- ygopro 协议客户端行为
- 场地渲染 / 操作交互

## 5. 关键链路

## 5.1 轮抽链路

`/` → 建房 → `/ws` 加入房间 → `start_draft` → `pack` → `confirm_pick` → `draft_complete`

## 5.2 对战启动链路

轮抽完成 → 组卡 → 进入 battle lobby → 双方提交 YDK → server 注册 preloaded decks → 广播 `duel_launch_neos` → 打开 `/neos/duelroom?...`

## 5.3 neos 连接链路

`/neos/duelroom?passwd=...&player=...` → 默认连接 `<hostname>:7911` → 7911 proxy → `/ws-duel` → `ygopro-ws.js` → `DuelSession`

## 6. 当前已知的架构注意点

1. 这是**双 WebSocket 架构**：
   - `/ws`：JSON
   - `/ws-duel`：binary
2. `neos-ts` 默认认的是 **host:port** 风格连接目标，不是 `/ws-duel` 这种路径。
3. 项目里有少量**遗留对战消息**，但当前主路径已经切到 `duel-bridge`。
4. Node 20 是实用基线；Node 22 容易出现 WASM / Emscripten 兼容问题。
