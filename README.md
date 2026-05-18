# Cube Draft — 游戏王 Cube 轮抽 + 在线对战

基于 ygopro 卡牌数据库的网页端 Cube 轮抽系统，集成 **neos-ts** 在线对战引擎。支持多人轮抽、组卡、YDK 导出，以及**在浏览器中进行实时对战**。

## 功能

### 轮抽 & 组卡
- **Cube 卡池管理** — 使用 `.ydk` 文件自定义卡池
- **多人轮抽** — 圆桌座位、密码房间、实时选牌、卡包轮转（左右交替传包）
- **卡组构筑** — 拖拽组卡，支持主卡组/额外/副卡组
- **YDK 导出** — 导出为标准 `.ydk` 格式，兼容 ygopro 客户端
- **房间聊天** — 房间内公屏聊天
- **座位交换** — 轮抽开始前自由换座

### 在线对战 (neos-ts)
- **浏览器内实时对战** — 无需安装 ygopro 客户端，打开浏览器即可对战
- **ocgcore WASM 引擎** — 基于 koishipro-core.js 的完整规则引擎
- **原汁原味的游戏王规则** — 支持所有卡牌效果（需 Lua 脚本）、连锁处理、召唤/魔法/陷阱
- **图形化对战界面** — 卡牌渲染、场地展示、操作菜单

## 快速开始

### 环境要求

- **Node.js 20 LTS**（ocgcore WASM 需要 Node 20，Node 22 存在兼容性问题）
- npm >= 9

### 安装

```bash
git clone <repo-url>
cd cube-draft/server
npm install
```

### 准备卡牌数据库

```bash
# 放入 cards.cdb（SQLite 格式的卡牌数据库）
cp /path/to/ygopro/cards.cdb server/data/

# 放入 ygopro 卡牌 Lua 脚本（用于 WASM 规则引擎）
# 从 https://github.com/Fluorohydride/ygopro-scripts 下载
cp -r /path/to/script ygopro/
```

