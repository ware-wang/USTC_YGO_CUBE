# Cube Draft — 游戏王 Cube 轮抽

基于 ygopro 卡牌数据库的网页端 Cube 轮抽系统。支持多人轮抽、组卡、导出 YDK。

## 功能

- **Cube 卡池管理** — 使用 `.ydk` 文件自定义卡池
- **多人轮抽** — 圆桌座位、密码房间、实时选牌、卡包轮转
- **卡组构筑** — 拖拽组卡，支持主卡组/额外/副卡组
- **YDK 导出** — 导出为标准 `.ydk` 格式，兼容 ygopro 客户端
- **房间聊天** — 房间内公屏聊天
- **座位交换** — 轮抽开始前自由换座

## 快速开始

### 环境要求

- Node.js >= 18
- npm >= 9

### 安装

```bash
git clone <repo-url>
cd cube-draft/server
npm install
```

### 准备卡牌数据库

将 ygopro 的 `cards.cdb` 放入 `server/data/` 目录：

```bash
cp /path/to/ygopro/cards.cdb server/data/
```

> `cards.cdb` 是 SQLite 格式的卡牌数据库，可以从 [ygopro 项目](https://github.com/Fluorohydride/ygopro) 获取。

### 自定义 Cube 卡池

编辑 `server/data/cubes/` 目录下的 `.ydk` 文件，格式与 ygopro 卡组文件一致：

```ydk
# Created by cube-draft
#main
24184846
21452275
10012614
...（你的卡片 ID）
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

## 部署到校内服务器

### 1. 手动部署

```bash
# 在服务器上
git clone <repo-url>
cd cube-draft/server
npm install

# 放入 cards.cdb
cp /path/to/cards.cdb server/data/

# 启动（后台运行）
nohup npm start > server.log 2>&1 &

# 或使用 PM2
npm install -g pm2
pm2 start src/index.js --name cube-draft
```

### 2. 防火墙开放端口

```bash
# Ubuntu/Debian
sudo ufw allow 3131/tcp

# CentOS/RHEL
sudo firewall-cmd --add-port=3131/tcp --permanent
sudo firewall-cmd --reload
```

### 3. 访问

玩家在浏览器中访问 `http://<服务器IP>:3131` 即可。

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
- 点击「导出 YDK」下载卡组文件，可直接导入 ygopro 使用

## 项目结构

```
cube-draft/
├── client/src/           # 前端 (HTML/CSS/JS)
│   ├── index.html        # 大厅页面
│   ├── app.js            # 大厅逻辑
│   ├── room.html         # 房间/轮抽/组卡页面
│   ├── room.js           # 房间逻辑
│   ├── style.css         # 样式
│   └── ws/client.js      # WebSocket 客户端
├── server/
│   ├── src/
│   │   ├── index.js      # Express 服务入口 + REST API
│   │   ├── ws/index.js   # WebSocket 消息处理
│   │   ├── room/index.js # 房间管理器
│   │   ├── draft/index.js# 轮抽引擎
│   │   ├── cube/index.js # Cube 卡池管理
│   │   └── card-db/      # 卡牌数据库 (SQLite)
│   ├── data/
│   │   ├── cards.cdb     # 卡牌数据库（需自行放入）
│   │   └── cubes/        # Cube .ydk 文件
│   └── scripts/          # 工具脚本
└── archives/             # 旧版本备份
```

## 技术栈

- **后端**: Node.js + Express + ws (WebSocket)
- **前端**: 原生 HTML/CSS/JS，无框架
- **数据库**: SQLite (sql.js) — 卡牌数据
- **卡图**: [YGOPRODeck API](https://ygoprodeck.com/api-guide/)

## License

MIT