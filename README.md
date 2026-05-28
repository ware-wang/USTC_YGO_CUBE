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
cd cube-draft

cd server
npm install

cd ../neos-client
npm install
npm run build
```

> `neos-client/dist/` 必须先构建出来，`server` 才能正确提供 `/neos/` 对战前端。

### 准备卡牌数据库

```bash
# 放入 cards.cdb（SQLite 格式的卡牌数据库，默认路径）
cp /path/to/ygopro/cards.cdb server/data/

# 放入 ygopro 卡牌 Lua 脚本（用于 WASM 规则引擎）
# 方案 A：放在仓库内（推荐）
mkdir -p ygopro
cp -r /path/to/ygopro/script ./ygopro/

# 方案 B：放到仓库外任意目录，然后启动时设置 YGO_SCRIPT_PATH
# 例如：/srv/ygopro/script
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

### 常用环境变量

- `PORT`：主 HTTP 服务端口，默认 `3131`
- `YGOPRO_PROXY_PORT`：neos 对战使用的外部 YGOPro WebSocket 端口，默认 `7911`
- `YGO_SCRIPT_PATH`：Lua 脚本目录；未设置时会按顺序尝试：
  - `./ygopro/script`
  - `../ygopro/script`

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
3. 双方都提交后，系统会推送一个 **`/neos/duelroom` 自动入房链接**
4. 点击按钮会在新窗口打开对战，并自动带入昵称与房间密码
5. 页面默认连接当前主机的 **7911** YGOPro 代理端口
6. 如果自动连接失败，可在页面里手动填写 `主机:端口`、昵称和房间密码后重试
7. 双方进入待战房间后会自动开始对战

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
玩家A/B: cube-draft → 轮抽 → 组卡 → 提交 YDK 到 battle table
                                          ↓
                         服务器注册预加载卡组（按 table 生成房间密码）
                                          ↓
玩家A/B: 打开 /neos/duelroom?passwd=...&player=...
                                          ↓
                         DuelRoom 默认连接 ws://<当前主机>:7911
                                          ↓
                         ygopro-proxy 转发 → /ws-duel
                                          ↓
                         ygopro-ws 匹配双人 / 自动 ready → DuelSession
                                          ↓
                         ocgcore WASM 原始二进制 ↔ neos-ts 渲染
```

### 已知限制
- **Node 版本**：ocgcore WASM 需要 Node.js 20 LTS，Node 22 存在 Emscripten 兼容性问题
- **卡牌图片**：本地环境默认显示占位图，可从 CDN 或 YGOPRODeck API 获取
- **单人测试**：当前仅支持双人对战，无 AI 对手

## 服务器部署

下面这套是面向 Linux 服务器的实际部署方式，按这个做基本可以直接上线。

### 1. 部署前先理解端口

这个项目不是单端口纯网页应用，它至少会用到两类入口：

- `3131`：主站，包含轮抽页面、REST API、JSON WebSocket、`/neos/`
- `7911`：neos 对战页连接的 YGOPro WebSocket 端口

关键点：

- `cube-draft` 页面和 API 走主站端口
- `/neos/duelroom` 会让浏览器直接连接 `主机:7911`
- 如果你的站点是 `https://`，那么这个 7911 入口也必须能走 `wss://`

### 2. 推荐目录结构

推荐把项目放到 `/srv` 一类的固定目录下：

```text
/srv/cube-draft/
/srv/cube-draft/server/
/srv/cube-draft/neos-client/
/srv/cube-draft/ygopro/script/
```

如果你不想把脚本放在仓库里，也可以用：

```text
/srv/ygopro/script/
```

然后启动时设置：

```bash
YGO_SCRIPT_PATH=/srv/ygopro/script
```

### 3. 服务器初始化

以下示例假设你已经有一台 Linux 服务器，并且准备使用 Node 20。

```bash
cd /srv
git clone <repo-url> cube-draft
cd cube-draft/server
npm install

cd ../neos-client
npm install
npm run build

cd ..
mkdir -p ygopro
cp -r /path/to/ygopro/script ./ygopro/
cp /path/to/ygopro/cards.cdb ./server/data/
```

如果你已经把 `cards.cdb` 提交在仓库里，这一步只需要确认文件是你想要的版本。

### 4. 直接启动验证

先不要急着配 systemd，先手工启动一次，确认资源路径和端口都正常。

```bash
export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH"
cd /srv/cube-draft/server
PORT=3131 YGOPRO_PROXY_PORT=7911 npm start
```

正常日志至少应该看到：

- `CardDB Loaded ... cards.cdb`
- `DuelBridge Ready`
- `Cube Draft running on http://localhost:3131`
- `YGOPro WS proxy on ws://localhost:7911`

如果脚本目录被识别到了，还会看到类似：

