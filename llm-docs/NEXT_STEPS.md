# Next Steps

这是给后续模型看的“下一步行动清单”，按优先级排列。

## P0：跑通真实浏览器端到端链路

### 目标

确认下面这条链在真实浏览器里能走通：

- 建房
- 双人入房
- 开始轮抽
- 完成选牌
- 提交 YDK
- 打开 `/neos/duelroom`
- 双方自动进 waitroom / duel

### 为什么优先

目前已经验证过：

- server 启动
- REST 正常
- ygopro 二进制协议测试正常
- `/neos/duelroom -> /neos/duel` 能进入真实浏览器对局
- 黑森林的魔女送墓检索后能完整回到自由时点，连锁标志会清掉

但**还没完全证明“轮抽建房 -> 选牌 -> 组卡 -> 对战”的整条业务链就一定无坑**。

### 完成标准

至少形成一份记录：

- 实际操作步骤
- 是否成功
- 卡在哪一步
- 如果失败，具体前端/后端日志

补充说明：

- 现在已证明：
  - `/neos/duelroom -> /neos/duel` 可以进入
  - 手牌可以正确装载到 DOM
  - 主阶段通常召唤、普通魔法发动、墓地诱发检索、`CHAIN_SOLVED` / `CHAIN_END` 都能在真实 UI 里走通
- 当前未完全覆盖的是：
  - 完整 cube-draft 业务流的浏览器自动化
  - 更多类型的 duel 主阶段动作消息兼容

---

## P1：清理遗留对战 JSON 消息

### 现状

`server/src/ws/index.js` 中还保留：

- `duel_start`
- `duel_respond`
- `battle_start`
- `battle_respond`

当前主路径实际上已经不靠它们执行对战。

### 建议

二选一：

1. **彻底删除遗留路径**
2. **明确标成 deprecated，并统一返回错误**

### 完成标准

- 代码里不再存在“看起来能用，实际上不会走通”的假入口
- 文档同步更新

---

## P1：补自动化端到端测试

### 目标

至少有一套脚本能验证：

- room 创建
- ws join / draft
- battle table
- YDK 提交
- `duel_launch_neos`

### 备注

当前已有：

- `server/test-ygopro-ws.js`
- `server/test-room-lifecycle.mjs`

但这只是 duel 协议层测试，不是完整业务流测试。

---

## P2：梳理缺脚本卡的影响范围

### 现状

日志里出现过类似：

- `Skipping ... cards without scripts`

这说明某些卡的 Lua 不存在或未加载到。

### 建议

- 记录哪些卡常缺
- 判断这些缺失是环境问题、数据问题，还是测试牌组问题
- 评估是否需要在 UI 层明确提示

---

## P2：统一文案与真实入口

### 现状

虽然这轮已经修了一部分，但项目仍然容易出现：

- README 说一套
- 页面提示说一套
- 真实路径又是另一套

### 建议

后续如果再改入口，必须同步检查：

- `README.md`
- `client/src/room.js`
- `server/src/index.js`
- `server/src/ws/index.js`
- `llm-docs/DEBUGGING_RUNBOOK.md`

---

## 不建议现在优先做的事

这些不是不能做，而是**现在性价比不高**：

1. 大规模重写 neos-client 内部结构
2. 先做 UI 美化而不做链路验证
3. 在没跑通真实浏览器流程前，过度清理“看起来脏”的代码

先把真实路径验证扎实，再谈大重构。 