> `cards.cdb` 和 Lua 脚本可从 [ygopro 项目](https://github.com/Fluorohydride/ygopro) 获取。
> 如果缺少某些卡片的 Lua 脚本，DuelSession 会自动跳过并记录警告。

### 使用 Node 20（重要）

```bash
# 如果系统安装了 nvm
nvm use 20

# 或手动指定路径
export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH"
```

### 自定义 Cube 卡池

编辑 `server/data/cubes/` 目录下的 `.ydk` 文件：

```ydk
# Created by cube-draft
#main
24184846
21452275
10012614
#extra
!side
```

Cube 解析只读取 `#main` 区的卡片，可以放入任意数量的卡。

### 生成随机 Cube（可选）

```bash
cd server
node scripts/generate-cube.js
```

### 启动

```bash
cd server
npm start
```

服务器默认监听 `http://localhost:3131`。

### 自定义端口

```bash
PORT=8080 npm start
```

## 使用说明

### 创建房间
1. 输入昵称，可选设置房间密码
2. 选择 Cube 卡池
3. 设置玩家数量、每人包数、每包张数
4. 点击「创建房间」

### 加入房间
1. 输入昵称和房间号
2. 如果房间有密码，输入密码
3. 进入房间后可以看到圆桌上的其他玩家

### 换座位
点击圆桌上的空位或其他玩家即可交换座位（仅限轮抽开始前）。

### 轮抽流程
1. 房主点击「开始轮抽」
2. 每轮从 15 张牌中选 1 张，60 秒超时自动随机选
3. 每包选完后卡包按方向轮转（交替左右传）
4. 所有包选完后进入卡组构筑

### 组卡 & 导出
- 拖拽卡片到主卡组 / 额外 / 副卡组区域
- 双击卡片快速移入移出
- 点击「导出 YDK」下载卡组文件

### 在线对战

1. 双方完成组卡后，进入**对战大厅**
2. 在座位上粘贴 YDK 并提交
3. 双方就绪后，系统弹出房间密码和 `/neos/` 链接
4. 点击「启动对战」按钮，浏览器将打开新窗口
5. 在 neos-ts 界面选择 **"Cube Draft (local)"** 服务器
6. 输入昵称和房间密码，点击连接
7. 系统自动匹配对手，开始对战！

### 对战界面功能
- 卡牌渲染展示
- 生命值管理
- 连锁处理与确认
- 召唤、攻击、效果发动
- 手牌/场地/墓地/除外区展示
- 投降按钮

## 项目结构

```
cube-draft/
├── client/src/                # 前端（原生 HTML/CSS/JS）
│   ├── index.html             # 大厅页面
│   ├── app.js                 # 大厅逻辑
│   ├── room.html              # 房间/轮抽/组卡/对战大厅
│   ├── room.js                # 房间逻辑 + 对战大厅
│   ├── style.css              # 样式
│   └── ws/client.js           # WebSocket 客户端
├── neos-client/               # neos-ts 前端（React/TypeScript）
│   └── src/
│       ├── ui/Duel/           # 对战主界面
│       ├── ui/DuelRoom/       # 对战大厅/房间匹配
│       ├── ui/WaitRoom/       # 等待房间
│       └── ui/NeosRouter.tsx  # 路由配置
├── server/
│   ├── src/
│   │   ├── index.js           # Express 服务入口 + REST API
│   │   ├── ws/index.js        # WebSocket 消息处理（双端点）
│   │   ├── room/index.js      # 房间管理器
│   │   ├── draft/index.js     # 轮抽引擎
│   │   ├── cube/index.js      # Cube 卡池管理
│   │   ├── card-db/           # 卡牌数据库 (SQLite)
│   │   ├── duel-bridge/       # ⭐ 对战协议桥接层
│   │   │   ├── duel-session.js    # ocgcore WASM 对战会话
│   │   │   ├── protocol-adapter.js# ygopro 二进制协议编解码
│   │   │   ├── ygopro-ws.js       # 二进制 WS 端点 + 房间配对
│   │   │   ├── ygopro-proxy.js    # 7911 端口转发代理
│   │   │   ├── ocgcore-worker.mjs # WASM 引擎 Worker
│   │   │   ├── relay.js           # 消息转发
│   │   │   └── index.js           # 模块导出
│   │   └── duel-manager/      # 对战管理器
│   ├── data/
│   │   ├── cards.cdb          # 卡牌数据库（需自行放入）
│   │   └── cubes/             # Cube .ydk 文件
│   └── scripts/               # 工具脚本
├── ygopro/                    # ygopro 资源（需自行放入）
│   ├── script/                # Lua 脚本文件
│   └── script-official/       # 官方脚本
├── archives/                  # 旧版本备份
└── pic/                       # 卡图缓存
```

## 架构

### 服务端口
- **3131** — 主服务器（Express + WebSocket）
- **7911** — ygopro 代理端口（兼容标准 ygopro 客户端连接）

### WebSocket 端点
- `/ws` — JSON WebSocket（cube-draft 前端通信）
- `/ws-duel` — 二进制 WebSocket（neos-ts 对战协议）

### 对战流程
```
玩家A/B: cube-draft → 轮抽 → 组卡 → POST /api/launch-duel
                                          ↓
                         服务器注册预加载卡组 (密码=房间号)
                                          ↓
玩家A/B: 打开 /neos/ → 选"Cube Draft (local)" 
       → 输入名字+密码 → 连接 ws://127.0.0.1:7911
                                          ↓
                         ygopro-proxy 转发 → /ws-duel
                                          ↓
                         ygopro-ws 匹配双人 → DuelSession
                                          ↓
                         ocgcore WASM 原始二进制 ↔ neos-ts 渲染
```

### 已知限制
- **Node 版本**：ocgcore WASM 需要 Node.js 20 LTS，Node 22 存在 Emscripten 兼容性问题
- **卡牌图片**：本地环境默认显示占位图，可从 CDN 或 YGOPRODeck API 获取
- **单人测试**：当前仅支持双人对战，无 AI 对手

## 技术栈

- **后端**: Node.js + Express + ws (WebSocket)
- **前端（轮抽）**: 原生 HTML/CSS/JS，无框架
- **前端（对战）**: React + TypeScript（neos-ts）
- **对战引擎**: koishipro-core.js (ocgcore WASM)
- **二进制协议**: ygopro 标准协议编码/解码
- **数据库**: SQLite (sql.js) — 卡牌数据
- **卡牌数据**: cards.cdb + Lua 脚本

## License

MIT