- `YGO script path: /srv/cube-draft/ygopro/script`

### 5. 用 systemd 托管

建议用 `systemd` 托管，不要靠手工开终端挂着。

示例文件：`/etc/systemd/system/cube-draft.service`

```ini
[Unit]
Description=Cube Draft server
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/srv/cube-draft/server
Environment=NODE_ENV=production
Environment=PORT=3131
Environment=YGOPRO_PROXY_PORT=7911
Environment=YGO_SCRIPT_PATH=/srv/cube-draft/ygopro/script
ExecStart=/usr/bin/node /srv/cube-draft/server/src/index.js
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
```

如果你的 Node 20 不是装在 `/usr/bin/node`，把 `ExecStart` 改成 `which node` 查到的实际路径；使用 `nvm` 时这一步尤其重要。

启用：

```bash
sudo systemctl daemon-reload
sudo systemctl enable cube-draft
sudo systemctl start cube-draft
sudo systemctl status cube-draft
```

查看日志：

```bash
journalctl -u cube-draft -f
```

### 6. HTTP 部署方式

如果你只是内网使用，或者先用 HTTP 跑通，最简单：

- 直接放行 `3131`
- 直接放行 `7911`
- 浏览器访问 `http://你的域名或IP:3131/`

这种方式最省事，但不适合正式公网环境。

### 7. HTTPS 部署方式

如果你的站点走 HTTPS，推荐把主站和 7911 都交给 Nginx 做反代 / TLS 终止。

这里有个非常重要的点：

- 页面如果是 `https://example.com`
- DuelRoom 会按 HTTPS 语义去连 `wss://example.com:7911`
- 所以 `7911` 不能只是一个裸的明文 ws 端口

推荐做法是把 Node 内部对战代理改到一个内网端口，比如 `17911`，然后让 Nginx 对外暴露 `7911`。

`systemd` 里对应改成：

```ini
Environment=YGOPRO_PROXY_PORT=17911
```

主站 Nginx 示例：

```nginx
server {
    listen 80;
    server_name duel.example.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name duel.example.com;

    ssl_certificate /etc/letsencrypt/live/duel.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/duel.example.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:3131;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```

对战 WebSocket 7911 示例：

```nginx
server {
    listen 7911 ssl;
    server_name duel.example.com;

    ssl_certificate /etc/letsencrypt/live/duel.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/duel.example.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:17911;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```

这样浏览器访问：

- `https://duel.example.com/`
- 对战页会自动连接 `wss://duel.example.com:7911`

### 8. 防火墙 / 云服务器安全组

至少确认这些端口策略：

- `80` / `443`：主站入口
- `7911`：对战 WebSocket 外部入口

如果你选择 HTTP 直连，还需要：

- `3131`

如果你让 Nginx 反代到内网端口：

- `3131`、`17911` 只需要本机可访问，不需要公网开放

### 9. 部署后检查顺序

先查服务本身：

```bash
curl http://127.0.0.1:3131/api/stats
curl -I http://127.0.0.1:3131/neos/
```

再查主站入口：

```bash
curl -I https://duel.example.com/
curl -I https://duel.example.com/neos/
```

最后查对战代理是否起来：

```bash
ss -ltnp | grep 7911
ss -ltnp | grep 3131
```

如果是 HTTPS + Nginx 内转发模式，再查内网端口：

```bash
ss -ltnp | grep 17911
```

### 10. 更新部署流程

以后更新代码时，推荐顺序：

```bash
cd /srv/cube-draft
git pull

cd server
npm install

cd ../neos-client
npm install
npm run build

sudo systemctl restart cube-draft
sudo systemctl status cube-draft
```

如果你更新了卡图、Lua 脚本或 `cards.cdb`，再额外把这些资源同步到服务器对应目录。

## 技术栈

- **后端**: Node.js + Express + ws (WebSocket)
- **前端（轮抽）**: 原生 HTML/CSS/JS，无框架
- **前端（对战）**: React + TypeScript（neos-ts）
- **对战引擎**: koishipro-core.js (ocgcore WASM)
- **二进制协议**: ygopro 标准协议编码/解码
- **数据库**: SQLite (sql.js) — 卡牌数据
- **卡牌数据**: cards.cdb + Lua 脚本

## LLM Handoff Docs

项目根目录维护了一个面向后续模型接手的文档目录：

- `llm-docs/README.md` — 索引
- `llm-docs/PROJECT_MAP.md` — 项目地图
- `llm-docs/WORKLOG.md` — 工作记录
- `llm-docs/NEXT_STEPS.md` — 下一步方向
- `llm-docs/DEBUGGING_RUNBOOK.md` — 调试/回归手册
- `llm-docs/OPEN_QUESTIONS.md` — 未决问题

如果你是新接手的模型，建议先读 `llm-docs/README.md`。

## License

MIT
